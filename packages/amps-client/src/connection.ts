// AmpsConnection -- the worker-side AMPS transport (plan §1's public
// surface: `connect()`, `openSubscription()`, `closeSubscription()`,
// `onState()`, plus `disconnect()` for the protocol's `conn.close`).
//
// Owns: connecting with exponential backoff (a NEW `Client` per attempt --
// CLIENT.md is explicit that a failed instance is never retried), the
// subscription registry (subId -> AMPS's own subscription id, needed to
// `unsubscribe`), and translating `message.header.command()` into the
// `SubscriptionSink` callbacks (subscription.ts).
//
// `AmpsClientLike`/`AmpsMessageLike` are the minimal structural slice of
// `amps`'s real `Client`/`Message` this class touches, so tests can supply
// a fake client with zero network I/O. The real `Client` (via amps-shim.ts)
// satisfies `AmpsClientLike` structurally -- see `defaultClientFactory`.
//
// Depends on: `amps` (via amps-shim.ts), `@amps-ui/protocol` (SubscriptionId only).
// Consumed by: `@amps-ui/data-worker`.
import type { RowData, SubscriptionId } from '@amps-ui/protocol';
import { Client, Command } from './amps-shim';
import { computeBackoffDelay } from './backoff';
import type { SubscriptionSink, SubscriptionSpec } from './subscription';

/** The subset of a real AMPS `Message` this module reads. */
export interface AmpsMessageLike {
  readonly header: { command(): string };
  readonly data: unknown;
}

/** The subset of a real AMPS `Client` this module drives. Method syntax keeps this bivariantly checkable against the real class. */
export interface AmpsClientLike {
  connect(uri: string): Promise<unknown>;
  disconnect(): Promise<unknown>;
  execute(command: unknown, handler: (message: AmpsMessageLike) => void): Promise<string>;
  unsubscribe(subId?: string): Promise<string>;
}

export type ConnLifecycleState = 'connecting' | 'open' | 'reconnecting' | 'closed' | 'failed';

export interface ConnStateEvent {
  readonly state: ConnLifecycleState;
  readonly attempt?: number;
  readonly error?: string;
}

export type ConnStateListener = (event: ConnStateEvent) => void;

export interface AmpsConnectionOptions {
  /** Test seam: build a fake client instead of a real `amps` `Client`. */
  readonly clientFactory?: (clientName: string) => AmpsClientLike;
  /** Test seam: avoid real timers when testing backoff. */
  readonly sleep?: (ms: number) => Promise<void>;
  readonly initialBackoffMs?: number;
  readonly maxBackoffMs?: number;
  /** Default: unlimited retries -- the worker keeps trying until it connects. */
  readonly maxAttempts?: number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// The real `Client` structurally satisfies `AmpsClientLike` (see the interface
// comment above); the cast documents that this is a deliberate narrowing to
// the subset of its API this module uses, not an unsafe escape hatch.
const defaultClientFactory = (clientName: string): AmpsClientLike =>
  new Client(clientName) as unknown as AmpsClientLike;

export class AmpsConnection {
  private client: AmpsClientLike | null = null;
  private readonly subscriptions = new Map<SubscriptionId, { ampsSubId: string }>();
  private readonly listeners = new Set<ConnStateListener>();
  private readonly clientFactory: (name: string) => AmpsClientLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly maxAttempts: number;

  constructor(options: AmpsConnectionOptions = {}) {
    this.clientFactory = options.clientFactory ?? defaultClientFactory;
    this.sleep = options.sleep ?? defaultSleep;
    this.initialBackoffMs = options.initialBackoffMs ?? 500;
    this.maxBackoffMs = options.maxBackoffMs ?? 8_000;
    this.maxAttempts = options.maxAttempts ?? Number.POSITIVE_INFINITY;
  }

  /** Subscribe to connection lifecycle transitions (drives `conn.state` events). Returns an unsubscribe function. */
  onState(listener: ConnStateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: ConnStateEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  /**
   * Connects with exponential backoff (0.5s -> 8s). Every attempt gets a
   * brand-new `Client` -- CLIENT.md: "Discard a client that failed to
   * connect -- don't retry on the same instance." Resolves once connected;
   * rejects only if `maxAttempts` is finite and exhausted (by default it
   * isn't, so this keeps retrying forever, matching a long-lived worker).
   */
  async connect(uri: string, clientName: string): Promise<void> {
    this.emit({ state: 'connecting' });
    for (let attempt = 0; ; attempt++) {
      const client = this.clientFactory(clientName);
      try {
        await client.connect(uri);
        this.client = client;
        this.emit({ state: 'open' });
        return;
      } catch (error) {
        await client.disconnect().catch(() => {});
        const message = error instanceof Error ? error.message : String(error);
        if (attempt + 1 >= this.maxAttempts) {
          this.emit({ state: 'failed', attempt: attempt + 1, error: message });
          throw error instanceof Error ? error : new Error(message);
        }
        this.emit({ state: 'reconnecting', attempt: attempt + 1, error: message });
        await this.sleep(computeBackoffDelay(attempt, this.initialBackoffMs, this.maxBackoffMs));
      }
    }
  }

  async disconnect(): Promise<void> {
    const client = this.client;
    this.client = null;
    if (client) await client.disconnect().catch(() => {});
    this.emit({ state: 'closed' });
  }

  /**
   * Opens one logical subscription and wires `SubscriptionSink` to AMPS
   * message dispatch (CLIENT.md: always branch on `message.header.
   * command()`). `execute()` resolving is the command being SENT, not data
   * arriving -- `onSnapshotComplete` (fired on `group_end`) is the real
   * "loaded" signal, never this method's return.
   */
  async openSubscription(
    subId: SubscriptionId,
    spec: SubscriptionSpec,
    sink: SubscriptionSink,
  ): Promise<void> {
    const client = this.requireClient();
    const command = buildCommand(spec);

    let rowCount = 0;
    let snapshotStartedAt = 0;

    const ampsSubId = await client.execute(command, (message) => {
      const data = message.data as RowData;
      const keyOf = (): string => String(data[spec.keyField]);
      switch (message.header.command()) {
        case 'group_begin':
          rowCount = 0;
          snapshotStartedAt = Date.now();
          sink.onSnapshotBegin?.();
          break;
        case 'sow':
          rowCount++;
          sink.onSowRow(keyOf(), data);
          break;
        case 'group_end':
          sink.onSnapshotComplete(rowCount, Date.now() - snapshotStartedAt);
          break;
        case 'p':
        case 'publish':
          sink.onDelta(keyOf(), data);
          break;
        case 'oof':
          sink.onOof(keyOf());
          break;
        default:
          break; // other ack/control commands are not part of this subscription's data path
      }
    });

    this.subscriptions.set(subId, { ampsSubId });
  }

  async closeSubscription(subId: SubscriptionId): Promise<void> {
    const record = this.subscriptions.get(subId);
    if (!record) return;
    this.subscriptions.delete(subId);
    await this.client?.unsubscribe(record.ampsSubId);
  }

  private requireClient(): AmpsClientLike {
    if (!this.client) throw new Error('AmpsConnection: not connected (call connect() first)');
    return this.client;
  }
}

function buildCommand(spec: SubscriptionSpec): Command {
  const command = new Command(spec.mode).topic(spec.topic).batchSize(spec.batchSize);
  if (spec.filter) command.filter(spec.filter);
  if (spec.orderBy) command.orderBy(spec.orderBy);
  if (spec.window) command.options(`top_n=${spec.window.topN},skip_n=${spec.window.skipN}`);
  return command;
}
