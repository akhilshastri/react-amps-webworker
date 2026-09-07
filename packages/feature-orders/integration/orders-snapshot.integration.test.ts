// Integration test against the LIVE AMPS instance (plan §6, M3C DoD). Mirrors
// `@amps-ui/amps-client`'s own live suite (`../amps-client/integration/
// live-order-details.integration.test.ts`): lives outside `src`, so it is
// never part of this package's `tsc --build` scope (see tsconfig.json's
// `include: ["src"]`) and skips automatically via `describe.skipIf` when
// AMPS isn't reachable, so it never fails the rest of `bun test` when the
// instance is down.
import { describe, expect, test } from 'bun:test';
import { AmpsConnection } from '@amps-ui/amps-client';
import type { RowData } from '@amps-ui/protocol';
import { toSubscriptionId } from '@amps-ui/protocol';
import { ordersSubscriptionSpec } from '../src/subscription';

const AMPS_URI = 'ws://localhost:9018/amps/json';

async function probeAmpsAvailable(): Promise<boolean> {
  const probe = new AmpsConnection({ maxAttempts: 1, initialBackoffMs: 0, maxBackoffMs: 0 });
  try {
    await probe.connect(AMPS_URI, 'm3c-integration-probe');
    await probe.disconnect();
    return true;
  } catch {
    return false;
  }
}

const ampsAvailable = await probeAmpsAvailable();

describe.skipIf(!ampsAvailable)('ordersSubscriptionSpec against live AMPS', () => {
  test('sow_and_subscribe on orders reaches group_end with exactly 1000 rows of 24 fields each', async () => {
    const connection = new AmpsConnection();
    await connection.connect(AMPS_URI, 'm3c-integration-orders');

    const subId = toSubscriptionId('m3c-orders-snapshot');
    const spec = ordersSubscriptionSpec(subId);

    const snapshotComplete = Promise.withResolvers<{ rowCount: number }>();
    const fieldCounts: number[] = [];

    await connection.openSubscription(subId, spec, {
      onSowRow: (_key, row: RowData) => {
        fieldCounts.push(Object.keys(row).length);
      },
      onSnapshotComplete: (rowCount) => snapshotComplete.resolve({ rowCount }),
      onDelta: () => {},
      onOof: () => {},
    });

    const { rowCount } = await snapshotComplete.promise;

    // CLIENT.md: `orders` is exactly 1,000 rows, written once, never updated.
    expect(rowCount).toBe(1000);
    expect(fieldCounts).toHaveLength(1000);
    // CLIENT.md schema lists exactly 24 fields per `orders` row.
    expect(fieldCounts.every((count) => count === 24)).toBe(true);

    await connection.closeSubscription(subId);
    await connection.disconnect();
  }, 20_000);
});
