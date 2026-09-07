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

describe('AmpsConnection auto-reconnect (plan §3/M5 -- CLIENT.md: the client never reconnects on its own)', () => {
  /** A fake client whose `disconnectHandler` registration is capturable, so a test can simulate an unintentional drop by invoking it directly. */
  function fakeClientWithCapturableDisconnectHandler(shouldFailConnect: () => boolean) {
    let captured: ((client: AmpsClientLike, error: Error) => void) | undefined;
    const client: AmpsClientLike = {
      connect: async () => {
        if (shouldFailConnect()) throw new Error('refused');
        return {};
      },
      disconnect: async () => ({}),
      execute: async () => 'unused',
      unsubscribe: async () => 'unused',
      disconnectHandler: (handler) => {
        captured = handler;
        return client;
      },
    };
    return { client, fireDisconnect: (error: Error) => captured?.(client, error) };
  }

  /**
   * A fire-and-forget reconnect loop advances on its own microtask/timer
   * schedule (nothing in `AmpsConnection`'s public API returns a promise for
   * it), so tests poll for a condition via macrotask ticks (each one drains
   * every microtask queued so far, including chained `sleep()` resolutions
   * from `fakeSleep`) rather than hand-counting `Promise.resolve()` hops.
   */
  async function waitUntil(predicate: () => boolean, maxTicks = 50): Promise<void> {
    for (let i = 0; i < maxTicks && !predicate(); i++) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  test('an unintentional disconnect triggers a fresh backoff reconnect with a brand-new Client, never the dead one', async () => {
    const { sleep, delays } = fakeSleep();
    const clients: ReturnType<typeof fakeClientWithCapturableDisconnectHandler>[] = [];
    let failNextTwo = 0; // the reconnect fails its first 2 attempts, then succeeds
    const clientFactory = (): AmpsClientLike => {
      const index = clients.length;
      const entry = fakeClientWithCapturableDisconnectHandler(() =>
        index === 0 ? false : failNextTwo-- > 0,
      );
      clients.push(entry);
      return entry.client;
    };

    const connection = new AmpsConnection({ clientFactory, sleep });
    const states: string[] = [];
    connection.onState((e) => states.push(e.state));

    await connection.connect('ws://fake', 'test-client');
    expect(clients).toHaveLength(1);
    expect(states).toEqual(['connecting', 'open']);

    failNextTwo = 2;
    clients[0]?.fireDisconnect(new Error('socket closed'));
    await waitUntil(() => states.at(-1) === 'open' && states.length > 2);

    // A fresh Client every attempt -- the original (now-dead) one is never reused.
    expect(clients.length).toBe(4); // 1 initial + 3 reconnect attempts (2 failed, 1 succeeded)
    expect(new Set(clients.map((c) => c.client)).size).toBe(4);
    expect(delays).toEqual([500, 1_000]);
    expect(states).toEqual([
      'connecting',
      'open',
      'reconnecting',
      'reconnecting',
      'reconnecting',
      'open',
    ]);
  });

  test('subscriptions are discarded on an unintentional disconnect -- closing one afterward is a no-op, not a call against a dead client', async () => {
    const { sleep } = fakeSleep();
    const entry = fakeClientWithCapturableDisconnectHandler(() => false);
    let unsubscribeCalls = 0;
    entry.client.unsubscribe = async () => {
      unsubscribeCalls++;
      return 'ok';
    };
    entry.client.execute = async () => 'amps-sub-xyz';
    const connection = new AmpsConnection({ clientFactory: () => entry.client, sleep });

    await connection.connect('ws://fake', 'c');
    const subId = toSubscriptionId('sub-1');
    await connection.openSubscription(
      subId,
      { topic: 'order_details', mode: 'sow', batchSize: 100, keyField: 'detailId' },
      { onSowRow: () => {}, onSnapshotComplete: () => {}, onDelta: () => {}, onOof: () => {} },
    );

    entry.fireDisconnect(new Error('dropped'));
    await connection.closeSubscription(subId);

    expect(unsubscribeCalls).toBe(0); // the registry was cleared -- nothing to (wrongly) unsubscribe on the dead client
  });

  test('an explicit disconnect() cancels a reconnect loop that is still backing off, so the connection never silently comes back', async () => {
    let resolveSleep: (() => void) | undefined;
    const sleep = () =>
      new Promise<void>((resolve) => {
        resolveSleep = resolve;
      });
    const first = fakeClientWithCapturableDisconnectHandler(() => false);
    let secondAttemptClient: AmpsClientLike | undefined;
    let clientCount = 0;
    const clientFactory = (): AmpsClientLike => {
      clientCount++;
      if (clientCount === 1) return first.client;
      // Every reconnect attempt after the first fails, so the loop stays in backoff.
      const client: AmpsClientLike = {
        connect: async () => {
          throw new Error('still down');
        },
        disconnect: async () => ({}),
        execute: async () => 'unused',
        unsubscribe: async () => 'unused',
      };
      secondAttemptClient = client;
      return client;
    };

    const connection = new AmpsConnection({ clientFactory, sleep });
    const states: string[] = [];
    connection.onState((e) => states.push(e.state));

    await connection.connect('ws://fake', 'c');
    first.fireDisconnect(new Error('dropped'));
    // Let the reconnect loop's first (failing) attempt run all the way to
    // its `sleep()` call -- `resolveSleep` is only assigned once that call
    // actually happens.
    await waitUntil(() => resolveSleep !== undefined);

    expect(secondAttemptClient).toBeDefined();
    expect(states.at(-1)).toBe('reconnecting');

    await connection.disconnect();
    expect(states.at(-1)).toBe('closed');

    // Let the backoff sleep resolve now that disconnect() has already bumped
    // the generation -- the loop must see itself superseded and stop, not
    // resurrect the connection with an 'open' state after an explicit close.
    resolveSleep?.();
    await waitUntil(() => false, 5); // a handful of macrotask ticks for the (superseded) loop to observe the bump and exit

    expect(states.at(-1)).toBe('closed');
    expect(states.includes('open')).toBe(true); // sanity: the initial connect did succeed once
    expect(states.filter((s) => s === 'open')).toHaveLength(1); // but never again after the cancelled reconnect
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
