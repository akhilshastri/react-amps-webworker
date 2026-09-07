// Pure translation from AG Grid's selected-rows callback to the row-key list
// the rest of this app cares about (plan §10 C2: "emit selected row keys,
// not row indices" -- indices are meaningless across a re-sort or a details-
// window repage, but a `getRowId`-derived key survives both).
//
// Split out from `viewport-grid.tsx` so it is unit-testable without mounting
// `AgGridReact` -- this package has no jsdom/happy-dom test setup (see
// `datasource.test.ts`'s header for the same reasoning applied to the
// datasource half of this component).
import type { RowData } from '@amps-ui/protocol';

/** Maps `api.getSelectedRows()`'s row data to keys via the same `getRowId` the grid itself uses. */
export function toSelectedRowKeys(
  selectedRows: readonly RowData[],
  getRowId: (data: RowData) => string,
): string[] {
  return selectedRows.map(getRowId);
}
