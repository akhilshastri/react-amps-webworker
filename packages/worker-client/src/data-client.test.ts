import { describe, expect, test } from 'bun:test';
import { PROTOCOL_VERSION, toEpoch, toSubscriptionId } from '@amps-ui/protocol';
import { DataClient } from './data-client';
import { FakeWorker } from './testing/fake-worker';

describe('DataClient', () => {
  test('openSubscription allocates epoch 0 and posts sub.open', () => {
    const worker = new FakeWorker();
    const client = new DataClient(worker);
    const subId = toSubscriptionId('sub-a');

    client.openSubscription({
      subId,
      topic: 'order_details',
      mode: 'sow_and_delta_subscribe',
      batchSize: 5000,
      keyField: 'detailId',
    });

    expect(worker.sent).toEqual([
      {
        v: PROTOCOL_VERSION,
        type: 'sub.open',
        subId,
        topic: 'order_details',
        mode: 'sow_and_delta_subscribe',
        batchSize: 5000,
        keyField: 'detailId',
        epoch: toEpoch(0),
      },
    ]);
  });

  test('updateSubscription bumps the epoch monotonically per subId', () => {
    const worker = new FakeWorker();
    const client = new DataClient(worker);
    const subId = toSubscriptionId('sub-a');
    client.openSubscription({ subId, topic: 't', mode: 'sow', batchSize: 100, keyField: 'id' });

    const epoch1 = client.updateSubscription(subId, { filter: '/x = 1' });
    const epoch2 = client.updateSubscription(subId, { filter: '/x = 2' });

    expect(epoch1).toBe(toEpoch(1));
    expect(epoch2).toBe(toEpoch(2));
  });

  test('epoch allocation is independent per subId', () => {
    const worker = new FakeWorker();
    const client = new DataClient(worker);
    const subA = toSubscriptionId('sub-a');
    const subB = toSubscriptionId('sub-b');
    client.openSubscription({
      subId: subA,
      topic: 't',
      mode: 'sow',
      batchSize: 10,
      keyField: 'id',
    });
    client.updateSubscription(subA, {});
    client.openSubscription({
      subId: subB,
      topic: 't',
      mode: 'sow',
      batchSize: 10,
      keyField: 'id',
    });

    expect(client.currentEpoch(subA)).toBe(toEpoch(1));
    expect(client.currentEpoch(subB)).toBe(toEpoch(0));
  });

  test('routes events only to the subscription that opened them (request correlation)', () => {
    const worker = new FakeWorker();
    const client = new DataClient(worker);
    const subA = toSubscriptionId('sub-a');
    const subB = toSubscriptionId('sub-b');
    const handleA = client.openSubscription({
      subId: subA,
      topic: 't',
      mode: 'sow',
      batchSize: 10,
      keyField: 'id',
    });
    const handleB = client.openSubscription({
      subId: subB,
      topic: 't',
      mode: 'sow',
      batchSize: 10,
      keyField: 'id',
    });
    const receivedA: string[] = [];
    const receivedB: string[] = [];
    handleA.onEvent((event) => receivedA.push(event.type));
    handleB.onEvent((event) => receivedB.push(event.type));

    worker.emit({
      v: PROTOCOL_VERSION,
      type: 'snapshot.complete',
      subId: subA,
      epoch: toEpoch(0),
      rowCount: 5,
      elapsedMs: 10,
    });

    expect(receivedA).toEqual(['snapshot.complete']);
    expect(receivedB).toEqual([]);
  });

  test('drops a stale-epoch event so a superseded snapshot cannot overwrite live state', () => {
    const worker = new FakeWorker();
    const client = new DataClient(worker);
    const subId = toSubscriptionId('sub-a');
    const handle = client.openSubscription({
      subId,
      topic: 't',
      mode: 'sow',
      batchSize: 10,
      keyField: 'id',
    });
    handle.update({ filter: '/x = 2' }); // bumps epoch 0 -> 1
    const received: string[] = [];
    handle.onEvent((event) => received.push(event.type));

    worker.emit({
      v: PROTOCOL_VERSION,
      type: 'rows.reset',
      subId,
      epoch: toEpoch(0),
      rowCount: 1,
      rows: {},
    });
    expect(received).toEqual([]);

    worker.emit({
      v: PROTOCOL_VERSION,
      type: 'rows.reset',
      subId,
      epoch: toEpoch(1),
      rowCount: 1,
      rows: {},
    });
    expect(received).toEqual(['rows.reset']);
  });

  test('conn.state fans out to connection listeners regardless of subId', () => {
    const worker = new FakeWorker();
    const client = new DataClient(worker);
    const states: string[] = [];
    client.onConnState((event) => states.push(event.state));

    worker.emit({ v: PROTOCOL_VERSION, type: 'conn.state', state: 'open' });

    expect(states).toEqual(['open']);
    expect(client.getConnState()).toBe('open');
  });

  test('sub.window carries the current epoch unchanged, not a bumped one', () => {
    const worker = new FakeWorker();
    const client = new DataClient(worker);
    const subId = toSubscriptionId('sub-a');
    const handle = client.openSubscription({
      subId,
      topic: 't',
      mode: 'sow',
      batchSize: 10,
      keyField: 'id',
    });
    handle.update({}); // epoch -> 1
    worker.sent.length = 0;

    handle.window(0, 2000);

    expect(worker.sent).toEqual([
      { v: PROTOCOL_VERSION, type: 'sub.window', subId, epoch: toEpoch(1), skip: 0, take: 2000 },
    ]);
  });

  test('closeSubscription sends sub.close and stops delivering events', () => {
    const worker = new FakeWorker();
    const client = new DataClient(worker);
    const subId = toSubscriptionId('sub-a');
    const handle = client.openSubscription({
      subId,
      topic: 't',
      mode: 'sow',
      batchSize: 10,
      keyField: 'id',
    });
    const received: unknown[] = [];
    handle.onEvent((event) => received.push(event));

    handle.close();
    worker.emit({ v: PROTOCOL_VERSION, type: 'rows.count', subId, epoch: toEpoch(0), rowCount: 3 });

    expect(received).toEqual([]);
    expect(worker.sent.at(-1)).toEqual({ v: PROTOCOL_VERSION, type: 'sub.close', subId });
  });

  test('a connection-scoped error (no subId) is routed to onError, not any subscription', () => {
    const worker = new FakeWorker();
    const client = new DataClient(worker);
    const errors: string[] = [];
    client.onError((event) => errors.push(event.code));

    worker.emit({
      v: PROTOCOL_VERSION,
      type: 'error',
      code: 'CONN_FAILED',
      message: 'x',
      fatal: true,
    });

    expect(errors).toEqual(['CONN_FAILED']);
  });
});
