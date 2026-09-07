// Orchestrates one full `/perf` probe run for a single target row count
// (plan §6/M6): pick orders -> open a fully-windowed `order_details`
// subscription -> measure load timing -> measure frame time during a
// sustained scroll -> snapshot the JS heap at both points -> return one
// `ProbeResult`.
//
// Deliberately windows the subscription at exactly `pickOrdersForTarget`'s
// `actualSum`, not the production `WINDOW_ROWS` (2,000) -- the point of this
// probe is to load the *entire* projected size in one AMPS-paginated window
// (plan §6: "open a details subscription at controlled projected sizes ...
// by selecting orders whose childCount sums to the target"), so scrolling
// exercises rendering/tick-apply cost at that size, not a 2,000-row window's
// repage behavior (M4 already covers repaging).
//
// Reuses the *production* tuning constants from `@amps-ui/feature-order-details`
// (`DEFAULT_ORDER_BY`, `DETAILS_BATCH_SIZE`) by default, with an optional
// override so a specific run can test a candidate value against a real
// measurement (plan: "measure first, then tune").
import {
  DEFAULT_ORDER_BY,
  DETAILS_BATCH_SIZE,
  buildDetailsFilter,
} from '@amps-ui/feature-order-details';
import type { Order } from '@amps-ui/feature-orders';
import type { SubscriptionId, WorkerEvent } from '@amps-ui/protocol';
import type { DataClient, SubscriptionHandle } from '@amps-ui/worker-client';
import { type HeapSnapshot, readHeapSnapshot } from './metrics/heap';
import {
  type PatchPhaseStats,
  type PatchRates,
  computeRates,
  createPatchTracker,
} from './metrics/patch-tracker';
import { pickOrdersForTarget } from './order-picker';
import { type Distribution, summarize } from './percentile';
import { runSustainedScroll } from './scroll-driver';

export interface ProbeTimings {
  /** `sub.open` sent -> first `snapshot.progress` (data starting to arrive at the worker). `undefined` if the snapshot completed before any progress tick (small windows, throttled to <=4/sec, can finish inside one throttle interval). */
  readonly openToFirstProgressMs: number | undefined;
  /**
   * `sub.open` sent -> first non-empty `rows.reset` (the first moment any
   * row DATA reaches the main thread). Expected, per plan §3 step 4, to
   * land at essentially the same instant as `openToGroupEndMs` -- the
   * worker suppresses all per-row patches during a snapshot and only ever
   * emits row content at `group_end`. If measurement shows a real gap here,
   * that contradicts the plan's design and is worth flagging, not tuning
   * around silently.
   */
  readonly openToFirstResetMs: number | undefined;
  /** `sub.open` sent -> `snapshot.complete`, measured on the main thread (includes worker dispatch + postMessage overhead on top of the AMPS round trip). */
  readonly openToGroupEndMs: number;
  /** The worker's own `elapsedMs` on `snapshot.complete` -- AMPS round-trip time only, no worker/postMessage overhead. Compared against `openToGroupEndMs` to see how much the boundary itself costs. */
  readonly workerReportedElapsedMs: number;
}

export interface ProbeResult {
  readonly targetRows: number;
  /** Actual `sum(childCount)` of the picked orders -- see `order-picker.ts`; can be slightly under `targetRows`. */
  readonly actualRows: number;
  readonly orderCount: number;
  readonly batchSize: number;
  readonly timings: ProbeTimings;
  readonly heapAfterSnapshot: HeapSnapshot | undefined;
  readonly heapAfterScroll: HeapSnapshot | undefined;
  /** Distribution of `requestAnimationFrame` deltas (ms) during the sustained scroll -- plan §6: "report p50 and p95". 16.7ms == 60fps. */
  readonly frameTiming: Distribution;
  readonly framesOver33ms: number;
  readonly framesOver50ms: number;
  readonly totalFrames: number;
  /** Patch/reset traffic observed between `sub.open` and `snapshot.complete`. */
  readonly loadPhaseStats: PatchPhaseStats;
  /** Patch/reset traffic observed during the scroll window only. */
  readonly scrollPhaseStats: PatchPhaseStats;
  readonly scrollPhaseRates: PatchRates;
}

