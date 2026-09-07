// Comparators for the sort index (plain `Array`, see sort-index.ts).
//
// `RowData` values are `unknown` (protocol §shared.ts) since AMPS's JSON
// TypeHelper hands back whatever JSON produced -- numbers stay numbers,
// everything else is compared as a string. Multi-field comparison supports
// a stable secondary key. Takes a plain `SortField[]` rather than the
// wire-level `SortSpec` (protocol v2 discriminated union on `mode: 'local'
// | 'server'`) -- by the time a comparator is being built, the caller
// (data-worker's runtime) has already decided this is the local-resort
// path; `fields` is the part of either variant's payload this needs.
import type { RowData, SortField } from '@amps-ui/protocol';
import type { RowStore } from './row-store';

/** Compares two field values: numeric if both are numbers, else lexicographic on the string form. */
export function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  const sa = String(a);
  const sb = String(b);
  if (sa < sb) return -1;
  if (sa > sb) return 1;
  return 0;
}

/** Builds a multi-field row comparator from a `SortField[]` (plan §3's translation of AG Grid's `getColumnState()`). */
export function createFieldComparator(
  fields: readonly SortField[],
): (a: RowData, b: RowData) => number {
  return (a, b) => {
    for (const { field, direction } of fields) {
      const cmp = compareValues(a[field], b[field]);
      if (cmp !== 0) return direction === 'asc' ? cmp : -cmp;
    }
    return 0;
  };
}

/**
 * Lifts a row-level comparator to a key-level one by looking rows up in the
 * store -- this is the shape `SortIndex` actually needs, since the index
 * stores keys, not rows. Ties (including rows missing from the store, which
 * should not happen in practice) fall back to comparing the keys themselves
 * so the sort stays total and deterministic.
 */
export function createKeyComparator(
  rowStore: RowStore,
  fieldComparator: (a: RowData, b: RowData) => number,
): (keyA: string, keyB: string) => number {
  const byKey = (keyA: string, keyB: string): number => (keyA < keyB ? -1 : keyA > keyB ? 1 : 0);
  return (keyA, keyB) => {
    const a = rowStore.get(keyA);
    const b = rowStore.get(keyB);
    if (!a || !b) return byKey(keyA, keyB);
    const cmp = fieldComparator(a, b);
    return cmp !== 0 ? cmp : byKey(keyA, keyB);
  };
}
