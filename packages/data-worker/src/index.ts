// @amps-ui/data-worker -- the worker entry point.
//
// This module IS the worker script (per plan §1's package table) --
// `apps/trading-ui` imports it via Vite's `?worker` suffix, per the winning
// R1 fallback recorded in plan/notes/M0-worker-bundling.md. It is
// deliberately thin: all dispatch/epoch/conflation logic lives in
// runtime.ts (`createWorkerRuntime`), which is 100% `bun test`-able; this
// file only wires that runtime to the real worker globals (`self`,
// `postMessage`, `setInterval`, `Date.now`) and the real `AmpsConnection`.
//
// Depends on: `amps-client`, `viewport-core`, `protocol`.
import { AmpsConnection } from '@amps-ui/amps-client';
import {
  PROTOCOL_VERSION,
  type WorkerEvent,
  type WorkerRequest,
  isWorkerRequest,
} from '@amps-ui/protocol';
import { FLUSH_INTERVAL_MS } from './constants';
import { createWorkerRuntime } from './runtime';

const connection = new AmpsConnection();

const runtime = createWorkerRuntime({
  connection,
  post: (event: WorkerEvent) => self.postMessage(event),
  clock: () => Date.now(),
});

// No requestAnimationFrame in a dedicated worker (plan §3 gotcha) -- a
// ~16ms timer drives the conflation flush instead.
setInterval(() => runtime.flush(), FLUSH_INTERVAL_MS);

self.onmessage = (event: MessageEvent) => {
  if (!isWorkerRequest(event.data)) return;
  const request: WorkerRequest = event.data;
  // Never throw across the worker boundary -- always an event (plan §3).
  void runtime.handleMessage(request).catch((error: unknown) => {
    const errorEvent: WorkerEvent = {
      v: PROTOCOL_VERSION,
      type: 'error',
      subId: 'subId' in request ? request.subId : undefined,
      epoch: 'epoch' in request ? request.epoch : undefined,
      code: 'unhandled-exception',
      message: error instanceof Error ? error.message : String(error),
      fatal: false,
    };
    self.postMessage(errorEvent);
  });
};
