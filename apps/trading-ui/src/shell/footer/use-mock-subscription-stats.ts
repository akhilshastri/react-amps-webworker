// Mock stats generator (plan §7 M3B: "the footer component (fed by a mock
// stats source for now)"). Simulates connecting -> throttled snapshot
// progress -> live using the plan's own worked example (§4: a 9,968-row
// true total windowed to 2,000 loaded rows) so `<TabFooter>`'s copy can be
// checked against the spec before any real subscription exists.
//
// Swap only this hook for a real one in M4 (reading `stats`/
// `snapshot.progress`/`snapshot.complete` off a `SubscriptionHandle`,
// `@amps-ui/protocol`) -- `<TabFooter>` only consumes `SubscriptionStats`
// and does not change.
import { useEffect, useState } from 'react';
import type { TabKind } from '../model';
import type { SubscriptionStats } from './subscription-stats';

// Matches numbers already used elsewhere in this codebase (App.tsx's M2
// hardcoded order, chosen by `orderBy('/childCount DESC').topN(5)`) and the
// plan §4 spike/example, so the mock reads as a plausible real subscription
// rather than an arbitrary placeholder.
const ORDERS_TRUE_TOTAL = 1000;
const DETAILS_TRUE_TOTAL = 9968;
const DETAILS_WINDOW_ROWS = 2000; // plan §4 `WINDOW_ROWS` default

const INITIAL_STATS: SubscriptionStats = {
  phase: 'connecting',
  received: 0,
  rowCount: undefined,
  loadedWindow: null,
  updatesPerSec: 0,
  lastTickAt: null,
};

/** Small deterministic per-tab jitter so cloned tabs' mock stats don't tick in lockstep. */
function seedFrom(instanceId: string): number {
  let hash = 0;
  for (let i = 0; i < instanceId.length; i += 1) {
    hash = (hash * 31 + instanceId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function useMockSubscriptionStats(kind: TabKind, instanceId: string): SubscriptionStats {
  const [stats, setStats] = useState<SubscriptionStats>(INITIAL_STATS);

  useEffect(() => {
    setStats(INITIAL_STATS);
    const jitterMs = seedFrom(instanceId) % 150;
    const trueTotal = kind === 'orders' ? ORDERS_TRUE_TOTAL : DETAILS_TRUE_TOTAL;
    const loadedWindow: SubscriptionStats['loadedWindow'] =
      kind === 'orders' ? null : [0, Math.min(DETAILS_WINDOW_ROWS, DETAILS_TRUE_TOTAL)];
    const loadedCount = loadedWindow ? loadedWindow[1] - loadedWindow[0] : trueTotal;
    const timers: Array<ReturnType<typeof setTimeout>> = [];

    timers.push(setTimeout(() => setStats((s) => ({ ...s, phase: 'snapshot' })), 200 + jitterMs));

    // Plan §3: "snapshot.progress ... throttled to <=4/sec".
    const progressSteps = 4;
    for (let step = 1; step <= progressSteps; step += 1) {
      timers.push(
        setTimeout(
          () =>
            setStats((s) => ({
              ...s,
              phase: 'snapshot',
              received: Math.round((loadedCount * step) / progressSteps),
            })),
          400 + jitterMs + step * 250,
        ),
      );
    }

    const liveAtMs = 400 + jitterMs + progressSteps * 250 + 200;
    timers.push(
      setTimeout(() => {
        setStats({
          phase: 'live',
          received: loadedCount,
          rowCount: trueTotal,
          loadedWindow,
          updatesPerSec: 0,
          lastTickAt: Date.now(),
        });
      }, liveAtMs),
    );

    // Plan §5: "a given row ticks only about once every 10 minutes" -- the
    // orders master rarely ticks (one tick at snapshot completion, then
    // quiet on purpose, to exercise the "idle is expected" hint without a
    // real 10-minute wait). The details window ticks continuously (plan §4
    // spike: ~8-17 updates/sec on a high-childCount order).
    let tickInterval: ReturnType<typeof setInterval> | undefined;
    if (kind === 'order-details') {
      tickInterval = setInterval(() => {
        setStats((s) =>
          s.phase !== 'live'
            ? s
            : {
                ...s,
                updatesPerSec: 8 + (seedFrom(instanceId) % 10) + Math.round(Math.random() * 3),
                lastTickAt: Date.now(),
              },
        );
      }, 1000);
    }

    return () => {
      for (const timer of timers) clearTimeout(timer);
      if (tickInterval) clearInterval(tickInterval);
    };
  }, [kind, instanceId]);

  return stats;
}
