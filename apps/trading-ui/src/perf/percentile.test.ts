import { describe, expect, test } from 'bun:test';
import { percentile, summarize } from './percentile';

describe('percentile', () => {
  test('p50 of an odd-length sorted set is the middle value', () => {
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
  });

  test('p95 of 100 values 1..100 is 95', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(values, 95)).toBe(95);
  });

  test('unsorted input is sorted internally', () => {
    expect(percentile([5, 1, 4, 2, 3], 50)).toBe(3);
  });

  test('empty input is 0', () => {
    expect(percentile([], 95)).toBe(0);
  });
});

describe('summarize', () => {
  test('empty distribution is all zeroes, not NaN', () => {
    expect(summarize([])).toEqual({ count: 0, mean: 0, p50: 0, p95: 0, max: 0 });
  });

  test('mean/p50/p95/max over a known set', () => {
    const dist = summarize([10, 20, 30, 40, 50]);
    expect(dist.count).toBe(5);
    expect(dist.mean).toBe(30);
    expect(dist.p50).toBe(30);
    expect(dist.max).toBe(50);
  });
});
