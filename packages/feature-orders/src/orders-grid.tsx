// `<OrdersGrid>` -- the `orders` master grid (plan §1, M3C; selection wired
// in M4b). A thin composition over the topic-agnostic `<ViewportGrid>`
// (`@amps-ui/grid-viewport`): supplies the 24-field column set and
// `orderId` as the row key. The caller (`apps/trading-ui`) opens the
// subscription (`ordersSubscriptionSpec()` + `DataClient.openSubscription()`)
// and hands in the resulting handle -- this component never owns a
// `DataClient`, matching `<ViewportGrid>`'s own "handle passed in" shape.
//
// Selection (plan §4/§10 C2): M4a added `<ViewportGrid>`'s `rowSelection`/
// `onSelectionChanged` surface; this component turns that on and translates
// AG Grid's selected rows into typed `Order[]` for the caller (the shell,
// M4b) to feed into an `OrderSelectionStore` -- this component doesn't own
// that store itself, matching `<ViewportGrid>`'s "policy belongs to the
// consumer" stance. `ref` forwards `<ViewportGrid>`'s `clearSelection()` so
// the shell can wire an explicit "Clear selection" control (plan §10 C2:
// the Viewport row model has no header-checkbox select-all).
import type { ViewportGridHandle, ViewportStatus } from '@amps-ui/grid-viewport';
import { ViewportGrid } from '@amps-ui/grid-viewport';
import type { RowData } from '@amps-ui/protocol';
import type { SubscriptionHandle } from '@amps-ui/worker-client';
import { type CSSProperties, type ReactNode, forwardRef } from 'react';
import { ORDERS_COLUMN_DEFS, getOrderRowId } from './columns';
import type { Order } from './order';

export interface OrdersGridProps {
  handle: SubscriptionHandle;
  className?: string;
  style?: CSSProperties;
  renderFooter?: (status: ViewportStatus) => ReactNode;
  /** Fires with the full selected `Order[]` on every AG Grid `selectionChanged` (plan §4/§5: master selection driving `OrderSelectionStore`). */
  onSelectionChanged?: (orders: Order[]) => void;
}

export const OrdersGrid = forwardRef<ViewportGridHandle, OrdersGridProps>(function OrdersGrid(
  { handle, className, style, renderFooter, onSelectionChanged }: OrdersGridProps,
  ref,
) {
  return (
    <ViewportGrid
      ref={ref}
      handle={handle}
      columnDefs={ORDERS_COLUMN_DEFS}
      getRowId={(data: RowData) => getOrderRowId(data)}
      className={className}
      style={style}
      renderFooter={renderFooter}
      rowSelection={onSelectionChanged ? 'multiple' : undefined}
      onSelectionChanged={
        onSelectionChanged
          ? (_keys, rows) => onSelectionChanged(rows as unknown as Order[])
          : undefined
      }
    />
  );
});
