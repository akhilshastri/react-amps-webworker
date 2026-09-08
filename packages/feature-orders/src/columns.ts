// Column definitions for the `orders` master grid -- all 24 CLIENT.md
// fields, sensible widths, right-aligned/formatted numerics.
//
// `orderId` needs no special sort comparator: it is `ORD-` + 6 zero-padded
// digits, fixed width, so the default string comparator already agrees with
// numeric order (CLIENT.md, brief) -- nothing to configure here.
//
// M7 (design spec §3.1/§3.3/§4.4):
//  - `orderId`/`clientId` (the identifier columns here) get `font-mono` so
//    their alphanumeric codes resist 0/O and 1/l/I misreads.
//  - Every numeric column gets `tabular-nums` so a scrolling column of
//    prices stays vertically aligned digit-for-digit.
//  - `side`/`status` render as colour-coded `Badge`s (`badges.tsx`) -- both
//    fields are static per row, so this doesn't run per tick (perf
//    constraint is about the 6 LIVE `order_details` fields, not these).
//  - Columns are grouped under five header bands (`ColGroupDef`, §3.3,
//    resolved safe against the Viewport row model at §11/§10.1) instead of
//    one flat 24-column header row.
import type { RowData } from '@amps-ui/protocol';
import type { ColDef, ColGroupDef } from 'ag-grid-community';
import { OrderStatusBadge, SideBadge } from './badges';
import { formatInteger, formatMagnitudeAwareNumber, formatTimestamp } from './format';
import type { Order } from './order';

/** The four identifier columns across both grids that need unambiguous glyphs (design spec §3.1). Only two of the four live here; `detailId`/`execId` are `@amps-ui/feature-order-details`'s. */
const MONO_ID_CLASS = 'font-mono';
const NUMERIC_CLASS = 'tabular-nums';

function textCol(field: keyof Order, headerName: string, width: number): ColDef<Order> {
  return { field, headerName, width };
}

/** An identifier column (`orderId`, `clientId`): monospace, unambiguous glyphs. */
function idCol(field: keyof Order, headerName: string, width: number): ColDef<Order> {
  return { field, headerName, width, cellClass: MONO_ID_CLASS };
}

/** A price-like numeric column: right-aligned, magnitude-aware decimals (never a hardcoded 2dp). */
function priceCol(field: keyof Order, headerName: string, width: number): ColDef<Order> {
  return {
    field,
    headerName,
    width,
    type: 'numericColumn',
    cellClass: NUMERIC_CLASS,
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
    cellClass: NUMERIC_CLASS,
    valueFormatter: (params) => formatInteger(params.value as number),
  };
}

export const ORDERS_COLUMN_DEFS: (ColDef<Order> | ColGroupDef<Order>)[] = [
  {
    headerName: 'Order',
    children: [
      idCol('orderId', 'Order ID', 130),
      textCol('orderDate', 'Order Date', 110),
      textCol('symbol', 'Symbol', 90),
      textCol('instrumentName', 'Instrument', 220),
    ],
  },
  {
    headerName: 'Classification',
    children: [
      textCol('assetClass', 'Asset Class', 110),
      textCol('exchange', 'Exchange', 90),
      { field: 'side', headerName: 'Side', width: 80, cellRenderer: SideBadge },
      textCol('orderType', 'Order Type', 110),
      textCol('tif', 'TIF', 70),
    ],
  },
  {
    headerName: 'Execution',
    children: [
      intCol('quantity', 'Quantity', 110),
      priceCol('limitPrice', 'Limit Price', 120),
      intCol('filledQty', 'Filled Qty', 110),
      priceCol('avgFillPrice', 'Avg Fill Price', 130),
      { field: 'status', headerName: 'Status', width: 100, cellRenderer: OrderStatusBadge },
      textCol('currency', 'Ccy', 80),
      priceCol('notional', 'Notional', 160),
    ],
  },
  {
    headerName: 'Ownership',
    children: [
      textCol('trader', 'Trader', 140),
      textCol('desk', 'Desk', 100),
      textCol('book', 'Book', 100),
      idCol('clientId', 'Client ID', 100),
      textCol('clientName', 'Client Name', 180),
    ],
  },
  {
    headerName: 'Dates',
    children: [
      textCol('settlementDate', 'Settlement Date', 140),
      {
        field: 'createdAt',
        headerName: 'Created At',
        width: 190,
        valueFormatter: (params) => formatTimestamp(params.value as string),
      },
      intCol('childCount', 'Child Count', 110),
    ],
  },
];

/** `getRowId` for `<ViewportGrid>` (mandatory there -- see `@amps-ui/grid-viewport`'s `viewport-grid.tsx`). */
export function getOrderRowId(data: RowData): string {
  return String(data.orderId);
}
