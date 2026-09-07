// Shared per-tab frame: content + the real per-tab footer (plan §5), fed
// from whichever `SubscriptionHandle` this tab currently has open right
// now. Both `<OrdersTabContent>` and `<OrderDetailsTabContent>` need
// exactly this wrapper -- factored out here rather than duplicated.
import type { SubscriptionHandle } from '@amps-ui/worker-client';
import type { ReactNode } from 'react';
import { TabFooter } from '../footer/tab-footer';
import { useSubscriptionStats } from '../footer/use-subscription-stats';

export function TabFrame({
  handle,
  children,
}: {
  handle: SubscriptionHandle | undefined;
  children: ReactNode;
}) {
  const stats = useSubscriptionStats(handle);
  return (
    <div className="flex h-full flex-col">
      {children}
      <TabFooter stats={stats} />
    </div>
  );
}
