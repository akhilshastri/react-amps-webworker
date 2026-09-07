import { describe, expect, test } from 'bun:test';
import { compareValues } from './comparators';
import { SortIndex } from './sort-index';

const numericAsc = (a: string, b: string) => Number(a) - Number(b);

describe('SortIndex', () => {
  test('setKeys sorts and exposes O(1) index lookups', () => {
    const index = new SortIndex(numericAsc);
    index.setKeys(['3', '1', '2']);
    expect(index.keys).toEqual(['1', '2', '3']);
    expect(index.indexOf('1')).toBe(0);
    expect(index.indexOf('2')).toBe(1);
    expect(index.indexOf('3')).toBe(2);
    expect(index.keyAt(1)).toBe('2');
    expect(index.length).toBe(3);
  });

  test('resort re-sorts an already-loaded (near-sorted) index in place', () => {
    const index = new SortIndex(numericAsc);
    index.setKeys(['1', '2', '3', '4', '5']);
    // A near-sorted re-sort (steady state per plan/brief) with a reversed comparator.
    index.resort((a, b) => Number(b) - Number(a));
    expect(index.keys).toEqual(['5', '4', '3', '2', '1']);
    expect(index.indexOf('5')).toBe(0);
    expect(index.indexOf('1')).toBe(4);
  });

  test('removeKey repairs positions for every key after the removed one (oof index repair)', () => {
    const index = new SortIndex(numericAsc);
    index.setKeys(['1', '2', '3', '4', '5']);
    expect(index.removeKey('3')).toBe(true);
    expect(index.keys).toEqual(['1', '2', '4', '5']);
    // Everything after the removed key must have shifted down by one.
    expect(index.indexOf('4')).toBe(2);
    expect(index.indexOf('5')).toBe(3);
    expect(index.indexOf('3')).toBeUndefined();
    expect(index.length).toBe(4);
  });

  test('removeKey on a key not present is a no-op', () => {
    const index = new SortIndex(numericAsc);
    index.setKeys(['1', '2']);
    expect(index.removeKey('99')).toBe(false);
    expect(index.length).toBe(2);
  });

  test('insertKey places a key at its sorted position and shifts everything after it', () => {
    const index = new SortIndex(numericAsc);
    index.setKeys(['1', '2', '4', '5']);
    index.insertKey('3');
    expect(index.keys).toEqual(['1', '2', '3', '4', '5']);
    expect(index.indexOf('3')).toBe(2);
    // Everything after the inserted key shifted up by one.
    expect(index.indexOf('4')).toBe(3);
    expect(index.indexOf('5')).toBe(4);
    expect(index.length).toBe(5);
  });

  test('insertKey at the front and back of the index', () => {
    const index = new SortIndex(numericAsc);
    index.setKeys(['2', '3']);
    index.insertKey('1');
    index.insertKey('4');
    expect(index.keys).toEqual(['1', '2', '3', '4']);
  });

  test('insertKey on a key already present is a no-op', () => {
    const index = new SortIndex(numericAsc);
    index.setKeys(['1', '2', '3']);
    index.insertKey('2');
    expect(index.keys).toEqual(['1', '2', '3']);
    expect(index.length).toBe(3);
  });

  test('insertKey into an empty index', () => {
    const index = new SortIndex(numericAsc);
    index.insertKey('1');
    expect(index.keys).toEqual(['1']);
    expect(index.indexOf('1')).toBe(0);
  });

  test('removeKey then insertKey round-trips back to the original order', () => {
    const index = new SortIndex(numericAsc);
    index.setKeys(['1', '2', '3', '4', '5']);
    index.removeKey('3');
    index.insertKey('3');
    expect(index.keys).toEqual(['1', '2', '3', '4', '5']);
  });

  test('indexOf/keyAt on an empty index', () => {
    const index = new SortIndex(numericAsc);
    expect(index.length).toBe(0);
    expect(index.indexOf('x')).toBeUndefined();
    expect(index.keyAt(0)).toBeUndefined();
  });
});

describe('compareValues', () => {
  test('compares numbers numerically, not lexicographically', () => {
    expect(compareValues(2, 10)).toBeLessThan(0);
    expect(compareValues('2', '10')).toBeGreaterThan(0); // string compare: '2' > '1'
  });

  test('equal values compare to 0', () => {
    expect(compareValues('a', 'a')).toBe(0);
    expect(compareValues(5, 5)).toBe(0);
  });
});
