// App-level connection-state banner (plan §7 M3B). Presentational -- takes
// the `ConnState` (`@amps-ui/protocol`, plan §3's `conn.state` payload) and
// renders it; `use-mock-connection-state.ts` is the mock source for now.
import type { ConnState } from '@amps-ui/protocol';
import { Alert, AlertTitle } from '@amps-ui/ui';

const LABEL: Record<ConnState, string> = {
  idle: 'Not connected',
  connecting: 'Connecting…',
  open: 'Connected',
  reconnecting: 'Reconnecting…',
  closed: 'Disconnected',
  failed: 'Connection failed',
};

// Steady-state `open` stays silent so the banner doesn't compete with the
// layout below it -- it only needs to speak up when something's wrong or
// pending.
const SILENT_STATES: ReadonlySet<ConnState> = new Set(['open']);

export function ConnectionBanner({ state }: { state: ConnState }) {
  if (SILENT_STATES.has(state)) return null;

  return (
    <Alert
      variant={state === 'failed' ? 'destructive' : 'default'}
      className="shrink-0 rounded-none border-x-0 border-t-0 py-1.5"
    >
      <AlertTitle>{LABEL[state]}</AlertTitle>
    </Alert>
  );
}
