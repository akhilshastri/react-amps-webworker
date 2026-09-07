import type { ConnState } from '@amps-ui/protocol';
// Mock connection lifecycle (plan §7 M3B: "App-level connection-state
// banner (mock state for now)"). Walks through a couple of the states a
// real `conn.state` worker event would report (plan §3) so the banner's
// non-silent states can be checked without a worker; M4/M5 replace this
// with `DataClient.onConnState` (`@amps-ui/worker-client`).
import { useEffect, useState } from 'react';

export function useMockConnectionState(): ConnState {
  const [state, setState] = useState<ConnState>('connecting');

  useEffect(() => {
    const timer = setTimeout(() => setState('open'), 800);
    return () => clearTimeout(timer);
  }, []);

  return state;
}
