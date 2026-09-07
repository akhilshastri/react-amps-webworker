// `<OrdersGrid>` -- the `orders` master grid (plan §1, M3C). A thin
// composition over the topic-agnostic `<ViewportGrid>`
// (`@amps-ui/grid-viewport`): supplies the 24-field column set and
// `orderId` as the row key. The caller (M4's `apps/trading-ui`) opens the
// subscription (`ordersSubscriptionSpec()` + `DataClient.openSubscription()`)
// and hands in the resulting handle -- this component never owns a
// `DataClient`, matching `<ViewportGrid>`'s own "handle passed in" shape.
//
// KNOWN GAP -- flagged, not silently worked around (see M3C report):
// `<ViewportGrid>`'s props (`viewport-grid.tsx`) have no selection surface
// yet (no `rowSelection` / `onSelectionChanged`), so this component cannot
// itself drive an `OrderSelectionStore` from AG Grid's row selection state.
// That wiring needs a small addition to `@amps-ui/grid-viewport`, which this
// milestone does not own (`packages/feature-orders/**` only). `OrderSelectionStore`
// (`./selection-store.ts`) is built and unit-tested standalone precisely so
// that follow-up is a small addition, not a redesign.
import type { ViewportStatus } from '@amps-ui/grid-viewport';
import { ViewportGrid } from '@amps-ui/grid-viewport';
import type { RowData } from '@amps-ui/protocol';
import type { SubscriptionHandle } from '@amps-ui/worker-client';
import type { CSSProperties, ReactNode } from 'react';
import { ORDERS_COLUMN_DEFS, getOrderRowId } from './columns';

export interface OrdersGridProps {
  handle: SubscriptionHandle;
  className?: string;
  style?: CSSProperties;
  renderFooter?: (status: ViewportStatus) => ReactNode;
}

export function OrdersGrid({ handle, className, style, renderFooter }: OrdersGridProps) {
  return (
    <ViewportGrid
      handle={handle}
      columnDefs={ORDERS_COLUMN_DEFS}
      getRowId={(data: RowData) => getOrderRowId(data)}
      className={className}
      style={style}
      renderFooter={renderFooter}
    />
  );
}
