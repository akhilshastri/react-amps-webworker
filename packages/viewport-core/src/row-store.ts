// RowStore -- the row-level source of truth for one subscription's data.
//
// Plain `Map<string, RowData>` per plan §1/§7 (no columnar storage: the brief
// measured a columnar store as premature at these scales -- 1k master rows,
// details usually << 100k). Every row that has ever been seen (snapshot or
// delta-merged) lives here, keyed by the topic's key field (e.g. `detailId`).
// Callers (amps-client's delta merge, data-worker's dispatch) are
// responsible for what goes into a row; this class is just storage.
import type { RowData } from '@amps-ui/protocol';

export class RowStore {
  private readonly rows = new Map<string, RowData>();

  set(key: string, row: RowData): void {
    this.rows.set(key, row);
  }

  get(key: string): RowData | undefined {
    return this.rows.get(key);
  }

  has(key: string): boolean {
    return this.rows.has(key);
  }

  delete(key: string): boolean {
    return this.rows.delete(key);
  }

  keys(): IterableIterator<string> {
    return this.rows.keys();
  }

  get size(): number {
    return this.rows.size;
  }

  clear(): void {
    this.rows.clear();
  }
}
