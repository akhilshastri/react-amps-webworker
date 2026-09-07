// @amps-ui/feature-orders -- the `orders` master grid feature (plan §1, M3C).
//
// Owns: the `orders` column defs (24 CLIENT.md fields, magnitude-aware
// formatters), the `orders` subscription spec, the per-tab selection store,
// `projectDetailRowCount()` (exact, from `childCount`), and
// `buildDetailsFilter()` (see `details-filter.ts` for a note on why this
// lives here rather than in `@amps-ui/feature-order-details`).
//
// Depends on: `@amps-ui/grid-viewport`, `@amps-ui/worker-client`,
// `@amps-ui/protocol`, `ag-grid-community` (types only), React.
// Consumed by: `apps/trading-ui` (M4), and by `@amps-ui/feature-order-details`
// (selection store only, per plan §1).
export type { Order } from './order';
export { ORDERS_COLUMN_DEFS, getOrderRowId } from './columns';
export {
  decimalsForMagnitude,
  formatInteger,
  formatMagnitudeAwareNumber,
  formatTimestamp,
} from './format';
export { ordersSubscriptionSpec } from './subscription';
export { OrderSelectionStore, useOrderSelection } from './selection-store';
export type { OrderSelectionListener } from './selection-store';
export { projectDetailRowCount } from './project-detail-row-count';
export { buildDetailsFilter } from './details-filter';
export { OrdersGrid } from './orders-grid';
export type { OrdersGridProps } from './orders-grid';
