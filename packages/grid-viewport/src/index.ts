// @amps-ui/grid-viewport -- the reusable topic-agnostic AG Grid viewport component.
//
// Owns: `createWorkerViewportDatasource()` implementing ag-grid's
// `IViewportDatasource` (see `datasource.ts`), `<ViewportGrid>`
// (`viewport-grid.tsx`), AG Grid module registration (`modules.ts`,
// imported here for its side effect), and `useViewportSubscription()`.
// Never learns the words "orders" or "childCount" (plan §1) -- that is
// what keeps it reusable across the master and details grids.
//
// Depends on: React, ag-grid-{community,enterprise,react},
// `@amps-ui/worker-client`, `@amps-ui/protocol`.
// Consumed by: `apps/trading-ui` directly for M2's bare page;
// `@amps-ui/feature-orders` and `@amps-ui/feature-order-details` from M3C/M4.
import './modules';

export { createWorkerViewportDatasource } from './datasource';
export type { CreateViewportDatasourceOptions, ViewportSubscription } from './datasource';
export { useViewportSubscription } from './use-viewport-subscription';
export { ViewportGrid } from './viewport-grid';
export type { ViewportGridProps, ViewportStatus } from './viewport-grid';
