import { describe, expect, test } from 'bun:test';
import { PROTOCOL_VERSION } from './brands';
import { isWorkerEvent, isWorkerRequest } from './guards';

describe('isWorkerRequest', () => {
  test('accepts a well-formed request', () => {
    expect(
      isWorkerRequest({ v: PROTOCOL_VERSION, type: 'conn.open', uri: 'x', clientName: 'c' }),
    ).toBe(true);
  });

  test('rejects a WorkerEvent type', () => {
    expect(isWorkerRequest({ v: PROTOCOL_VERSION, type: 'conn.state', state: 'open' })).toBe(false);
  });

  test('rejects a mismatched protocol version', () => {
    expect(isWorkerRequest({ v: 99, type: 'conn.open' })).toBe(false);
  });

  test('rejects non-envelope values', () => {
    expect(isWorkerRequest(null)).toBe(false);
    expect(isWorkerRequest('conn.open')).toBe(false);
    expect(isWorkerRequest({})).toBe(false);
  });
});

describe('isWorkerEvent', () => {
  test('accepts a well-formed event', () => {
    expect(isWorkerEvent({ v: PROTOCOL_VERSION, type: 'conn.state', state: 'open' })).toBe(true);
  });

  test('accepts a pong -- ping/pong round trip closed in v2 (plan §10 C3)', () => {
    expect(
      isWorkerEvent({ v: PROTOCOL_VERSION, type: 'pong', nonce: 'abc', workerTime: 1_000 }),
    ).toBe(true);
  });

  test('rejects a WorkerRequest type', () => {
    expect(isWorkerEvent({ v: PROTOCOL_VERSION, type: 'conn.open' })).toBe(false);
  });

  test('rejects an unknown type string', () => {
    expect(isWorkerEvent({ v: PROTOCOL_VERSION, type: 'bogus' })).toBe(false);
  });
});
