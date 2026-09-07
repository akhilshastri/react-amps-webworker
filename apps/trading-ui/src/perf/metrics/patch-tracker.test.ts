import { describe, expect, test } from 'bun:test';
import { PROTOCOL_VERSION, toEpoch, toSubscriptionId } from '@amps-ui/protocol';
import type { RowsPatchEvent, RowsResetEvent } from '@amps-ui/protocol';
import { EMPTY_PATCH_STATS, applySample, computeRates, sampleFromEvent } from './patch-tracker';

const subId = toSubscriptionId('perf-details');
const epoch = toEpoch(0);

function patchEvent(rows: Record<number, unknown>): RowsPatchEvent {
  return { v: PROTOCOL_VERSION, type: 'rows.patch', subId, epoch, rows: rows as never };
}

function resetEvent(rowCount: number, rows: Record<number, unknown>): RowsResetEvent {
  return { v: PROTOCOL_VERSION, type: 'rows.reset', subId, epoch, rowCount, rows: rows as never };
}

describe('applySample', () => {
  test('accumulates counts, rows, and bytes across samples', () => {
    let stats = EMPTY_PATCH_STATS;
    stats = applySample(stats, { kind: 'patch', rowCount: 3, bytes: 100, at: 1_000 });
    stats = applySample(stats, { kind: 'reset', rowCount: 50, bytes: 2_000, at: 1_050 });
    expect(stats.patchMessageCount).toBe(1);
    expect(stats.resetMessageCount).toBe(1);
    expect(stats.totalRowCount).toBe(53);
    expect(stats.totalBytes).toBe(2_100);
    expect(stats.firstMessageAt).toBe(1_000);
    expect(stats.lastMessageAt).toBe(1_050);
  });
});

describe('computeRates', () => {
  test('all zero for an empty phase (never NaN/Infinity)', () => {
    const rates = computeRates(EMPTY_PATCH_STATS);
    expect(rates).toEqual({
      messagesPerSec: 0,
      rowsPerSec: 0,
      bytesPerSec: 0,
      avgRowsPerMessage: 0,
    });
  });

  test('derives rates from the phase span, not an external duration', () => {
    let stats = EMPTY_PATCH_STATS;
    stats = applySample(stats, { kind: 'patch', rowCount: 10, bytes: 1_000, at: 0 });
    stats = applySample(stats, { kind: 'patch', rowCount: 10, bytes: 1_000, at: 2_000 }); // 2s span
    const rates = computeRates(stats);
    expect(rates.messagesPerSec).toBe(1); // 2 messages / 2s
    expect(rates.rowsPerSec).toBe(10); // 20 rows / 2s
    expect(rates.avgRowsPerMessage).toBe(10);
  });
});

describe('sampleFromEvent', () => {
  test('extracts a patch sample from rows.patch', () => {
    const sample = sampleFromEvent(patchEvent({ 5: { detailId: 'x' }, 6: { detailId: 'y' } }), 42);
    expect(sample).toEqual({ kind: 'patch', rowCount: 2, bytes: expect.any(Number), at: 42 });
  });

  test('extracts a reset sample from rows.reset', () => {
    const sample = sampleFromEvent(resetEvent(1_000, { 0: { detailId: 'a' } }), 42);
    expect(sample).toEqual({ kind: 'reset', rowCount: 1, bytes: expect.any(Number), at: 42 });
  });

  test('ignores event types with no row payload', () => {
    const sample = sampleFromEvent(
      { v: PROTOCOL_VERSION, type: 'rows.count', subId, epoch, rowCount: 5 },
      42,
    );
    expect(sample).toBeUndefined();
  });
});
