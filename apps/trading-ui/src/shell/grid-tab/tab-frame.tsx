// Shared per-tab frame: content + the real per-tab footer (plan §5), fed
// from whichever `SubscriptionHandle` this tab currently has open right
// now. Both `<OrdersTabContent>` and `<OrderDetailsTabContent>` need
// exactly this wrapper -- factored out here rather than duplicated.
//
// M7 (design spec §2.1): an optional `accent` renders a 2px top border
// stripe in that colour -- only an Orders tab passes one (its own accent),
// a peripheral-vision-visible marker of "this is the violet one" while the
// tab is focused, reinforcing the same-colour dot on its label and on any
// Details tab following it.
import type { TabAccent } from '@amps-ui/grid-viewport';
import type { SubscriptionHandle } from '@amps-ui/worker-client';
import type { ReactNode } from 'react';
import { TabFooter } from '../footer/tab-footer';
import { useSubscriptionStats } from '../footer/use-subscription-stats';

export function TabFrame({
  handle,
  accent,
  children,
}: {
  handle: SubscriptionHandle | undefined;
  accent?: TabAccent;
  children: ReactNode;
}) {
  const stats = useSubscriptionStats(handle);
  return (
    <div
      className="flex h-full flex-col"
      style={accent ? { borderTop: `2px solid var(--accent-${accent}-9)` } : undefined}
    >
      {children}
      <TabFooter stats={stats} />
    </div>
  );
}
