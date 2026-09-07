// Turns worker-reported protocol errors into shadcn/sonner toasts (plan
// §5/M5: "error events surfaced as shadcn toasts"). Fed by `DataClient.
// onError` (`@amps-ui/worker-client`), which -- as of M5 -- fans out BOTH
// connection-scoped errors (e.g. the initial connect exhausting its
// retries) and subscription-scoped ones (e.g. a per-tab resubscribe that
// failed after a reconnect), so this one hook covers the whole app rather
// than each tab needing its own listener.
//
// Presentational home for the `<Toaster>` mount point is `shell.tsx`, which
// is the only component that both owns the single `DataClient` for the
// whole app and renders once at the app root.
import { toast } from '@amps-ui/ui';
import type { DataClient } from '@amps-ui/worker-client';
import { useEffect } from 'react';

export function useErrorToasts(client: DataClient | undefined): void {
  useEffect(() => {
    if (!client) return;
    return client.onError((event) => {
      const notify = event.fatal ? toast.error : toast.warning;
      notify(event.message, { description: event.code });
    });
  }, [client]);
}
