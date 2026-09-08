// `status` cell renderer for the `order_details` grid (design spec §4.4).
// Separate from `@amps-ui/feature-orders`'s `OrderStatusBadge` because the
// two topics use different status vocabularies (`OrderDetail['status']` is
// FILLED/PARTIAL/PENDING, vs `Order['status']`'s NEW/PARTIAL/FILLED/CANCELLED)
// -- `side` is shared instead (`columns.ts` reuses `SideBadge` directly),
// since BUY/SELL means the same thing in both topics.
import { Badge } from '@amps-ui/ui';
import type { ICellRendererParams } from 'ag-grid-community';
import type { OrderDetail } from './order-detail';

// PENDING has no exact equivalent among the design spec's status tokens
// (NEW/PARTIAL/FILLED/CANCELLED) -- mapped to the "new/not yet done" slate
// token as the closest semantic match (a smallest-reasonable-call, not
// spec'd explicitly).
const STATUS_CLASS: Record<OrderDetail['status'], string> = {
  PENDING: 'bg-[var(--status-new-bg)] text-[var(--status-new-text)]',
  PARTIAL: 'bg-[var(--status-partial-bg)] text-[var(--status-partial-text)]',
  FILLED: 'bg-[var(--status-filled-bg)] text-[var(--status-filled-text)]',
};

export function OrderDetailStatusBadge({
  value,
}: ICellRendererParams<unknown, OrderDetail['status']>) {
  if (!value) return null;
  return <Badge className={STATUS_CLASS[value]}>{value}</Badge>;
}
