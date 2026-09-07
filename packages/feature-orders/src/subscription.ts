// The `orders` master subscription spec (plan §3/M3C row): `sow_and_subscribe`
// on `orders`, unfiltered -- CLIENT.md: 1,000 rows total and "changes? never
// after seeding", so 1,000 rows is safe unfiltered and this is effectively a
// one-time snapshot, not a ticking subscription. No tick-handling machinery
// belongs here (unlike `order_details`'s delta path in `@amps-ui/amps-client`).
import type { SubscriptionId } from '@amps-ui/protocol';
import type { OpenSubscriptionSpec } from '@amps-ui/worker-client';

/** The amps client's own default batchSize is 10, far too small for a 1,000-row bulk load (brief/plan §3). */
const ORDERS_BATCH_SIZE = 500;

/** Builds the `sub.open` spec for the `orders` master grid, given the tab's `subId` (plan §5: `subId === instanceId`). */
export function ordersSubscriptionSpec(subId: SubscriptionId): OpenSubscriptionSpec {
  return {
    subId,
    topic: 'orders',
    mode: 'sow_and_subscribe',
    batchSize: ORDERS_BATCH_SIZE,
    keyField: 'orderId',
  };
}
