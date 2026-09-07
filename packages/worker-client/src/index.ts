// @amps-ui/worker-client -- main-thread owner of the single worker.
//
// Public surface (plan §1): `DataClient` + `SubscriptionHandle`. See
// `data-client.ts` for what `DataClient` owns and why it takes an injected
// `WorkerLike` rather than spawning its own worker.
//
// Depends on: `@amps-ui/protocol` only. Runs on the main thread (needs the
// `Worker`/`MessageEvent` DOM types), never inside the worker itself.
// Consumed by: `@amps-ui/grid-viewport`, `apps/trading-ui`.
export { DataClient, type OpenSubscriptionSpec } from './data-client';
export { SubscriptionHandle } from './subscription-handle';
export type { WorkerLike } from './worker-like';
