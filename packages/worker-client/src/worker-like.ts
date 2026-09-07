// Minimal surface of the DOM `Worker` that `DataClient` depends on.
//
// Kept narrow (rather than typing against `Worker` directly) so a fake
// worker used in `bun test` (see `testing/fake-worker.ts`) only has to
// implement three methods, not the full DOM `Worker`/`EventTarget`
// interface. A real `Worker` instance satisfies this structurally with no
// adapter needed.
export interface WorkerLike {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener?(type: 'message', listener: (event: MessageEvent) => void): void;
  terminate?(): void;
}
