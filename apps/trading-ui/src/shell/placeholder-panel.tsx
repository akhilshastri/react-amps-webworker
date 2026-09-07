// Stands in for `<OrdersGrid>`/`<OrderDetailsGrid>` (plan §7 M3B: "rendering
// a placeholder panel for now -- the real grids arrive in M3C/M4"). Also
// exercises the per-tab selection store (`tab-state.tsx`) with a small
// toggle UI, so cloning a tab's independent selection is visible without
// waiting for a real grid: clone this tab, toggle a different combination
// in each, and the two stay independent.
import { Badge, Button } from '@amps-ui/ui';
import type { TabKind } from './model';
import { useTabState } from './tab-state';

const KIND_LABEL: Record<TabKind, string> = {
  orders: 'Orders',
  'order-details': 'Order Details',
};

// Stand-in order ids; the real selection comes from the orders grid in M4.
const DEMO_ORDER_IDS = ['ORD-000001', 'ORD-000002', 'ORD-000003'];

export function PlaceholderPanel({ kind, instanceId }: { kind: TabKind; instanceId: string }) {
  const [state, setState] = useTabState(instanceId);

  function toggleOrderId(orderId: string) {
    const selectedOrderIds = state.selectedOrderIds.includes(orderId)
      ? state.selectedOrderIds.filter((id) => id !== orderId)
      : [...state.selectedOrderIds, orderId];
    setState({ selectedOrderIds });
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <Badge variant="outline">{KIND_LABEL[kind]}</Badge>
      <p className="text-sm text-muted-foreground">
        Grid not wired up yet (M3C/M4). Instance <code>{instanceId.slice(0, 8)}</code>.
      </p>
      <div className="flex gap-2">
        {DEMO_ORDER_IDS.map((orderId) => (
          <Button
            key={orderId}
            size="sm"
            variant={state.selectedOrderIds.includes(orderId) ? 'default' : 'outline'}
            onClick={() => toggleOrderId(orderId)}
          >
            {orderId}
          </Button>
        ))}
      </div>
      <p className="max-w-xs text-xs text-muted-foreground">
        This tab's selection is per-instance, not shared. Clone this tab (the "+" in the tab strip)
        and toggle a different combination to see it diverge.
      </p>
    </div>
  );
}
