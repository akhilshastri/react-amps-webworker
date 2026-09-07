// Integration test against the LIVE AMPS instance (plan §6). NOT part of the
// package's `tsc --build` project (see tsconfig.json's `include: ["src"]`)
// so a live-only file never blocks `bun run typecheck`; Bun still runs and
// type-strips it directly.
//
// Skips automatically (via `describe.skipIf`) if AMPS isn't reachable, so
// this suite doesn't fail the rest of `bun test` when the instance is down.
// `WebSocket` is a Bun global, so this runs unmodified outside a browser
// (plan §6).
import { describe, expect, test } from 'bun:test';
import { toSubscriptionId } from '@amps-ui/protocol';
import type { RowData } from '@amps-ui/protocol';
import { AmpsConnection } from '../src/connection';
import type { SubscriptionSink } from '../src/subscription';

const AMPS_URI = 'ws://localhost:9018/amps/json';

// M2's hardcoded target (plan/task): childCount 9968, ~16.7 updates/sec, verified live.
const TARGET_ORDER_ID = 'ORD-000426';
const EXPECTED_CHILD_COUNT = 9968;

async function probeAmpsAvailable(): Promise<boolean> {
  const probe = new AmpsConnection({ maxAttempts: 1, initialBackoffMs: 0, maxBackoffMs: 0 });
  try {
    await probe.connect(AMPS_URI, 'm2-integration-probe');
    await probe.disconnect();
    return true;
  } catch {
    return false;
  }
}

const ampsAvailable = await probeAmpsAvailable();

describe.skipIf(!ampsAvailable)('AmpsConnection against live AMPS', () => {
  test('sow_and_delta_subscribe on order_details reaches group_end with the expected row count, then receives deltas', async () => {
    const connection = new AmpsConnection();
    await connection.connect(AMPS_URI, 'm2-integration-order-details');

    const snapshotComplete = Promise.withResolvers<{ rowCount: number; elapsedMs: number }>();
    const firstDelta = Promise.withResolvers<{ key: string; patch: RowData }>();
    const sowFieldCounts: number[] = [];
    let deltaCount = 0;

    const sink: SubscriptionSink = {
      onSowRow: (_key, row) => {
        sowFieldCounts.push(Object.keys(row).length);
      },
      onSnapshotComplete: (rowCount, elapsedMs) =>
        snapshotComplete.resolve({ rowCount, elapsedMs }),
      onDelta: (key, patch) => {
        deltaCount++;
        if (deltaCount === 1) firstDelta.resolve({ key, patch });
      },
      onOof: () => {},
    };

    await connection.openSubscription(
      toSubscriptionId('m2-target'),
      {
        topic: 'order_details',
        mode: 'sow_and_delta_subscribe',
        filter: `/orderId = '${TARGET_ORDER_ID}'`,
        batchSize: 2_000,
        keyField: 'detailId',
      },
      sink,
    );

    const { rowCount } = await snapshotComplete.promise;
    expect(rowCount).toBe(EXPECTED_CHILD_COUNT);
    // Snapshot rows carry the full 23-field record (CLIENT.md).
    expect(sowFieldCounts.every((count) => count === 23)).toBe(true);

    // ~16.7 updates/sec expected against this filter -- a few seconds is ample.
    const { key, patch } = await firstDelta.promise;
    expect(key.startsWith(`${TARGET_ORDER_ID}:`)).toBe(true);
    // Deltas are variable-width (6 or 7 fields observed) -- assert the key is present
    // and the payload is materially smaller than a full record, not an exact count.
    expect(Object.keys(patch).length).toBeLessThan(23);
    expect(Object.keys(patch).length).toBeGreaterThan(0);

    await connection.closeSubscription(toSubscriptionId('m2-target'));
    await connection.disconnect();
  }, 20_000);

  test('disconnect() then connect() again opens a fresh usable connection', async () => {
    const connection = new AmpsConnection();
    await connection.connect(AMPS_URI, 'm2-integration-reconnect-a');
    await connection.disconnect();

    // Subscriptions do not survive a reconnect (CLIENT.md) -- re-issuing on a
    // freshly connected instance must work exactly like a first connect.
    await connection.connect(AMPS_URI, 'm2-integration-reconnect-b');

    const snapshotComplete = Promise.withResolvers<number>();
    await connection.openSubscription(
      toSubscriptionId('reconnect-check'),
      {
        topic: 'orders',
        mode: 'sow',
        filter: "/orderId = 'ORD-000001'",
        batchSize: 10,
        keyField: 'orderId',
      },
      {
        onSowRow: () => {},
        onSnapshotComplete: (rowCount) => snapshotComplete.resolve(rowCount),
        onDelta: () => {},
        onOof: () => {},
      },
    );

    expect(await snapshotComplete.promise).toBe(1);
    await connection.disconnect();
  }, 10_000);
});
