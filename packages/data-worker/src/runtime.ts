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
  type RowData,
  type SortField,
  type SparseRowMap,
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
  REPAGE_DEBOUNCE_MS,
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

/**
 * A repage scheduled by `maybeScheduleRepage` but not yet fired -- the
 * worker-side half of plan §4's "~150ms debounce" (there is no `sub.window`
 * message from the main thread for this path; the worker decides on its
 * own, per §3's `sub.viewport` gotcha table entry). `flush()` fires it once
 * `REPAGE_DEBOUNCE_MS` has passed since the *last* `sub.viewport` that
 * touched it, so a scroll fling collapses to one re-subscription.
 */
interface PendingRepage {
  readonly skipN: number;
  /** Local (already skip-adjusted) viewport range to seed the re-opened subscription's projection with, so the user's scroll position survives the repage instead of resetting to the top of the new window. */
  readonly localFirstRow: number;
  readonly localLastRow: number;
  readonly requestedAt: number;
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
  /** True row count to report once `spec.window` is set (plan §4/M4b -- see `SubOpenRequest.rowCountHint`, protocol/requests.ts). `undefined` falls back to `sortIndex.length`. */
  rowCountHint: number | undefined;
  /** Debounced worker-triggered repage, if one is due (plan §4/C5). */
  pendingRepage: PendingRepage | undefined;
  conflator: DirtyKeyConflator;
  projection: ViewportProjection;
  inSnapshot: boolean;
  snapshotRowCount: number;
  lastProgressAt: number;
  updatesApplied: number;
  lastTickAt: number;
  lastStatsAt: number;
}

