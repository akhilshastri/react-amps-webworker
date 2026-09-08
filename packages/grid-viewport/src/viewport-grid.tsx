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
  ColGroupDef,
  GetRowIdParams,
  GridApi,
  GridReadyEvent,
  RowSelectionOptions,
  SelectionChangedEvent,
  SortChangedEvent,
  Theme,
} from 'ag-grid-community';
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
import type { SortColumnState } from './sort-filter-translate';
import { blotterTheme } from './theme';
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

// Off by default -- matches AG Grid's own Viewport row model example. The
// Viewport row model gets no sortModel/filterModel of its own (plan §3);
// `onSortChanged`/`sortChanged` (above) is the bridge a caller uses instead,
// and a caller that wants it must opt columns into `sortable: true` via its
// own `defaultColDef`/`columnDefs` (e.g. `feature-order-details`, M4b).
// Client-side column filtering (plan D3) is a separate opt-in this
// component doesn't wire up yet.
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
  /**
   * Also accepts `ColGroupDef` (a two-row grouped header, design spec §3.3)
   * -- confirmed safe against the Viewport row model (§10.1/§11: header
   * grouping is a pure column-definition concern, unrelated to row
   * grouping, which the Viewport row model genuinely doesn't support).
   */
  columnDefs: (ColDef | ColGroupDef)[];
  getRowId: (data: RowData) => string;
  defaultColDef?: ColDef;
  rowHeight?: number;
  /**
   * The AG Grid Theming-API theme (`./theme.ts`'s `blotterTheme` by
   * default). A caller overrides this only to layer a per-instance param on
   * top (e.g. `<OrdersGrid>`'s per-tab `selectedRowBackgroundColor` accent,
   * `accentSelectionTheme`, design spec §2.3/§5) -- `blotterTheme` itself
   * already carries every density/colour token both grids share.
   */
  theme?: Theme;
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
   * window repage, but a `getRowId`-derived key survives both. Also passes
   * the full row data (M4b addition) alongside the keys, since a caller
   * that needs more than the key (e.g. `feature-orders`' selection store,
   * which needs `childCount` for `projectDetailRowCount`) has no other way
   * to reach it -- the Viewport row model's key->row mapping lives inside
   * AG Grid, not in any store this package exposes.
   */
  onSelectionChanged?: (keys: string[], rows: RowData[]) => void;
  /**
   * Fires whenever AG Grid's own `sortChanged` fires, with
   * `api.getColumnState()` (plan §3: "listen to sortChanged/filterChanged,
   * read api.getColumnState()/getFilterModel(), translate to a
   * sub.update"). Translating this into a protocol `SortSpec` is the
   * caller's job (`sort-filter-translate.ts`'s `translateSortModel`) since
   * it needs topic-specific policy (`mode`, `nonStreamableFields`) this
   * component has no opinion on (plan §1: stay topic-agnostic).
   */
  onSortChanged?: (columnState: SortColumnState[]) => void;
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
    theme = blotterTheme,
    className,
    style,
    renderFooter = defaultFooter,
    rowSelection,
    onSelectionChanged,
    onSortChanged,
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
      const rows = event.api.getSelectedRows();
      onSelectionChanged?.(toSelectedRowKeys(rows, getRowId), rows);
    },
    [onSelectionChanged, getRowId],
  );

  const handleSortChanged = useCallback(
    (event: SortChangedEvent<RowData>) => {
      onSortChanged?.(event.api.getColumnState());
    },
    [onSortChanged],
  );

  const agRowSelection = useMemo(() => toAgRowSelection(rowSelection), [rowSelection]);

  return (
    <div
      // `amps-grid` scopes the cell-flash CSS override (`@amps-ui/ui`'s
      // `index.css`, design spec §3.4/§10.2 -- no theme param exists for the
      // flash colour in this AG Grid version) to exactly the grids that need
      // it, never leaking onto an unrelated themed surface.
      className={['amps-grid', className].filter(Boolean).join(' ')}
      style={{ display: 'flex', flexDirection: 'column', height: '100%', ...style }}
    >
      <div style={{ flex: 1, minHeight: 0 }}>
        <AgGridReact<RowData>
          theme={theme}
          rowModelType="viewport"
          viewportDatasource={datasource}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          getRowId={gridGetRowId}
          rowHeight={rowHeight}
          rowSelection={agRowSelection}
          onGridReady={handleGridReady}
          onSelectionChanged={agRowSelection ? handleSelectionChanged : undefined}
          onSortChanged={onSortChanged ? handleSortChanged : undefined}
        />
      </div>
      <div className="viewport-grid-footer">{renderFooter(status)}</div>
    </div>
  );
});
