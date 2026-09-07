// @amps-ui/amps-client -- AMPS transport, worker-safe.
//
// Owns: connecting with exponential backoff (connection.ts), the single
// `amps` import shim isolating R1's fallback (amps-shim.ts), the
// subscription registry and snapshot-lifecycle dispatch (connection.ts),
// delta-merge semantics (delta.ts) -- CLIENT.md's central pitfall:
// `Object.assign`, never a replace, or the 17 static `order_details`
// fields get blanked by the next tick -- and translating a worker-side
// `SortField[]` into AMPS's `orderBy` string (order-by.ts, plan amended §4:
// the details topic's server-delegated sort).
//
// Depends on: `amps` (worker-safe per M0), `@amps-ui/protocol`.
// Consumed by: `@amps-ui/data-worker`.
export { AmpsConnection } from './connection';
export type {
  AmpsClientLike,
  AmpsMessageLike,
  ConnLifecycleState,
  ConnStateEvent,
  ConnStateListener,
  AmpsConnectionOptions,
} from './connection';
export type { SubscriptionSpec, SubscriptionSink, SubscriptionWindow } from './subscription';
export { mergeDelta } from './delta';
export { computeBackoffDelay } from './backoff';
export { buildOrderBy } from './order-by';