export interface RunProbeOptions {
  readonly client: DataClient;
  readonly subId: SubscriptionId;
  /** Already-loaded `orders` snapshot (childCount is only known once `orders` itself is loaded -- see `perf-page.tsx`). */
  readonly orders: readonly Order[];
  readonly targetRows: number;
  readonly scrollDurationMs: number;
  readonly snapshotTimeoutMs: number;
  /** Resolves once this run's grid has rendered a scrollable body in the DOM. Kept as an injected callback so this module stays React-free -- `perf-page.tsx` owns the ref/poll (see `scroll-driver.ts`'s `waitForScrollContainer`). */
  readonly waitForScrollContainer: () => Promise<HTMLElement>;
  /** Overrides the production `DETAILS_BATCH_SIZE` for this run -- an experiment lever, not a default (see module header). */
  readonly batchSize?: number;
  /**
   * Fired synchronously once `client.openSubscription` returns, before any
   * `await`. `perf-page.tsx` uses this to render `<ViewportGrid
   * handle={...}>` immediately -- the grid must be mounted (and its scroll
   * body found, per `waitForScrollContainer`) before this function's own
   * scroll phase can run, so the caller needs the handle well before
   * `runProbe`'s promise resolves.
   */
  readonly onHandleOpened?: (handle: SubscriptionHandle) => void;
}

/**
 * Resolves once `snapshot.complete` arrives for `handle`'s current epoch, or
 * rejects after `timeoutMs` -- a hung 100k-row window should fail loudly
 * rather than stall the probe UI forever. `onEvent` is called for every
 * event seen while waiting, so the caller can accumulate load-phase stats
 * without a second listener racing this one.
 */
function waitForGroupEnd(
  handle: SubscriptionHandle,
  timeoutMs: number,
  onEvent: (event: WorkerEvent) => void,
): Promise<{ rowCount: number; elapsedMs: number }> {
  return new Promise((resolve, reject) => {
    let unsubscribe: () => void = () => {};
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error(`snapshot.complete not received within ${timeoutMs}ms`));
    }, timeoutMs);
    unsubscribe = handle.onEvent((event) => {
      onEvent(event);
      if (event.type === 'snapshot.complete') {
        clearTimeout(timer);
        unsubscribe();
        resolve({ rowCount: event.rowCount, elapsedMs: event.elapsedMs });
      }
    });
  });
}

export async function runProbe(options: RunProbeOptions): Promise<ProbeResult> {
  const {
    client,
    subId,
    orders,
    targetRows,
    scrollDurationMs,
    snapshotTimeoutMs,
    waitForScrollContainer,
    batchSize = DETAILS_BATCH_SIZE,
    onHandleOpened,
  } = options;

  const pick = pickOrdersForTarget(orders, targetRows);
  const filter = buildDetailsFilter(pick.orderIds);
  if (!filter) {
    throw new Error(`pickOrdersForTarget(orders, ${targetRows}) selected no orders`);
  }

  const loadTracker = createPatchTracker();
  let firstProgressAt: number | undefined;
  let firstResetAt: number | undefined;

  const openAt = performance.now();
  const handle = client.openSubscription({
    subId,
    topic: 'order_details',
    mode: 'sow_and_delta_subscribe',
    filter,
    orderBy: DEFAULT_ORDER_BY,
    batchSize,
    keyField: 'detailId',
    window: { topN: Math.max(1, pick.actualSum), skipN: 0 },
    rowCountHint: pick.actualSum,
  });
  onHandleOpened?.(handle);

  const { elapsedMs: workerReportedElapsedMs } = await waitForGroupEnd(
    handle,
    snapshotTimeoutMs,
    (event) => {
      const now = performance.now();
      if (event.type === 'snapshot.progress' && firstProgressAt === undefined) {
        firstProgressAt = now;
      }
      if (
        event.type === 'rows.reset' &&
        firstResetAt === undefined &&
        Object.keys(event.rows).length > 0
      ) {
        firstResetAt = now;
      }
      loadTracker.record(event, now);
    },
  );
  const groupEndAt = performance.now();
  const heapAfterSnapshot = readHeapSnapshot();

  const scrollTracker = createPatchTracker();
  const unsubscribeScroll = handle.onEvent((event) =>
    scrollTracker.record(event, performance.now()),
  );

  const scrollContainer = await waitForScrollContainer();
  const { frameDeltasMs } = await runSustainedScroll(scrollContainer, scrollDurationMs);

  unsubscribeScroll();
  const heapAfterScroll = readHeapSnapshot();

  return {
    targetRows,
    actualRows: pick.actualSum,
    orderCount: pick.orderIds.length,
    batchSize,
    timings: {
      openToFirstProgressMs: firstProgressAt !== undefined ? firstProgressAt - openAt : undefined,
      openToFirstResetMs: firstResetAt !== undefined ? firstResetAt - openAt : undefined,
      openToGroupEndMs: groupEndAt - openAt,
      workerReportedElapsedMs,
    },
    heapAfterSnapshot,
    heapAfterScroll,
    frameTiming: summarize(frameDeltasMs),
    framesOver33ms: frameDeltasMs.filter((d) => d > 33).length,
    framesOver50ms: frameDeltasMs.filter((d) => d > 50).length,
    totalFrames: frameDeltasMs.length,
    loadPhaseStats: loadTracker.snapshot(),
    scrollPhaseStats: scrollTracker.snapshot(),
    scrollPhaseRates: computeRates(scrollTracker.snapshot()),
  };
}
