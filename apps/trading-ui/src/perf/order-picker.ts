// Picks a set of `orders` whose `childCount` sums to (approximately, never
// over) a target row count, so the `/perf` probe can open an `order_details`
// subscription at a controlled size (plan §6/M6: "selecting orders whose
// `childCount` sums to the target ... exact (verified: 3 orders summing to
// 2,537 produced exactly 2,537 rows)").
//
// Pure and side-effect free -- the caller (`run-probe.ts`) supplies the
// already-loaded `orders` snapshot; this module never touches AMPS or the
// worker, which is what makes it `bun test`-able (see `order-picker.test.ts`).
import type { Order } from '@amps-ui/feature-orders';

export interface OrderPick {
  readonly orderIds: readonly string[];
  /** Exact sum of `childCount` over `orderIds` -- always <= `target` (never overshoots; see algorithm note below). */
  readonly actualSum: number;
}

/**
 * Greedy subset-sum: sort orders largest-first, take any order that still
 * fits under the remaining budget, and keep going until the budget is
 * exhausted or every order has been considered. This never overshoots
 * `target` (unlike "sort descending, stop once sum >= target", which would
 * blow past a 1k target the moment the single largest order -- up to
 * ~10,000 per CLIENT.md -- gets picked first) and it packs tightly because
 * every order it considers is guaranteed to fit, largest first. It is not
 * an exact-subset-sum solver -- with 1,000 orders and a log-uniform
 * `childCount` distribution there is no guarantee of an exact match -- so
 * `actualSum` can land a little under `target`; callers should size the
 * subscription's `window.topN` off `actualSum`, not `target`.
 */
export function pickOrdersForTarget(orders: readonly Order[], target: number): OrderPick {
  const sorted = [...orders].sort((a, b) => b.childCount - a.childCount);
  const orderIds: string[] = [];
  let remaining = target;

  for (const order of sorted) {
    if (order.childCount <= remaining) {
      orderIds.push(order.orderId);
      remaining -= order.childCount;
    }
    if (remaining === 0) break;
  }

  return { orderIds, actualSum: target - remaining };
}
