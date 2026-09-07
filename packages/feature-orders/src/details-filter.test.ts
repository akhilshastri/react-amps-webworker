import { describe, expect, test } from 'bun:test';
import { buildDetailsFilter } from './details-filter';

describe('buildDetailsFilter', () => {
  test('0 ids -> undefined (no subscription, plan §4)', () => {
    expect(buildDetailsFilter([])).toBeUndefined();
  });

  test('1 id -> a plain equality filter (cheaper than a 1-element IN), single-quoted', () => {
    expect(buildDetailsFilter(['ORD-000042'])).toBe("/orderId = 'ORD-000042'");
  });

  test('n ids -> an IN filter, single-quoted, comma-separated with no spaces', () => {
    expect(buildDetailsFilter(['ORD-000042', 'ORD-000101'])).toBe(
      "/orderId IN ('ORD-000042','ORD-000101')",
    );
  });

  test('n ids preserves selection order and scales past two ids', () => {
    expect(buildDetailsFilter(['ORD-000003', 'ORD-000001', 'ORD-000002'])).toBe(
      "/orderId IN ('ORD-000003','ORD-000001','ORD-000002')",
    );
  });

  test('a large id list stays a valid single-quoted IN list', () => {
    const ids = Array.from({ length: 250 }, (_, i) => `ORD-${String(i).padStart(6, '0')}`);
    const filter = buildDetailsFilter(ids);
    expect(filter?.startsWith("/orderId IN ('ORD-000000',")).toBe(true);
    expect(filter?.endsWith("'ORD-000249')")).toBe(true);
    expect(filter?.match(/'/g)?.length).toBe(500);
  });
});
