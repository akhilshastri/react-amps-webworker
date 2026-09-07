// @amps-ui/feature-order-details -- the `order_details` details grid feature.
//
// M1 STUB. Full implementation (details column defs, magnitude-aware
// decimals, flash on the 6 ticking fields, selection -> subscription
// lifecycle including the 250ms debounce and epoch cancellation, and the
// loading-overlay UI around the AMPS-paginated server-side window) lands in
// M4b (plan §7).
//
// `buildDetailsFilter` (plan §4: 0/1/n branches, single-quoted string
// literals) is carry-forward C1 (plan §10): it is tested and lives in
// `@amps-ui/feature-orders` (see that package's `details-filter.ts` for why),
// so it is re-exported here rather than reimplemented -- this package
// already depends on `@amps-ui/feature-orders`.
//
// Depends on: `@amps-ui/grid-viewport`, `@amps-ui/ui`,
// `@amps-ui/feature-orders`, `@amps-ui/protocol`.
// Consumed by: `apps/trading-ui`.
export { buildDetailsFilter } from '@amps-ui/feature-orders';

export function OrderDetailsGrid(): never {
  throw new Error('OrderDetailsGrid: not implemented (M1 stub, see M4b)');
}
