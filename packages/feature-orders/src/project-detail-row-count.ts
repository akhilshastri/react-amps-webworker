// `projectDetailRowCount()` -- the exact (not estimated) number of
// `order_details` rows a given orders selection owns (plan §4/§6). Verified
// against live AMPS this session: 3 orders with childCounts summing to 2537
// produced exactly 2537 detail rows, so this is a straight sum, never an
// approximation -- there is nothing probabilistic to model here.
//
// Takes a narrow structural slice of `Order` (just `childCount`) rather than
// the full type, mirroring this codebase's other cross-boundary interfaces
// (e.g. `AmpsMessageLike` in `@amps-ui/amps-client`) -- callers can pass full
// `Order` rows straight through with no adapter.
interface OrderChildCount {
  readonly childCount: number;
}

/** Exact sum of `childCount` over the current orders selection (plan §4: the footer's true total, independent of what is actually loaded/windowed). */
export function projectDetailRowCount(selectedOrders: readonly OrderChildCount[]): number {
  let total = 0;
  for (const order of selectedOrders) total += order.childCount;
  return total;
}
