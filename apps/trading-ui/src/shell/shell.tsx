// App-level shell (plan §5, §7 M3B; real AMPS wiring M4b): connection
// banner + the flexlayout tab layout, with per-tab selection scoped by
// `TabStateProvider`.
//
// Owns the single worker + `DataClient` for the whole app (plan §3: "One
// DedicatedWorker. One AmpsConnection.") -- every tab's subscription
// (`grid-tab/`) goes through this one client, matching M2's bootstrap
// pattern (`m2-slice.tsx`) but for the real tabbed shell instead of one
// bare page.
//
// Construction + `connect()` happen together inside one `useEffect`
// (mirroring `m2-slice.tsx`), and `client` is only handed to `<ShellLayout>`
// -- so a tab's own subscription-opening effect can exist -- once that
// effect has actually run. This is deliberate, not incidental: React runs a
// mounting tree's effects bottom-up (children before parents), so if
// `client` existed from render 1 (e.g. via a `useState` lazy initializer), a
// child tab's "open my subscription" effect would fire and post `sub.open`
// BEFORE this component's own effect ever posts `conn.open` -- a strictly
// worse version of the connect/subscribe race `@amps-ui/data-worker`
// (`runtime.ts`'s `awaitConnection`) fixes, since there the worker would
// have no in-flight connect to wait on. Gating child mount on `client`
// being set guarantees `conn.open` is always sent first.
import DataWorker from '@amps-ui/data-worker?worker';
import { Toaster, TooltipProvider } from '@amps-ui/ui';
import { DataClient } from '@amps-ui/worker-client';
import { useEffect, useState } from 'react';
import { ConnectionBanner } from './connection-banner/connection-banner';
import { useConnectionState } from './connection-banner/use-connection-state';
import { useErrorToasts } from './error-toasts';
import { ShellLayout } from './shell-layout';
import { TabStateProvider } from './tab-state';

// Hardcoded per plan §1 assumptions ("Single AMPS instance ... hardcoded in
// an env var. No failover / HA planning") -- matches `m2-slice.tsx`.
const AMPS_URI = 'ws://localhost:9018/amps/json';

export function Shell() {
  const [client, setClient] = useState<DataClient | undefined>(undefined);

  useEffect(() => {
    const worker = new DataWorker();
    const dataClient = new DataClient(worker);
    dataClient.connect(AMPS_URI, 'trading-ui');
    setClient(dataClient);

    // `dispose()`/`disconnect()` are also what a normal unmount runs below,
    // via this same effect's cleanup -- but an actual browser tab/window
    // close does not reliably run React's unmount cleanup (plan §5/M5:
    // "clean teardown on tab close and page unload"). `pagehide` (rather
    // than `beforeunload`, which is worse for the back/forward cache) is
    // the extra trigger that covers that case; sharing one function means
    // there is exactly one teardown path to keep correct, run from
    // whichever event fires first.
    const teardown = () => {
      dataClient.disconnect();
      dataClient.dispose();
    };
    window.addEventListener('pagehide', teardown);

    return () => {
      window.removeEventListener('pagehide', teardown);
      teardown();
    };
  }, []);

  const connState = useConnectionState(client);
  useErrorToasts(client);

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col">
        <ConnectionBanner state={connState} />
        <div className="min-h-0 flex-1">
          {client && (
            <TabStateProvider>
              <ShellLayout client={client} />
            </TabStateProvider>
          )}
        </div>
      </div>
      <Toaster />
    </TooltipProvider>
  );
}
