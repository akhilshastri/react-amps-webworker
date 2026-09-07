// App-level shell (plan §5/§7 M3B): connection banner + the flexlayout tab
// layout, with per-tab selection scoped by `TabStateProvider`. No AMPS
// wiring of its own (plan §7 M3B: "No AMPS data at all") -- real grids and
// a real `DataClient` land in M3C/M4.
//
// `TooltipProvider` wraps everything here because `@amps-ui/ui`'s Tooltip
// (used by the per-tab footer's "idle is expected" hint) requires one
// ancestor provider, not one per tooltip.
import { TooltipProvider } from '@amps-ui/ui';
import { ConnectionBanner } from './connection-banner/connection-banner';
import { useMockConnectionState } from './connection-banner/use-mock-connection-state';
import { ShellLayout } from './shell-layout';
import { TabStateProvider } from './tab-state';

export function Shell() {
  const connState = useMockConnectionState();

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col">
        <ConnectionBanner state={connState} />
        <div className="min-h-0 flex-1">
          <TabStateProvider>
            <ShellLayout />
          </TabStateProvider>
        </div>
      </div>
    </TooltipProvider>
  );
}
