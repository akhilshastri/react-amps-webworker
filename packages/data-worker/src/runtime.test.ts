import { describe, expect, test } from 'bun:test';
import type { ConnStateEvent, SubscriptionSink, SubscriptionSpec } from '@amps-ui/amps-client';
import {
  type SubscriptionId,
  type WorkerEvent,
  toEpoch,
  toSubscriptionId,
} from '@amps-ui/protocol';
import type { AmpsConnectionLike } from './runtime';
import { createWorkerRuntime } from './runtime';

/** A fake AmpsConnection that hands back a controllable sink per subscription. */
function fakeConnection() {
  const sinks = new Map<SubscriptionId, SubscriptionSink>();
  const openedSpecs: { subId: SubscriptionId; spec: SubscriptionSpec }[] = [];
  const closed: SubscriptionId[] = [];
  const stateListeners: ((event: ConnStateEvent) => void)[] = [];

  const connection: AmpsConnectionLike = {
    connect: async () => {},
    disconnect: async () => {},
    onState: (listener) => {
      stateListeners.push(listener);
      return () => {};
    },
    openSubscription: async (subId, spec, sink) => {
      sinks.set(subId, sink);
      openedSpecs.push({ subId, spec });
    },
    closeSubscription: async (subId) => {
      closed.push(subId);
      sinks.delete(subId);
    },
  };

  return {
    connection,
    sinkFor: (subId: SubscriptionId): SubscriptionSink => {
      const sink = sinks.get(subId);
      if (!sink) throw new Error(`no sink registered for ${subId}`);
      return sink;
    },
    openedSpecs,
    closed,
    emitState: (event: ConnStateEvent) => {
      for (const listener of stateListeners) listener(event);
    },
  };
}

/** Loads a small 5-row snapshot through the sink, as AmpsConnection would dispatch it. */
function loadSnapshot(
  sink: SubscriptionSink,
  rows: { key: string; data: Record<string, unknown> }[],
) {
  sink.onSnapshotBegin?.();
  for (const row of rows) sink.onSowRow(row.key, row.data);
  sink.onSnapshotComplete(rows.length, 10);
}

