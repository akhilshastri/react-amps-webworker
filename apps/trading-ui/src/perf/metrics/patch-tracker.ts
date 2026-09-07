// Accumulates message-size/rate statistics for the two `WorkerEvent` kinds
// that carry row data across the worker boundary -- `rows.patch` (sparse
// ticks) and `rows.reset` (structural: initial load, `oof` repair, or the
// window catching up to a scrolled range) -- plan §6: "patch message size
// and rate". Both matter for "size and rate crossing the worker boundary":
// during a sustained scroll of a *fully loaded* window (this probe's
// design -- see `run-probe.ts`), most traffic is actually `rows.reset`
// (each scroll tick reveals rows AG Grid has never seen), not `rows.patch`
// (those are live ticks); tracking them separately keeps that distinction
// visible instead of conflating "scroll cost" with "tick cost".
//
// Split into a pure fold (`applySample`, unit-tested in
// `patch-tracker.test.ts`) and a thin stateful wrapper (`createPatchTracker`)
// that does the one side-effecting thing a reducer can't: serialize the
// event to estimate its wire size. Same split `viewport-grid.tsx`'s
// `reduceStatus` uses, for the same reason.
import type { WorkerEvent } from '@amps-ui/protocol';

export interface PatchPhaseStats {
  readonly patchMessageCount: number;
  readonly resetMessageCount: number;
  readonly totalRowCount: number;
  readonly totalBytes: number;
  readonly firstMessageAt: number | undefined;
  readonly lastMessageAt: number | undefined;
}

export const EMPTY_PATCH_STATS: PatchPhaseStats = {
  patchMessageCount: 0,
  resetMessageCount: 0,
  totalRowCount: 0,
  totalBytes: 0,
  firstMessageAt: undefined,
  lastMessageAt: undefined,
};

export interface PatchSample {
  readonly kind: 'patch' | 'reset';
  readonly rowCount: number;
  readonly bytes: number;
  readonly at: number;
}

/** Pure fold: one sample in, the next `PatchPhaseStats` out. */
export function applySample(stats: PatchPhaseStats, sample: PatchSample): PatchPhaseStats {
  return {
    patchMessageCount: stats.patchMessageCount + (sample.kind === 'patch' ? 1 : 0),
    resetMessageCount: stats.resetMessageCount + (sample.kind === 'reset' ? 1 : 0),
    totalRowCount: stats.totalRowCount + sample.rowCount,
    totalBytes: stats.totalBytes + sample.bytes,
    firstMessageAt: stats.firstMessageAt ?? sample.at,
    lastMessageAt: sample.at,
  };
}

export interface PatchRates {
  readonly messagesPerSec: number;
  readonly rowsPerSec: number;
  readonly bytesPerSec: number;
  readonly avgRowsPerMessage: number;
}

/**
 * Derived rates over the phase's own observed span (`lastMessageAt -
 * firstMessageAt`), not the caller's wall-clock probe duration -- a quiet
 * subscription (CLIENT.md: "a given row ticks ~once per 10 min") should not
 * be scored as if traffic were spread over the whole probe window when it
 * only actually arrived in a fraction of it.
 */
export function computeRates(stats: PatchPhaseStats): PatchRates {
  const messageCount = stats.patchMessageCount + stats.resetMessageCount;
  const spanMs =
    stats.firstMessageAt !== undefined && stats.lastMessageAt !== undefined
      ? Math.max(1, stats.lastMessageAt - stats.firstMessageAt)
      : 0;
  const spanSec = spanMs / 1000;
  if (messageCount === 0 || spanSec === 0) {
    return { messagesPerSec: 0, rowsPerSec: 0, bytesPerSec: 0, avgRowsPerMessage: 0 };
  }
  return {
    messagesPerSec: messageCount / spanSec,
    rowsPerSec: stats.totalRowCount / spanSec,
    bytesPerSec: stats.totalBytes / spanSec,
    avgRowsPerMessage: stats.totalRowCount / messageCount,
  };
}

/**
 * Extracts a `PatchSample` from a `WorkerEvent`, or `undefined` for event
 * types this tracker doesn't care about. Kept separate from `applySample`
 * so the pure fold's tests never need to construct a real `WorkerEvent`.
 */
export function sampleFromEvent(event: WorkerEvent, now: number): PatchSample | undefined {
  if (event.type === 'rows.patch') {
    return {
      kind: 'patch',
      rowCount: Object.keys(event.rows).length,
      bytes: byteSize(event),
      at: now,
    };
  }
  if (event.type === 'rows.reset') {
    return {
      kind: 'reset',
      rowCount: Object.keys(event.rows).length,
      bytes: byteSize(event),
      at: now,
    };
  }
  return undefined;
}

/**
 * `JSON.stringify(...).length` as a wire-size proxy -- not exact (structured
 * clone over a `postMessage` differs from JSON text length), but consistent
 * across every event this tracker sees, and cheap enough to run on a hot
 * path without perturbing the measurement it's taking.
 */
function byteSize(event: WorkerEvent): number {
  return JSON.stringify(event).length;
}

/**
 * Mutable accumulator wrapping the pure fold above. `run-probe.ts` creates
 * one per measurement phase (load vs. scroll) and calls `record` from a
 * `handle.onEvent` callback.
 */
export interface PatchTracker {
  record(event: WorkerEvent, now: number): void;
  snapshot(): PatchPhaseStats;
}

export function createPatchTracker(): PatchTracker {
  let stats = EMPTY_PATCH_STATS;
  return {
    record(event, now) {
      const sample = sampleFromEvent(event, now);
      if (sample) stats = applySample(stats, sample);
    },
    snapshot: () => stats,
  };
}
