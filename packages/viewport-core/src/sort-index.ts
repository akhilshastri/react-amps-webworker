// SortIndex -- the row order, as a plain `Array<string>` of keys.
//
// Deliberately NOT a `Uint32Array` (plan §1 / brief audit finding #1,
// measured on this machine: `Array.prototype.sort` -- TimSort -- exploits
// pre-sortedness and beats `TypedArray.prototype.sort` by 3-5x on
// near-sorted data, which is the steady state here: a live subscription
// re-sorts an almost-sorted index far more often than it sorts from
// scratch). A typed array would be a pessimization, not an optimization.
//
// A parallel `Map<string, number>` (`position`) gives O(1) key->absolute
// index lookup, which `buildSparsePatch` needs on every flush to turn a
// dirty key into the row index AG Grid's viewport datasource expects.
// Keeping it in sync is the only bookkeeping cost this class carries.
export class SortIndex {
  private order: string[] = [];
  private position = new Map<string, number>();

  constructor(private comparator: (a: string, b: string) => number) {}

  /** Full rebuild from a fresh key set (snapshot load, or a filter change that swaps the row set). */
  setKeys(keys: Iterable<string>): void {
    this.order = Array.from(keys).sort(this.comparator);
    this.rebuildPositions();
  }

  /**
   * Re-sorts the keys already held, optionally with a new comparator (a
   * `sub.update` sort-only change per plan §3: "sort/clientFilter-only
   * change => worker re-indexes in place, no network"). This is exactly
   * TimSort's best case -- the array is already sorted or close to it.
   */
  resort(comparator: (a: string, b: string) => number = this.comparator): void {
    this.comparator = comparator;
    this.order.sort(this.comparator);
    this.rebuildPositions();
  }

  /**
   * Removes one key (an `oof` -- the row no longer matches the filter).
   * Every key after it shifts down by one, so positions are rebuilt in
   * full; at the row counts here (single order's children, <=~10k) this is
   * cheap and `oof` events are rare relative to deltas.
   */
  removeKey(key: string): boolean {
    const idx = this.position.get(key);
    if (idx === undefined) return false;
    this.order.splice(idx, 1);
    this.rebuildPositions();
    return true;
  }

  /**
   * Inserts one key at its correctly-sorted position (a row that starts
   * matching the client-side column filter after a delta -- plan D3/M3A:
   * the mirror image of `removeKey`, used when a row *enters* the visible
   * set instead of leaving it). No-op if the key is already present.
   * Binary search for the insertion point, then the same full
   * position-rebuild `removeKey` uses -- cheap at these scales, same
   * reasoning as `removeKey`'s comment.
   */
  insertKey(key: string): void {
    if (this.position.has(key)) return;
    let lo = 0;
    let hi = this.order.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const candidate = this.order[mid];
      if (candidate !== undefined && this.comparator(candidate, key) < 0) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    this.order.splice(lo, 0, key);
    this.rebuildPositions();
  }

  indexOf(key: string): number | undefined {
    return this.position.get(key);
  }

  keyAt(index: number): string | undefined {
    return this.order[index];
  }

  get length(): number {
    return this.order.length;
  }

  get keys(): readonly string[] {
    return this.order;
  }

  private rebuildPositions(): void {
    this.position.clear();
    this.order.forEach((key, index) => this.position.set(key, index));
  }
}
