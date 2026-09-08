// `<GridTab>` -- dispatches a flexlayout tab's content by `TabConfig.kind`
// (plan §5). Replaces M3B's `PlaceholderPanel` with the real grids (M4b).
//
// M7: also threads the flexlayout `Model` down to the details side, which
// needs it to resolve its source Orders tab's live name/list for the
// "Following ▾" picker (design spec §1.4/§2.2, `order-details-tab-content.tsx`).
import type { DataClient } from '@amps-ui/worker-client';
import type { Model } from 'flexlayout-react';
import type { TabConfig } from '../model';
import { OrderDetailsTabContent } from './order-details-tab-content';
import { OrdersTabContent } from './orders-tab-content';

export function GridTab({
  config,
  client,
  model,
}: {
  config: TabConfig;
  client: DataClient;
  model: Model;
}) {
  if (config.kind === 'orders') {
    return <OrdersTabContent client={client} instanceId={config.instanceId} />;
  }
  return <OrderDetailsTabContent client={client} config={config} model={model} />;
}
