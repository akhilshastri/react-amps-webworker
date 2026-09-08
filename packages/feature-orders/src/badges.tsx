// Side/status colour-coded cell renderers (design spec §4.4). Both fields
// are STATIC per row (an order's `side`/`status` never ticks after seed --
// only `order_details`'s 6 named ticking fields do, plan §4), so a
// per-cell React renderer here doesn't run per tick and doesn't conflict
// with the "no per-cell React components" performance constraint that
// applies to the live-updating columns.
//
// `SideBadge` is exported (not duplicated) because `@amps-ui/feature-order-details`
// shares the exact same BUY/SELL semantics for its own `side` column; each
// package's `status` renderer differs (different status vocabularies) and
// stays local to it.
import { Badge } from '@amps-ui/ui';
import type { ICellRendererParams } from 'ag-grid-community';
import type { Order } from './order';

const SIDE_CLASS: Record<Order['side'], string> = {
  BUY: 'bg-[var(--side-buy-bg)] text-[var(--side-buy-text)]',
  SELL: 'bg-[var(--side-sell-bg)] text-[var(--side-sell-text)]',
};

export function SideBadge({ value }: ICellRendererParams<unknown, Order['side']>) {
  if (!value) return null;
  return <Badge className={SIDE_CLASS[value]}>{value}</Badge>;
}

const ORDER_STATUS_CLASS: Record<Order['status'], string> = {
  NEW: 'bg-[var(--status-new-bg)] text-[var(--status-new-text)]',
  PARTIAL: 'bg-[var(--status-partial-bg)] text-[var(--status-partial-text)]',
  FILLED: 'bg-[var(--status-filled-bg)] text-[var(--status-filled-text)]',
  // CANCELLED is neutral-void, not a loss (design spec §4.2) -- slate
  // background plus a strikethrough carries the meaning, not a red pill.
  CANCELLED: 'bg-[var(--status-cancelled-bg)] text-[var(--status-cancelled-text)] line-through',
};

export function OrderStatusBadge({ value }: ICellRendererParams<unknown, Order['status']>) {
  if (!value) return null;
  return <Badge className={ORDER_STATUS_CLASS[value]}>{value}</Badge>;
}
