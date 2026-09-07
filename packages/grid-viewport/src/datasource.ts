// The reusable, topic-agnostic bridge between one worker subscription and
// one AG Grid Viewport row model instance (plan §1, §3).
//
// Two responsibilities, both about taming how fast events can arrive
// relative to the browser's paint cycle:
// 1. Applying data: `rows.patch` / `rows.reset` / `rows.count` events can
//    arrive several times within one animation frame (the worker flushes
//    conflated updates on its own ~16ms timer, independent of the main
//    thread's paint cycle). They are merged into one pending buffer and
//    applied to the grid exactly once per real `requestAnimationFrame`
//    (plan §3 "Main-thread apply").
// 2. Sending viewport range: AG Grid's `setViewportRange` fires repeatedly
//    during a scroll fling. Multiple calls within one frame collapse to
//    the last one, sent on the next frame (plan §3 "coalesced on the main
//    thread before send").
//
// This module knows nothing about topics, columns, or feature-specific
// row shapes -- only the wire-level `WorkerEvent` union from `@amps-ui/protocol`.
import type { RowData, WorkerEvent } from '@amps-ui/protocol';
import type { IViewportDatasource, IViewportDatasourceParams } from 'ag-grid-community';

/**
 * The subset of `SubscriptionHandle` (`@amps-ui/worker-client`) this
 * datasource needs. Kept as a narrow structural interface -- rather than
 * importing the concrete class -- so tests can pass a plain object instead
 * of standing up a real `DataClient` + fake `Worker`. A real
 * `SubscriptionHandle` satisfies this with no adapter.
 */
export interface ViewportSubscription {
  onEvent(listener: (event: WorkerEvent) => void): () => void;
  setViewportRange(firstRow: number, lastRow: number): void;
}

/** rAF/cancelRAF are injected (default: the real browser globals) so the
 * per-frame merge/coalesce behavior is deterministic under `bun test`,
 * which has no `requestAnimationFrame` (mirrors viewport-core's "clock
 * injected" pattern, plan §1). */
export interface CreateViewportDatasourceOptions {
  raf?: (callback: FrameRequestCallback) => number;
  cancelRaf?: (handle: number) => void;
}

export function createWorkerViewportDatasource(
  subscription: ViewportSubscription,
  options: CreateViewportDatasourceOptions = {},
): IViewportDatasource {
  const raf = options.raf ?? requestAnimationFrame;
  const cancelRaf = options.cancelRaf ?? cancelAnimationFrame;

  let params: IViewportDatasourceParams | undefined;
  let unsubscribe: (() => void) | undefined;

  // Per-frame merge buffer for applying row data (see module header, point 1).
  let pendingRowCount: number | undefined;
  let pendingRows: Record<number, RowData> | undefined;
  let applyRafHandle: number | undefined;

  function scheduleApply(): void {
    if (applyRafHandle !== undefined) return;
    applyRafHandle = raf(() => {
      applyRafHandle = undefined;
      if (!params) return;
      if (pendingRowCount !== undefined) {
        params.setRowCount(pendingRowCount, true);
        pendingRowCount = undefined;
      }
      if (pendingRows !== undefined) {
        params.setRowData(pendingRows);
        pendingRows = undefined;
      }
    });
  }

  function mergeRows(rows: Record<number, RowData>): void {
    pendingRows = pendingRows ? Object.assign(pendingRows, rows) : { ...rows };
    scheduleApply();
  }

  function mergeRowCount(count: number): void {
    pendingRowCount = count;
    scheduleApply();
  }

  function handleEvent(event: WorkerEvent): void {
    switch (event.type) {
      case 'rows.patch':
        mergeRows(event.rows);
        break;
      case 'rows.reset':
        mergeRowCount(event.rowCount);
        mergeRows(event.rows);
        break;
      case 'rows.count':
        mergeRowCount(event.rowCount);
        break;
      default:
        // snapshot.progress / snapshot.complete / rows.removed / error /
        // sub.opened / conn.state carry no row data for this datasource to
        // apply -- a topic-agnostic grid has nothing to do with them.
        // `<ViewportGrid>` subscribes to the same handle independently for
        // its footer/status slot.
        break;
    }
  }

  // Per-frame coalescing for outgoing viewport-range changes (see module
  // header, point 2). Deliberately separate from the apply-side rAF above:
  // these are two different clocks (incoming worker events vs. outgoing
  // grid scroll callbacks) that happen to use the same primitive.
  let pendingRange: { firstRow: number; lastRow: number } | undefined;
  let viewportRafHandle: number | undefined;

  return {
    init(initParams) {
      params = initParams;
      unsubscribe = subscription.onEvent(handleEvent);
    },
    setViewportRange(firstRow, lastRow) {
      pendingRange = { firstRow, lastRow };
      if (viewportRafHandle !== undefined) return;
      viewportRafHandle = raf(() => {
        viewportRafHandle = undefined;
        if (pendingRange)
          subscription.setViewportRange(pendingRange.firstRow, pendingRange.lastRow);
        pendingRange = undefined;
      });
    },
    destroy() {
      unsubscribe?.();
      if (applyRafHandle !== undefined) cancelRaf(applyRafHandle);
      if (viewportRafHandle !== undefined) cancelRaf(viewportRafHandle);
    },
  };
}
