import { type Order, buildDetailsFilter, projectDetailRowCount } from '@amps-ui/feature-orders';
// `<OrderDetailsGrid>` -- the `order_details` details grid (plan §4, M4b).
//
// Unlike `<OrdersGrid>` (which is handed an already-open, static
// subscription), this component OWNS its subscription's lifecycle end to
// end, because unlike the 1,000-row `orders` grid, what it subscribes to
// depends entirely on the (live-changing) orders selection:
//
//  - 0 selected orders -> no subscription, empty state (plan §4).
//  - A selection change is debounced 250ms trailing (`SELECTION_DEBOUNCE_MS`)
//    so arrow-keying down the orders grid issues exactly one subscription,
//    not one per row (plan §4).
//  - The first `sub.open` is already AMPS-paginated (`WINDOW_ROWS`,
//    `rowCountHint = projectDetailRowCount(selectedOrders)`, reused from
//    `@amps-ui/feature-orders`, "verified exact against live AMPS") -- large
//    selections load progressively instead of streaming everything, and the
//    footer can show the true total distinct from what's loaded (plan §4).
//  - A later selection change re-issues via `handle.update()` (protocol
//    epoch machinery discards any in-flight snapshot from the superseded
//    selection); old rows stay on screen -- nothing here ever clears them --
//    until the new `snapshot.complete`'s `rows.reset` swaps them atomically.
//  - Sorting is delegated to AMPS (`translateSortModel({ mode: 'server' })`)
//    except `lastUpdated`/`tickSeq`, which `NON_STREAMABLE_SORT_FIELDS`
//    (constants.ts) blocks from ever reaching the worker as a live sort key
//    (plan §4 CORRECTED/C5) -- blocked fields are surfaced via a banner
//    rather than silently dropped.
//  - The client-side window trim that keeps a paginated subscription's row
//    store bounded, and the repage that follows the viewport past the
//    loaded window, both live in `@amps-ui/data-worker` (worker-side; this
//    component only asks for a window, it doesn't enforce one).
import {
  type SortColumnState,
  ViewportGrid,
  type ViewportStatus,
  translateSortModel,
} from '@amps-ui/grid-viewport';
import type { SubscriptionId } from '@amps-ui/protocol';
import { Alert, AlertDescription, AlertTitle, Badge } from '@amps-ui/ui';
import type { DataClient, SubscriptionHandle } from '@amps-ui/worker-client';
import { type CSSProperties, useCallback, useEffect, useRef, useState } from 'react';
import { blockedFieldsMessage } from './blocked-sort-message';
import { ORDER_DETAILS_COLUMN_DEFS, getOrderDetailRowId } from './columns';
import {
  DEFAULT_ORDER_BY,
  DETAILS_BATCH_SIZE,
  NON_STREAMABLE_SORT_FIELDS,
  SELECTION_DEBOUNCE_MS,
  WINDOW_ROWS,
} from './constants';

const DETAILS_DEFAULT_COL_DEF = { resizable: true, sortable: true };

export interface OrderDetailsGridProps {
  client: DataClient;
  subId: SubscriptionId;
  /** The current orders selection driving this grid's filter (plan §4). Empty means "show nothing". */
  selectedOrders: readonly Order[];
  className?: string;
  style?: CSSProperties;
  /**
   * Lets the caller (the shell, M4b) observe the internally-managed
   * subscription handle, e.g. to feed the per-tab footer's `stats` (plan
   * §5) -- this component owns the handle's open/update/close lifecycle, so
   * it's the only thing that can create it.
   */
  onHandleChange?: (handle: SubscriptionHandle | undefined) => void;
}

