// createWorkerRuntime -- the worker-side update pipeline (plan §3), factored
// out of the actual `self.onmessage`/`setInterval` wiring (index.ts) so it
// is 100% `bun test`-able with a fake `AmpsConnectionLike`, a captured
// `post()`, and an injected clock -- the same "no timers/globals baked in"
// discipline `viewport-core` uses.
//
// Owns: `onmessage` dispatch per request type, epoch enforcement (drop any
// request whose epoch is behind the subscription's current one), and the
// conflation flush (`flush()`, meant to be driven by a ~16ms timer -- there
// is no `requestAnimationFrame` in a dedicated worker).
//
// Wires together `@amps-ui/amps-client` (transport + delta merge + orderBy
// translation) and `@amps-ui/viewport-core` (row store, sort index, client
// filter predicate, window, sparse patches).
// Depends on: `@amps-ui/amps-client`, `@amps-ui/viewport-core`, `@amps-ui/protocol`.
import { buildOrderBy, mergeDelta } from '@amps-ui/amps-client';
import type { ConnStateEvent, SubscriptionSink, SubscriptionSpec } from '@amps-ui/amps-client';
import {
  type ClientFilterSpec,
  type ConnOpenRequest,
  type Epoch,
  PROTOCOL_VERSION,
  type PingRequest,
  type SortField,
  type SubCloseRequest,
  type SubOpenRequest,
  type SubUpdateRequest,
  type SubViewportRequest,
  type SubWindowRequest,
  type SubscriptionId,
  type WorkerEvent,
  type WorkerRequest,
  isStaleEpoch,
} from '@amps-ui/protocol';
import {
  DirtyKeyConflator,
  RowStore,
  SortIndex,
  ViewportProjection,
  buildSparsePatch,
  buildWindowSnapshot,
  createFieldComparator,
  createKeyComparator,
  matchesClientFilter,
} from '@amps-ui/viewport-core';
import {
  DEFAULT_INITIAL_WINDOW_ROWS,
  DEFAULT_OVERSCAN_ROWS,
  FLUSH_INTERVAL_MS,
  SNAPSHOT_PROGRESS_THROTTLE_MS,
  STATS_INTERVAL_MS,
} from './constants';

/** The subset of `AmpsConnection`'s public surface this runtime drives -- lets tests supply a fake with zero network I/O. */
export interface AmpsConnectionLike {
  connect(uri: string, clientName: string): Promise<void>;
  disconnect(): Promise<void>;
  onState(listener: (event: ConnStateEvent) => void): () => void;
  openSubscription(
    subId: SubscriptionId,
    spec: SubscriptionSpec,
    sink: SubscriptionSink,
  ): Promise<void>;
  closeSubscription(subId: SubscriptionId): Promise<void>;
}

export interface WorkerRuntimeDeps {
  readonly connection: AmpsConnectionLike;
  readonly post: (event: WorkerEvent) => void;
  /** Injected clock (plan §1) -- keeps the flush/progress/stats timing 100% `bun test`-able. */
  readonly clock: () => number;
}

interface SubscriptionState {
  epoch: Epoch;
  spec: SubscriptionSpec;
  rowStore: RowStore;
  sortIndex: SortIndex;
  /** Fields the local sort index is currently ordered by -- carried forward across a filter/window re-issue so a re-opened subscription's initial local order still matches (plan §3/§4). */
  sortFields: readonly SortField[];
  /** Client-side column filter (plan D3), applied over `rowStore` to decide `sortIndex` membership. `undefined` means "everything loaded is visible". */
  clientFilter: ClientFilterSpec | undefined;
  conflator: DirtyKeyConflator;
  projection: ViewportProjection;
  inSnapshot: boolean;
  snapshotRowCount: number;
  lastProgressAt: number;
  updatesApplied: number;
  lastTickAt: number;
  lastStatsAt: number;
}

export interface WorkerRuntime {
  handleMessage(request: WorkerRequest): Promise<void>;
  /** Drives the ~16ms conflation flush. Call this from a `setInterval` in the real worker. */
  flush(): void;
}

