// Column definitions for the `order_details` grid -- all 23 CLIENT.md
// fields. Reuses `@amps-ui/feature-orders`'s magnitude-aware number
// formatting (`formatMagnitudeAwareNumber`: "value under 10 -> 4dp (FX),
// else 2dp -- never hardcode 2dp", CLIENT.md) rather than duplicating it --
// the rule is identical for both topics' price-like fields.
//
// `enableCellChangeFlash` is set on exactly the 6 ticking fields
// (CLIENT.md: "updated ~2,500 rows/sec"); every other field is static from
// seed and never re-renders after its first paint.
import {
  formatInteger,
  formatMagnitudeAwareNumber,
  formatTimestamp,
} from '@amps-ui/feature-orders';
import type { RowData } from '@amps-ui/protocol';
import type { ColDef } from 'ag-grid-community';
import type { OrderDetail } from './order-detail';

function textCol(field: keyof OrderDetail, headerName: string, width: number): ColDef<OrderDetail> {
  return { field, headerName, width };
}

/** A price-like numeric column: right-aligned, magnitude-aware decimals (never a hardcoded 2dp). */
function priceCol(
  field: keyof OrderDetail,
  headerName: string,
  width: number,
  { flash = false }: { flash?: boolean } = {},
): ColDef<OrderDetail> {
  return {
    field,
    headerName,
    width,
    type: 'numericColumn',
    enableCellChangeFlash: flash,
    valueFormatter: (params) => formatMagnitudeAwareNumber(params.value as number),
  };
}

function intCol(field: keyof OrderDetail, headerName: string, width: number): ColDef<OrderDetail> {
  return {
    field,
    headerName,
    width,
    type: 'numericColumn',
    valueFormatter: (params) => formatInteger(params.value as number),
  };
}

export const ORDER_DETAILS_COLUMN_DEFS: ColDef<OrderDetail>[] = [
  // -- static fields (17) --
  { field: 'detailId', headerName: 'Detail ID', width: 170, pinned: 'left' },
  textCol('orderId', 'Order ID', 130),
  intCol('seq', 'Seq', 90),
  textCol('symbol', 'Symbol', 100),
  textCol('side', 'Side', 80),
  textCol('execId', 'Exec ID', 150),
  {
    field: 'executionTime',
    headerName: 'Exec Time',
    width: 160,
    valueFormatter: (params) => formatTimestamp(params.value as string),
  },
  textCol('venue', 'Venue', 110),
  textCol('counterparty', 'Counterparty', 150),
  intCol('lastQty', 'Last Qty', 110),
  priceCol('lastPx', 'Last Px', 110),
  intCol('cumQty', 'Cum Qty', 110),
  intCol('leavesQty', 'Leaves Qty', 120),
  priceCol('commission', 'Commission', 120),
  priceCol('fees', 'Fees', 100),
  textCol('currency', 'Ccy', 80),
  textCol('status', 'Status', 110),
  // -- ticking fields (6, CLIENT.md: ~2,500 rows/sec) -- flash enabled --
  priceCol('markPrice', 'Mark Price', 120, { flash: true }),
  priceCol('marketValue', 'Mkt Value', 130, { flash: true }),
  priceCol('unrealizedPnl', 'Unreal. PnL', 130, { flash: true }),
  priceCol('dayPnl', 'Day PnL', 120, { flash: true }),
  {
    field: 'lastUpdated',
    headerName: 'Last Updated',
    width: 160,
    enableCellChangeFlash: true,
    valueFormatter: (params) => formatTimestamp(params.value as string),
  },
  {
    field: 'tickSeq',
    headerName: 'Tick Seq',
    width: 100,
    type: 'numericColumn',
    enableCellChangeFlash: true,
    valueFormatter: (params) => formatInteger(params.value as number),
  },
];

/** `getRowId` for `<ViewportGrid>` (mandatory there -- see `@amps-ui/grid-viewport`'s `viewport-grid.tsx`). */
export function getOrderDetailRowId(data: RowData): string {
  return String(data.detailId);
}
