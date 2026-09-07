import { describe, expect, test } from 'bun:test';
import { RowStore } from './row-store';
import { SortIndex } from './sort-index';
import { buildSparsePatch, buildWindowSnapshot } from './sparse-patch';

function setup() {
  const rowStore = new RowStore();
  const keys = Array.from({ length: 10 }, (_, i) => `k${i}`);
  for (const key of keys) rowStore.set(key, { key, value: 0 });
  const sortIndex = new SortIndex((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  sortIndex.setKeys(keys); // k0..k9, in order, so index === numeric suffix
  return { rowStore, sortIndex };
}

describe('buildSparsePatch', () => {
  test('includes only dirty rows inside the window, keyed by absolute index', () => {
    const { rowStore, sortIndex } = setup();
    rowStore.set('k3', { key: 'k3', value: 99 });
    rowStore.set('k7', { key: 'k7', value: 42 });
    const patch = buildSparsePatch(new Set(['k3', 'k7']), rowStore, sortIndex, 0, 5);
    expect(patch).toEqual({ 3: { key: 'k3', value: 99 } });
  });

  test('drops dirty rows outside the window entirely -- they are not queued', () => {
    const { rowStore, sortIndex } = setup();
    rowStore.set('k8', { key: 'k8', value: 1 });
    const patch = buildSparsePatch(new Set(['k8']), rowStore, sortIndex, 0, 5);
    expect(patch).toEqual({});
  });

  test('an empty dirty set produces an empty patch', () => {
    const { rowStore, sortIndex } = setup();
    expect(buildSparsePatch(new Set(), rowStore, sortIndex, 0, 9)).toEqual({});
  });

  test('a dirty key no longer in the sort index (e.g. removed by oof) is skipped, not errored', () => {
    const { rowStore, sortIndex } = setup();
    sortIndex.removeKey('k4');
    const patch = buildSparsePatch(new Set(['k4']), rowStore, sortIndex, 0, 9);
    expect(patch).toEqual({});
  });
});

describe('buildWindowSnapshot', () => {
  test('returns full data for every row in the window, not just changed ones', () => {
    const { rowStore, sortIndex } = setup();
    const snapshot = buildWindowSnapshot(rowStore, sortIndex, 2, 4);
    expect(snapshot).toEqual({
      2: { key: 'k2', value: 0 },
      3: { key: 'k3', value: 0 },
      4: { key: 'k4', value: 0 },
    });
  });

  test('clamps a window that overruns the index bounds', () => {
    const { rowStore, sortIndex } = setup();
    const snapshot = buildWindowSnapshot(rowStore, sortIndex, 8, 50);
    expect(Object.keys(snapshot).sort()).toEqual(['8', '9']);
  });

  test('an empty index yields an empty snapshot', () => {
    const rowStore = new RowStore();
    const sortIndex = new SortIndex((a, b) => (a < b ? -1 : 1));
    expect(buildWindowSnapshot(rowStore, sortIndex, 0, 10)).toEqual({});
  });
});