export function createWorkerRuntime(deps: WorkerRuntimeDeps): WorkerRuntime {
  const { connection, post, clock } = deps;
  const subscriptions = new Map<SubscriptionId, SubscriptionState>();
  let connectPromise: Promise<void> | null = null;

  connection.onState((event) => {
    post({
      v: PROTOCOL_VERSION,
      type: 'conn.state',
      state: event.state,
      attempt: event.attempt,
      error: event.error,
    });
  });

  /**
   * @param sortFields Local sort order to build the initial comparator from.
   *   Empty means "no explicit sort yet" -- falls back to `keyField ASC`
   *   (M2's original default). Carried forward by the caller across a
   *   filter/window re-issue so re-opening doesn't silently reset the sort.
   * @param clientFilter Carried forward the same way (plan D3).
   */
  function createState(
    spec: SubscriptionSpec,
    epoch: Epoch,
    sortFields: readonly SortField[],
    clientFilter: ClientFilterSpec | undefined,
  ): SubscriptionState {
    const rowStore = new RowStore();
    const fields =
      sortFields.length > 0 ? sortFields : [{ field: spec.keyField, direction: 'asc' as const }];
    const sortIndex = new SortIndex(createKeyComparator(rowStore, createFieldComparator(fields)));
    return {
      epoch,
      spec,
      rowStore,
      sortIndex,
      sortFields: fields,
      clientFilter,
      conflator: new DirtyKeyConflator(clock),
      projection: new ViewportProjection(DEFAULT_OVERSCAN_ROWS, DEFAULT_INITIAL_WINDOW_ROWS),
      inSnapshot: true,
      snapshotRowCount: 0,
      lastProgressAt: 0,
      updatesApplied: 0,
      lastTickAt: 0,
      lastStatsAt: 0,
    };
  }

  /**
   * Rebuilds `sortIndex`'s key set from scratch against `state.clientFilter`
   * (plan D3): every loaded row that currently matches is visible, in
   * sorted order; everything else is excluded. Used whenever the filter
   * itself changes, or the underlying data set is replaced wholesale (a
   * fresh snapshot) -- NOT for a single row's membership flipping on a
   * delta, which is cheaper to handle incrementally (see `onRowEntersView`/
   * `onRowLeavesView` below).
   */
  function refreshVisibleKeys(state: SubscriptionState): void {
    const keys = Array.from(state.rowStore.keys()).filter((key) => {
      const row = state.rowStore.get(key);
      return row !== undefined && matchesClientFilter(row, state.clientFilter);
    });
    state.sortIndex.setKeys(keys);
  }

  /**
   * `rowCount` here is `sortIndex.length` -- the *visible* (post-client-
   * filter) row count, not the total loaded in `rowStore` -- so the footer
   * reads "rows in subscription" accurately once a client filter narrows
   * what's shown (plan D3).
   */
  function resetWindow(subId: SubscriptionId, state: SubscriptionState): void {
    const rows = buildWindowSnapshot(
      state.rowStore,
      state.sortIndex,
      state.projection.windowStart,
      state.projection.windowEnd,
    );
    post({
      v: PROTOCOL_VERSION,
      type: 'rows.reset',
      subId,
      epoch: state.epoch,
      rowCount: state.sortIndex.length,
      rows,
    });
  }

  /**
   * A row leaves the visible set -- either AMPS `oof` (no longer matches
   * the AMPS-side filter, so the caller also deletes it from `rowStore`) or
   * a client-side filter exclusion after a delta (row stays in `rowStore`,
   * just drops out of `sortIndex`). Either way the index needs the same
   * repair: remove the key, reclamp the window against the smaller visible
   * count, and tell the main thread via `rows.removed` (selection cleanup)
   * followed by a fresh `rows.reset` (index shift -- plan §3 "Structural
   * change").
   */
  function onRowLeavesView(subId: SubscriptionId, state: SubscriptionState, key: string): void {
    state.sortIndex.removeKey(key);
    state.projection.reclamp(state.sortIndex.length);
    post({
      v: PROTOCOL_VERSION,
      type: 'rows.removed',
      subId,
      epoch: state.epoch,
      keys: [key],
      rowCount: state.sortIndex.length,
    });
    resetWindow(subId, state);
  }

  /**
   * The mirror image of `onRowLeavesView`: a row already in `rowStore`
   * starts matching the client filter after a delta. Insert it into the
   * sort index at its correct position and send a fresh window -- a
   * structural change, not a diff (plan §3), same as an `oof` removal.
   */
  function onRowEntersView(subId: SubscriptionId, state: SubscriptionState, key: string): void {
    state.sortIndex.insertKey(key);
    state.projection.reclamp(state.sortIndex.length);
    resetWindow(subId, state);
  }

  function buildSink(subId: SubscriptionId, state: SubscriptionState): SubscriptionSink {
    return {
      onSnapshotBegin: () => {
        state.inSnapshot = true;
        state.snapshotRowCount = 0;
        state.lastProgressAt = 0;
      },
      onSowRow: (key, row) => {
        state.rowStore.set(key, row);
        state.snapshotRowCount++;
        const now = clock();
        if (now - state.lastProgressAt >= SNAPSHOT_PROGRESS_THROTTLE_MS) {
          state.lastProgressAt = now;
          post({
            v: PROTOCOL_VERSION,
            type: 'snapshot.progress',
            subId,
            epoch: state.epoch,
            received: state.snapshotRowCount,
          });
        }
      },
      onSnapshotComplete: (rowCount, elapsedMs) => {
        state.inSnapshot = false;
        // Suppressed per-row patches during the snapshot (plan §3 step 4) --
        // this is the one and only rows.reset for the load, covering just
        // the current window; the rest of RowStore is loaded but unsent
        // until the viewport moves over it (sub.viewport handling below).
        // Applies any carried-forward client filter (plan D3) rather than
        // indexing every loaded row unconditionally.
        refreshVisibleKeys(state);
        state.projection.reclamp(state.sortIndex.length);
        resetWindow(subId, state);
        post({
          v: PROTOCOL_VERSION,
          type: 'snapshot.complete',
          subId,
          epoch: state.epoch,
          // The raw AMPS-delivered count -- distinct from resetWindow's
          // filtered `sortIndex.length` (plan §3: this event is "loaded",
          // not "currently visible").
          rowCount,
          elapsedMs,
        });
      },
      onDelta: (key, patch) => {
        const existing = state.rowStore.get(key);
        const row = existing ? mergeDelta(existing, patch) : patch;
        if (!existing) state.rowStore.set(key, row); // defensive: a delta with no prior sow row (shouldn't happen for this protocol)
        state.updatesApplied++;
        state.lastTickAt = clock();

        // No client filter active (the common case, and the only one M2
        // exercised) -- every row is always visible, so skip straight to
        // the fast path rather than paying an extra sortIndex lookup per
        // tick on a hot path that can run at ~2,500 updates/sec (CLIENT.md).
        if (!state.clientFilter) {
          state.conflator.mark(key);
          return;
        }

        // A client filter (plan D3) can flip a row's visibility on every
        // tick -- e.g. a live-column range filter, the same churn the
        // amended plan §4 spike observed for paginated AMPS ordering.
        // That's real behaviour to handle, not an error.
        const wasVisible = state.sortIndex.indexOf(key) !== undefined;
        const isVisible = matchesClientFilter(row, state.clientFilter);
        if (wasVisible && !isVisible) {
          onRowLeavesView(subId, state, key);
        } else if (!wasVisible && isVisible) {
          onRowEntersView(subId, state, key);
        } else if (isVisible) {
          state.conflator.mark(key);
        }
        // else: still hidden by the filter -- nothing to send.
      },
      onOof: (key) => {
        // AMPS itself says this row no longer matches the *AMPS-side*
        // filter, so it's gone for good, unlike a client-filter exclusion
        // (onRowLeavesView alone, row kept in rowStore).
        state.rowStore.delete(key);
        onRowLeavesView(subId, state, key);
      },
    };
  }

  async function openWithSpec(
    subId: SubscriptionId,
    spec: SubscriptionSpec,
    epoch: Epoch,
    sortFields: readonly SortField[],
    clientFilter: ClientFilterSpec | undefined,
  ): Promise<void> {
    const state = createState(spec, epoch, sortFields, clientFilter);
    subscriptions.set(subId, state);
    await connection.openSubscription(subId, spec, buildSink(subId, state));
  }

  /**
   * Closes the current AMPS subscription and re-opens it under a new epoch
   * with `specPatch` merged over the previous spec, carrying `sortFields`/
   * `clientFilter` forward. The shared shape behind a filter change, a
   * server-sort change, and an explicit `sub.window` repage (plan §3/§4) --
   * all three replace *what* AMPS sends while keeping *how it's viewed*.
   */
  async function reissue(
    subId: SubscriptionId,
    state: SubscriptionState,
    specPatch: Partial<SubscriptionSpec>,
    epoch: Epoch,
    sortFields: readonly SortField[],
    clientFilter: ClientFilterSpec | undefined,
  ): Promise<void> {
    await connection.closeSubscription(subId);
    await openWithSpec(subId, { ...state.spec, ...specPatch }, epoch, sortFields, clientFilter);
  }

  async function handleConnOpen(msg: ConnOpenRequest): Promise<void> {
    if (connectPromise) {
      await connectPromise;
      return;
    }
    connectPromise = connection.connect(msg.uri, msg.clientName).catch((error: unknown) => {
      connectPromise = null; // let a future conn.open retry from scratch
      throw error;
    });
    await connectPromise;
  }

  async function handleConnClose(): Promise<void> {
    connectPromise = null;
    await connection.disconnect();
  }

  async function handleSubOpen(msg: SubOpenRequest): Promise<void> {
    const spec: SubscriptionSpec = {
      topic: msg.topic,
      mode: msg.mode,
      filter: msg.filter,
      orderBy: msg.orderBy,
      batchSize: msg.batchSize,
      keyField: msg.keyField,
    };
    // A `sort` at open time only ever means 'local' -- a 'server' sort is
    // expressed directly as `msg.orderBy` above, since there is no
    // subscription yet to re-issue (protocol §3).
    const sortFields = msg.sort?.mode === 'local' ? msg.sort.fields : [];
    await openWithSpec(msg.subId, spec, msg.epoch, sortFields, msg.clientFilter);
    post({ v: PROTOCOL_VERSION, type: 'sub.opened', subId: msg.subId, epoch: msg.epoch });
  }

  async function handleSubUpdate(msg: SubUpdateRequest): Promise<void> {
    const state = subscriptions.get(msg.subId);
    if (!state) return;
    if (isStaleEpoch(state.epoch, msg.epoch)) return; // superseded request -- discard (plan §3)

    if (msg.filter !== undefined) {
      // A filter change re-issues to AMPS entirely and starts a fresh
      // snapshot under the new epoch (plan §3); any window is not carried
      // forward -- a new filter means a new dataset from the top. Sort and
      // client filter DO carry forward: they describe how to view whatever
      // comes back, independent of which AMPS filter produced it.
      await reissue(
        msg.subId,
        state,
        { filter: msg.filter, window: undefined },
        msg.epoch,
        msg.sort?.mode === 'local' ? msg.sort.fields : state.sortFields,
        msg.clientFilter ?? state.clientFilter,
      );
      return;
    }

    if (msg.sort?.mode === 'server') {
      // Details-topic path (plan amended §4): sorting up to 1.5M rows in JS
      // is a non-starter, so a server-sort change re-issues the
      // subscription with a new AMPS `orderBy` instead of re-indexing
      // locally. The window (if any) is preserved -- only the ranking
      // AMPS uses to fill it changes.
      await reissue(
        msg.subId,
        state,
        { orderBy: buildOrderBy(msg.sort.fields) },
        msg.epoch,
        msg.sort.fields,
        msg.clientFilter ?? state.clientFilter,
      );
      return;
    }

    // Sort(local)/clientFilter-only change: re-index in place, no network
    // round trip. Both can arrive in the same message (e.g. a combined
    // AG Grid sortChanged + filterChanged batch) -- apply both, then send
    // one rows.reset rather than one per field, avoiding a redundant extra
    // apply on the main thread (same "no redundant work" principle as the
    // sub.viewport coalescing above).
    state.epoch = msg.epoch;
    let needsReset = false;
    if (msg.sort?.mode === 'local') {
      state.sortFields = msg.sort.fields;
      state.sortIndex.resort(
        createKeyComparator(state.rowStore, createFieldComparator(state.sortFields)),
      );
      needsReset = true;
    }
    if (msg.clientFilter !== undefined) {
      state.clientFilter = msg.clientFilter;
      refreshVisibleKeys(state);
      state.projection.reclamp(state.sortIndex.length);
      needsReset = true;
    }
    if (needsReset) resetWindow(msg.subId, state);
  }

  async function handleSubClose(msg: SubCloseRequest): Promise<void> {
    if (!subscriptions.delete(msg.subId)) return;
    await connection.closeSubscription(msg.subId);
  }

  function handleSubViewport(msg: SubViewportRequest): void {
    const state = subscriptions.get(msg.subId);
    if (!state) return;
    const previousStart = state.projection.windowStart;
    const previousEnd = state.projection.windowEnd;
    state.projection.setRange(msg.firstRow, msg.lastRow, state.sortIndex.length);
    if (state.inSnapshot) return; // group_end's own rows.reset will already cover the current window
    // The main thread already coalesces rapid `setViewportRange` calls
    // before sending (plan §3); this is the worker-side half of that same
    // guarantee -- if the clamped window didn't actually move (e.g. a
    // sub-pixel scroll that overscan already covered), skip the redundant
    // rows.reset entirely rather than resending data the main thread
    // already has (M3A).
    if (
      state.projection.windowStart === previousStart &&
      state.projection.windowEnd === previousEnd
    ) {
      return;
    }
    // The new window may include rows never sent to the main thread (only
    // the previous window's data was pushed) -- resend it in full rather
    // than relying on rows.patch, which only carries diffs (plan §3).
    resetWindow(msg.subId, state);
  }

  async function handleSubWindow(msg: SubWindowRequest): Promise<void> {
    const state = subscriptions.get(msg.subId);
    if (!state) return;
    if (isStaleEpoch(state.epoch, msg.epoch)) return;
    // Explicit AMPS-side repage -- the seam for M4's paginated details
    // window (`options('top_n=take,skip_n=skip')`). Sort/filter carry
    // forward the same way a filter change does (plan §4).
    await reissue(
      msg.subId,
      state,
      { window: { topN: msg.take, skipN: msg.skip } },
      msg.epoch,
      state.sortFields,
      state.clientFilter,
    );
  }

  function handlePing(msg: PingRequest): void {
    // v2 closes the v1 gap: reply with the same nonce plus a worker-side
    // timestamp so the caller can compute an RTT (plan §10 C3).
    post({ v: PROTOCOL_VERSION, type: 'pong', nonce: msg.nonce, workerTime: clock() });
  }

  async function handleMessage(request: WorkerRequest): Promise<void> {
    switch (request.type) {
      case 'conn.open':
        return handleConnOpen(request);
      case 'conn.close':
        return handleConnClose();
      case 'sub.open':
        return handleSubOpen(request);
      case 'sub.update':
        return handleSubUpdate(request);
      case 'sub.close':
        return handleSubClose(request);
      case 'sub.viewport':
        return handleSubViewport(request);
      case 'sub.window':
        return handleSubWindow(request);
      case 'ping':
        return handlePing(request);
      default:
        return;
    }
  }

  function flush(): void {
    const now = clock();
    for (const [subId, state] of subscriptions) {
      if (!state.inSnapshot && state.conflator.isDue(FLUSH_INTERVAL_MS)) {
        const dirty = state.conflator.drain();
        const patch = buildSparsePatch(
          dirty,
          state.rowStore,
          state.sortIndex,
          state.projection.windowStart,
          state.projection.windowEnd,
        );
        if (Object.keys(patch).length > 0) {
          post({ v: PROTOCOL_VERSION, type: 'rows.patch', subId, epoch: state.epoch, rows: patch });
        }
      }
      if (now - state.lastStatsAt >= STATS_INTERVAL_MS) {
        state.lastStatsAt = now;
        post({
          v: PROTOCOL_VERSION,
          type: 'stats',
          subId,
          epoch: state.epoch,
          rowCount: state.sortIndex.length, // visible (post-client-filter) count, matching resetWindow (plan D3)
          updatesApplied: state.updatesApplied,
          lastTickAt: state.lastTickAt,
        });
      }
    }
  }

  return { handleMessage, flush };
}
