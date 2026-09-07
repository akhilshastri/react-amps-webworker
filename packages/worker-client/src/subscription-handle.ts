// One logical subscription as seen from the main thread (plan §1, §3).
//
// A thin, stateless wrapper around `DataClient` scoped to a single
// `subId` -- every method just forwards to the client instance that
// created it. Kept separate from `DataClient` so callers (grid-viewport's
// `createWorkerViewportDatasource`, feature packages later) get a small
// per-subscription handle instead of the whole client.
import type {
  ClientFilterSpec,
  Epoch,
  SortSpec,
  SubscriptionId,
  WorkerEvent,
} from '@amps-ui/protocol';
import type { DataClient } from './data-client';

export class SubscriptionHandle {
  constructor(
    private readonly client: DataClient,
    readonly subId: SubscriptionId,
  ) {}

  /** The epoch this subscription is currently on (plan §3: bumped by `open`/`update`). */
  get epoch(): Epoch {
    return this.client.currentEpoch(this.subId);
  }

  /**
   * Sends `sub.update`. A `filter` change makes the worker re-issue to
   * AMPS; a sort/clientFilter-only change re-indexes in place (plan §3).
   * Returns the new epoch this subscription is now on.
   */
  update(patch: { filter?: string; sort?: SortSpec; clientFilter?: ClientFilterSpec }): Epoch {
    return this.client.updateSubscription(this.subId, patch);
  }

  /**
   * Sends `sub.viewport`. Callers that need fling protection (grid-viewport's
   * datasource) should coalesce before calling this -- this method sends
   * immediately, on every call (plan §3: coalescing happens "on the main
   * thread before send", which here means before reaching this handle).
   */
  setViewportRange(firstRow: number, lastRow: number): void {
    this.client.sendViewport(this.subId, firstRow, lastRow);
  }

  /** Explicit repage of an AMPS-paginated subscription (plan §4). */
  window(skip: number, take: number): void {
    this.client.sendWindow(this.subId, skip, take);
  }

  /** Sends `sub.close` and stops delivering further events to this handle's listeners. */
  close(): void {
    this.client.closeSubscription(this.subId);
  }

  /** Subscribes to every `WorkerEvent` for this subId. Returns an unsubscribe function. */
  onEvent(listener: (event: WorkerEvent) => void): () => void {
    return this.client.onSubscriptionEvent(this.subId, listener);
  }
}
