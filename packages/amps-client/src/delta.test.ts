// Regression test for the delta-merge pitfall (plan §3 / CLIENT.md): merging
// with `Object.assign` must preserve the 17 static `order_details` fields
// across a partial (6- or 7-field) delta; a naive replace must NOT.
import { describe, expect, test } from 'bun:test';
import type { RowData } from '@amps-ui/protocol';
import { mergeDelta } from './delta';

// The real order_details shape (CLIENT.md): 17 static fields, 6 ticking fields.
const snapshotRow: RowData = {
  detailId: 'ORD-000426:137',
  orderId: 'ORD-000426',
  seq: 137,
  symbol: 'BRK.B',
  side: 'BUY',
  execId: 'EXE-0YQAGAR',
  executionTime: '2026-09-06T09:44:09.442Z',
  venue: 'IEX',
  counterparty: 'SUSQUEHANNA',
  lastQty: 15,
  lastPx: 485.65,
  cumQty: 15,
  leavesQty: 108811,
  commission: 1.46,
  fees: 0.36,
  currency: 'USD',
  status: 'FILLED',
  // ticking fields, present at snapshot time too
  markPrice: 477.84,
  marketValue: 7167.6,
  unrealizedPnl: -117.15,
  dayPnl: -70.29,
  lastUpdated: '2026-09-06T17:23:54.991Z',
  tickSeq: 1,
};

const STATIC_FIELDS = [
  'detailId',
  'orderId',
  'seq',
  'symbol',
  'side',
  'execId',
  'executionTime',
  'venue',
  'counterparty',
  'lastQty',
  'lastPx',
  'cumQty',
  'leavesQty',
  'commission',
  'fees',
  'currency',
  'status',
] as const;

describe('mergeDelta', () => {
  test('Object.assign preserves all 17 static fields through a 7-field delta', () => {
    const existing = { ...snapshotRow };
    // Measured delta shape (CLIENT.md): detailId + the 6 ticking fields.
    const delta: RowData = {
      detailId: 'ORD-000426:137',
      markPrice: 480.1,
      marketValue: 7201.5,
      unrealizedPnl: -83.25,
      dayPnl: -49.95,
      lastUpdated: '2026-09-06T17:24:10.112Z',
      tickSeq: 2,
    };

    const merged = mergeDelta(existing, delta);

    for (const field of STATIC_FIELDS) {
      expect(merged[field]).toBe(snapshotRow[field]);
    }
    expect(merged.markPrice).toBe(480.1);
    expect(merged.tickSeq).toBe(2);
  });

  test('a delta narrower than 7 fields (6 fields, no tickSeq) still preserves static fields', () => {
    const existing = { ...snapshotRow };
    // The spike observed BOTH 7- and 6-field deltas -- never assume a fixed shape.
    const delta: RowData = {
      detailId: 'ORD-000426:137',
      markPrice: 481.0,
      marketValue: 7215.0,
      unrealizedPnl: -70.0,
      dayPnl: -42.0,
      lastUpdated: '2026-09-06T17:24:20.000Z',
    };

    const merged = mergeDelta(existing, delta);

    for (const field of STATIC_FIELDS) {
      expect(merged[field]).toBe(snapshotRow[field]);
    }
    expect(merged.tickSeq).toBe(1); // untouched by this delta -- still the snapshot value
  });

  test('mergeDelta mutates and returns the same object reference (no re-set needed by callers)', () => {
    const existing = { ...snapshotRow };
    const merged = mergeDelta(existing, { markPrice: 999 });
    expect(merged).toBe(existing);
  });

  test('REGRESSION: a naive replace (storing the delta as the whole record) blanks the static fields', () => {
    // This is exactly the bug CLIENT.md and the plan warn about: `rows.set(key, delta)`
    // instead of merging. Demonstrating it here pins down *why* mergeDelta exists.
    const delta: RowData = {
      detailId: 'ORD-000426:137',
      markPrice: 480.1,
      marketValue: 7201.5,
      unrealizedPnl: -83.25,
      dayPnl: -49.95,
      lastUpdated: '2026-09-06T17:24:10.112Z',
      tickSeq: 2,
    };

    const replaced: RowData = delta; // the bug: replace instead of merge

    expect(replaced.venue).toBeUndefined();
    expect(replaced.execId).toBeUndefined();
    expect(replaced.lastPx).toBeUndefined();
    for (const field of STATIC_FIELDS) {
      if (field === 'detailId') continue; // the delta always carries the key
      expect(replaced[field]).toBeUndefined();
    }
  });
});
