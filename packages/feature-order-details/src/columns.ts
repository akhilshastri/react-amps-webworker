// Column definitions for the `order_details` grid -- all 23 CLIENT.md
// fields. Reuses `@amps-ui/feature-orders`'s magnitude-aware number
// formatting (`formatMagnitudeAwareNumber`: "value under 10 -> 4dp (FX),
// else 2dp -- never hardcode 2dp", CLIENT.md) rather than duplicating it --
// the rule is identical for both topics' price-like fields.
//
// `enableCellChangeFlash` is set on exactly the 6 ticking fields
// (CLIENT.md: "updated ~2,500 rows/sec"); every other field is static from
// seed and never re-renders after its first paint.
//
// M7 (design spec §3.1/§3.3/§4.2/§4.4) -- all STATIC-field styling only,
// per the performance constraint (no per-cell React/inline styles on the
// six LIVE fields):
//  - `detailId`/`execId` (static identifiers) get `font-mono`.
//  - Every numeric column gets `tabular-nums`.
//  - `side` reuses `@amps-ui/feature-orders`'s `SideBadge` (identical
//    BUY/SELL semantics); `status` gets its own badge (different
//    vocabulary: FILLED/PARTIAL/PENDING -- PENDING maps to the "new/not yet
//    done" slate token, no exact spec equivalent for a third state).
//  - `unrealizedPnl`/`dayPnl` (LIVE fields) get sign-based text colour via
//    `cellClassRules` -- AG Grid evaluates this itself per already-planned
//    formatting work, not an added per-cell allocation -- rather than a
//    `Badge`, which would be extra DOM/React work on a ticking cell.
//  - Identity columns pinned left, the four "why this pane is open" fields
//    pinned right (§3.3).
import {
  SideBadge,
  formatInteger,
  formatMagnitudeAwareNumber,
  formatTimestamp,
} from '@amps-ui/feature-orders';
import type { RowData } from '@amps-ui/protocol';
import type { CellClassRules, ColDef } from 'ag-grid-community';
import type { OrderDetail } from './order-detail';
import { OrderDetailStatusBadge } from './status-badge';

const MONO_ID_CLASS = 'font-mono';
const NUMERIC_CLASS = 'tabular-nums';

/**
 * Sign-based text colour for `unrealizedPnl`/`dayPnl` (design spec §4.2) --
 * persistent, distinct from the transient neutral flash pulse (§3.4). The
 * `!` (Tailwind's important modifier) is load-bearing here: AG Grid injects
 * its own theme `<style>` tag OUTSIDE any CSS cascade layer, and Tailwind
 * v4's utilities live INSIDE `@layer utilities` -- per the CSS spec,
 * unlayered rules always beat layered ones regardless of specificity, so
 * without `!` this class was silently outranked by AG Grid's own `.ag-cell`
 * text colour rule (verified: class was present in the DOM, computed colour
 * was still `--foreground`, not this token).
 */
const PNL_CLASS_RULES: CellClassRules = {
  'text-[var(--pnl-positive-text)]!': (params) =>
    typeof params.value === 'number' && params.value > 0,
  'text-[var(--pnl-negative-text)]!': (params) =>
    typeof params.value === 'number' && params.value < 0,
};

function textCol(field: keyof OrderDetail, headerName: string, width: number): ColDef<OrderDetail> {
  return { field, headerName, width };
}

/** An identifier column (`detailId`, `execId`): monospace, unambiguous glyphs. */
function idCol(
  field: keyof OrderDetail,
  headerName: string,
  width: number,
  extra: ColDef<OrderDetail> = {},
): ColDef<OrderDetail> {
  return { field, headerName, width, cellClass: MONO_ID_CLASS, ...extra };
}

/** A price-like numeric column: right-aligned, magnitude-aware decimals (never a hardcoded 2dp). */
function priceCol(
  field: keyof OrderDetail,
  headerName: string,
  width: number,
  {
    flash = false,
    pnl = false,
    pinned,
  }: { flash?: boolean; pnl?: boolean; pinned?: ColDef['pinned'] } = {},
): ColDef<OrderDetail> {
  return {
    field,
    headerName,
    width,
    pinned,
    type: 'numericColumn',
    enableCellChangeFlash: flash,
    cellClass: NUMERIC_CLASS,
    cellClassRules: pnl ? PNL_CLASS_RULES : undefined,
    valueFormatter: (params) => formatMagnitudeAwareNumber(params.value as number),
  };
}

function intCol(field: keyof OrderDetail, headerName: string, width: number): ColDef<OrderDetail> {
  return {
    field,
    headerName,
    width,
    type: 'numericColumn',
    cellClass: NUMERIC_CLASS,
    valueFormatter: (params) => formatInteger(params.value as number),
  };
}

export const ORDER_DETAILS_COLUMN_DEFS: ColDef<OrderDetail>[] = [
  // -- static fields (17), identity pinned left (design spec §3.3) --
  idCol('detailId', 'Detail ID', 170, { pinned: 'left' }),
  {
    field: 'orderId',
    headerName: 'Order ID',
    width: 130,
    pinned: 'left',
    cellClass: MONO_ID_CLASS,
  },
  { ...intCol('seq', 'Seq', 90), pinned: 'left' },
  textCol('symbol', 'Symbol', 100),
  { field: 'side', headerName: 'Side', width: 80, cellRenderer: SideBadge },
  idCol('execId', 'Exec ID', 150),
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
  { field: 'status', headerName: 'Status', width: 110, cellRenderer: OrderDetailStatusBadge },
  // -- ticking fields (6, CLIENT.md: ~2,500 rows/sec) -- flash enabled;
  // the four P&L/valuation fields are pinned right (design spec §3.3: "why
  // a trader has the details pane open" -- visible regardless of how far
  // the middle columns are scrolled). `lastUpdated`/`tickSeq` stay
  // unpinned -- diagnostic/audit fields, not scan targets.
  priceCol('markPrice', 'Mark Price', 120, { flash: true, pinned: 'right' }),
  priceCol('marketValue', 'Mkt Value', 130, { flash: true, pinned: 'right' }),
  priceCol('unrealizedPnl', 'Unreal. PnL', 130, { flash: true, pnl: true, pinned: 'right' }),
  priceCol('dayPnl', 'Day PnL', 120, { flash: true, pnl: true, pinned: 'right' }),
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
    cellClass: NUMERIC_CLASS,
    enableCellChangeFlash: true,
    valueFormatter: (params) => formatInteger(params.value as number),
  },
];

/** `getRowId` for `<ViewportGrid>` (mandatory there -- see `@amps-ui/grid-viewport`'s `viewport-grid.tsx`). */
export function getOrderDetailRowId(data: RowData): string {
  return String(data.detailId);
}