/** Lets pending promise chains (e.g. `flush()`'s fire-and-forget `performRepage`) settle before assertions run -- `flush()` itself is synchronous and never awaits the re-subscription it kicks off. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function fakeClock(startAt = 0) {
  let now = startAt;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('createWorkerRuntime', () => {
  test('sub.open opens a subscription, then loads a snapshot into exactly one rows.reset + snapshot.complete', async () => {
    const fake = fakeConnection();
    const events: WorkerEvent[] = [];
    const clock = fakeClock();
    const runtime = createWorkerRuntime({
      connection: fake.connection,
      post: (e) => events.push(e),
      clock: clock.now,
    });

    const subId = toSubscriptionId('sub-1');
    await runtime.handleMessage({
      v: 2,
      type: 'sub.open',
      subId,
      epoch: toEpoch(1),
      topic: 'order_details',
      mode: 'sow_and_delta_subscribe',
      filter: "/orderId = 'ORD-000426'",
      batchSize: 2000,
      keyField: 'detailId',
    });

    expect(fake.openedSpecs).toHaveLength(1);
    expect(fake.openedSpecs[0]?.spec.topic).toBe('order_details');
    expect(events.map((e) => e.type)).toEqual(['sub.opened']);

    const sink = fake.sinkFor(subId);
    loadSnapshot(sink, [
      { key: 'ORD-000426:0', data: { detailId: 'ORD-000426:0', seq: 0 } },
      { key: 'ORD-000426:1', data: { detailId: 'ORD-000426:1', seq: 1 } },
    ]);

    const types = events.map((e) => e.type);
    expect(types).toEqual(['sub.opened', 'rows.reset', 'snapshot.complete']);
    const reset = events[1];
    if (reset?.type !== 'rows.reset') throw new Error('expected rows.reset');
    expect(reset.rowCount).toBe(2);
    expect(reset.rows).toEqual({
      0: { detailId: 'ORD-000426:0', seq: 0 },
      1: { detailId: 'ORD-000426:1', seq: 1 },
    });
    const complete = events[2];
    if (complete?.type !== 'snapshot.complete') throw new Error('expected snapshot.complete');
    expect(complete.rowCount).toBe(2);
  });

  test('per-row patches are suppressed during the snapshot -- only progress events, throttled', async () => {
    const fake = fakeConnection();
    const events: WorkerEvent[] = [];
    const clock = fakeClock();
    const runtime = createWorkerRuntime({
      connection: fake.connection,
      post: (e) => events.push(e),
      clock: clock.now,
    });
    const subId = toSubscriptionId('sub-1');
    await runtime.handleMessage({
      v: 2,
      type: 'sub.open',
      subId,
      epoch: toEpoch(1),
      topic: 'order_details',
      mode: 'sow_and_delta_subscribe',
      batchSize: 2000,
      keyField: 'detailId',
    });
    const sink = fake.sinkFor(subId);

    sink.onSnapshotBegin?.();
    sink.onSowRow('a', { detailId: 'a' });
    clock.advance(300); // past the 250ms progress throttle
    sink.onSowRow('b', { detailId: 'b' });
    sink.onSowRow('c', { detailId: 'c' }); // immediately after -- should NOT re-emit progress
    sink.onSnapshotComplete(3, 5);

    const progressEvents = events.filter((e) => e.type === 'snapshot.progress');
    expect(progressEvents).toHaveLength(1);
    expect(events.some((e) => e.type === 'rows.patch')).toBe(false);
  });

  test('a delta after snapshot merges via Object.assign and is delivered as a sparse rows.patch on the next due flush', async () => {
    const fake = fakeConnection();
    const events: WorkerEvent[] = [];
    const clock = fakeClock();
    const runtime = createWorkerRuntime({
      connection: fake.connection,
      post: (e) => events.push(e),
      clock: clock.now,
    });
    const subId = toSubscriptionId('sub-1');
    await runtime.handleMessage({
      v: 2,
      type: 'sub.open',
      subId,
      epoch: toEpoch(1),
      topic: 'order_details',
      mode: 'sow_and_delta_subscribe',
      batchSize: 2000,
      keyField: 'detailId',
    });
    const sink = fake.sinkFor(subId);
    loadSnapshot(sink, [
      { key: 'a', data: { detailId: 'a', markPrice: 1, venue: 'IEX' } },
      { key: 'b', data: { detailId: 'b', markPrice: 1, venue: 'NYSE' } },
    ]);
    events.length = 0; // discard snapshot events, focus on the live path

    sink.onDelta('a', { detailId: 'a', markPrice: 42 }); // partial -- must merge, not replace
    runtime.flush(); // not due yet (no time elapsed)
    expect(events).toHaveLength(0);

    clock.advance(16);
    runtime.flush();

    const patches = events.filter((e) => e.type === 'rows.patch');
    expect(patches).toHaveLength(1);
    if (patches[0]?.type !== 'rows.patch') throw new Error('expected rows.patch');
    expect(patches[0].rows).toEqual({ 0: { detailId: 'a', markPrice: 42, venue: 'IEX' } }); // venue survived the merge
  });

  test('rows dirtied outside the current window are dropped from the patch, not queued', async () => {
    const fake = fakeConnection();
    const events: WorkerEvent[] = [];
    const clock = fakeClock();
    const runtime = createWorkerRuntime({
      connection: fake.connection,
      post: (e) => events.push(e),
      clock: clock.now,
    });
    const subId = toSubscriptionId('sub-1');
    await runtime.handleMessage({
      v: 2,
      type: 'sub.open',
      subId,
      epoch: toEpoch(1),
      topic: 'order_details',
      mode: 'sow_and_delta_subscribe',
      batchSize: 2000,
      keyField: 'detailId',
    });
    const sink = fake.sinkFor(subId);
    // Zero-padded so the default lexicographic keyField sort matches numeric/insertion order.
    const key = (i: number) => `k${String(i).padStart(3, '0')}`;
    const rows = Array.from({ length: 200 }, (_, i) => ({
      key: key(i),
      data: { detailId: key(i), v: 0 },
    }));
    loadSnapshot(sink, rows);
    events.length = 0;

    // Narrow the viewport to [0, 9] (plus overscan) so row k150 is well outside it.
    runtime.handleMessage({ v: 2, type: 'sub.viewport', subId, firstRow: 0, lastRow: 9 });
    events.length = 0; // discard the reset the viewport change itself triggers

    sink.onDelta(key(150), { detailId: key(150), v: 99 });
    clock.advance(16);
    runtime.flush();

    expect(events.filter((e) => e.type === 'rows.patch')).toHaveLength(0);
  });

  test('sub.viewport moving to a never-sent window triggers a fresh rows.reset with full row data', async () => {
    const fake = fakeConnection();
    const events: WorkerEvent[] = [];
    const clock = fakeClock();
    const runtime = createWorkerRuntime({
      connection: fake.connection,
      post: (e) => events.push(e),
      clock: clock.now,
    });
    const subId = toSubscriptionId('sub-1');
    await runtime.handleMessage({
      v: 2,
      type: 'sub.open',
      subId,
      epoch: toEpoch(1),
      topic: 'order_details',
      mode: 'sow_and_delta_subscribe',
      batchSize: 2000,
      keyField: 'detailId',
    });
    const sink = fake.sinkFor(subId);
    // Zero-padded so the default lexicographic keyField sort matches numeric/insertion order.
    const key = (i: number) => `k${String(i).padStart(3, '0')}`;
    const rows = Array.from({ length: 200 }, (_, i) => ({
      key: key(i),
      data: { detailId: key(i), v: i },
    }));
    loadSnapshot(sink, rows);
    events.length = 0;

    runtime.handleMessage({ v: 2, type: 'sub.viewport', subId, firstRow: 150, lastRow: 160 });

    const resets = events.filter((e) => e.type === 'rows.reset');
    expect(resets).toHaveLength(1);
    if (resets[0]?.type !== 'rows.reset') throw new Error('expected rows.reset');
    expect(resets[0].rows[150]).toEqual({ detailId: key(150), v: 150 });
    expect(resets[0].rows[160]).toEqual({ detailId: key(160), v: 160 });
  });

  test('oof removes the row, repairs the index, and emits rows.removed followed by rows.reset', async () => {
    const fake = fakeConnection();
    const events: WorkerEvent[] = [];
    const clock = fakeClock();
    const runtime = createWorkerRuntime({
      connection: fake.connection,
      post: (e) => events.push(e),
      clock: clock.now,
    });
    const subId = toSubscriptionId('sub-1');
    await runtime.handleMessage({
      v: 2,
      type: 'sub.open',
      subId,
      epoch: toEpoch(1),
      topic: 'order_details',
      mode: 'sow_and_delta_subscribe',
      batchSize: 2000,
      keyField: 'detailId',
    });
    const sink = fake.sinkFor(subId);
    loadSnapshot(sink, [
      { key: 'a', data: { detailId: 'a' } },
      { key: 'b', data: { detailId: 'b' } },
      { key: 'c', data: { detailId: 'c' } },
    ]);
    events.length = 0;

    sink.onOof('b');

    expect(events.map((e) => e.type)).toEqual(['rows.removed', 'rows.reset']);
    const removed = events[0];
    if (removed?.type !== 'rows.removed') throw new Error('expected rows.removed');
    expect(removed.keys).toEqual(['b']);
    expect(removed.rowCount).toBe(2);
    const reset = events[1];
    if (reset?.type !== 'rows.reset') throw new Error('expected rows.reset');
    // 'c' shifted from index 2 down to index 1 after 'b' was removed.
    expect(reset.rows).toEqual({ 0: { detailId: 'a' }, 1: { detailId: 'c' } });
  });

  test('epoch enforcement: a stale sub.update is dropped without effect', async () => {
    const fake = fakeConnection();
    const events: WorkerEvent[] = [];
    const clock = fakeClock();
    const runtime = createWorkerRuntime({
      connection: fake.connection,
      post: (e) => events.push(e),
      clock: clock.now,
    });
    const subId = toSubscriptionId('sub-1');
    await runtime.handleMessage({
      v: 2,
      type: 'sub.open',
      subId,
      epoch: toEpoch(5),
      topic: 'order_details',
      mode: 'sow_and_delta_subscribe',
      batchSize: 2000,
      keyField: 'detailId',
    });
    fake.openedSpecs.length = 0;

    await runtime.handleMessage({
      v: 2,
      type: 'sub.update',
      subId,
      epoch: toEpoch(4),
      filter: "/orderId = 'ORD-999'",
    });

    expect(fake.openedSpecs).toHaveLength(0); // superseded request -- never re-issued
    expect(fake.closed).toHaveLength(0);
  });

  test('sub.window (M4 seam) re-issues the same topic/filter with a top_n/skip_n window', async () => {
    const fake = fakeConnection();
    const events: WorkerEvent[] = [];
    const clock = fakeClock();
    const runtime = createWorkerRuntime({
      connection: fake.connection,
      post: (e) => events.push(e),
      clock: clock.now,
    });
    const subId = toSubscriptionId('sub-1');
    await runtime.handleMessage({
      v: 2,
      type: 'sub.open',
      subId,
      epoch: toEpoch(1),
      topic: 'order_details',
      mode: 'sow_and_delta_subscribe',
      filter: "/orderId = 'ORD-000426'",
      orderBy: '/detailId ASC',
      batchSize: 2000,
      keyField: 'detailId',
    });
    fake.openedSpecs.length = 0;

    await runtime.handleMessage({
      v: 2,
      type: 'sub.window',
      subId,
      epoch: toEpoch(2),
      skip: 20,
      take: 20,
    });

    expect(fake.closed).toEqual([subId]);
    expect(fake.openedSpecs).toHaveLength(1);
    expect(fake.openedSpecs[0]?.spec).toMatchObject({
      topic: 'order_details',
      filter: "/orderId = 'ORD-000426'",
      orderBy: '/detailId ASC',
      window: { topN: 20, skipN: 20 },
    });
  });

  test('sub.close closes the AMPS subscription and removes local state', async () => {
    const fake = fakeConnection();
    const runtime = createWorkerRuntime({
      connection: fake.connection,
      post: () => {},
      clock: () => 0,
    });
    const subId = toSubscriptionId('sub-1');
    await runtime.handleMessage({
      v: 2,
      type: 'sub.open',
      subId,
      epoch: toEpoch(1),
      topic: 'order_details',
      mode: 'sow',
      batchSize: 100,
      keyField: 'detailId',
    });

    await runtime.handleMessage({ v: 2, type: 'sub.close', subId });

    expect(fake.closed).toEqual([subId]);
    // Closing again is a no-op, not a crash.
    await runtime.handleMessage({ v: 2, type: 'sub.close', subId });
    expect(fake.closed).toEqual([subId]);
  });

  test('conn.open forwards conn.state transitions from the connection', async () => {
    const fake = fakeConnection();
    const events: WorkerEvent[] = [];
    const runtime = createWorkerRuntime({
      connection: fake.connection,
      post: (e) => events.push(e),
      clock: () => 0,
    });

    fake.emitState({ state: 'connecting' });
    fake.emitState({ state: 'open' });

    await runtime.handleMessage({ v: 2, type: 'conn.open', uri: 'ws://x', clientName: 'c' });

    expect(events.map((e) => e.type)).toEqual(['conn.state', 'conn.state']);
  });

  describe('conn.open / sub.open race (browser-found regression)', () => {
    // A real WebSocket handshake is never synchronous -- every other test
    // in this file uses a fake whose `connect()` resolves immediately,
    // which is exactly why this race went uncaught until browser
    // verification: a consumer that calls `client.connect(...)` then
    // `client.openSubscription(...)` back-to-back posts `conn.open` and
    // `sub.open` in the same tick, and `sub.open` must not reach
    // `AmpsConnection.openSubscription` before the handshake completes.
    function fakeConnectionWithGatedConnect() {
      const fake = fakeConnection();
      let resolveConnect: () => void = () => {};
      let rejectConnect: (error: Error) => void = () => {};
      const gate = new Promise<void>((resolve, reject) => {
        resolveConnect = resolve;
        rejectConnect = reject;
      });
      fake.connection.connect = async () => {
        await gate;
      };
      return { ...fake, resolveConnect, rejectConnect };
    }

    test('a sub.open posted immediately after conn.open (before the handshake settles) still produces a snapshot', async () => {
      const fake = fakeConnectionWithGatedConnect();
      const events: WorkerEvent[] = [];
      const runtime = createWorkerRuntime({
        connection: fake.connection,
        post: (e) => events.push(e),
        clock: () => 0,
      });

      // Fired back-to-back, exactly as a real caller does -- neither is
      // awaited before the next is sent (matches `DataClient.connect()`
      // immediately followed by `openSubscription()`).
      const connectPromise = runtime.handleMessage({
        v: 2,
        type: 'conn.open',
        uri: 'ws://x',
        clientName: 'c',
      });
      const subId = toSubscriptionId('sub-1');
      const openPromise = runtime.handleMessage({
        v: 2,
        type: 'sub.open',
        subId,
        epoch: toEpoch(1),
        topic: 'order_details',
        mode: 'sow_and_delta_subscribe',
        filter: "/orderId = 'ORD-000426'",
        batchSize: 2000,
        keyField: 'detailId',
      });

      // The handshake is still pending -- must not have reached a
      // disconnected client yet.
      expect(fake.openedSpecs).toHaveLength(0);

      fake.resolveConnect();
      await connectPromise;
      await openPromise;

      expect(fake.openedSpecs).toHaveLength(1);
      const sink = fake.sinkFor(subId);
      loadSnapshot(sink, [{ key: 'a', data: { detailId: 'a' } }]);
      expect(events.some((e) => e.type === 'snapshot.complete')).toBe(true);
    });

    test('sub.open fails (never reaching the connection) when the in-flight handshake ultimately fails', async () => {
      const fake = fakeConnectionWithGatedConnect();
      const runtime = createWorkerRuntime({
        connection: fake.connection,
        post: () => {},
        clock: () => 0,
      });

      const connectPromise = runtime.handleMessage({
        v: 2,
        type: 'conn.open',
        uri: 'ws://x',
        clientName: 'c',
      });
      const openPromise = runtime.handleMessage({
        v: 2,
        type: 'sub.open',
        subId: toSubscriptionId('sub-1'),
        epoch: toEpoch(1),
        topic: 'order_details',
        mode: 'sow_and_delta_subscribe',
        batchSize: 2000,
        keyField: 'detailId',
      });

      // Attach rejection handlers before rejecting -- otherwise the two
      // promises are briefly unobserved between `rejectConnect()` and the
      // `expect(...).rejects` lines below, which Bun flags as an unhandled
      // rejection even though this test does go on to handle it.
      const connectSettled = connectPromise.then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      const openSettled = openPromise.then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      );

      fake.rejectConnect(new Error('handshake failed'));

      const connectResult = await connectSettled;
      expect(connectResult.ok).toBe(false);
      const openResult = await openSettled;
      expect(openResult.ok).toBe(false);
      expect(fake.openedSpecs).toHaveLength(0);
    });
  });

  test('ping is answered by a pong carrying the same nonce (v2 gap closed)', () => {
    const fake = fakeConnection();
    const events: WorkerEvent[] = [];
    const runtime = createWorkerRuntime({
      connection: fake.connection,
      post: (e) => events.push(e),
      clock: () => 12_345,
    });

    runtime.handleMessage({ v: 2, type: 'ping', nonce: 'abc-123' });

    expect(events).toEqual([{ v: 2, type: 'pong', nonce: 'abc-123', workerTime: 12_345 }]);
  });

  describe('local sort (orders -- static rows re-indexed in the worker)', () => {
    test('sub.update with a local sort resorts the existing index and resends the window, no re-subscription', async () => {
      const fake = fakeConnection();
      const events: WorkerEvent[] = [];
      const clock = fakeClock();
      const runtime = createWorkerRuntime({
        connection: fake.connection,
        post: (e) => events.push(e),
        clock: clock.now,
      });
      const subId = toSubscriptionId('sub-1');
      await runtime.handleMessage({
        v: 2,
        type: 'sub.open',
        subId,
        epoch: toEpoch(1),
        topic: 'orders',
        mode: 'sow_and_subscribe',
        batchSize: 2000,
        keyField: 'orderId',
      });
      const sink = fake.sinkFor(subId);
      loadSnapshot(sink, [
        { key: 'a', data: { orderId: 'a', childCount: 1 } },
        { key: 'b', data: { orderId: 'b', childCount: 3 } },
        { key: 'c', data: { orderId: 'c', childCount: 2 } },
      ]);
      fake.openedSpecs.length = 0;
      events.length = 0;

      await runtime.handleMessage({
        v: 2,
        type: 'sub.update',
        subId,
        epoch: toEpoch(2),
        sort: { mode: 'local', fields: [{ field: 'childCount', direction: 'desc' }] },
      });

      // No network round trip -- local mode re-indexes in place (plan §3).
      expect(fake.openedSpecs).toHaveLength(0);
      expect(fake.closed).toHaveLength(0);
      const resets = events.filter((e) => e.type === 'rows.reset');
      expect(resets).toHaveLength(1);
      if (resets[0]?.type !== 'rows.reset') throw new Error('expected rows.reset');
      expect(resets[0].rows).toEqual({
        0: { orderId: 'b', childCount: 3 },
        1: { orderId: 'c', childCount: 2 },
        2: { orderId: 'a', childCount: 1 },
      });
    });
  });

  describe('server sort (order_details -- delegated to AMPS via orderBy)', () => {
    test('sub.update with a server sort re-issues the subscription with a translated orderBy, preserving the window', async () => {
      const fake = fakeConnection();
      const runtime = createWorkerRuntime({
        connection: fake.connection,
        post: () => {},
        clock: () => 0,
      });
      const subId = toSubscriptionId('sub-1');
      await runtime.handleMessage({
        v: 2,
        type: 'sub.open',
        subId,
        epoch: toEpoch(1),
        topic: 'order_details',
        mode: 'sow_and_delta_subscribe',
        filter: "/orderId = 'ORD-000426'",
        orderBy: '/detailId ASC',
        batchSize: 2000,
        keyField: 'detailId',
      });
      // Simulate a prior sub.window repage (plan §4) so the window is non-empty.
      await runtime.handleMessage({
        v: 2,
        type: 'sub.window',
        subId,
        epoch: toEpoch(2),
        skip: 0,
        take: 2000,
      });
      fake.openedSpecs.length = 0;

      await runtime.handleMessage({
        v: 2,
        type: 'sub.update',
        subId,
        epoch: toEpoch(3),
        sort: { mode: 'server', fields: [{ field: 'markPrice', direction: 'desc' }] },
      });

      expect(fake.closed).toEqual([subId, subId]); // once for the window repage, once for the sort change
      expect(fake.openedSpecs).toHaveLength(1);
      expect(fake.openedSpecs[0]?.spec).toMatchObject({
        topic: 'order_details',
        filter: "/orderId = 'ORD-000426'",
        orderBy: '/markPrice DESC',
        window: { topN: 2000, skipN: 0 }, // window carried forward, unlike a filter change
      });
    });
  });

  describe('client-side column filtering (plan D3)', () => {
    test('sub.open with a clientFilter only indexes matching rows, with an accurate rowCount', async () => {
      const fake = fakeConnection();
      const events: WorkerEvent[] = [];
      const runtime = createWorkerRuntime({
        connection: fake.connection,
        post: (e) => events.push(e),
        clock: () => 0,
      });
      const subId = toSubscriptionId('sub-1');
      await runtime.handleMessage({
        v: 2,
        type: 'sub.open',
        subId,
        epoch: toEpoch(1),
        topic: 'order_details',
        mode: 'sow_and_delta_subscribe',
        batchSize: 2000,
        keyField: 'detailId',
        clientFilter: { venue: { kind: 'text', operator: 'equals', value: 'nyse' } },
      });
      const sink = fake.sinkFor(subId);
      loadSnapshot(sink, [
        { key: 'a', data: { detailId: 'a', venue: 'NYSE' } },
        { key: 'b', data: { detailId: 'b', venue: 'NASDAQ' } },
        { key: 'c', data: { detailId: 'c', venue: 'NYSE' } },
      ]);

      const reset = events.find((e) => e.type === 'rows.reset');
      if (reset?.type !== 'rows.reset') throw new Error('expected rows.reset');
      expect(reset.rowCount).toBe(2); // NASDAQ excluded -- "rows in subscription" reflects the filter (D3)
      expect(reset.rows).toEqual({
        0: { detailId: 'a', venue: 'NYSE' },
        1: { detailId: 'c', venue: 'NYSE' },
      });
    });

    test('sub.update with a clientFilter re-indexes the already-loaded store, no network round trip', async () => {
      const fake = fakeConnection();
      const events: WorkerEvent[] = [];
      const runtime = createWorkerRuntime({
        connection: fake.connection,
        post: (e) => events.push(e),
        clock: () => 0,
      });
      const subId = toSubscriptionId('sub-1');
      await runtime.handleMessage({
        v: 2,
        type: 'sub.open',
        subId,
        epoch: toEpoch(1),
        topic: 'order_details',
        mode: 'sow_and_delta_subscribe',
        batchSize: 2000,
        keyField: 'detailId',
      });
      const sink = fake.sinkFor(subId);
      loadSnapshot(sink, [
        { key: 'a', data: { detailId: 'a', venue: 'NYSE' } },
        { key: 'b', data: { detailId: 'b', venue: 'NASDAQ' } },
      ]);
      fake.openedSpecs.length = 0;
      events.length = 0;

      await runtime.handleMessage({
        v: 2,
        type: 'sub.update',
        subId,
        epoch: toEpoch(2),
        clientFilter: { venue: { kind: 'text', operator: 'equals', value: 'nasdaq' } },
      });

      expect(fake.openedSpecs).toHaveLength(0);
      const reset = events.find((e) => e.type === 'rows.reset');
      if (reset?.type !== 'rows.reset') throw new Error('expected rows.reset');
      expect(reset.rowCount).toBe(1);
      expect(reset.rows).toEqual({ 0: { detailId: 'b', venue: 'NASDAQ' } });
    });

    test('a sub.update carrying both a local sort AND a clientFilter applies both but sends exactly one rows.reset', async () => {
      const fake = fakeConnection();
      const events: WorkerEvent[] = [];
      const runtime = createWorkerRuntime({
        connection: fake.connection,
        post: (e) => events.push(e),
        clock: () => 0,
      });
      const subId = toSubscriptionId('sub-1');
      await runtime.handleMessage({
        v: 2,
        type: 'sub.open',
        subId,
        epoch: toEpoch(1),
        topic: 'orders',
        mode: 'sow_and_subscribe',
        batchSize: 2000,
        keyField: 'orderId',
      });
      const sink = fake.sinkFor(subId);
      loadSnapshot(sink, [
        { key: 'a', data: { orderId: 'a', venue: 'NYSE', childCount: 5 } },
        { key: 'b', data: { orderId: 'b', venue: 'NASDAQ', childCount: 1 } },
        { key: 'c', data: { orderId: 'c', venue: 'NYSE', childCount: 3 } },
      ]);
      events.length = 0;

      await runtime.handleMessage({
        v: 2,
        type: 'sub.update',
        subId,
        epoch: toEpoch(2),
        sort: { mode: 'local', fields: [{ field: 'childCount', direction: 'desc' }] },
        clientFilter: { venue: { kind: 'text', operator: 'equals', value: 'nyse' } },
      });

      const resets = events.filter((e) => e.type === 'rows.reset');
      expect(resets).toHaveLength(1); // one combined apply, not one per field (M3A: avoid redundant work)
      if (resets[0]?.type !== 'rows.reset') throw new Error('expected rows.reset');
      expect(resets[0].rowCount).toBe(2); // NASDAQ excluded
      expect(resets[0].rows).toEqual({
        0: { orderId: 'a', venue: 'NYSE', childCount: 5 },
        1: { orderId: 'c', venue: 'NYSE', childCount: 3 },
      });
    });

    test('a delta that pushes a visible row out of the client filter removes it and repairs the index, without touching rowStore', async () => {
      const fake = fakeConnection();
      const events: WorkerEvent[] = [];
      const runtime = createWorkerRuntime({
        connection: fake.connection,
        post: (e) => events.push(e),
        clock: () => 0,
      });
      const subId = toSubscriptionId('sub-1');
      await runtime.handleMessage({
        v: 2,
        type: 'sub.open',
        subId,
        epoch: toEpoch(1),
        topic: 'order_details',
        mode: 'sow_and_delta_subscribe',
        batchSize: 2000,
        keyField: 'detailId',
        clientFilter: { markPrice: { kind: 'number', operator: 'greaterThan', value: 100 } },
      });
      const sink = fake.sinkFor(subId);
      loadSnapshot(sink, [
        { key: 'a', data: { detailId: 'a', markPrice: 150 } },
        { key: 'b', data: { detailId: 'b', markPrice: 200 } },
      ]);
      events.length = 0;

      sink.onDelta('a', { detailId: 'a', markPrice: 50 }); // ticks below the filter threshold

      expect(events.map((e) => e.type)).toEqual(['rows.removed', 'rows.reset']);
      const removed = events[0];
      if (removed?.type !== 'rows.removed') throw new Error('expected rows.removed');
      expect(removed.keys).toEqual(['a']);
      expect(removed.rowCount).toBe(1); // only 'b' still visible
      const reset = events[1];
      if (reset?.type !== 'rows.reset') throw new Error('expected rows.reset');
      expect(reset.rows).toEqual({ 0: { detailId: 'b', markPrice: 200 } });
    });

    test('a delta that brings a hidden row back into the client filter inserts it into the index', async () => {
      const fake = fakeConnection();
      const events: WorkerEvent[] = [];
      const runtime = createWorkerRuntime({
        connection: fake.connection,
        post: (e) => events.push(e),
        clock: () => 0,
      });
      const subId = toSubscriptionId('sub-1');
      await runtime.handleMessage({
        v: 2,
        type: 'sub.open',
        subId,
        epoch: toEpoch(1),
        topic: 'order_details',
        mode: 'sow_and_delta_subscribe',
        batchSize: 2000,
        keyField: 'detailId',
        clientFilter: { markPrice: { kind: 'number', operator: 'greaterThan', value: 100 } },
      });
      const sink = fake.sinkFor(subId);
      loadSnapshot(sink, [
        { key: 'a', data: { detailId: 'a', markPrice: 50 } }, // starts hidden
        { key: 'b', data: { detailId: 'b', markPrice: 200 } },
      ]);
      events.length = 0;

      sink.onDelta('a', { detailId: 'a', markPrice: 300 }); // now the highest price

      const resets = events.filter((e) => e.type === 'rows.reset');
      expect(resets).toHaveLength(1);
      if (resets[0]?.type !== 'rows.reset') throw new Error('expected rows.reset');
      expect(resets[0].rowCount).toBe(2);
      // No sort was requested at open, so the index still orders by the
      // default keyField (detailId) ASC -- 'a' sorts before 'b' regardless
      // of price. insertKey placed it correctly either way.
      expect(resets[0].rows).toEqual({
        0: { detailId: 'a', markPrice: 300 },
        1: { detailId: 'b', markPrice: 200 },
      });
    });
  });

  describe('sub.viewport coalescing (M3A: worker-side half of fling protection)', () => {
    test('a redundant range change that clamps to the same window is dropped, not re-sent', async () => {
      const fake = fakeConnection();
      const events: WorkerEvent[] = [];
      const runtime = createWorkerRuntime({
        connection: fake.connection,
        post: (e) => events.push(e),
        clock: () => 0,
      });
      const subId = toSubscriptionId('sub-1');
      await runtime.handleMessage({
        v: 2,
        type: 'sub.open',
        subId,
        epoch: toEpoch(1),
        topic: 'order_details',
        mode: 'sow_and_delta_subscribe',
        batchSize: 2000,
        keyField: 'detailId',
      });
      const sink = fake.sinkFor(subId);
      const key = (i: number) => `k${String(i).padStart(3, '0')}`;
      const rows = Array.from({ length: 200 }, (_, i) => ({
        key: key(i),
        data: { detailId: key(i), v: i },
      }));
      loadSnapshot(sink, rows);
      events.length = 0;

      runtime.handleMessage({ v: 2, type: 'sub.viewport', subId, firstRow: 50, lastRow: 60 });
      expect(events.filter((e) => e.type === 'rows.reset')).toHaveLength(1);
      events.length = 0;

      // An exact repeat of the same range (e.g. two rapid AG Grid callbacks
      // that survived the main thread's own coalescing).
      runtime.handleMessage({ v: 2, type: 'sub.viewport', subId, firstRow: 50, lastRow: 60 });
      expect(events.filter((e) => e.type === 'rows.reset')).toHaveLength(0);

      // A raw range that DIFFERS but clamps to the identical window because
      // both ends saturate at the row-count boundary -- still redundant.
      runtime.handleMessage({ v: 2, type: 'sub.viewport', subId, firstRow: 0, lastRow: 199 });
      events.length = 0;
      runtime.handleMessage({ v: 2, type: 'sub.viewport', subId, firstRow: 5, lastRow: 195 });
      expect(events.filter((e) => e.type === 'rows.reset')).toHaveLength(0);
    });

    test('a range change that does move the clamped window still sends a fresh rows.reset', async () => {
      const fake = fakeConnection();
      const events: WorkerEvent[] = [];
      const runtime = createWorkerRuntime({
        connection: fake.connection,
        post: (e) => events.push(e),
        clock: () => 0,
      });
      const subId = toSubscriptionId('sub-1');
      await runtime.handleMessage({
        v: 2,
        type: 'sub.open',
        subId,
        epoch: toEpoch(1),
        topic: 'order_details',
        mode: 'sow_and_delta_subscribe',
        batchSize: 2000,
        keyField: 'detailId',
      });
      const sink = fake.sinkFor(subId);
      const key = (i: number) => `k${String(i).padStart(3, '0')}`;
      const rows = Array.from({ length: 200 }, (_, i) => ({
        key: key(i),
        data: { detailId: key(i), v: i },
      }));
      loadSnapshot(sink, rows);
      events.length = 0;

      runtime.handleMessage({ v: 2, type: 'sub.viewport', subId, firstRow: 50, lastRow: 60 });
      expect(events.filter((e) => e.type === 'rows.reset')).toHaveLength(1);
      events.length = 0;

      runtime.handleMessage({ v: 2, type: 'sub.viewport', subId, firstRow: 100, lastRow: 110 });
      expect(events.filter((e) => e.type === 'rows.reset')).toHaveLength(1);
    });
  });

  describe('AMPS-paginated window (plan §4/C5, M4b)', () => {
    test('a windowed sub.open reports the true rowCountHint total, distinct from the loaded window size', async () => {
      const fake = fakeConnection();
      const events: WorkerEvent[] = [];
      const runtime = createWorkerRuntime({
        connection: fake.connection,
        post: (e) => events.push(e),
        clock: () => 0,
      });
      const subId = toSubscriptionId('sub-1');
      await runtime.handleMessage({
        v: 2,
        type: 'sub.open',
        subId,
        epoch: toEpoch(1),
        topic: 'order_details',
        mode: 'sow_and_delta_subscribe',
        filter: "/orderId IN ('ORD-1','ORD-2')",
        orderBy: '/detailId ASC',
        batchSize: 2000,
        keyField: 'detailId',
        window: { topN: 2, skipN: 0 },
        rowCountHint: 9968, // plan §4's worked example: sum(childCount) over the selection
      });
      const sink = fake.sinkFor(subId);
      loadSnapshot(sink, [
        { key: 'a', data: { detailId: 'a' } },
        { key: 'b', data: { detailId: 'b' } },
      ]);

      const reset = events.find((e) => e.type === 'rows.reset');
      if (reset?.type !== 'rows.reset') throw new Error('expected rows.reset');
      expect(reset.rowCount).toBe(9968); // true total, not the 2-row loaded window
      const complete = events.find((e) => e.type === 'snapshot.complete');
      if (complete?.type !== 'snapshot.complete') throw new Error('expected snapshot.complete');
      expect(complete.rowCount).toBe(2); // "loaded", distinct from "true total" (plan §4)
    });

    test('a live row entering a windowed subscription trims the tail back to top_n -- AMPS never oofs a displaced row', async () => {
      const fake = fakeConnection();
      const events: WorkerEvent[] = [];
      const runtime = createWorkerRuntime({
        connection: fake.connection,
        post: (e) => events.push(e),
        clock: () => 0,
      });
      const subId = toSubscriptionId('sub-1');
      await runtime.handleMessage({
        v: 2,
        type: 'sub.open',
        subId,
        epoch: toEpoch(1),
        topic: 'order_details',
        mode: 'sow_and_delta_subscribe',
        batchSize: 2000,
        keyField: 'detailId',
        sort: { mode: 'local', fields: [{ field: 'v', direction: 'desc' }] },
        window: { topN: 3, skipN: 0 },
      });
      const sink = fake.sinkFor(subId);
      loadSnapshot(sink, [
        { key: 'a', data: { detailId: 'a', v: 30 } },
        { key: 'b', data: { detailId: 'b', v: 20 } },
        { key: 'c', data: { detailId: 'c', v: 10 } },
      ]);
      events.length = 0;

      // 'd' has never been seen before -- exactly the scenario the spike
      // measured (a row newly ranking into the top_n, delivered live with
      // no snapshot). It ranks in ahead of 'b' and 'c'.
      sink.onDelta('d', { detailId: 'd', v: 25 });

      const resets = events.filter((e) => e.type === 'rows.reset');
      expect(resets).toHaveLength(1);
      const reset = resets[0];
      if (reset?.type !== 'rows.reset') throw new Error('expected rows.reset');
      expect(reset.rowCount).toBe(3); // still bounded at top_n, not 4
      expect(reset.rows).toEqual({
        0: { detailId: 'a', v: 30 },
        1: { detailId: 'd', v: 25 },
        2: { detailId: 'b', v: 20 },
      }); // 'c' (now worst-ranked) fell off locally -- no oof ever arrives for it
    });

    test('stats reports the current AMPS-paginated window bounds, for the footer\'s "window S..S+W loaded"', async () => {
      const fake = fakeConnection();
      const events: WorkerEvent[] = [];
      const clock = fakeClock();
      const runtime = createWorkerRuntime({
        connection: fake.connection,
        post: (e) => events.push(e),
        clock: clock.now,
      });
      const subId = toSubscriptionId('sub-1');
      await runtime.handleMessage({
        v: 2,
        type: 'sub.open',
        subId,
        epoch: toEpoch(1),
        topic: 'order_details',
        mode: 'sow_and_delta_subscribe',
        batchSize: 2000,
        keyField: 'detailId',
        window: { topN: 2000, skipN: 0 },
        rowCountHint: 9968,
      });
      const sink = fake.sinkFor(subId);
      loadSnapshot(sink, [{ key: 'a', data: { detailId: 'a' } }]);
      events.length = 0;

      clock.advance(1000);
      runtime.flush();

      const stats = events.find((e) => e.type === 'stats');
      if (stats?.type !== 'stats') throw new Error('expected stats');
      expect(stats.window).toEqual({ topN: 2000, skipN: 0 });
      expect(stats.rowCount).toBe(9968);
    });

    describe('worker-triggered repage (scrolling past the loaded window)', () => {
      function keyAt(i: number): string {
        return `k${String(i).padStart(4, '0')}`;
      }

      async function openWindowed(
        runtime: ReturnType<typeof createWorkerRuntime>,
        fake: ReturnType<typeof fakeConnection>,
        subId: SubscriptionId,
      ) {
        await runtime.handleMessage({
          v: 2,
          type: 'sub.open',
          subId,
          epoch: toEpoch(1),
          topic: 'order_details',
          mode: 'sow_and_delta_subscribe',
          orderBy: '/detailId ASC',
          batchSize: 2000,
          keyField: 'detailId',
          window: { topN: 100, skipN: 0 },
          rowCountHint: 10_000,
        });
        const sink = fake.sinkFor(subId);
        loadSnapshot(
          sink,
          Array.from({ length: 100 }, (_, i) => ({ key: keyAt(i), data: { detailId: keyAt(i) } })),
        );
        fake.openedSpecs.length = 0;
      }

      test('a range outside the loaded window schedules a repage that fires once the debounce elapses', async () => {
        const fake = fakeConnection();
        const clock = fakeClock();
        const runtime = createWorkerRuntime({
          connection: fake.connection,
          post: () => {},
          clock: clock.now,
        });
        const subId = toSubscriptionId('sub-1');
        await openWindowed(runtime, fake, subId);

        // Global rows 500-520 -- well outside the loaded [0, 100) window.
        runtime.handleMessage({ v: 2, type: 'sub.viewport', subId, firstRow: 500, lastRow: 520 });
        expect(fake.openedSpecs).toHaveLength(0); // debounced -- not yet

        clock.advance(149);
        runtime.flush();
        expect(fake.openedSpecs).toHaveLength(0); // not due yet (150ms debounce, constants.ts)

        clock.advance(1);
        runtime.flush();
        await flushMicrotasks(); // performRepage's reissue is fire-and-forget from flush()
        expect(fake.closed).toEqual([subId]);
        expect(fake.openedSpecs).toHaveLength(1);
        // skip_n = firstRow - overscan (20, constants.ts DEFAULT_OVERSCAN_ROWS), clamped to [0, total-topN].
        expect(fake.openedSpecs[0]?.spec.window).toEqual({ topN: 100, skipN: 480 });
      });

      test('a range still covered by the loaded window (plus overscan) never repages', async () => {
        const fake = fakeConnection();
        const clock = fakeClock();
        const runtime = createWorkerRuntime({
          connection: fake.connection,
          post: () => {},
          clock: clock.now,
        });
        const subId = toSubscriptionId('sub-1');
        await openWindowed(runtime, fake, subId);

        runtime.handleMessage({ v: 2, type: 'sub.viewport', subId, firstRow: 10, lastRow: 30 });
        clock.advance(200);
        runtime.flush();

        expect(fake.openedSpecs).toHaveLength(0);
        expect(fake.closed).toHaveLength(0);
      });

      test('a later scroll before the debounce fires replaces the pending repage -- one re-subscription per fling, not one per callback', async () => {
        const fake = fakeConnection();
        const clock = fakeClock();
        const runtime = createWorkerRuntime({
          connection: fake.connection,
          post: () => {},
          clock: clock.now,
        });
        const subId = toSubscriptionId('sub-1');
        await openWindowed(runtime, fake, subId);

        runtime.handleMessage({ v: 2, type: 'sub.viewport', subId, firstRow: 500, lastRow: 520 });
        clock.advance(100);
        runtime.flush();
        expect(fake.openedSpecs).toHaveLength(0); // 100ms since the first call -- not due

        runtime.handleMessage({ v: 2, type: 'sub.viewport', subId, firstRow: 600, lastRow: 620 });
        clock.advance(100);
        runtime.flush();
        expect(fake.openedSpecs).toHaveLength(0); // only 100ms since the SECOND call

        clock.advance(50);
        runtime.flush();
        await flushMicrotasks();
        expect(fake.openedSpecs).toHaveLength(1); // exactly one re-subscription for the whole fling
        expect(fake.openedSpecs[0]?.spec.window).toEqual({ topN: 100, skipN: 580 }); // from the latest request (600 - 20)
      });
    });
  });
});
