// M2 bare page's column set for the `order_details` topic (plan §M2 scope,
// CLIENT.md schema: 17 static + 6 ticking fields = 23 total).
//
// This is deliberately app-local, not `@amps-ui/feature-order-details`
// (which owns the real details grid from M4 -- selection-driven filter,
// the AMPS-paginated window, the guard UI). M2 is a bare page proving the
// worker -> viewport-grid path on one hardcoded order, so its columns live
// here instead.
import type { RowData } from '@amps-ui/protocol';
import type { ColDef, ValueFormatterParams } from 'ag-grid-community';

/**
 * Decimals vary by magnitude: FX-style prices under 10 carry 4dp,
 * everything else 2dp (CLIENT.md; do not hardcode 2dp). Applied to every
 * monetary field below (lastPx, markPrice, marketValue, unrealizedPnl,
 * dayPnl, commission, fees).
 */
function formatMagnitudeAwarePrice(params: ValueFormatterParams<RowData>): string {
  const { value } = params;
  if (typeof value !== 'number') return value == null ? '' : String(value);
  const decimals = Math.abs(value) < 10 ? 4 : 2;
  return value.toFixed(decimals);
}

/**
 * `executionTime`/`lastUpdated` are timestamps; the exact wire
 * representation (epoch millis vs. ISO string) isn't pinned down by the
 * protocol (`RowData` is `Record<string, unknown>`), so this formats
 * whichever shows up rather than assuming one.
 */
function formatTimestamp(params: ValueFormatterParams<RowData>): string {
  const { value } = params;
  if (typeof value === 'number') return new Date(value).toLocaleTimeString();
  if (typeof value === 'string') return value;
  return '';
}

export function getOrderDetailRowId(data: RowData): string {
  return String(data.detailId);
}

export const orderDetailsColumnDefs: ColDef<RowData>[] = [
  // -- static fields (17) --
  { field: 'detailId', headerName: 'Detail ID', width: 170, pinned: 'left' },
  { field: 'orderId', headerName: 'Order ID', width: 130 },
  { field: 'seq', headerName: 'Seq', width: 90, type: 'numericColumn' },
  { field: 'symbol', headerName: 'Symbol', width: 100 },
  { field: 'side', headerName: 'Side', width: 80 },
  { field: 'execId', headerName: 'Exec ID', width: 150 },
  { field: 'executionTime', headerName: 'Exec Time', width: 140, valueFormatter: formatTimestamp },
  { field: 'venue', headerName: 'Venue', width: 100 },
  { field: 'counterparty', headerName: 'Counterparty', width: 150 },
  { field: 'lastQty', headerName: 'Last Qty', width: 110, type: 'numericColumn' },
  {
    field: 'lastPx',
    headerName: 'Last Px',
    width: 110,
    type: 'numericColumn',
    valueFormatter: formatMagnitudeAwarePrice,
  },
  { field: 'cumQty', headerName: 'Cum Qty', width: 110, type: 'numericColumn' },
  { field: 'leavesQty', headerName: 'Leaves Qty', width: 120, type: 'numericColumn' },
  {
    field: 'commission',
    headerName: 'Commission',
    width: 120,
    type: 'numericColumn',
    valueFormatter: formatMagnitudeAwarePrice,
  },
  {
    field: 'fees',
    headerName: 'Fees',
    width: 100,
    type: 'numericColumn',
    valueFormatter: formatMagnitudeAwarePrice,
  },
  { field: 'currency', headerName: 'Ccy', width: 80 },
  { field: 'status', headerName: 'Status', width: 110 },
  // -- ticking fields (6) -- cell-flash enabled so live ticks are visible (M2 scope)
  {
    field: 'markPrice',
    headerName: 'Mark Price',
    width: 120,
    type: 'numericColumn',
    enableCellChangeFlash: true,
    valueFormatter: formatMagnitudeAwarePrice,
  },
  {
    field: 'marketValue',
    headerName: 'Mkt Value',
    width: 130,
    type: 'numericColumn',
    enableCellChangeFlash: true,
    valueFormatter: formatMagnitudeAwarePrice,
  },
  {
    field: 'unrealizedPnl',
    headerName: 'Unreal. PnL',
    width: 130,
    type: 'numericColumn',
    enableCellChangeFlash: true,
    valueFormatter: formatMagnitudeAwarePrice,
  },
  {
    field: 'dayPnl',
    headerName: 'Day PnL',
    width: 120,
    type: 'numericColumn',
    enableCellChangeFlash: true,
    valueFormatter: formatMagnitudeAwarePrice,
  },
  {
    field: 'lastUpdated',
    headerName: 'Last Updated',
    width: 150,
    enableCellChangeFlash: true,
    valueFormatter: formatTimestamp,
  },
  {
    field: 'tickSeq',
    headerName: 'Tick Seq',
    width: 100,
    type: 'numericColumn',
    enableCellChangeFlash: true,
  },
];
