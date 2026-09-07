// The `orders` master grid tab's content (plan §5/M4b). Opens the
// unfiltered `orders` subscription once for this tab's lifetime
// (`ordersSubscriptionSpec`, `@amps-ui/feature-orders` -- 1,000 rows,
// static, `sow_and_subscribe`) and closes it on unmount (plan §5: "Closing
// a tab must release its subscription"). Feeds AG Grid's row selection into
// this tab's own per-tab selection slot (`../tab-state.tsx`) so a paired
// order-details tab (`sourceOrdersTabId`, `../model.ts`) can follow it, plus
// an explicit "Clear selection" control (plan §10 C2: the Viewport row
// model has no header-checkbox select-all).
import { OrdersGrid, ordersSubscriptionSpec } from '@amps-ui/feature-orders';
import type { ViewportGridHandle } from '@amps-ui/grid-viewport';
import { toSubscriptionId } from '@amps-ui/protocol';
import { Button } from '@amps-ui/ui';
import type { DataClient, SubscriptionHandle } from '@amps-ui/worker-client';
import { useEffect, useRef, useState } from 'react';
import { TabFooter } from '../footer/tab-footer';
import { useSubscriptionStats } from '../footer/use-subscription-stats';
import { useTabState } from '../tab-state';

export function OrdersTabContent({
  client,
  instanceId,
}: {
  client: DataClient;
  instanceId: string;
}) {
  const [handle, setHandle] = useState<SubscriptionHandle | undefined>(undefined);
  const [, setTabState] = useTabState(instanceId);
  const gridRef = useRef<ViewportGridHandle>(null);

  useEffect(() => {
    const opened = client.openSubscription(ordersSubscriptionSpec(toSubscriptionId(instanceId)));
    setHandle(opened);
    return () => opened.close();
  }, [client, instanceId]);

  const stats = useSubscriptionStats(handle);

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-end gap-2 border-b px-2 py-1">
        <Button size="sm" variant="outline" onClick={() => gridRef.current?.clearSelection()}>
          Clear selection
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        {handle && (
          <OrdersGrid
            ref={gridRef}
            handle={handle}
            renderFooter={() => null}
            onSelectionChanged={(orders) => setTabState({ selectedOrders: orders })}
          />
        )}
      </div>
      <TabFooter stats={stats} />
    </div>
  );
}
