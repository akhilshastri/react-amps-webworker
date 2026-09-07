// @amps-ui/worker-client's core: the main-thread owner of the single worker
// connection (plan §1, §3).
//
// Owns: request correlation and per-subscription event fan-out (routes an
// incoming `WorkerEvent` to the listeners registered for its `subId`),
// epoch allocation (monotonic per subId, bumped on `sub.open`/`sub.update`
// -- plan §3), the connection-state store, and stale-epoch dropping (a
// late event from a superseded request is discarded before it reaches any
// listener).
//
// Deliberately accepts any `WorkerLike` rather than spawning a `Worker`
// itself: the concrete worker (built from `@amps-ui/data-worker` via
// Vite's `?worker` import, per plan/notes/M0-worker-bundling.md) is
// constructed by the app, which is the only place that both has a bundler
// context and a dependency on `data-worker`. That injection point is what
// makes this class unit-testable against a fake `Worker`
// (`testing/fake-worker.ts`) with no DOM and no bundler involved.
//
// Depends on: `@amps-ui/protocol` only. Consumed by `@amps-ui/grid-viewport`
// and `apps/trading-ui`.
import {
  type ClientFilterSpec,
  type ConnState,
  type ConnStateEvent,
  type Epoch,
  PROTOCOL_VERSION,
  type ProtocolErrorEvent,
  type SortSpec,
  type SubOpenRequest,
  type SubscriptionId,
  type WorkerEvent,
  type WorkerRequest,
  isStaleEpoch,
  isWorkerEvent,
  toEpoch,
} from '@amps-ui/protocol';
import { SubscriptionHandle } from './subscription-handle';
import type { WorkerLike } from './worker-like';

type SubscriptionListener = (event: WorkerEvent) => void;
type ConnStateListener = (event: ConnStateEvent) => void;
type ErrorListener = (event: ProtocolErrorEvent) => void;

/** Fields the caller supplies when opening a subscription -- `v`/`type`/`epoch` are added by the client. */
export type OpenSubscriptionSpec = Omit<SubOpenRequest, 'v' | 'type' | 'epoch'>;

export class DataClient {
  private readonly epochBySubId = new Map<SubscriptionId, number>();
  private readonly listenersBySubId = new Map<SubscriptionId, Set<SubscriptionListener>>();
  private readonly connStateListeners = new Set<ConnStateListener>();
  private readonly errorListeners = new Set<ErrorListener>();
  private connState: ConnState = 'idle';

  constructor(private readonly worker: WorkerLike) {
    worker.addEventListener('message', this.handleMessage);
  }

  getConnState(): ConnState {
    return this.connState;
  }

  /** Subscribes to `conn.state` changes. Returns an unsubscribe function. */
  onConnState(listener: ConnStateListener): () => void {
    this.connStateListeners.add(listener);
    return () => this.connStateListeners.delete(listener);
  }

  /** Subscribes to connection-scoped `error` events (no `subId`). Returns an unsubscribe function. */
  onError(listener: ErrorListener): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  /** Opens (or re-opens) the single worker-side AMPS connection. Idempotent (plan §3). */
  connect(uri: string, clientName: string): void {
    this.post({ v: PROTOCOL_VERSION, type: 'conn.open', uri, clientName });
  }

  disconnect(): void {
    this.post({ v: PROTOCOL_VERSION, type: 'conn.close' });
  }

  /**
   * Opens one logical subscription: allocates its first epoch (0),
   * registers its listener set, and sends `sub.open`.
   */
  openSubscription(spec: OpenSubscriptionSpec): SubscriptionHandle {
    const epoch = this.allocateEpoch(spec.subId);
    this.listenersBySubId.set(spec.subId, new Set());
    this.post({ v: PROTOCOL_VERSION, type: 'sub.open', ...spec, epoch });
    return new SubscriptionHandle(this, spec.subId);
  }