/** Options threaded through `createState`/`openWithSpec`/`reissue` -- grouped because every re-subscription path (filter change, server-sort change, explicit or worker-triggered repage) needs to carry the same handful of things forward (plan §3/§4). */
interface OpenOptions {
  readonly sortFields: readonly SortField[];
  readonly clientFilter: ClientFilterSpec | undefined;
  readonly rowCountHint?: number;
  /** Seeds the new subscription's viewport projection instead of defaulting to the top (plan §4: a worker-triggered repage must preserve the user's scroll position). */
  readonly initialViewport?: { readonly firstRow: number; readonly lastRow: number };
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
   * `options.sortFields` empty means "no explicit sort yet" -- falls back to
   * `keyField ASC` (M2's original default). Every field on `options` is
   * carried forward by the caller across a filter/sort/window re-issue so
   * re-opening never silently resets state that logically survives it (plan
   * §3/§4) -- see `OpenOptions`'s own doc comment.
   */
  function createState(
    spec: SubscriptionSpec,
    epoch: Epoch,
    options: OpenOptions,
  ): SubscriptionState {
    const rowStore = new RowStore();
    const fields =
      options.sortFields.length > 0
        ? options.sortFields
        : [{ field: spec.keyField, direction: 'asc' as const }];
    const sortIndex = new SortIndex(createKeyComparator(rowStore, createFieldComparator(fields)));
    const projection = new ViewportProjection(DEFAULT_OVERSCAN_ROWS, DEFAULT_INITIAL_WINDOW_ROWS);
    if (options.initialViewport) {
      // Raw range is stored immediately; the real clamp happens once the
      // snapshot completes and the actual row count is known (`reclamp`,
      // called from `onSnapshotComplete` below) -- this is how a
      // worker-triggered repage (plan §4) restores the exact viewport the
      // user was scrolled to instead of resetting to the top of the window.
      projection.setRange(options.initialViewport.firstRow, options.initialViewport.lastRow, 0);
    }
    return {
      epoch,
      spec,
      rowStore,
      sortIndex,
      sortFields: fields,
      clientFilter: options.clientFilter,
      rowCountHint: options.rowCountHint,
      pendingRepage: undefined,
      conflator: new DirtyKeyConflator(clock),
      projection,
      inSnapshot: true,
      snapshotRowCount: 0,
      lastProgressAt: 0,
      updatesApplied: 0,
      lastTickAt: 0,
      lastStatsAt: 0,
    };
  }

  /** The row count to report to the main thread (plan §4/M4b): the true total once a `rowCountHint` is known, else whatever is actually loaded. */
  function reportedRowCount(state: SubscriptionState): number {
    return state.rowCountHint ?? state.sortIndex.length;
  }

  /** The AMPS-side pagination offset this subscription is currently loaded at, or 0 for an unwindowed one. */
  function skipOf(state: SubscriptionState): number {
    return state.spec.window?.skipN ?? 0;
  }

  /**
   * Re-keys a `SparseRowMap`'s local (sortIndex-relative) indices into the
   * AMPS-paginated window's global row space by adding `skip` -- e.g. index
   * 0 in a subscription windowed at `skip_n=2000` is global row 2000, which
   * is what AG Grid's viewport row model expects (plan §4). A `skip` of 0
   * (the common, unwindowed case -- `orders`, or any details subscription
   * before its first repage) returns the same object, no allocation.
   */
  function toGlobalRows(rows: SparseRowMap, skip: number): SparseRowMap {
    if (skip === 0) return rows;
    const shifted: Record<number, RowData> = {};
    for (const [index, row] of Object.entries(rows)) {
      shifted[Number(index) + skip] = row;
    }
    return shifted;
  }

  /**
   * Enforces the AMPS-side `top_n` boundary locally (plan §4 CORRECTED /
   * carry-forward C5, mandatory): a live paginated subscription pushes
   * newly-qualifying rows into the window as their rank improves, but AMPS
   * never sends `oof` for a row that falls back OUT of the top_n (measured:
   * `/lastUpdated DESC`, top_n=1000, 37,748 rows displaced, zero `oof`).
   * Without this the row store grows without bound. Trims from the tail of
   * the sort index -- its comparator is built from the same `sortFields`
   * carried forward alongside `spec.window` on every re-issue (`reissue`
   * below), mirroring the AMPS `orderBy` that produced this window, so the
   * worst-ranked keys are always at the end (sort-index.ts).
   */
  function trimToWindow(state: SubscriptionState): void {
    const topN = state.spec.window?.topN;
    if (topN === undefined) return;
    while (state.sortIndex.length > topN) {
      const key = state.sortIndex.keyAt(state.sortIndex.length - 1);
      if (key === undefined) break;
      state.sortIndex.removeKey(key);
      state.rowStore.delete(key);
    }
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
      rowCount: reportedRowCount(state),
      rows: toGlobalRows(rows, skipOf(state)),
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
      rowCount: reportedRowCount(state),
    });
    resetWindow(subId, state);
  }

  /**
   * The mirror image of `onRowLeavesView`: a row not currently in the sort
   * index starts belonging there -- either plan D3's client-filter case (a
   * row starts matching after a delta) or, for a paginated details window,
   * a row newly ranking into the AMPS `top_n` boundary that this client has
   * never seen before (plan §4/C5 CORRECTED). Insert it at its correct
   * position, enforce the `top_n` boundary locally (`trimToWindow` -- AMPS
   * never `oof`s a row that falls back out of rank), then send a fresh
   * window -- a structural change, not a diff (plan §3), same as an `oof`
   * removal.
   */
  function onRowEntersView(subId: SubscriptionId, state: SubscriptionState, key: string): void {
    state.sortIndex.insertKey(key);
    trimToWindow(state);
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
        // Defensive (plan §4/C5): AMPS's own `top_n` should already cap a
        // paginated snapshot at this size, but enforcing it here too costs
        // nothing and guards against any edge case landing more rows than
        // requested.
        trimToWindow(state);
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

        if (!existing) {
          // A key neither in the snapshot nor previously delivered live.
          // Two ways this happens: plan D3's client-filter case (a row
          // starts matching only after this delta), or -- far more common
          // for a live paginated details window -- plan §4/C5 CORRECTED: a
          // row newly ranking into the AMPS `top_n` boundary. Either way it
          // arrives as a raw partial patch (CLIENT.md: a delta carries only
          // the changed fields), stored as-is since there is no prior
          // record to merge it into; `onRowEntersView` (which enforces
          // `trimToWindow`) is what keeps a windowed subscription bounded
          // once this happens repeatedly.
          state.rowStore.set(key, patch);
          state.updatesApplied++;
          state.lastTickAt = clock();
          if (matchesClientFilter(patch, state.clientFilter)) {
            onRowEntersView(subId, state, key);
          }
          return;
        }

        const row = mergeDelta(existing, patch);
        state.updatesApplied++;
        state.lastTickAt = clock();

        // No client filter active (the common case, and the only one M2
        // exercised) -- every row already in `rowStore` is already in
        // `sortIndex` too (that invariant is what the `!existing` branch
        // above maintains), so skip straight to the fast path rather than
        // paying an extra sortIndex lookup per tick on a hot path that can
        // run at ~2,500 updates/sec (CLIENT.md).
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

  /**
   * Waits out any in-flight `conn.open` before touching the AMPS
   * connection. Fixes a real race (found in browser verification, not
   * caught by unit tests because the fake `AmpsConnectionLike` they use
   * connects synchronously): a consumer that calls `client.connect(...)`
   * then `client.openSubscription(...)` back-to-back posts `conn.open` and
   * `sub.open` in the same tick. `handleConnOpen` starts the (async)
   * handshake and returns without blocking the worker's `onmessage` queue,
   * so `sub.open` can reach `openWithSpec` while `connectPromise` is still
   * pending -- without this wait, `AmpsConnection.openSubscription` throws
   * "not connected" and the subscription is dead on arrival, even though
   * the connection succeeds moments later. No-op if nothing is in flight
   * (already connected, or `conn.open` was never sent -- the latter is a
   * genuine caller bug this doesn't newly paper over).
   */
  async function awaitConnection(): Promise<void> {
    if (connectPromise) await connectPromise;
  }

  async function openWithSpec(
    subId: SubscriptionId,
    spec: SubscriptionSpec,
    epoch: Epoch,
    options: OpenOptions,
  ): Promise<void> {
    const state = createState(spec, epoch, options);
    subscriptions.set(subId, state);
    await awaitConnection();
    await connection.openSubscription(subId, spec, buildSink(subId, state));
  }

  /**
   * Closes the current AMPS subscription and re-opens it under a new epoch
   * with `specPatch` merged over the previous spec, carrying `options`
   * forward. The shared shape behind a filter change, a server-sort change,
   * an explicit `sub.window` repage, and a worker-triggered repage
   * (`performRepage` below) -- all four replace *what* AMPS sends while
   * keeping *how it's viewed* (plan §3/§4).
   */
  async function reissue(
    subId: SubscriptionId,
    state: SubscriptionState,
    specPatch: Partial<SubscriptionSpec>,
    epoch: Epoch,
    options: OpenOptions,
  ): Promise<void> {
    await connection.closeSubscription(subId);
    await openWithSpec(subId, { ...state.spec, ...specPatch }, epoch, options);
  }

  /**
   * Fires a repage scheduled by `maybeScheduleRepage` once its debounce has
   * elapsed (`flush()` below). Guards against the subscription having moved
   * on since it was scheduled -- a filter change, a sort change, or a tab
   * close all replace or remove `subscriptions.get(subId)` before this
   * fires, and `reissue`ing against a stale `state` would resurrect a
   * superseded (or closed) subscription.
   */
  async function performRepage(
    subId: SubscriptionId,
    state: SubscriptionState,
    repage: PendingRepage,
  ): Promise<void> {
    if (subscriptions.get(subId) !== state) return; // superseded meanwhile
    const window = state.spec.window;
    if (!window) return;
    await reissue(
      subId,
      state,
      { window: { topN: window.topN, skipN: repage.skipN } },
      state.epoch,
      {
        sortFields: state.sortFields,
        clientFilter: state.clientFilter,
        rowCountHint: state.rowCountHint,
        initialViewport: { firstRow: repage.localFirstRow, lastRow: repage.localLastRow },
      },
    );
  }

  /**
   * Decides whether the just-received `sub.viewport` range needs the
   * AMPS-side window repaged (plan §4: "scrolling past the loaded window
   * repages"). `globalFirstRow`/`globalLastRow` are AG Grid's absolute row
   * numbers -- the *reported* row count (plan §4's true total, e.g.
   * `sum(childCount)`), not the local sort index, which only ever holds
   * `window.topN` keys at a time. Debounced ~150ms (constants.ts) via
   * `state.pendingRepage`, checked by `flush()` -- the worker's only timer
   * (plan §3 gotcha: no `requestAnimationFrame` here).
   */
  function maybeScheduleRepage(
    state: SubscriptionState,
    globalFirstRow: number,
    globalLastRow: number,
  ): void {
    const window = state.spec.window;
    if (!window) return;

    const loadedStart = window.skipN;
    const loadedEnd = window.skipN + window.topN - 1;
    const desiredStart = Math.max(0, globalFirstRow - DEFAULT_OVERSCAN_ROWS);
    const desiredEnd = globalLastRow + DEFAULT_OVERSCAN_ROWS;
    if (desiredStart >= loadedStart && desiredEnd <= loadedEnd) {
      state.pendingRepage = undefined; // already covered by the current window
      return;
    }

    const maxSkip = Math.max(0, reportedRowCount(state) - window.topN);
    const nextSkip = Math.min(maxSkip, desiredStart);
    if (nextSkip === window.skipN) return; // pinned at a boundary AMPS already gives us (e.g. the very end)

    state.pendingRepage = {
      skipN: nextSkip,
      localFirstRow: Math.max(0, globalFirstRow - nextSkip),
      localLastRow: Math.max(0, globalLastRow - nextSkip),
      requestedAt: clock(),
    };
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
      window: msg.window,
    };
    // A `sort` at open time only ever means 'local' -- a 'server' sort is
    // expressed directly as `msg.orderBy` above, since there is no
    // subscription yet to re-issue (protocol §3).
    const sortFields = msg.sort?.mode === 'local' ? msg.sort.fields : [];
    await openWithSpec(msg.subId, spec, msg.epoch, {
      sortFields,
      clientFilter: msg.clientFilter,
      rowCountHint: msg.rowCountHint,
    });
    post({ v: PROTOCOL_VERSION, type: 'sub.opened', subId: msg.subId, epoch: msg.epoch });
  }

  async function handleSubUpdate(msg: SubUpdateRequest): Promise<void> {
    const state = subscriptions.get(msg.subId);
    if (!state) return;
    if (isStaleEpoch(state.epoch, msg.epoch)) return; // superseded request -- discard (plan §3)

    if (msg.filter !== undefined) {
      // A filter change re-issues to AMPS entirely and starts a fresh
      // snapshot under the new epoch (plan §3). CORRECTED from the
      // original comment here ("any window is not carried forward"): for a
      // *windowed* subscription (plan §4's paginated details grid), the
      // `top_n` bound MUST carry forward too, just reset to `skip_n=0` (a
      // new selection is a new dataset "from the top" of its own ranking,
      // not an unbounded one) -- dropping the window entirely on every
      // selection change would try to stream the whole new selection
      // unbounded, exactly the hazard `top_n` exists to prevent. Sort and
      // client filter also carry forward: they describe how to view
      // whatever comes back, independent of which AMPS filter produced it.
      await reissue(
        msg.subId,
        state,
        {
          filter: msg.filter,
          window: state.spec.window ? { topN: state.spec.window.topN, skipN: 0 } : undefined,
        },
        msg.epoch,
        {
          sortFields: msg.sort?.mode === 'local' ? msg.sort.fields : state.sortFields,
          clientFilter: msg.clientFilter ?? state.clientFilter,
          rowCountHint: msg.rowCountHint ?? state.rowCountHint,
        },
      );
      return;
    }

    if (msg.sort?.mode === 'server') {
      // Details-topic path (plan amended §4): sorting up to 1.5M rows in JS
      // is a non-starter, so a server-sort change re-issues the
      // subscription with a new AMPS `orderBy` instead of re-indexing
      // locally. The window (if any) is preserved -- only the ranking
      // AMPS uses to fill it changes.
      await reissue(msg.subId, state, { orderBy: buildOrderBy(msg.sort.fields) }, msg.epoch, {
        sortFields: msg.sort.fields,
        clientFilter: msg.clientFilter ?? state.clientFilter,
        rowCountHint: msg.rowCountHint ?? state.rowCountHint,
      });
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
    const skip = skipOf(state);
    const previousStart = state.projection.windowStart;
    const previousEnd = state.projection.windowEnd;
    // AG Grid's row numbers are global (plan §4); the local projection --
    // and `sortIndex`/`rowStore`, which only ever hold `window.topN` keys --
    // work in window-relative coordinates, so convert before clamping.
    state.projection.setRange(
      Math.max(0, msg.firstRow - skip),
      Math.max(0, msg.lastRow - skip),
      state.sortIndex.length,
    );
    // A windowed subscription may need its AMPS-side `skip_n` moved instead
    // of (or in addition to) a local reclamp -- decided in global
    // coordinates, independently of the local clamp above (plan §4).
    maybeScheduleRepage(state, msg.firstRow, msg.lastRow);
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
    // window (`options('top_n=take,skip_n=skip')`). Sort/filter/rowCountHint
    // carry forward the same way a filter change does (plan §4).
    await reissue(msg.subId, state, { window: { topN: msg.take, skipN: msg.skip } }, msg.epoch, {
      sortFields: state.sortFields,
      clientFilter: state.clientFilter,
      rowCountHint: state.rowCountHint,
    });
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
          post({
            v: PROTOCOL_VERSION,
            type: 'rows.patch',
            subId,
            epoch: state.epoch,
            rows: toGlobalRows(patch, skipOf(state)),
          });
        }
      }
      if (now - state.lastStatsAt >= STATS_INTERVAL_MS) {
        state.lastStatsAt = now;
        post({
          v: PROTOCOL_VERSION,
          type: 'stats',
          subId,
          epoch: state.epoch,
          rowCount: reportedRowCount(state), // true total once windowed (plan §4/M4b), else the visible post-client-filter count (plan D3)
          updatesApplied: state.updatesApplied,
          lastTickAt: state.lastTickAt,
          window: state.spec.window,
        });
      }
      // Worker-triggered repage, debounced (plan §4/C5): fires once
      // `REPAGE_DEBOUNCE_MS` has passed since the last `sub.viewport` that
      // scheduled or re-scheduled it (`maybeScheduleRepage`). Async and
      // fire-and-forget like the rest of this pipeline's re-subscription
      // paths -- errors are posted as `error` events rather than thrown
      // across the worker boundary (plan §3).
      if (state.pendingRepage && now - state.pendingRepage.requestedAt >= REPAGE_DEBOUNCE_MS) {
        const repage = state.pendingRepage;
        state.pendingRepage = undefined;
        void performRepage(subId, state, repage).catch((error: unknown) => {
          post({
            v: PROTOCOL_VERSION,
            type: 'error',
            subId,
            epoch: state.epoch,
            code: 'repage-failed',
            message: error instanceof Error ? error.message : String(error),
            fatal: false,
          });
        });
      }
    }
  }

  return { handleMessage, flush };
}
