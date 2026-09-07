// `<ViewportGrid>` -- the reusable, topic-agnostic AG Grid Viewport row
// model grid (plan §1). Never learns the words "orders" or "childCount":
// every topic-specific concern (columns, filters, subscription spec) is
// supplied by the caller (a feature package, or `apps/trading-ui` directly
// for M2's bare page).
//
// `getRowId` is mandatory (not optional) -- without it the Viewport row
// model matches incoming data to RowNodes by index, so every re-sort looks
// like a full data change and selection/flash state is lost (plan §3).
import type { RowData, WorkerEvent } from '@amps-ui/protocol';
import type { SubscriptionHandle } from '@amps-ui/worker-client';
import type { ColDef, GetRowIdParams } from 'ag-grid-community';
import { themeQuartz } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import { type CSSProperties, type ReactNode, useMemo, useState } from 'react';
import { createWorkerViewportDatasource } from './datasource';
import './modules';
import { useViewportSubscription } from './use-viewport-subscription';

/** Status derived from the subscription's own events -- fuels the default footer. */
export interface ViewportStatus {
  rowCount: number | undefined;
  /** True while a snapshot is loading (from `sub.opened` up to `snapshot.complete`). */
  loading: boolean;
  snapshotReceived: number | undefined;
  lastSnapshotElapsedMs: number | undefined;
  lastError: string | undefined;
}

const INITIAL_STATUS: ViewportStatus = {
  rowCount: undefined,
  loading: true,
  snapshotReceived: undefined,
  lastSnapshotElapsedMs: undefined,
  lastError: undefined,
};

function reduceStatus(status: ViewportStatus, event: WorkerEvent): ViewportStatus {
  switch (event.type) {
    case 'snapshot.progress':
      return { ...status, loading: true, snapshotReceived: event.received };
    case 'snapshot.complete':
      return {
        ...status,
        loading: false,
        rowCount: event.rowCount,
        lastSnapshotElapsedMs: event.elapsedMs,
      };
    case 'rows.count':
    case 'rows.reset':
      return { ...status, rowCount: event.rowCount };
    case 'error':
      return { ...status, lastError: event.message };
    default:
      return status;
  }
}

function defaultFooter(status: ViewportStatus): ReactNode {
  if (status.lastError) return `Error: ${status.lastError}`;
  if (status.loading) return `Loading... ${status.snapshotReceived ?? 0} rows received`;
  return `${status.rowCount ?? 0} rows`;
}

// Sorting/filtering is not wired in yet (plan §3: the Viewport row model
// gets no sortModel/filterModel; that bridging is M3A). Until then, a
// clickable sort/filter UI would silently do nothing, so both are off by
// default -- matches AG Grid's own Viewport row model example.
const DEFAULT_COL_DEF: ColDef = { sortable: false, filter: false, resizable: true };

export interface ViewportGridProps {
  handle: SubscriptionHandle;
  columnDefs: ColDef[];
  getRowId: (data: RowData) => string;
  defaultColDef?: ColDef;
  rowHeight?: number;
  className?: string;
  style?: CSSProperties;
  renderFooter?: (status: ViewportStatus) => ReactNode;
}

export function ViewportGrid({
  handle,
  columnDefs,
  getRowId,
  defaultColDef = DEFAULT_COL_DEF,
  rowHeight,
  className,
  style,
  renderFooter = defaultFooter,
}: ViewportGridProps) {
  const [status, setStatus] = useState<ViewportStatus>(INITIAL_STATUS);
  const datasource = useMemo(() => createWorkerViewportDatasource(handle), [handle]);
  useViewportSubscription(handle, (event) => setStatus((prev) => reduceStatus(prev, event)));

  const gridGetRowId = useMemo(
    () => (params: GetRowIdParams<RowData>) => getRowId(params.data),
    [getRowId],
  );

  return (
    <div
      className={className}
      style={{ display: 'flex', flexDirection: 'column', height: '100%', ...style }}
    >
      <div style={{ flex: 1, minHeight: 0 }}>
        <AgGridReact<RowData>
          theme={themeQuartz}
          rowModelType="viewport"
          viewportDatasource={datasource}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          getRowId={gridGetRowId}
          rowHeight={rowHeight}
        />
      </div>
      <div className="viewport-grid-footer">{renderFooter(status)}</div>
    </div>
  );
}