  /** Used by `SubscriptionHandle.update`. Bumps and returns the subscription's new epoch. */
  updateSubscription(
    subId: SubscriptionId,
    patch: { filter?: string; sort?: SortSpec; clientFilter?: ClientFilterSpec },
  ): Epoch {
    const epoch = this.allocateEpoch(subId);
    this.post({ v: PROTOCOL_VERSION, type: 'sub.update', subId, ...patch, epoch });
    return epoch;
  }

  /** Used by `SubscriptionHandle.setViewportRange`. Sends immediately, uncoalesced. */
  sendViewport(subId: SubscriptionId, firstRow: number, lastRow: number): void {
    this.post({ v: PROTOCOL_VERSION, type: 'sub.viewport', subId, firstRow, lastRow });
  }

  /**
   * Used by `SubscriptionHandle.window`. Carries the subscription's
   * *current* epoch -- a repage is not an update, so it does not bump it
   * (plan §3: epoch is only bumped by `sub.open`/`sub.update`).
   */
  sendWindow(subId: SubscriptionId, skip: number, take: number): void {
    this.post({
      v: PROTOCOL_VERSION,
      type: 'sub.window',
      subId,
      epoch: this.currentEpoch(subId),
      skip,
      take,
    });
  }

  /** Used by `SubscriptionHandle.close`. Sends `sub.close` and drops this subId's listeners/epoch. */
  closeSubscription(subId: SubscriptionId): void {
    this.post({ v: PROTOCOL_VERSION, type: 'sub.close', subId });
    this.listenersBySubId.delete(subId);
    this.epochBySubId.delete(subId);
  }

  /** Used by `SubscriptionHandle.onEvent`. Returns an unsubscribe function. */
  onSubscriptionEvent(subId: SubscriptionId, listener: SubscriptionListener): () => void {
    const listeners = this.listenersBySubId.get(subId) ?? new Set<SubscriptionListener>();
    listeners.add(listener);
    this.listenersBySubId.set(subId, listeners);
    return () => listeners.delete(listener);
  }

  /** The epoch this subId is currently on (0 if it has never been opened by this client). */
  currentEpoch(subId: SubscriptionId): Epoch {
    return toEpoch(this.epochBySubId.get(subId) ?? 0);
  }

  /** Detaches from the worker and terminates it, if it supports termination. */
  dispose(): void {
    this.worker.removeEventListener?.('message', this.handleMessage);
    this.worker.terminate?.();
  }

  private allocateEpoch(subId: SubscriptionId): Epoch {
    const next = (this.epochBySubId.get(subId) ?? -1) + 1;
    this.epochBySubId.set(subId, next);
    return toEpoch(next);
  }

  private post(request: WorkerRequest): void {
    this.worker.postMessage(request);
  }

  // Bound as a field (not a prototype method) so `removeEventListener` in
  // `dispose()` receives the exact same function reference passed to
  // `addEventListener` in the constructor.
  private readonly handleMessage = (event: MessageEvent): void => {
    const data: unknown = event.data;
    if (!isWorkerEvent(data)) return;

    if (data.type === 'conn.state') {
      this.connState = data.state;
      for (const listener of this.connStateListeners) listener(data);
      return;
    }

    if (data.type === 'error' && data.subId === undefined) {
      for (const listener of this.errorListeners) listener(data);
      return;
    }

    if (!('subId' in data) || data.subId === undefined) return;
    const subId = data.subId;

    // Stale-epoch dropping (plan §3): a late event from a superseded
    // request (e.g. a cancelled selection's snapshot) must never reach a
    // listener, so a `sub.update` in flight can't be overwritten by data
    // for the request it replaced.
    if ('epoch' in data && data.epoch !== undefined) {
      const current = this.epochBySubId.get(subId);
      if (current !== undefined && isStaleEpoch(toEpoch(current), data.epoch)) return;
    }

    const listeners = this.listenersBySubId.get(subId);
    if (!listeners) return;
    for (const listener of listeners) listener(data);
  };
}
