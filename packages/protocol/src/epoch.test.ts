import { describe, expect, test } from 'bun:test';
import { toEpoch } from './brands';
import { isStaleEpoch } from './epoch';

describe('isStaleEpoch', () => {
  test('an older epoch is stale', () => {
    expect(isStaleEpoch(toEpoch(5), toEpoch(4))).toBe(true);
  });

  test('the current epoch is not stale', () => {
    expect(isStaleEpoch(toEpoch(5), toEpoch(5))).toBe(false);
  });

  test('a newer epoch is not stale', () => {
    expect(isStaleEpoch(toEpoch(5), toEpoch(6))).toBe(false);
  });
});
