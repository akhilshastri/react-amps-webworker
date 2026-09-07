// Test-only stand-in for the DOM `Worker` (plan §6: "worker-client: request
// correlation and stale-epoch dropping against a fake `Worker`"). Not
// exported from the package's public surface (`../index.ts`) -- it exists
// solely so `data-client.test.ts` can drive `DataClient` without a real
// worker or a browser.
import type { WorkerEvent, WorkerRequest } from '@amps-ui/protocol';
import type { WorkerLike } from '../worker-like';

export class FakeWorker implements WorkerLike {
  /** Every request `DataClient` has posted, in order. */
  readonly sent: WorkerRequest[] = [];
  private readonly listeners = new Set<(event: MessageEvent) => void>();

  postMessage(message: unknown): void {
    this.sent.push(message as WorkerRequest);
  }

  addEventListener(_type: 'message', listener: (event: MessageEvent) => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'message', listener: (event: MessageEvent) => void): void {
    this.listeners.delete(listener);
  }

  /** Simulates the worker posting an event back to the main thread. */
  emit(event: WorkerEvent): void {
    const messageEvent = { data: event } as MessageEvent;
    for (const listener of this.listeners) listener(messageEvent);
  }
}
