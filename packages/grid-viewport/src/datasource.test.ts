import { describe, expect, test } from 'bun:test';
// Covers plan §6's "worker-client [sic -- exercised here, at the
// grid-viewport boundary]: ... rAF patch merging, viewport-range
// coalescing" and "viewport-core: sparse-update reducer" as seen from the
// consumer side: does `createWorkerViewportDatasource` apply sparse
// patches, merge same-frame patches into one apply, and coalesce outgoing
// `setViewportRange` calls.
import { PROTOCOL_VERSION, toEpoch, toSubscriptionId } from '@amps-ui/protocol';
import type { WorkerEvent } from '@amps-ui/protocol';
import type { IViewportDatasourceParams } from 'ag-grid-community';
import { type ViewportSubscription, createWorkerViewportDatasource } from './datasource';

/** Deterministic rAF stand-in: queues callbacks, runs them all on `flush()`. */
function createManualRaf() {
  let queue: FrameRequestCallback[] = [];
  return {
    raf: (callback: FrameRequestCallback): number => {
      queue.push(callback);
      return queue.length;
    },
    cancelRaf: (): void => {},
    flush: (): void => {
      const toRun = queue;
      queue = [];
      for (const callback of toRun) callback(0);
    },
    pendingCount: () => queue.length,
  };
}

/** A `ViewportSubscription` whose events are driven by the test via `emit`. */
function createFakeSubscription() {
  const listeners = new Set<(event: WorkerEvent) => void>();
  const viewportCalls: Array<[number, number]> = [];
  const subscription: ViewportSubscription = {
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setViewportRange(firstRow, lastRow) {
      viewportCalls.push([firstRow, lastRow]);
    },
  };
  return {
    subscription,
    emit: (event: WorkerEvent) => {
      for (const listener of listeners) listener(event);
    },
    viewportCalls,
    listenerCount: () => listeners.size,
  };
}

function createFakeParams() {
  const setRowCountCalls: Array<[number, boolean | undefined]> = [];
  const setRowDataCalls: Array<Record<number, unknown>> = [];
  const params = {
    setRowCount: (count: number, keepRenderedRows?: boolean) => {
      setRowCountCalls.push([count, keepRenderedRows]);
    },
    setRowData: (rowData: Record<number, unknown>) => {
      setRowDataCalls.push(rowData);
    },
    getRow: () => undefined,
  } as unknown as IViewportDatasourceParams;
  return { params, setRowCountCalls, setRowDataCalls };
}