export function OrderDetailsGrid({
  client,
  subId,
  selectedOrders,
  className,
  style,
  onHandleChange,
}: OrderDetailsGridProps) {
  const [handle, setHandle] = useState<SubscriptionHandle | undefined>(undefined);
  const [blockedSortFields, setBlockedSortFields] = useState<readonly string[]>([]);
  const [loading, setLoading] = useState(false);
  const handleRef = useRef<SubscriptionHandle | undefined>(undefined);

  // `onHandleChange` is read through a ref rather than listed as an effect
  // dependency below -- a caller passing a fresh arrow function every render
  // must not re-arm the 250ms selection debounce on every unrelated render.
  const onHandleChangeRef = useRef(onHandleChange);
  onHandleChangeRef.current = onHandleChange;

  // Selection -> subscription lifecycle (plan §4): 250ms trailing debounce
  // so arrow-keying down the orders grid issues exactly one subscription,
  // not one per row.
  useEffect(() => {
    const timer = setTimeout(() => {
      const orderIds = selectedOrders.map((order) => order.orderId);
      const filter = buildDetailsFilter(orderIds);
      if (!filter) {
        handleRef.current?.close();
        handleRef.current = undefined;
        setHandle(undefined);
        onHandleChangeRef.current?.(undefined);
        return;
      }

      const rowCountHint = projectDetailRowCount(selectedOrders);
      if (!handleRef.current) {
        const opened = client.openSubscription({
          subId,
          topic: 'order_details',
          mode: 'sow_and_delta_subscribe',
          filter,
          orderBy: DEFAULT_ORDER_BY,
          batchSize: DETAILS_BATCH_SIZE,
          keyField: 'detailId',
          window: { topN: WINDOW_ROWS, skipN: 0 },
          rowCountHint,
        });
        handleRef.current = opened;
        setHandle(opened);
        onHandleChangeRef.current?.(opened);
      } else {
        handleRef.current.update({ filter, rowCountHint });
      }
    }, SELECTION_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [selectedOrders, client, subId]);

  // Release the subscription when this grid instance goes away (plan §5:
  // "Closing a tab must release its subscription").
  useEffect(
    () => () => {
      handleRef.current?.close();
      handleRef.current = undefined;
    },
    [],
  );

  // A fresh handle starts loading until its first snapshot completes; old
  // rows (from whatever handle preceded it) stay visible in the meantime --
  // nothing here clears the grid (plan §4: "no blank grid between
  // selections"). Independent of `<ViewportGrid>`'s own status tracking
  // (same "subscribe to the same handle for a status slot" pattern
  // `datasource.ts` documents), since a loading *overlay* needs to sit
  // above the grid, not below it in the footer slot.
  useEffect(() => {
    if (!handle) {
      setLoading(false);
      return;
    }
    setLoading(true);
    return handle.onEvent((event) => {
      if (event.type === 'snapshot.progress') setLoading(true);
      else if (event.type === 'snapshot.complete') setLoading(false);
    });
  }, [handle]);

  const handleSortChanged = useCallback((columnState: SortColumnState[]) => {
    const { sort, blockedFields } = translateSortModel(columnState, {
      mode: 'server',
      nonStreamableFields: NON_STREAMABLE_SORT_FIELDS,
    });
    setBlockedSortFields(blockedFields);
    handleRef.current?.update({ sort });
  }, []);

  const renderFooter = useCallback((_status: ViewportStatus) => null, []);

  return (
    <div
      className={className}
      style={{ display: 'flex', flexDirection: 'column', height: '100%', ...style }}
    >
      {blockedSortFields.length > 0 && (
        <Alert variant="default" className="shrink-0 rounded-none border-x-0 border-t-0 py-1.5">
          <AlertTitle>Sort not applied</AlertTitle>
          <AlertDescription>{blockedFieldsMessage(blockedSortFields)}</AlertDescription>
        </Alert>
      )}
      <div className="relative min-h-0 flex-1">
        {handle ? (
          <ViewportGrid
            handle={handle}
            columnDefs={ORDER_DETAILS_COLUMN_DEFS}
            getRowId={getOrderDetailRowId}
            defaultColDef={DETAILS_DEFAULT_COL_DEF}
            onSortChanged={handleSortChanged}
            renderFooter={renderFooter}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center text-muted-foreground text-sm">
            Select one or more orders to see their details.
          </div>
        )}
        {loading && (
          <Badge variant="secondary" className="absolute top-2 right-2 shadow">
            Loading…
          </Badge>
        )}
      </div>
    </div>
  );
}
