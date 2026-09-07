// Column definitions for the `orders` master grid -- all 24 CLIENT.md
// fields, sensible widths, right-aligned/formatted numerics.
//
// `orderId` needs no special sort comparator: it is `ORD-` + 6 zero-padded
// digits, fixed width, so the default string comparator already agrees with
// numeric order (CLIENT.md, brief) -- nothing to configure here.
import type { RowData } from '@amps-ui/protocol';
import type { ColDef } from 'ag-grid-community';
import { formatInteger, formatMagnitudeAwareNumber, formatTimestamp } from './format';
import type { Order } from './order';

function textCol(field: keyof Order, headerName: string, width: number): ColDef<Order> {
  return { field, headerName, width };
}

/** A price-like numeric column: right-aligned, magnitude-aware decimals (never a hardcoded 2dp). */
function priceCol(field: keyof Order, headerName: string, width: number): ColDef<Order> {
  return {
    field,
    headerName,
    width,
    type: 'numericColumn',
    valueFormatter: (params) => formatMagnitudeAwareNumber(params.value as number),
  };
}

/** A whole-number column (quantities/counts): right-aligned, comma-grouped, no decimals. */
function intCol(field: keyof Order, headerName: string, width: number): ColDef<Order> {
  return {
    field,
    headerName,
    width,
    type: 'numericColumn',
    valueFormatter: (params) => formatInteger(params.value as number),
  };
}

export const ORDERS_COLUMN_DEFS: ColDef<Order>[] = [
  textCol('orderId', 'Order ID', 130),
  textCol('orderDate', 'Order Date', 110),
  textCol('symbol', 'Symbol', 90),
  textCol('instrumentName', 'Instrument', 220),
  textCol('assetClass', 'Asset Class', 110),
  textCol('exchange', 'Exchange', 90),
  textCol('side', 'Side', 80),
  textCol('orderType', 'Order Type', 110),
  textCol('tif', 'TIF', 70),
  intCol('quantity', 'Quantity', 110),
  priceCol('limitPrice', 'Limit Price', 120),
  intCol('filledQty', 'Filled Qty', 110),
  priceCol('avgFillPrice', 'Avg Fill Price', 130),
  textCol('status', 'Status', 100),
  textCol('currency', 'Ccy', 80),
  priceCol('notional', 'Notional', 160),
  textCol('trader', 'Trader', 140),
  textCol('desk', 'Desk', 100),
  textCol('book', 'Book', 100),
  textCol('clientId', 'Client ID', 100),
  textCol('clientName', 'Client Name', 180),
  textCol('settlementDate', 'Settlement Date', 140),
  intCol('childCount', 'Child Count', 110),
  {
    field: 'createdAt',
    headerName: 'Created At',
    width: 190,
    valueFormatter: (params) => formatTimestamp(params.value as string),
  },
];

/** `getRowId` for `<ViewportGrid>` (mandatory there -- see `@amps-ui/grid-viewport`'s `viewport-grid.tsx`). */
export function getOrderRowId(data: RowData): string {
  return String(data.orderId);
}
