// Runtime type guards for messages crossing the worker boundary.
// `postMessage` payloads are `unknown` at the receiving end; these guards
// are how both `worker-client` (main thread) and `data-worker` narrow them
// back to the typed unions before dispatching.
import { PROTOCOL_VERSION } from './brands';
import type { WorkerEvent } from './events';
import type { WorkerRequest } from './requests';

const REQUEST_TYPES = new Set<WorkerRequest['type']>([
  'conn.open',
  'conn.close',
  'sub.open',
  'sub.update',
  'sub.close',
  'sub.viewport',
  'sub.window',
  'ping',
]);

const EVENT_TYPES = new Set<WorkerEvent['type']>([
  'conn.state',
  'pong',
  'sub.opened',
  'snapshot.progress',
  'snapshot.complete',
  'rows.patch',
  'rows.reset',
  'rows.count',
  'rows.removed',
  'stats',
  'error',
]);

function hasEnvelope(value: unknown): value is { v: unknown; type: unknown } {
  return typeof value === 'object' && value !== null && 'v' in value && 'type' in value;
}

/** Narrows an unknown value received on the worker side to a `WorkerRequest`. */
export function isWorkerRequest(value: unknown): value is WorkerRequest {
  return (
    hasEnvelope(value) &&
    value.v === PROTOCOL_VERSION &&
    REQUEST_TYPES.has(value.type as WorkerRequest['type'])
  );
}

/** Narrows an unknown value received on the main thread to a `WorkerEvent`. */
export function isWorkerEvent(value: unknown): value is WorkerEvent {
  return (
    hasEnvelope(value) &&
    value.v === PROTOCOL_VERSION &&
    EVENT_TYPES.has(value.type as WorkerEvent['type'])
  );
}
