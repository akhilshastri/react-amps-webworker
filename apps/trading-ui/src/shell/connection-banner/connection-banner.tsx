// App-level connection-state banner (plan §7 M3B). Presentational -- takes
// the `ConnState` (`@amps-ui/protocol`, plan §3's `conn.state` payload) and
// renders it; `use-connection-state.ts` (M4b) is the real source, reading
// the app's single `DataClient`.
//
// M7 (design spec §7) visual refresh: a spinner while a connection attempt
// is in flight, `reconnecting` reuses the amber "in-progress" semantic
// token (§4.2) as a left border rather than inventing a new colour, and
// `failed` keeps the existing destructive treatment with an icon.
import type { ConnState } from '@amps-ui/protocol';
import { Alert, AlertTitle } from '@amps-ui/ui';
import { AlertCircle, Loader2 } from 'lucide-react';

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
const SPINNER_STATES: ReadonlySet<ConnState> = new Set(['connecting', 'reconnecting']);

export function ConnectionBanner({ state }: { state: ConnState }) {
  if (SILENT_STATES.has(state)) return null;

  return (
    <Alert
      variant={state === 'failed' ? 'destructive' : 'default'}
      className={
        state === 'reconnecting'
          ? 'shrink-0 rounded-none border-x-0 border-t-0 border-l-4 border-l-[var(--status-partial-text)] py-1.5'
          : 'shrink-0 rounded-none border-x-0 border-t-0 py-1.5'
      }
    >
      {SPINNER_STATES.has(state) && <Loader2 className="animate-spin" />}
      {state === 'failed' && <AlertCircle />}
      <AlertTitle>{LABEL[state]}</AlertTitle>
    </Alert>
  );
}
