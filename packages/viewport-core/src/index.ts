// @amps-ui/viewport-core -- pure data engine, no I/O.
//
// Owns: the row `Map` (row-store.ts), the plain-`Array` sort index with
// O(1) key->index lookup and insert/remove index repair (sort-index.ts),
// comparators (comparators.ts), client-side column filter predicates
// (filter.ts, plan D3), viewport window tracking with overscan
// (viewport.ts), dirty-key conflation with an injected clock (conflator.ts),
// and sparse-patch / window-snapshot construction (sparse-patch.ts). No
// timers of its own, no DOM, no React -- 100% `bun test`-able (plan §1).
//
// Depends on: `@amps-ui/protocol` only.
// Consumed by: `@amps-ui/data-worker`.
export { RowStore } from './row-store';
export { SortIndex } from './sort-index';
export { compareValues, createFieldComparator, createKeyComparator } from './comparators';
export { ViewportProjection, clampWindow } from './viewport';
export { DirtyKeyConflator } from './conflator';
export { buildSparsePatch, buildWindowSnapshot } from './sparse-patch';
export { matchesClientFilter } from './filter';
