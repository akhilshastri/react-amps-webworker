// Sparse patch / window-snapshot construction -- the reducer at the heart
// of the worker-side update pipeline (plan §3 step 3): dirty keys -> the
// sort index's absolute row positions -> a `SparseRowMap` keyed by index,
// filtered to the current viewport window, changed rows only.
//
// Two entry points, both pure:
//  - `buildSparsePatch` for `rows.patch` (diff of what actually changed).
//  - `buildWindowSnapshot` for `rows.reset` (full data for a window the
//    main thread has never seen -- initial load, `oof` index repair, or
//    the window sliding to reveal rows it was never sent, since patches
//    for off-window rows are dropped rather than queued).
import type { RowData, SparseRowMap } from '@amps-ui/protocol';
import type { RowStore } from './row-store';
import type { SortIndex } from './sort-index';

/**
 * Builds the sparse `rows.patch` payload for one flush. Rows whose current
 * index falls outside `[windowStart, windowEnd]` are dropped -- deliberately
 * (plan §3): they are still correct in `RowStore`, and will be delivered in
 * full the next time the viewport window slides over them.
 */
export function buildSparsePatch(
  dirtyKeys: ReadonlySet<string>,
  rowStore: RowStore,
  sortIndex: SortIndex,
  windowStart: number,
  windowEnd: number,
): SparseRowMap {
  const patch: Record<number, RowData> = {};
  for (const key of dirtyKeys) {
    const index = sortIndex.indexOf(key);
    if (index === undefined || index < windowStart || index > windowEnd) continue;
    const row = rowStore.get(key);
    if (!row) continue;
    patch[index] = row;
  }
  return patch;
}

/** Builds a full (non-diff) snapshot of every row currently inside `[windowStart, windowEnd]`. */
export function buildWindowSnapshot(
  rowStore: RowStore,
  sortIndex: SortIndex,
  windowStart: number,
  windowEnd: number,
): SparseRowMap {
  const rows: Record<number, RowData> = {};
  const start = Math.max(0, windowStart);
  const end = Math.min(sortIndex.length - 1, windowEnd);
  for (let index = start; index <= end; index++) {
    const key = sortIndex.keyAt(index);
    if (key === undefined) continue;
    const row = rowStore.get(key);
    if (!row) continue;
    rows[index] = row;
  }
  return rows;
}
