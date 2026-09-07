import { describe, expect, test } from 'bun:test';
import { toSubscriptionId } from '@amps-ui/protocol';
import type { AmpsClientLike, AmpsMessageLike } from './connection';
import { AmpsConnection } from './connection';
import type { SubscriptionSink } from './subscription';

/** A fake AMPS message, structurally matching what `AmpsConnection` reads. */
function msg(command: string, data: Record<string, unknown>): AmpsMessageLike {
  return { header: { command: () => command }, data };
}

/** Records every delay `sleep()` was called with, without ever actually waiting. */
function fakeSleep() {
  const delays: number[] = [];
  const sleep = async (ms: number) => {
    delays.push(ms);
  };
  return { sleep, delays };
}

describe('AmpsConnection.connect backoff', () => {
  test('retries with 0.5s -> 1s -> 2s -> 4s -> 8s -> 8s (capped), a new Client per attempt', async () => {
    const { sleep, delays } = fakeSleep();
    const createdClients: AmpsClientLike[] = [];
    let attempt = 0;
    const clientFactory = (): AmpsClientLike => {
      const failThisMany = 5; // fail attempts 0..4, succeed on attempt 5
      const client: AmpsClientLike = {
        connect: async () => {
          if (attempt < failThisMany) {
            attempt++;
            throw new Error('connection refused');
          }
          return {};
        },
        disconnect: async () => ({}),
        execute: async () => 'unused',
        unsubscribe: async () => 'unused',
      };
      createdClients.push(client);
      return client;
    };

    const connection = new AmpsConnection({ clientFactory, sleep });
    const states: string[] = [];
    connection.onState((e) => states.push(e.state));

    await connection.connect('ws://fake', 'test-client');

    expect(delays).toEqual([500, 1_000, 2_000, 4_000, 8_000]);
    // A fresh Client instance every attempt -- never retry a failed one.
    expect(createdClients.length).toBe(6);
    expect(new Set(createdClients).size).toBe(6);
    expect(states.at(0)).toBe('connecting');
    expect(states.filter((s) => s === 'reconnecting').length).toBe(5);
    expect(states.at(-1)).toBe('open');
  });

  test('emits "failed" and rejects once maxAttempts is exhausted', async () => {
    const { sleep } = fakeSleep();
    const clientFactory = (): AmpsClientLike => ({
      connect: async () => {
        throw new Error('down');
      },
      disconnect: async () => ({}),
      execute: async () => 'unused',
      unsubscribe: async () => 'unused',
    });
    const connection = new AmpsConnection({ clientFactory, sleep, maxAttempts: 2 });
    const states: string[] = [];
    connection.onState((e) => states.push(e.state));

    await expect(connection.connect('ws://fake', 'test-client')).rejects.toThrow('down');
    expect(states).toEqual(['connecting', 'reconnecting', 'failed']);
  });
});

describe('AmpsConnection.openSubscription', () => {
  function connectedConnectionWithHandler(): {
    connection: AmpsConnection;
    fire: (message: AmpsMessageLike) => void;
  } {
    let capturedHandler: ((message: AmpsMessageLike) => void) | undefined;
    const clientFactory = (): AmpsClientLike => ({
      connect: async () => ({}),
      disconnect: async () => ({}),
      execute: async (_command, handler) => {
        capturedHandler = handler;
        return 'amps-sub-id-1';
      },
      unsubscribe: async () => 'ok',
    });
    const connection = new AmpsConnection({ clientFactory, sleep: async () => {} });
    return {
      connection,
      fire: (message) => {
        if (!capturedHandler)
          throw new Error('handler not captured yet -- call after connect+openSubscription');
        capturedHandler(message);
      },
    };
  }

  test('dispatches group_begin/sow/group_end/publish/oof to the sink (CLIENT.md message dispatch)', async () => {
    const { connection, fire } = connectedConnectionWithHandler();
    await connection.connect('ws://fake', 'c');

    const events: string[] = [];
    const sink: SubscriptionSink = {
      onSnapshotBegin: () => events.push('begin'),
      onSowRow: (key) => events.push(`sow:${key}`),
      onSnapshotComplete: (rowCount) => events.push(`complete:${rowCount}`),
      onDelta: (key) => events.push(`delta:${key}`),
      onOof: (key) => events.push(`oof:${key}`),
    };

    await connection.openSubscription(
      toSubscriptionId('sub-1'),
      {
        topic: 'order_details',
        mode: 'sow_and_delta_subscribe',
        batchSize: 500,
        keyField: 'detailId',
      },
      sink,
    );

    fire(msg('group_begin', {}));
    fire(msg('sow', { detailId: 'ORD-1:0' }));
    fire(msg('sow', { detailId: 'ORD-1:1' }));
    fire(msg('group_end', {}));
    fire(msg('p', { detailId: 'ORD-1:0', markPrice: 1 }));
    fire(msg('publish', { detailId: 'ORD-1:1', markPrice: 2 }));
    fire(msg('oof', { detailId: 'ORD-1:0' }));

    expect(events).toEqual([
      'begin',
      'sow:ORD-1:0',
      'sow:ORD-1:1',
      'complete:2',
      'delta:ORD-1:0',
      'delta:ORD-1:1',
      'oof:ORD-1:0',
    ]);
  });

  test('closeSubscription unsubscribes using the AMPS-assigned subscription id, not the logical subId', async () => {
    let unsubscribedWith: string | undefined;
    const clientFactory = (): AmpsClientLike => ({
      connect: async () => ({}),
      disconnect: async () => ({}),
      execute: async () => 'amps-sub-xyz',
      unsubscribe: async (subId) => {
        unsubscribedWith = subId;
        return 'ok';
      },
    });
    const connection = new AmpsConnection({ clientFactory, sleep: async () => {} });
    await connection.connect('ws://fake', 'c');
    const subId = toSubscriptionId('logical-sub-1');
    await connection.openSubscription(
      subId,
      { topic: 'order_details', mode: 'sow', batchSize: 100, keyField: 'detailId' },
      { onSowRow: () => {}, onSnapshotComplete: () => {}, onDelta: () => {}, onOof: () => {} },
    );

    await connection.closeSubscription(subId);

    expect(unsubscribedWith).toBe('amps-sub-xyz');
  });

  test('closing an unknown subId is a no-op', async () => {
    const connection = new AmpsConnection({
      clientFactory: () => ({
        connect: async () => ({}),
        disconnect: async () => ({}),
        execute: async () => 'x',
        unsubscribe: async () => {
          throw new Error('should never be called');
        },
      }),
      sleep: async () => {},
    });
    await expect(
      connection.closeSubscription(toSubscriptionId('never-opened')),
    ).resolves.toBeUndefined();
  });
});
