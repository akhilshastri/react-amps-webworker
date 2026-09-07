// Real connection-state source (plan §5/M4b), replacing M3B's
// `use-mock-connection-state.ts`. `<ConnectionBanner>` itself is untouched
// -- it only ever consumed a `ConnState` value; this hook just supplies it
// from the app's single `DataClient` (`@amps-ui/worker-client`) instead of
// a timer-driven simulation.
import type { ConnState } from '@amps-ui/protocol';
import type { DataClient } from '@amps-ui/worker-client';
import { useEffect, useState } from 'react';

/**
 * `client` is `undefined` for the brief window before `Shell`'s own effect
 * has constructed it (see `shell.tsx`'s header for why that's gated behind
 * an effect rather than a `useState` lazy initializer) -- reads as `'idle'`
 * until then, matching `ConnState`'s own "not connected yet" value.
 */
export function useConnectionState(client: DataClient | undefined): ConnState {
  const [state, setState] = useState<ConnState>(() => client?.getConnState() ?? 'idle');

  useEffect(() => {
    if (!client) return;
    setState(client.getConnState());
    return client.onConnState((event) => setState(event.state));
  }, [client]);

  return state;
}
