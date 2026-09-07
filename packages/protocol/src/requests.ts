// main -> worker messages (plan §3 "main -> worker (WorkerRequest)" table).
// Every message carries the protocol envelope { v, type } plus its own
// fields flattened in (not nested under a `payload` key), per plan §3:
// "Every message: { v: 1, type, subId?, epoch?, ... }".
import type { Epoch, PROTOCOL_VERSION, SubscriptionId } from './brands';
import type { ClientFilterSpec, SortSpec, SubMode } from './shared';

interface Envelope<Type extends string> {
  readonly v: typeof PROTOCOL_VERSION;
  readonly type: Type;
}

/** Open (or re-open) the single worker-side AMPS connection. Idempotent. */
export interface ConnOpenRequest extends Envelope<'conn.open'> {
  readonly uri: string;
  readonly clientName: string;
}

export interface ConnCloseRequest extends Envelope<'conn.close'> {}

/**
 * Open one logical subscription. `batchSize` must be set explicitly --
 * the amps client's default is 10, far too small for bulk loads (brief).
 */
export interface SubOpenRequest extends Envelope<'sub.open'> {
  readonly subId: SubscriptionId;
  readonly epoch: Epoch;
  readonly topic: string;
  readonly mode: SubMode;
  readonly filter?: string;
  readonly orderBy?: string;
  readonly batchSize: number;
  readonly keyField: string;
  readonly sort?: SortSpec;
  readonly clientFilter?: ClientFilterSpec;
}

/**
 * Update an open subscription. A `filter` change makes the worker re-issue
 * to AMPS; a sort/clientFilter-only change makes it re-index in place with
 * no network round trip (plan §3).
 */
export interface SubUpdateRequest extends Envelope<'sub.update'> {
  readonly subId: SubscriptionId;
  readonly epoch: Epoch;
  readonly filter?: string;
  readonly sort?: SortSpec;
  readonly clientFilter?: ClientFilterSpec;
}

export interface SubCloseRequest extends Envelope<'sub.close'> {
  readonly subId: SubscriptionId;
}

/**
 * Coalesced viewport range from AG Grid's `setViewportRange` (fling
 * protection happens on the main thread before this is sent). For a
 * paginated subscription the worker compares this against its loaded
 * window and re-issues with a new `skip_n` when the range falls outside
 * it, debounced ~150ms (plan §3, §4).
 */
export interface SubViewportRequest extends Envelope<'sub.viewport'> {
  readonly subId: SubscriptionId;
  readonly firstRow: number;
  readonly lastRow: number;
}

/**
 * Explicit repage of an AMPS-paginated subscription: `options('top_n=take,skip_n=skip')`
 * (plan §4 -- `Command` has no `skipN()` and `topN()` is deprecated in
 * favor of the free-form options string).
 */
export interface SubWindowRequest extends Envelope<'sub.window'> {
  readonly subId: SubscriptionId;
  readonly epoch: Epoch;
  readonly skip: number;
  readonly take: number;
}

/** Liveness / RTT probe. Answered by a `PongEvent` (events.ts) carrying the same `nonce` back. */
export interface PingRequest extends Envelope<'ping'> {
  readonly nonce: string;
}

export type WorkerRequest =
  | ConnOpenRequest
  | ConnCloseRequest
  | SubOpenRequest
  | SubUpdateRequest
  | SubCloseRequest
  | SubViewportRequest
  | SubWindowRequest
  | PingRequest;
