import { describe, expect, test } from 'bun:test';
import type { RowData } from '@amps-ui/protocol';
import { toSelectedRowKeys } from './selection';

const getRowId = (data: RowData): string => String(data.id);

describe('toSelectedRowKeys', () => {
  test('maps selected row data to keys via the supplied getRowId', () => {
    const selected: RowData[] = [{ id: 'ORD-000002' }, { id: 'ORD-000042' }];
    expect(toSelectedRowKeys(selected, getRowId)).toEqual(['ORD-000002', 'ORD-000042']);
  });

  test('empty selection maps to an empty key list', () => {
    expect(toSelectedRowKeys([], getRowId)).toEqual([]);
  });

  test('preserves AG Grid selection order, not sorted order', () => {
    const selected: RowData[] = [{ id: 'c' }, { id: 'a' }, { id: 'b' }];
    expect(toSelectedRowKeys(selected, getRowId)).toEqual(['c', 'a', 'b']);
  });
});
