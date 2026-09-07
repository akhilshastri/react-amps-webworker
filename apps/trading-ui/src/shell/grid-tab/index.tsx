// `<GridTab>` -- dispatches a flexlayout tab's content by `TabConfig.kind`
// (plan §5). Replaces M3B's `PlaceholderPanel` with the real grids (M4b).
import type { DataClient } from '@amps-ui/worker-client';
import type { TabConfig } from '../model';
import { OrderDetailsTabContent } from './order-details-tab-content';
import { OrdersTabContent } from './orders-tab-content';

export function GridTab({ config, client }: { config: TabConfig; client: DataClient }) {
  if (config.kind === 'orders') {
    return <OrdersTabContent client={client} instanceId={config.instanceId} />;
  }
  return <OrderDetailsTabContent client={client} config={config} />;
}
