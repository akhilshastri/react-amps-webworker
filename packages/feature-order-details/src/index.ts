// @amps-ui/feature-order-details -- the `order_details` details grid feature
// (plan §1, §4; full implementation lands in M4b, plan §7).
//
// Owns: `order_details` column defs (23 CLIENT.md fields, magnitude-aware
// decimals reused from `@amps-ui/feature-orders`, flash on the 6 ticking
// fields), the selection -> subscription lifecycle (250ms debounce, the
// AMPS-paginated window, epoch-driven cancellation of superseded snapshots,
// the blocked-sort banner) -- see `order-details-grid.tsx`'s header for the
// full picture.
//
// `buildDetailsFilter` (plan §4: 0/1/n branches, single-quoted string
// literals) is carry-forward C1 (plan §10): it is tested and lives in
// `@amps-ui/feature-orders` (see that package's `details-filter.ts` for why),
// so it is re-exported here rather than reimplemented -- this package
// already depends on `@amps-ui/feature-orders`.
//
// Depends on: `@amps-ui/grid-viewport`, `@amps-ui/ui`, `@amps-ui/worker-client`,
// `@amps-ui/feature-orders`, `@amps-ui/protocol`, `ag-grid-community` (types only).
// Consumed by: `apps/trading-ui`.
export { buildDetailsFilter } from '@amps-ui/feature-orders';
export { ORDER_DETAILS_COLUMN_DEFS, getOrderDetailRowId } from './columns';
export type { OrderDetail } from './order-detail';
export { OrderDetailsGrid } from './order-details-grid';
export type { OrderDetailsGridProps } from './order-details-grid';
export {
  DEFAULT_ORDER_BY,
  DETAILS_BATCH_SIZE,
  NON_STREAMABLE_SORT_FIELDS,
  SELECTION_DEBOUNCE_MS,
  WINDOW_ROWS,
} from './constants';
