// worker -> main messages (plan §3 "worker -> main (WorkerEvent)" table).
import type { Epoch, PROTOCOL_VERSION, SubscriptionId } from './brands';
import type { ConnState, SparseRowMap, WindowSpec } from './shared';

interface Envelope<Type extends string> {
  readonly v: typeof PROTOCOL_VERSION;
  readonly type: Type;
}

/** Drives the app-level connection banner. */
export interface ConnStateEvent extends Envelope<'conn.state'> {
  readonly state: ConnState;
  readonly attempt?: number;
  readonly error?: string;
}

/** The `sub.open`/`sub.update` command was accepted by AMPS -- NOT that data has arrived. */
export interface SubOpenedEvent extends Envelope<'sub.opened'> {
  readonly subId: SubscriptionId;
  readonly epoch: Epoch;
}

/**
 * Reply to `ping` (requests.ts), carrying back the same nonce plus a
 * worker-side timestamp so the caller can compute an RTT. Closes v1 gap #1
 * (plan §10 C3): `ping` previously had no reply, so the liveness/RTT probe
 * could never complete a round trip.
 */
export interface PongEvent extends Envelope<'pong'> {
  readonly nonce: string;
  readonly workerTime: number;
}

/** Throttled to <=4/sec while a snapshot is loading. */
export interface SnapshotProgressEvent extends Envelope<'snapshot.progress'> {
  readonly subId: SubscriptionId;
  readonly epoch: Epoch;
  readonly received: number;
}

/**
 * Emitted on `group_end`. This is the only "loaded" signal -- `execute()`
 * resolves when the command is sent, not when data arrives (brief/plan §3).
 */
export interface SnapshotCompleteEvent extends Envelope<'snapshot.complete'> {
  readonly subId: SubscriptionId;
  readonly epoch: Epoch;
  readonly rowCount: number;
  readonly elapsedMs: number;
}

/**
 * SPARSE, absolute-row-index, changed-rows-only patch. Never a whole
 * window -- this is the main performance lever (plan §3).
 */
export interface RowsPatchEvent extends Envelope<'rows.patch'> {
  readonly subId: SubscriptionId;
  readonly epoch: Epoch;
  readonly rows: SparseRowMap;
}

/**
 * Structural change (insert / `oof` removal / re-sort shifted indices):
 * new count plus the currently visible window only (~100 rows).
 * Deliberately distinct from `rows.patch` (plan §3).
 */
export interface RowsResetEvent extends Envelope<'rows.reset'> {
  readonly subId: SubscriptionId;
  readonly epoch: Epoch;
  readonly rowCount: number;
  readonly rows: SparseRowMap;
}

/** Count-only change (no visible-row content changed). */
export interface RowsCountEvent extends Envelope<'rows.count'> {
  readonly subId: SubscriptionId;
  readonly epoch: Epoch;
  readonly rowCount: number;
}

/**
 * `oof` -- rows no longer match the filter. Main thread uses this for
 * selection cleanup; index repair rides on the accompanying `rows.reset`.
 */
export interface RowsRemovedEvent extends Envelope<'rows.removed'> {
  readonly subId: SubscriptionId;
  readonly epoch: Epoch;
  readonly keys: readonly string[];
  readonly rowCount: number;
}

/**
 * <=1/sec; feeds the footer and the "idle is expected" hint.
 *
 * `window` (M4b addition): the AMPS-paginated window currently loaded, when
 * this subscription has one (plan §4/§5's footer requirement -- "window
 * S..S+W loaded" -- needs the *pagination* bounds, not the on-screen
 * scroll range; the worker can silently reposition this via its own
 * autonomous repage, per C5, so the main thread cannot just remember what
 * it originally asked for -- it has to be told). `undefined` for an
 * unwindowed subscription (e.g. the 1,000-row `orders` grid).
 */
export interface StatsEvent extends Envelope<'stats'> {
  readonly subId: SubscriptionId;
  readonly epoch: Epoch;
  readonly rowCount: number;
  readonly updatesApplied: number;
  readonly lastTickAt: number;
  readonly window?: WindowSpec;
}

/**
 * Never throw across the worker boundary -- always an event. Named
 * `ProtocolErrorEvent` rather than `ErrorEvent` to avoid shadowing the DOM
 * global of the same name in consumer packages that have the "DOM" lib.
 */
export interface ProtocolErrorEvent extends Envelope<'error'> {
  readonly subId?: SubscriptionId;
  readonly epoch?: Epoch;
  readonly code: string;
  readonly message: string;
  readonly fatal: boolean;
}

export type WorkerEvent =
  | ConnStateEvent
  | PongEvent
  | SubOpenedEvent
  | SnapshotProgressEvent
  | SnapshotCompleteEvent
  | RowsPatchEvent
  | RowsResetEvent
  | RowsCountEvent
  | RowsRemovedEvent
  | StatsEvent
  | ProtocolErrorEvent;
