// Integration test against the LIVE AMPS instance (plan §4/C5, mandatory
// per the M4b brief: "A live-AMPS integration test proving the client-side
// window trim keeps the row store bounded while ticks flow"). NOT part of
// the package's `tsc --build` project (`tsconfig.json`'s `include: ["src"]`)
// so a live-only file never blocks `bun run typecheck` -- Bun still runs
// and type-strips it directly, matching `@amps-ui/amps-client`'s own
// integration test.
//
// Skips automatically (via `describe.skipIf`) if AMPS isn't reachable.
//
// Deliberately the WORST case the plan measured (§4 CORRECTED): unfiltered,
// sorted by `/lastUpdated DESC`, which the spike found degenerates a
// paginated subscription's live-update rate from ~2/s to the entire
// topic's ~2,550/s because every tick re-qualifies for the top of the
// window. This is exactly the scenario `trimToWindow` (`../src/runtime.ts`)
// exists for -- if it were absent (or broken), the row store would grow
// visibly and quickly within the few seconds this test runs, since AMPS
// itself sends **zero `oof`** for a row that falls back out of rank
// (measured: 37,748 rows displaced, 0 `oof`).
import { describe, expect, test } from 'bun:test';
import { AmpsConnection } from '@amps-ui/amps-client';
import { type WorkerEvent, toEpoch, toSubscriptionId } from '@amps-ui/protocol';
import { createWorkerRuntime } from '../src/runtime';

const AMPS_URI = 'ws://localhost:9018/amps/json';
const TOP_N = 50;
const RUN_MS = 6_000;

async function probeAmpsAvailable(): Promise<boolean> {
  const probe = new AmpsConnection({ maxAttempts: 1, initialBackoffMs: 0, maxBackoffMs: 0 });
  try {
    await probe.connect(AMPS_URI, 'm4b-window-trim-probe');
    await probe.disconnect();
    return true;
  } catch {
    return false;
  }
}

const ampsAvailable = await probeAmpsAvailable();

describe.skipIf(!ampsAvailable)('client-side window trim against live AMPS (plan §4/C5)', () => {
  test('a top_n=50 subscription sorted by /lastUpdated DESC (worst-case churn) never reports more than top_n rows, despite far more than top_n rows ticking through it', async () => {
    const connection = new AmpsConnection();
    const events: WorkerEvent[] = [];
    const runtime = createWorkerRuntime({
      connection,
      post: (event) => events.push(event),
      clock: () => Date.now(),
    });
    const flushInterval = setInterval(() => runtime.flush(), 16);

    try {
      await runtime.handleMessage({
        v: 2,
        type: 'conn.open',
        uri: AMPS_URI,
        clientName: 'm4b-window-trim-integration',
      });

      const subId = toSubscriptionId('window-trim-check');
      await runtime.handleMessage({
        v: 2,
        type: 'sub.open',
        subId,
        epoch: toEpoch(1),
        topic: 'order_details',
        mode: 'sow_and_delta_subscribe',
        orderBy: '/lastUpdated DESC',
        batchSize: 2_000,
        keyField: 'detailId',
        window: { topN: TOP_N, skipN: 0 },
      });

      // Let live ticks flow -- CLIENT.md: ~2,500 updates/sec topic-wide, so
      // a few seconds is ample to push far more than TOP_N distinct rows
      // through a `/lastUpdated DESC` ranking.
      await new Promise((resolve) => setTimeout(resolve, RUN_MS));

      await runtime.handleMessage({ v: 2, type: 'sub.close', subId });

      const resets = events.filter((e) => e.type === 'rows.reset');
      const counts = events.filter((e) => e.type === 'rows.count');
      expect(resets.length + counts.length).toBeGreaterThan(0); // the pipeline actually produced structural events

      // The load-bearing assertion: every reported count -- across
      // snapshot load AND every live re-rank this test observed -- stayed
      // at or under top_n. If `trimToWindow` were missing, this churn
      // pattern (measured: 37,748 rows/15s with zero `oof`) would blow
      // straight past it.
      const reportedCounts = [
        ...resets.map((e) => (e.type === 'rows.reset' ? e.rowCount : 0)),
        ...counts.map((e) => (e.type === 'rows.count' ? e.rowCount : 0)),
      ];
      for (const count of reportedCounts) {
        expect(count).toBeLessThanOrEqual(TOP_N);
      }

      // Proves real churn happened, not just a static snapshot: the
      // DISTINCT keys seen across every rows.reset's window (which, at
      // skip_n=0, is the same as the loaded top_n slice) must exceed
      // top_n -- i.e. the *membership* of the top-50 changed over time,
      // which is exactly the condition that would grow an untrimmed store.
      const distinctKeys = new Set<string>();
      for (const event of resets) {
        if (event.type !== 'rows.reset') continue;
        for (const row of Object.values(event.rows)) {
          const detailId = (row as { detailId?: unknown }).detailId;
          if (typeof detailId === 'string') distinctKeys.add(detailId);
        }
      }
      expect(distinctKeys.size).toBeGreaterThan(TOP_N);
    } finally {
      clearInterval(flushInterval);
      await connection.disconnect();
    }
  }, 20_000);
});
