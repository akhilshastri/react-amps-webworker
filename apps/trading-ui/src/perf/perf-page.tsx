// `/perf` probe page (plan §6/M6): a standalone route, isolated from the
// tabbed shell, that opens `order_details` subscriptions at controlled
// projected sizes (~1k/10k/100k rows) and measures the pipeline end to end
// -- load timing, JS heap, patch traffic, and frame time during a scripted
// sustained scroll (`run-probe.ts`).
//
// Deliberately outside `shell/`: this page owns its own worker + `DataClient`
// (mirroring `m2-slice.tsx`'s bootstrap pattern) so a run here never shares
// state with, or is throttled by, the real app's tabs, and it is reachable
// directly at `/?perf` (see `App.tsx`) with none of flexlayout's machinery.
// M6 owns this directory exclusively (task brief); everything else in
// `apps/trading-ui` belongs to M5/shell and is not touched here.
//
// Results accumulate on `window.__PERF_RESULTS__` as each run completes, for
// a CDP script driving this page to read back afterward (`wsl-chrome-
// debugging` skill) -- there is no server round trip, everything here stays
// in the tab.
import DataWorker from '@amps-ui/data-worker?worker';
import { ORDER_DETAILS_COLUMN_DEFS, getOrderDetailRowId } from '@amps-ui/feature-order-details';
import { type Order, getOrderRowId, ordersSubscriptionSpec } from '@amps-ui/feature-orders';
import { ViewportGrid } from '@amps-ui/grid-viewport';
import { toSubscriptionId } from '@amps-ui/protocol';
import { DataClient, type SubscriptionHandle } from '@amps-ui/worker-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatMarkdownTable } from './probe-report';
import { type ProbeResult, runProbe } from './run-probe';
import { waitForScrollContainer } from './scroll-driver';
import { AMPS_URI, PERF_TARGET_ROWS, SCROLL_DURATION_MS, SNAPSHOT_TIMEOUT_MS } from './targets';

declare global {
  interface Window {
    __PERF_RESULTS__?: ProbeResult[];
  }
}

/**
 * `?batchSize=N` overrides the production `DETAILS_BATCH_SIZE` for every run
 * this page load (`run-probe.ts`'s `batchSize` experiment lever) -- lets a
 * measurement session compare a candidate value against a real number
 * without a code change (plan: "measure first, then tune"). `undefined`
 * (the default, no query param) falls back to the production constant.
 */
