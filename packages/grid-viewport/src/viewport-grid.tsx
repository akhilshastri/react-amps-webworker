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
import type {
  ColDef,
  GetRowIdParams,
  GridApi,
  GridReadyEvent,
  RowSelectionOptions,
  SelectionChangedEvent,
} from 'ag-grid-community';
import { themeQuartz } from 'ag-grid-community';
import { AgGridReact } from 'ag-grid-react';
import {
  type CSSProperties,
  type ReactNode,
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createWorkerViewportDatasource } from './datasource';
import './modules';
import { toSelectedRowKeys } from './selection';
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

/**
 * Translates the topic-agnostic `rowSelection` prop into AG Grid's own
 * `RowSelectionOptions` (plan §10 C2).
 *
 * `'multiple'` disables the header "select all" checkbox on purpose: the
 * Viewport row model has no concept of "every row" to select -- only
 * whatever window is currently loaded -- so a header checkbox would either
 * lie (claim "all" while only selecting the loaded window) or require a
 * custom select-all AG Grid doesn't support here. The plan's resolution is
 * an explicit "Clear selection" control instead (`ViewportGridHandle.clearSelection`,
 * below), which is honest about operating on whatever is currently selected
 * rather than implying "all rows in the topic".
 */
function toAgRowSelection(
  mode: ViewportGridProps['rowSelection'],
): RowSelectionOptions | undefined {
  switch (mode) {
    case 'single':
      return { mode: 'singleRow', enableClickSelection: true };
    case 'multiple':
      return { mode: 'multiRow', enableClickSelection: true, headerCheckbox: false };
    default:
      return undefined;
  }
}

export interface ViewportGridProps {
  handle: SubscriptionHandle;
  columnDefs: ColDef[];
  getRowId: (data: RowData) => string;
  defaultColDef?: ColDef;
  rowHeight?: number;
  className?: string;
  style?: CSSProperties;
  renderFooter?: (status: ViewportStatus) => ReactNode;
  /**
   * Enables AG Grid row selection. Omitted entirely (the default) disables
   * selection, matching M2's bare page. `'multiple'` is what a master grid
   * driving a details subscription needs (plan §4); this component has no
   * opinion on what selecting a row *means* -- that policy (feeding an
   * `OrderSelectionStore`, debouncing, etc.) belongs to the feature package
   * consuming this component (plan §1: stay topic-agnostic).
   */
  rowSelection?: 'single' | 'multiple';
  /**
   * Fires whenever AG Grid's own `selectionChanged` fires, with the
   * selected rows' **keys** (via the same `getRowId` passed above) -- plan
   * §10 C2: row indices are meaningless across a re-sort or a details-
   * window repage, but a `getRowId`-derived key survives both.
   */
  onSelectionChanged?: (keys: string[]) => void;
}

/** Imperative handle for operations that don't fit the declarative prop surface (plan §10 C2). */
export interface ViewportGridHandle {
  /**
   * Clears the current row selection. The Viewport row model has no
   * header-checkbox select-all and shift-click only spans the loaded
   * window (plan §10 C2), so this is the mechanism a consumer wires to an
   * explicit "Clear selection" button rather than relying on AG Grid's own
   * (unavailable here) select-all.
   */
  clearSelection(): void;
}

export const ViewportGrid = forwardRef<ViewportGridHandle, ViewportGridProps>(function ViewportGrid(
  {
    handle,
    columnDefs,
    getRowId,
    defaultColDef = DEFAULT_COL_DEF,
    rowHeight,
    className,
    style,
    renderFooter = defaultFooter,
    rowSelection,
    onSelectionChanged,
  },
  ref,
) {
  const [status, setStatus] = useState<ViewportStatus>(INITIAL_STATUS);
  const datasource = useMemo(() => createWorkerViewportDatasource(handle), [handle]);
  useViewportSubscription(handle, (event) => setStatus((prev) => reduceStatus(prev, event)));

  const gridGetRowId = useMemo(
    () => (params: GetRowIdParams<RowData>) => getRowId(params.data),
    [getRowId],
  );

  const apiRef = useRef<GridApi<RowData> | undefined>(undefined);
  useImperativeHandle(
    ref,
    () => ({
      clearSelection: () => apiRef.current?.deselectAll(),
    }),
    [],
  );

  const handleGridReady = useCallback((event: GridReadyEvent<RowData>) => {
    apiRef.current = event.api;
  }, []);

  const handleSelectionChanged = useCallback(
    (event: SelectionChangedEvent<RowData>) => {
      onSelectionChanged?.(toSelectedRowKeys(event.api.getSelectedRows(), getRowId));
    },
    [onSelectionChanged, getRowId],
  );

  const agRowSelection = useMemo(() => toAgRowSelection(rowSelection), [rowSelection]);

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
          rowSelection={agRowSelection}
          onGridReady={handleGridReady}
          onSelectionChanged={agRowSelection ? handleSelectionChanged : undefined}
        />
      </div>
      <div className="viewport-grid-footer">{renderFooter(status)}</div>
    </div>
  );
});
