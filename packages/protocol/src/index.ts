// @amps-ui/protocol -- the main<->worker message contract (protocol v1).
//
// Owns: WorkerRequest/WorkerEvent message unions, branded SubscriptionId/
// Epoch types, shared row/topic vocabulary, and the runtime type guards.
// Zero runtime deps, zero DOM, zero React (enforced by tsconfig.json's
// `lib: ["ES2023", "WebWorker"]`, no `"DOM"`).
//
// Frozen for M1: every other package (amps-client, viewport-core,
// data-worker, worker-client, grid-viewport, and both feature-* packages)
// depends on this one and only this one for cross-boundary types, so
// changing it after M1 requires updating all of them.
export * from './brands';
export * from './epoch';
export * from './shared';
export * from './requests';
export * from './events';
export * from './guards';
