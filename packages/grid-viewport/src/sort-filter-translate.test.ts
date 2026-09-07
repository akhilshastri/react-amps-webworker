import { describe, expect, test } from 'bun:test';
import {
  type AgFilterModel,
  translateFilterModel,
  translateSortModel,
} from './sort-filter-translate';

describe('translateSortModel', () => {
  test('mode "local": builds SortSpec fields from active columns, ordered by sortIndex', () => {
    const { sort, blockedFields } = translateSortModel(
      [
        { colId: 'symbol', sort: 'asc', sortIndex: 1 },
        { colId: 'notional', sort: 'desc', sortIndex: 0 },
        { colId: 'trader', sort: null, sortIndex: null },
      ],
      { mode: 'local' },
    );
    expect(sort).toEqual({
      mode: 'local',
      fields: [
        { field: 'notional', direction: 'desc' },
        { field: 'symbol', direction: 'asc' },
      ],
    });
    expect(blockedFields).toEqual([]);
  });

  test('no active sort -> empty fields, matching "clear the sort" (keyField ASC fallback lives in the worker)', () => {
    const { sort } = translateSortModel([{ colId: 'symbol', sort: null }], { mode: 'local' });
    expect(sort).toEqual({ mode: 'local', fields: [] });
  });

  test('mode "server": builds the same SortSpec shape tagged for server-delegated sort', () => {
    const { sort } = translateSortModel([{ colId: 'detailId', sort: 'asc', sortIndex: 0 }], {
      mode: 'server',
    });
    expect(sort).toEqual({ mode: 'server', fields: [{ field: 'detailId', direction: 'asc' }] });
  });

  // plan §4/C5, carry-forward C3: lastUpdated/tickSeq must never become a
  // streaming server-sort key -- every tick sets them to the newest value,
  // which degenerated a top_n=1000 window to the full 2550/s topic rate.
  test('mode "server" drops fields the caller marks non-streamable, and reports them', () => {
    const nonStreamableFields = new Set(['lastUpdated', 'tickSeq']);
    const { sort, blockedFields } = translateSortModel(
      [
        { colId: 'lastUpdated', sort: 'desc', sortIndex: 0 },
        { colId: 'markPrice', sort: 'asc', sortIndex: 1 },
      ],
      { mode: 'server', nonStreamableFields },
    );
    expect(sort).toEqual({ mode: 'server', fields: [{ field: 'markPrice', direction: 'asc' }] });
    expect(blockedFields).toEqual(['lastUpdated']);
  });

  test('nonStreamableFields is ignored for mode "local" (the worker re-sorts an already-loaded static store, not a streaming window)', () => {
    const { sort, blockedFields } = translateSortModel(
      [{ colId: 'lastUpdated', sort: 'desc', sortIndex: 0 }],
      { mode: 'local', nonStreamableFields: new Set(['lastUpdated']) },
    );
    expect(sort).toEqual({ mode: 'local', fields: [{ field: 'lastUpdated', direction: 'desc' }] });
    expect(blockedFields).toEqual([]);
  });
});

describe('translateFilterModel', () => {
  test('text filter model -> a text FilterCondition', () => {
    const filterModel: AgFilterModel = {
      symbol: { filterType: 'text', type: 'contains', filter: 'AAPL' },
    };
    expect(translateFilterModel(filterModel)).toEqual({
      symbol: { kind: 'text', operator: 'contains', value: 'AAPL' },
    });
  });

  test('number range filter model -> a number FilterCondition with valueTo', () => {
    const filterModel: AgFilterModel = {
      notional: { filterType: 'number', type: 'inRange', filter: 100, filterTo: 500 },
    };
    expect(translateFilterModel(filterModel)).toEqual({
      notional: { kind: 'number', operator: 'inRange', value: 100, valueTo: 500 },
    });
  });

  test('number filter model without a range operator omits valueTo', () => {
    const filterModel: AgFilterModel = {
      quantity: { filterType: 'number', type: 'greaterThan', filter: 10 },
    };
    expect(translateFilterModel(filterModel)).toEqual({
      quantity: { kind: 'number', operator: 'greaterThan', value: 10, valueTo: undefined },
    });
  });

  test('set filter model -> a set FilterCondition', () => {
    const filterModel: AgFilterModel = {
      status: { filterType: 'set', values: ['FILLED', 'PARTIAL'] },
    };
    expect(translateFilterModel(filterModel)).toEqual({
      status: { kind: 'set', values: ['FILLED', 'PARTIAL'] },
    });
  });

  test('an unsupported operator (e.g. "blank") is omitted rather than mistranslated', () => {
    const filterModel: AgFilterModel = {
      trader: { filterType: 'text', type: 'blank' },
    };
    expect(translateFilterModel(filterModel)).toEqual({});
  });

  test('multiple columns combine into one spec', () => {
    const filterModel: AgFilterModel = {
      symbol: { filterType: 'text', type: 'equals', filter: 'MSFT' },
      quantity: { filterType: 'number', type: 'lessThan', filter: 1000 },
    };
    expect(translateFilterModel(filterModel)).toEqual({
      symbol: { kind: 'text', operator: 'equals', value: 'MSFT' },
      quantity: { kind: 'number', operator: 'lessThan', value: 1000, valueTo: undefined },
    });
  });

  test('empty filter model -> empty spec', () => {
    expect(translateFilterModel({})).toEqual({});
  });
});
