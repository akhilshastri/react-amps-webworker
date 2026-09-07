// Real connection-state source (plan §5/M4b), replacing M3B's
// `use-mock-connection-state.ts`. `<ConnectionBanner>` itself is untouched
// -- it only ever consumed a `ConnState` value; this hook just supplies it
// from the app's single `DataClient` (`@amps-ui/worker-client`) instead of
// a timer-driven simulation.
import type { ConnState } from '@amps-ui/protocol';
import type { DataClient } from '@amps-ui/worker-client';
import { useEffect, useState } from 'react';

export function useConnectionState(client: DataClient): ConnState {
  const [state, setState] = useState<ConnState>(() => client.getConnState());

  useEffect(() => client.onConnState((event) => setState(event.state)), [client]);

  return state;
}