describe('createWorkerViewportDatasource', () => {
  test('applies a sparse rows.patch to setRowData on the next frame, not synchronously', () => {
    const manualRaf = createManualRaf();
    const fake = createFakeSubscription();
    const { params, setRowDataCalls } = createFakeParams();
    const datasource = createWorkerViewportDatasource(fake.subscription, {
      raf: manualRaf.raf,
      cancelRaf: manualRaf.cancelRaf,
    });
    datasource.init(params);

    fake.emit({
      v: PROTOCOL_VERSION,
      type: 'rows.patch',
      subId: toSubscriptionId('s'),
      epoch: toEpoch(0),
      rows: { 5: { a: 1 } },
    });
    expect(setRowDataCalls).toEqual([]); // not applied yet -- still pending the frame

    manualRaf.flush();
    expect(setRowDataCalls).toEqual([{ 5: { a: 1 } }]);
  });

  test('merges multiple patches arriving in one frame into a single apply', () => {
    const manualRaf = createManualRaf();
    const fake = createFakeSubscription();
    const { params, setRowDataCalls } = createFakeParams();
    const datasource = createWorkerViewportDatasource(fake.subscription, {
      raf: manualRaf.raf,
      cancelRaf: manualRaf.cancelRaf,
    });
    datasource.init(params);

    fake.emit({
      v: PROTOCOL_VERSION,
      type: 'rows.patch',
      subId: toSubscriptionId('s'),
      epoch: toEpoch(0),
      rows: { 1: { a: 1 } },
    });
    fake.emit({
      v: PROTOCOL_VERSION,
      type: 'rows.patch',
      subId: toSubscriptionId('s'),
      epoch: toEpoch(0),
      rows: { 2: { a: 2 } },
    });
    fake.emit({
      v: PROTOCOL_VERSION,
      type: 'rows.patch',
      subId: toSubscriptionId('s'),
      epoch: toEpoch(0),
      rows: { 1: { a: 99 } },
    });

    manualRaf.flush();

    // one apply call, with the merged map, and the later value for row 1 wins
    expect(setRowDataCalls).toEqual([{ 1: { a: 99 }, 2: { a: 2 } }]);
  });

  test('rows.reset sets both row count and the sparse visible-window map', () => {
    const manualRaf = createManualRaf();
    const fake = createFakeSubscription();
    const { params, setRowCountCalls, setRowDataCalls } = createFakeParams();
    const datasource = createWorkerViewportDatasource(fake.subscription, {
      raf: manualRaf.raf,
      cancelRaf: manualRaf.cancelRaf,
    });
    datasource.init(params);

    fake.emit({
      v: PROTOCOL_VERSION,
      type: 'rows.reset',
      subId: toSubscriptionId('s'),
      epoch: toEpoch(0),
      rowCount: 9968,
      rows: { 0: { a: 1 } },
    });
    manualRaf.flush();

    expect(setRowCountCalls).toEqual([[9968, true]]);
    expect(setRowDataCalls).toEqual([{ 0: { a: 1 } }]);
  });

  test('rows.count updates only the row count, leaving row data untouched', () => {
    const manualRaf = createManualRaf();
    const fake = createFakeSubscription();
    const { params, setRowCountCalls, setRowDataCalls } = createFakeParams();
    const datasource = createWorkerViewportDatasource(fake.subscription, {
      raf: manualRaf.raf,
      cancelRaf: manualRaf.cancelRaf,
    });
    datasource.init(params);

    fake.emit({
      v: PROTOCOL_VERSION,
      type: 'rows.count',
      subId: toSubscriptionId('s'),
      epoch: toEpoch(0),
      rowCount: 42,
    });
    manualRaf.flush();

    expect(setRowCountCalls).toEqual([[42, true]]);
    expect(setRowDataCalls).toEqual([]);
  });

  test("ignores non-row events (status/progress/errors are the caller's concern)", () => {
    const manualRaf = createManualRaf();
    const fake = createFakeSubscription();
    const { params, setRowCountCalls, setRowDataCalls } = createFakeParams();
    const datasource = createWorkerViewportDatasource(fake.subscription, {
      raf: manualRaf.raf,
      cancelRaf: manualRaf.cancelRaf,
    });
    datasource.init(params);

    fake.emit({
      v: PROTOCOL_VERSION,
      type: 'snapshot.progress',
      subId: toSubscriptionId('s'),
      epoch: toEpoch(0),
      received: 100,
    });
    fake.emit({
      v: PROTOCOL_VERSION,
      type: 'error',
      subId: toSubscriptionId('s'),
      epoch: toEpoch(0),
      code: 'X',
      message: 'y',
      fatal: false,
    });

    expect(manualRaf.pendingCount()).toBe(0);
    manualRaf.flush();
    expect(setRowCountCalls).toEqual([]);
    expect(setRowDataCalls).toEqual([]);
  });

  test('coalesces multiple setViewportRange calls in one frame into the last range sent', () => {
    const manualRaf = createManualRaf();
    const fake = createFakeSubscription();
    const { params } = createFakeParams();
    const datasource = createWorkerViewportDatasource(fake.subscription, {
      raf: manualRaf.raf,
      cancelRaf: manualRaf.cancelRaf,
    });
    datasource.init(params);

    // simulates a scroll fling generating several rapid range changes
    datasource.setViewportRange(0, 100);
    datasource.setViewportRange(10, 110);
    datasource.setViewportRange(50, 150);

    expect(fake.viewportCalls).toEqual([]); // nothing sent yet
    manualRaf.flush();
    expect(fake.viewportCalls).toEqual([[50, 150]]); // only the last range, sent once
  });

  test('destroy unsubscribes from the handle', () => {
    const manualRaf = createManualRaf();
    const fake = createFakeSubscription();
    const { params, setRowDataCalls } = createFakeParams();
    const datasource = createWorkerViewportDatasource(fake.subscription, {
      raf: manualRaf.raf,
      cancelRaf: manualRaf.cancelRaf,
    });
    datasource.init(params);
    expect(fake.listenerCount()).toBe(1);

    datasource.destroy?.();
    expect(fake.listenerCount()).toBe(0);

    fake.emit({
      v: PROTOCOL_VERSION,
      type: 'rows.count',
      subId: toSubscriptionId('s'),
      epoch: toEpoch(0),
      rowCount: 1,
    });
    manualRaf.flush();
    expect(setRowDataCalls).toEqual([]);
  });
});
