// ViewportProjection -- tracks which absolute row indices are "in view"
// (AG Grid's `setViewportRange` firstRow/lastRow, per plan §3) plus a fixed
// overscan margin so a small scroll doesn't immediately drop rows that are
// still just off-screen. `buildSparsePatch` uses this window to decide
// which dirty rows are worth sending; rows dirtied outside it are dropped
// on purpose (plan §3) -- they arrive fresh via `rows.reset` the next time
// the window moves over them (see `sub.viewport` handling in data-worker).
//
// `clampWindow` is the pure function this class wraps; it is exported
// separately so the window/overscan math itself is directly unit-testable
// without needing an instance.
export function clampWindow(
  firstRow: number,
  lastRow: number,
  overscan: number,
  rowCount: number,
): { start: number; end: number } {
  if (rowCount <= 0) return { start: 0, end: -1 };
  const start = Math.max(0, firstRow - overscan);
  const end = Math.min(rowCount - 1, lastRow + overscan);
  return { start, end };
}

export class ViewportProjection {
  private rawFirstRow = 0;
  private rawLastRow: number;
  private start = 0;
  private end = -1;

  /**
   * @param overscan Rows of margin kept loaded on each side of the visible range.
   * @param initialWindowRows Default visible-row count assumed before the first
   *   real `sub.viewport` message arrives (the grid hasn't rendered yet, but
   *   `group_end` still needs *some* window to put in its `rows.reset`).
   */
  constructor(
    private readonly overscan: number,
    initialWindowRows: number,
  ) {
    this.rawLastRow = initialWindowRows - 1;
  }

  /** Records a new visible range (raw, pre-overscan) and reclamps against the current row count. */
  setRange(firstRow: number, lastRow: number, rowCount: number): void {
    this.rawFirstRow = firstRow;
    this.rawLastRow = lastRow;
    this.reclamp(rowCount);
  }

  /** Re-applies the last known raw range against a (possibly changed) row count, e.g. after a snapshot or an `oof` removal. */
  reclamp(rowCount: number): void {
    const { start, end } = clampWindow(this.rawFirstRow, this.rawLastRow, this.overscan, rowCount);
    this.start = start;
    this.end = end;
  }

  get windowStart(): number {
    return this.start;
  }

  get windowEnd(): number {
    return this.end;
  }

  contains(index: number): boolean {
    return index >= this.start && index <= this.end;
  }
}
