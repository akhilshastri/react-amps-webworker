// The `order_details` grid tab's content (plan §4/§5, M4b). Unlike the
// orders tab, this component does not open a subscription itself --
// `<OrderDetailsGrid>` owns that lifecycle entirely (debounced open/update/
// close driven by `selectedOrders`, see its own header) -- this component's
// only job is resolving WHICH selection to follow (`config.sourceOrdersTabId`,
// `../model.ts`) and forwarding the resulting handle to the shared
// `<TabFooter>` (plan §5: real `stats` events, not a mock).
import { OrderDetailsGrid } from '@amps-ui/feature-order-details';
import { toSubscriptionId } from '@amps-ui/protocol';
import type { DataClient, SubscriptionHandle } from '@amps-ui/worker-client';
import { useState } from 'react';
import { TabFooter } from '../footer/tab-footer';
import { useSubscriptionStats } from '../footer/use-subscription-stats';
import type { TabConfig } from '../model';
import { useTabState } from '../tab-state';

export function OrderDetailsTabContent({
  client,
  config,
}: {
  client: DataClient;
  config: TabConfig;
}) {
  // No `sourceOrdersTabId` means this tab was severed by a clone (or
  // created standalone) -- it falls back to its OWN slot, which a clone
  // seeds once at creation time and nothing else ever writes (`../tab-actions.ts`).
  const sourceId = config.sourceOrdersTabId ?? config.instanceId;
  const [sourceState] = useTabState(sourceId);
  const [handle, setHandle] = useState<SubscriptionHandle | undefined>(undefined);
  const stats = useSubscriptionStats(handle);

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1">
        <OrderDetailsGrid
          client={client}
          subId={toSubscriptionId(config.instanceId)}
          selectedOrders={sourceState.selectedOrders}
          onHandleChange={setHandle}
        />
      </div>
      <TabFooter stats={stats} />
    </div>
  );
}
