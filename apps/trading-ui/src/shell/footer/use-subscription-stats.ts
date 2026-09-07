// Real `SubscriptionStats` source (plan §5/M4b), replacing M3B's
// `use-mock-subscription-stats.ts`. `<TabFooter>` itself is untouched --
// this hook only supplies the same `SubscriptionStats` shape from a live
// `SubscriptionHandle`'s worker events instead of a timer-driven simulation.
//
// Derives:
//  - `phase`/`received` from `snapshot.progress`/`snapshot.complete`.
//  - `rowCount` from `stats`/`rows.count`/`rows.reset` -- for a windowed
//    subscription (`@amps-ui/data-worker`'s `reportedRowCount`, plan §4)
//    this is already the TRUE total (e.g. `sum(childCount)`), not the
//    loaded window size, so "N rows" never gets confused with "window
//    loaded" (plan §4/§5).
//  - `loadedWindow` from `stats.window` (M4b protocol addition,
//    `@amps-ui/protocol`'s `StatsEvent.window`) -- the worker can reposition
//    this on its own (a scroll-triggered repage, plan §4/C5), so the main
//    thread can't just remember what it originally asked for.
//  - `updatesPerSec` from the delta between successive `stats` events'
//    cumulative `updatesApplied`, divided by the wall-clock time between
//    them (`stats` fires <=1/sec, plan §3, but is not a perfectly steady
//    clock, so the actual elapsed time is measured rather than assumed).
import type { WorkerEvent } from '@amps-ui/protocol';
import type { SubscriptionHandle } from '@amps-ui/worker-client';
import { useEffect, useState } from 'react';
import type { SubscriptionStats } from './subscription-stats';

const CONNECTING_STATS: SubscriptionStats = {
  phase: 'connecting',
  received: 0,
  rowCount: undefined,
  loadedWindow: null,
  updatesPerSec: 0,
  lastTickAt: null,
};

interface Accumulator {
  readonly stats: SubscriptionStats;
  readonly lastUpdatesApplied: number;
  readonly lastStatsReceivedAt: number;
}

const INITIAL: Accumulator = {
  stats: CONNECTING_STATS,
  lastUpdatesApplied: 0,
  lastStatsReceivedAt: 0,
};

function reduce(prev: Accumulator, event: WorkerEvent): Accumulator {
  const { stats } = prev;
  switch (event.type) {
    case 'snapshot.progress':
      return { ...prev, stats: { ...stats, phase: 'snapshot', received: event.received } };
    case 'snapshot.complete':
      return { ...prev, stats: { ...stats, phase: 'live', received: event.rowCount } };
    case 'rows.count':
    case 'rows.reset':
      return { ...prev, stats: { ...stats, rowCount: event.rowCount } };
    case 'stats': {
      const now = Date.now();
      const elapsedSec = prev.lastStatsReceivedAt ? (now - prev.lastStatsReceivedAt) / 1000 : 0;
      const updatesPerSec =
        elapsedSec > 0
          ? Math.max(0, Math.round((event.updatesApplied - prev.lastUpdatesApplied) / elapsedSec))
          : 0;
      return {
        lastUpdatesApplied: event.updatesApplied,
        lastStatsReceivedAt: now,
        stats: {
          ...stats,
          phase: 'live',
          rowCount: event.rowCount,
          loadedWindow: event.window
            ? [event.window.skipN, event.window.skipN + event.window.topN]
            : null,
          updatesPerSec,
          // `lastTickAt` is a worker-side epoch-ms timestamp (`Date.now()`
          // in the real worker, `data-worker/index.ts`), directly
          // comparable to this hook's own `Date.now()` calls -- `0` means
          // "never ticked" (CLIENT.md's own convention for `tickSeq`),
          // which must not overwrite a real previous tick with "no ticks".
          lastTickAt: event.lastTickAt > 0 ? event.lastTickAt : stats.lastTickAt,
        },
      };
    }
    default:
      return prev;
  }
}

export function useSubscriptionStats(handle: SubscriptionHandle | undefined): SubscriptionStats {
  const [acc, setAcc] = useState<Accumulator>(INITIAL);

  useEffect(() => {
    setAcc(INITIAL);
    if (!handle) return;
    return handle.onEvent((event) => setAcc((prev) => reduce(prev, event)));
  }, [handle]);

  return acc.stats;
}
