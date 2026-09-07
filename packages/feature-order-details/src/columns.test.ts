import { describe, expect, test } from 'bun:test';
import { ORDER_DETAILS_COLUMN_DEFS, getOrderDetailRowId } from './columns';

const TICKING_FIELDS = new Set([
  'markPrice',
  'marketValue',
  'unrealizedPnl',
  'dayPnl',
  'lastUpdated',
  'tickSeq',
]);

describe('ORDER_DETAILS_COLUMN_DEFS', () => {
  test('covers all 23 CLIENT.md fields (17 static + 6 ticking)', () => {
    expect(ORDER_DETAILS_COLUMN_DEFS).toHaveLength(23);
  });

  test('enableCellChangeFlash is set on exactly the 6 ticking fields', () => {
    const flashing = ORDER_DETAILS_COLUMN_DEFS.filter((col) => col.enableCellChangeFlash === true);
    expect(flashing).toHaveLength(6);
    for (const col of flashing) {
      expect(TICKING_FIELDS.has(String(col.field))).toBe(true);
    }
  });

  test('every static (non-ticking) field leaves cell-flash off', () => {
    const staticCols = ORDER_DETAILS_COLUMN_DEFS.filter(
      (col) => !TICKING_FIELDS.has(String(col.field)),
    );
    expect(staticCols).toHaveLength(17);
    for (const col of staticCols) {
      expect(col.enableCellChangeFlash).not.toBe(true);
    }
  });
});

describe('getOrderDetailRowId', () => {
  test('keys by detailId', () => {
    expect(getOrderDetailRowId({ detailId: 'ORD-000042:7' })).toBe('ORD-000042:7');
  });
});
