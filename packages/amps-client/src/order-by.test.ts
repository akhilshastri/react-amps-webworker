import { describe, expect, test } from 'bun:test';
import { buildOrderBy } from './order-by';

describe('buildOrderBy', () => {
  test('single field', () => {
    expect(buildOrderBy([{ field: 'detailId', direction: 'asc' }])).toBe('/detailId ASC');
  });

  test('multiple fields are comma-separated, direction upper-cased', () => {
    expect(
      buildOrderBy([
        { field: 'markPrice', direction: 'desc' },
        { field: 'detailId', direction: 'asc' },
      ]),
    ).toBe('/markPrice DESC,/detailId ASC');
  });

  test('empty fields produce an empty string', () => {
    expect(buildOrderBy([])).toBe('');
  });
});