function readBatchSizeOverride(): number | undefined {
  if (typeof location === 'undefined') return undefined;
  const raw = new URLSearchParams(location.search).get('batchSize');
  const parsed = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function PerfPage() {
  const batchSizeOverride = readBatchSizeOverride();
  const clientRef = useRef<DataClient | undefined>(undefined);
  const gridWrapperRef = useRef<HTMLDivElement>(null);
  // Mutable "current details handle" / "a run is in flight" tracking, read
  // from inside `runOne`'s async body -- kept as refs (not the `useState`
  // below) specifically so `runOne`'s own identity never goes stale mid-run;
  // see the module-level note in `runOne` for why reading React state here
  // instead would close over a snapshot from whenever `runOne` was last
  // recreated, not the handle the *previous loop iteration* just opened.
  const detailsHandleRef = useRef<SubscriptionHandle | undefined>(undefined);
  const runningRef = useRef(false);

  const [connState, setConnState] = useState('idle');
  const [orders, setOrders] = useState<Order[]>([]);
  const [detailsHandle, setDetailsHandle] = useState<SubscriptionHandle | undefined>(undefined);
  const [results, setResults] = useState<ProbeResult[]>([]);
  const [runningTarget, setRunningTarget] = useState<number | undefined>(undefined);
  const [lastError, setLastError] = useState<string | undefined>(undefined);

  // Bootstrap: worker + connection + the one-time `orders` load. childCount
  // is the whole basis for `pickOrdersForTarget` (`order-picker.ts`), so
  // every probe run needs this loaded first.
  useEffect(() => {
    const worker = new DataWorker();
    const client = new DataClient(worker);
    clientRef.current = client;
    const offState = client.onConnState((e) => setConnState(e.state));
    client.connect(AMPS_URI, 'perf-probe');

    const ordersSubId = toSubscriptionId('perf-orders');
    const ordersHandle = client.openSubscription(ordersSubscriptionSpec(ordersSubId));
    const ordersByKey = new Map<string, Order>();
    const offOrders = ordersHandle.onEvent((event) => {
      if (event.type === 'snapshot.complete') {
        // Widen past the default ~100-row initial window
        // (`DEFAULT_INITIAL_WINDOW_ROWS`, plan §3) to pull every order's
        // `childCount` -- only 1,000 rows total, cheap to hold whole
        // (matches `ordersSubscriptionSpec`'s own "1,000 rows is safe
        // unfiltered").
        ordersHandle.setViewportRange(0, event.rowCount - 1);
      }
      if (event.type === 'rows.reset') {
        for (const row of Object.values(event.rows)) {
          ordersByKey.set(getOrderRowId(row), row as unknown as Order);
        }
        setOrders([...ordersByKey.values()]);
      }
    });

    return () => {
      offState();
      offOrders();
      ordersHandle.close();
      detailsHandleRef.current?.close();
      client.disconnect();
      client.dispose();
    };
  }, []);

  const runOne = useCallback(
    async (target: number) => {
      const client = clientRef.current;
      const wrapper = gridWrapperRef.current;
      if (!client || !wrapper || orders.length === 0 || runningRef.current) return;

      runningRef.current = true;
      setRunningTarget(target);
      setLastError(undefined);
      // A fresh subId per run (rather than reusing one) keeps each run's
      // subscription, epoch, and AG Grid instance (via the `key` on
      // `<ViewportGrid>` below) fully independent -- no state from the
      // previous size carries over.
      const subId = toSubscriptionId(`perf-details-${target}-${Date.now()}`);

      try {
        const result = await runProbe({
          client,
          subId,
          orders,
          targetRows: target,
          scrollDurationMs: SCROLL_DURATION_MS,
          snapshotTimeoutMs: SNAPSHOT_TIMEOUT_MS,
          waitForScrollContainer: () => waitForScrollContainer(wrapper),
          batchSize: batchSizeOverride,
          onHandleOpened: (handle) => {
            detailsHandleRef.current?.close();
            detailsHandleRef.current = handle;
            setDetailsHandle(handle);
          },
        });
        setResults((prev) => {
          const next = [...prev.filter((r) => r.targetRows !== target), result];
          window.__PERF_RESULTS__ = next;
          return next;
        });
      } catch (error) {
        setLastError(error instanceof Error ? error.message : String(error));
      } finally {
        runningRef.current = false;
        setRunningTarget(undefined);
      }
    },
    // `detailsHandleRef`/`runningRef` are refs (always current, no
    // staleness); `orders` only changes once, while loading; `batchSizeOverride`
    // is derived once from `location.search` and never changes across
    // this page's life -- so `runOne` settles to one stable identity once
    // the orders snapshot arrives, which `runAll`'s sequential loop below
    // relies on to always see the latest run's outcome, not a stale closure's.
    [orders, batchSizeOverride],
  );

  const runAll = useCallback(async () => {
    // Sequential, not `Promise.all` -- each run needs the previous run's
    // subscription closed and its grid instance's DOM settled before the
    // next one's `waitForScrollContainer` looks for a scroll body, and only
    // one details subscription should be live at a time so patch/heap
    // measurements stay attributable to a single target size.
    for (const target of PERF_TARGET_ROWS) {
      await runOne(target);
    }
  }, [runOne]);

  const busy = runningTarget !== undefined;

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', height: '100vh', font: '13px system-ui' }}
    >
      <div
        style={{
          padding: '8px 12px',
          borderBottom: '1px solid #ccc',
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          flexWrap: 'wrap',
        }}
      >
        <strong>/perf probe</strong>
        <span>
          connection: <strong>{connState}</strong>
        </span>
        <span>
          orders loaded: <strong>{orders.length}</strong>
        </span>
        <span>
          batchSize: <strong>{batchSizeOverride ?? '(production default)'}</strong>
        </span>
        {PERF_TARGET_ROWS.map((target) => (
          <button
            key={target}
            type="button"
            disabled={orders.length === 0 || busy}
            onClick={() => runOne(target)}
          >
            {runningTarget === target
              ? `running ${target.toLocaleString()}…`
              : `run ${target.toLocaleString()}`}
          </button>
        ))}
        <button type="button" disabled={orders.length === 0 || busy} onClick={runAll}>
          run all
        </button>
        {lastError && <span style={{ color: 'crimson' }}>error: {lastError}</span>}
      </div>

      <div style={{ flex: 1, minHeight: 0 }} ref={gridWrapperRef}>
        {detailsHandle && (
          <ViewportGrid
            key={String(detailsHandle.subId)}
            handle={detailsHandle}
            columnDefs={ORDER_DETAILS_COLUMN_DEFS}
            getRowId={getOrderDetailRowId}
          />
        )}
      </div>

      <div
        style={{
          padding: '8px 12px',
          borderTop: '1px solid #ccc',
          maxHeight: '35vh',
          overflow: 'auto',
        }}
      >
        <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
          {results.length > 0 ? formatMarkdownTable(results) : '(no runs yet)'}
        </pre>
      </div>
    </div>
  );
}
