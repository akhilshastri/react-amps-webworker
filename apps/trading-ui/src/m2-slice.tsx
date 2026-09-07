// M2 verification slice -- RESTORED.
//
// M3B replaced this page with the tab shell on the grounds that M2 had
// "already done its job". It had not: M2's browser verification was blocked
// (Chromium missing libnss3/libnspr4/libasound2t64), so the worker -> AMPS ->
// viewport grid path has never actually been observed rendering. Removing the
// only page that could demonstrate it removed the ability to close that gate.
//
// Kept as a separate dev-only route (`?m2`) rather than the default page, so
// the shell stays the app's real entry point while M2 remains verifiable in
// isolation -- a much smaller surface to debug than the full tabbed shell.
//
// Delete this file once QA has signed off the M2 checklist (plan §10 C4).
import DataWorker from '@amps-ui/data-worker?worker';
import { ViewportGrid } from '@amps-ui/grid-viewport';
import { toSubscriptionId } from '@amps-ui/protocol';
import { DataClient, type SubscriptionHandle } from '@amps-ui/worker-client';
import { useEffect, useState } from 'react';
import { getOrderDetailRowId, orderDetailsColumnDefs } from './order-details-columns';

/** Verified live: childCount 9968, ~16.7 updates/sec -- enough to see cells flash. */
const ORDER_ID = 'ORD-000426';
const EXPECTED_ROWS = 9968;
const AMPS_URI = 'ws://localhost:9018/amps/json';

export function M2Slice() {
  const [handle, setHandle] = useState<SubscriptionHandle | undefined>();
  const [conn, setConn] = useState<string>('idle');

  useEffect(() => {
    const worker = new DataWorker();
    const client = new DataClient(worker);
    const offState = client.onConnState((e) => setConn(e.state));

    client.connect(AMPS_URI, 'm2-slice');
    const h = client.openSubscription({
      subId: toSubscriptionId('m2-slice'),
      topic: 'order_details',
      mode: 'sow_and_delta_subscribe',
      filter: `/orderId = '${ORDER_ID}'`,
      orderBy: '/detailId ASC',
      batchSize: 5000,
      keyField: 'detailId',
    });
    setHandle(h);

    return () => {
      offState();
      h.close();
      client.disconnect();
      worker.terminate?.();
    };
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <div style={{ padding: '8px 12px', font: '13px system-ui', borderBottom: '1px solid #ccc' }}>
        <strong>M2 slice</strong> — {ORDER_ID} — expecting <strong>{EXPECTED_ROWS.toLocaleString()}</strong> rows
        {' · '}connection: <strong>{conn}</strong>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        {handle && (
          <ViewportGrid
            handle={handle}
            columnDefs={orderDetailsColumnDefs}
            getRowId={getOrderDetailRowId}
            renderFooter={(s) => (
              <div style={{ padding: '6px 12px', font: '12px system-ui' }}>
                rows: <strong>{s.rowCount ?? '—'}</strong>
                {s.loading ? ' · loading…' : ''}
                {s.lastSnapshotElapsedMs !== undefined ? ` · snapshot ${s.lastSnapshotElapsedMs}ms` : ''}
                {s.lastError ? ` · error: ${s.lastError}` : ''}
              </div>
            )}
          />
        )}
      </div>
    </div>
  );
}
