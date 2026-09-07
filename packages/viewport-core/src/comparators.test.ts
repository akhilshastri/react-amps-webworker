import { describe, expect, test } from 'bun:test';
import type { RowData } from '@amps-ui/protocol';
import { createFieldComparator, createKeyComparator } from './comparators';
import { RowStore } from './row-store';

describe('createFieldComparator', () => {
  test('single field, ascending', () => {
    const cmp = createFieldComparator([{ field: 'seq', direction: 'asc' }]);
    expect(cmp({ seq: 1 }, { seq: 2 })).toBeLessThan(0);
    expect(cmp({ seq: 2 }, { seq: 1 })).toBeGreaterThan(0);
  });

  test('single field, descending', () => {
    const cmp = createFieldComparator([{ field: 'seq', direction: 'desc' }]);
    expect(cmp({ seq: 1 }, { seq: 2 })).toBeGreaterThan(0);
  });

  test('falls through to the second field on a tie in the first', () => {
    const cmp = createFieldComparator([
      { field: 'orderId', direction: 'asc' },
      { field: 'seq', direction: 'desc' },
    ]);
    const a: RowData = { orderId: 'ORD-1', seq: 1 };
    const b: RowData = { orderId: 'ORD-1', seq: 2 };
    expect(cmp(a, b)).toBeGreaterThan(0); // same orderId, seq desc -> a (seq 1) sorts after b (seq 2)
  });

  test('an empty sort spec treats every pair as equal', () => {
    const cmp = createFieldComparator([]);
    expect(cmp({ a: 1 }, { a: 2 })).toBe(0);
  });
});

describe('createKeyComparator', () => {
  test('compares keys by looking up rows in the store', () => {
    const rowStore = new RowStore();
    rowStore.set('a', { seq: 5 });
    rowStore.set('b', { seq: 1 });
    const cmp = createKeyComparator(
      rowStore,
      createFieldComparator([{ field: 'seq', direction: 'asc' }]),
    );
    expect(cmp('a', 'b')).toBeGreaterThan(0);
  });

  test('ties break stably on the key itself', () => {
    const rowStore = new RowStore();
    rowStore.set('a', { seq: 1 });
    rowStore.set('b', { seq: 1 });
    const cmp = createKeyComparator(
      rowStore,
      createFieldComparator([{ field: 'seq', direction: 'asc' }]),
    );
    expect(cmp('a', 'b')).toBeLessThan(0);
    expect(cmp('b', 'a')).toBeGreaterThan(0);
  });

  test('a missing row falls back to comparing keys directly rather than throwing', () => {
    const rowStore = new RowStore();
    rowStore.set('a', { seq: 1 });
    const cmp = createKeyComparator(
      rowStore,
      createFieldComparator([{ field: 'seq', direction: 'asc' }]),
    );
    expect(() => cmp('a', 'missing')).not.toThrow();
  });
});
