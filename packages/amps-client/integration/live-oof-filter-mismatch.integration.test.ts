// Integration test against the LIVE AMPS instance (plan §6/M5): attempts to
// verify `oof` for the case CLIENT.md documents it for -- a row that stops
// matching the SUBSCRIPTION'S OWN FILTER -- as distinct from a row falling
// out of a paginated window's `top_n` rank, which plan §4 CORRECTED /
// carry-forward C5 already measured produces ZERO `oof`
// (`live-window-trim.integration.test.ts`, `@amps-ui/data-worker`).
//
// NOT part of the package's `tsc --build` project (`tsconfig.json`'s
// `include: ["src"]`), matching this package's other integration test.
// Skips automatically if AMPS isn't reachable.
//
// ** FINDING (recorded here per plan §6's own instruction: "if this proves
// flaky in practice, downgrade to a manual check and say so -- do not chase
// it"): manual live probing during M5 did NOT observe a single `oof` for a
// content-filter mismatch on `order_details`, across ~3 cumulative minutes
// and two independent methods:
//   1. A `/markPrice` range filter (CLIENT.md's own worked example),
//      matching several hundred rows near each edge of a live order's price
//      distribution, run for 10s/10s/90s.
//   2. A DETERMINISTIC `/tickSeq < K` filter (chosen so thousands of
//      already-matching rows would fail it on their very next tick, since
//      `tickSeq` increments by exactly 1 on every update -- CLIENT.md), run
//      for 15s/40s via both `sow_and_delta_subscribe` and
//      `sow_and_subscribe`. Live deltas kept arriving throughout (140+
//      `p`/`publish` messages seen in the 40s run) with none observed
//      violating the filter, so this did not even manage to reproduce the
//      precondition, let alone the resulting `oof`.
// This contradicts CLIENT.md's explicit documented behavior for this
// instance. Rather than assert a behavior that could not be reproduced
// live (which would make this suite permanently red, or force a band wide
// enough to be meaningless), this test asserts only what WAS verified --
// the content filter correctly bounds the snapshot -- and reports whether
// an `oof` showed up during its own run via `console.warn` rather than a
// hard failure. See the M5 report for the full writeup; this is flagged as
// a "reality contradicts the plan" finding, not silently patched around.
import { describe, expect, test } from 'bun:test';
import type { RowData } from '@amps-ui/protocol';
import { Client, Command } from '../src/amps-shim';
import type { AmpsClientLike, AmpsMessageLike } from '../src/connection';
import { AmpsConnection } from '../src/connection';

const AMPS_URI = 'ws://localhost:9018/amps/json';

async function probeAmpsAvailable(): Promise<boolean> {
  const probe = new AmpsConnection({ maxAttempts: 1, initialBackoffMs: 0, maxBackoffMs: 0 });
  try {
    await probe.connect(AMPS_URI, 'm5-oof-probe');
    await probe.disconnect();
    return true;
  } catch {
    return false;
  }
}

const ampsAvailable = await probeAmpsAvailable();

/** Runs one AMPS `Command`, resolving with every `sow` row's `data` at `group_end` -- CLIENT.md's `execute()` gotcha: it resolves on SEND, not on data arriving. */
function runQuery(client: AmpsClientLike, command: unknown): Promise<RowData[]> {
  return new Promise((resolve, reject) => {
    const rows: RowData[] = [];
    client
      .execute(command, (m: AmpsMessageLike) => {
        const kind = m.header.command();
        if (kind === 'sow') rows.push(m.data as RowData);
        else if (kind === 'group_end') resolve(rows);
      })
      .catch(reject);
  });
}

describe.skipIf(!ampsAvailable)(
  'oof against live AMPS (plan §6/M5 -- filter mismatch, not window displacement)',
  () => {
    test('a narrow /markPrice filter correctly bounds the snapshot to the matching subset (oof itself: see file header finding)', async () => {
      // The real `Client` structurally satisfies `AmpsClientLike` (see
      // `connection.ts`'s `defaultClientFactory`); the cast documents that
      // narrowing rather than escaping it.
      const client = new Client('m5-oof-integration') as unknown as AmpsClientLike;
      await client.connect(AMPS_URI);

      try {
        const [bigOrder] = await runQuery(
          client,
          new Command('sow').topic('orders').orderBy('/childCount DESC').topN(1),
        );
        const orderId = bigOrder.orderId as string;

        // Bounded by this one order's own childCount -- never an unfiltered
        // order_details query (CLIENT.md).
        const allRows = await runQuery(
          client,
          new Command('sow').topic('order_details').filter(`/orderId = '${orderId}'`),
        );
        expect(allRows.length).toBeGreaterThan(0);
        const prices = allRows.map((r) => r.markPrice as number).sort((a, b) => a - b);
        const median = prices[Math.floor(prices.length / 2)] as number;
        const band = Math.max(median * 0.003, 0.02);
        const lower = median - band;
        const upper = median + band;
        const expectedMatchCount = prices.filter((p) => p > lower && p < upper).length;

        const oofKeys: string[] = [];
        let matchedSowCount = 0;
        const filter = `/orderId = '${orderId}' AND /markPrice > ${lower} AND /markPrice < ${upper}`;
        const subId = await client.execute(
          new Command('sow_and_delta_subscribe').topic('order_details').filter(filter),
          (m: AmpsMessageLike) => {
            const kind = m.header.command();
            if (kind === 'sow') matchedSowCount++;
            else if (kind === 'oof') oofKeys.push((m.data as RowData).detailId as string);
          },
        );

        // CLIENT.md: a given row ticks ~once every 10 minutes on average --
        // this order's full childCount (not just the narrow band) is what
        // makes 15s a reasonable window to give at least a few of the
        // matched rows a chance to tick.
        await new Promise((resolve) => setTimeout(resolve, 15_000));
        await client.unsubscribe(subId);

        // Verified: the content filter narrows the snapshot to (very
        // nearly) the same subset computed independently client-side --
        // small drift is expected since real ticks land between the two
        // queries.
        expect(matchedSowCount).toBeGreaterThan(0);
        expect(Math.abs(matchedSowCount - expectedMatchCount)).toBeLessThan(
          Math.max(20, expectedMatchCount * 0.05),
        );

        if (oofKeys.length === 0) {
          console.warn(
            '[M5 finding] no oof observed for a live /markPrice filter mismatch in 15s -- ' +
              "see this file's header comment; CLIENT.md documents this as expected behavior " +
              'but it was not reproducible during M5 live probing.',
          );
        } else {
          for (const key of oofKeys) expect(key.startsWith(`${orderId}:`)).toBe(true);
        }
      } finally {
        await client.disconnect();
      }
    }, 25_000);
  },
);
