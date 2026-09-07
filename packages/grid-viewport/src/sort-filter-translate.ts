// Translates AG Grid's own sort/filter models into protocol v2's
// `SortSpec` / `ClientFilterSpec` (plan §10 C3). This is the seam the plan
// calls out explicitly: `@amps-ui/protocol` must stay AG-Grid-free, so the
// translation from `api.getColumnState()` / `api.getFilterModel()` lives
// here, on the main-thread side, not in the protocol package.
//
// Deliberately takes narrow *structural* subsets of AG Grid's real
// `ColumnState[]` / `FilterModel` types (rather than importing them
// wholesale) -- same convention as `datasource.ts`'s `ViewportSubscription`:
// a real AG Grid value satisfies these with no adapter, but a test can build
// one without constructing every unrelated field on AG Grid's actual
// interfaces.
//
// Consumed by: feature packages (`OrdersGrid`, and `OrderDetailsGrid` in
// M4b) when wiring `sortChanged`/`filterChanged` to `SubscriptionHandle.update()`.
import type { ClientFilterSpec, FilterCondition, SortField, SortSpec } from '@amps-ui/protocol';

/** The subset of AG Grid's `ColumnState` this translation needs. */
export interface SortColumnState {
  readonly colId: string;
  readonly sort?: 'asc' | 'desc' | null;
  readonly sortIndex?: number | null;
}

export interface TranslateSortModelOptions {
  /**
   * `'local'` -- the worker re-sorts its own already-loaded row store in
   * place (the `orders` grid: 1,000 static rows). `'server'` -- the worker
   * translates `fields` into an AMPS `orderBy` and re-issues the
   * subscription (the `order_details` grid: sorting up to 1.5M rows in JS
   * is a non-starter). Decided by the caller per subscription -- this
   * package has no opinion on which topic needs which (plan §4).
   */
  mode: SortSpec['mode'];
  /**
   * Field names ineligible for a *streaming* server sort (plan §4/C5,
   * carry-forward C3): a paginated, live-updating window sorted by a column
   * every tick sets to its newest value (e.g. `order_details`'s `lastUpdated`
   * or `tickSeq`) degenerates to the full topic rate, because every update
   * instantly re-qualifies for the top-N. Declared by the caller -- this
   * package never hardcodes a topic's field names -- and only consulted
   * when `mode === 'server'`.
   */
  nonStreamableFields?: ReadonlySet<string>;
}

export interface SortTranslation {
  /**
   * The `SortSpec` to send. Any field flagged by `nonStreamableFields` is
   * dropped here (safe by default: a caller that ignores `blockedFields`
   * still can't accidentally request a streaming sort that would blow up
   * the subscription).
   */
  readonly sort: SortSpec;
  /**
   * Requested server-sort fields `nonStreamableFields` flagged, in request
   * order. Always empty for `mode: 'local'`. Reported so the caller (the
   * details feature, M4b) can act on it -- e.g. surface it in the UI, or
   * fall back to a one-off snapshot re-fetch instead of a live re-issue
   * (plan §4: "disable server-sort for those columns and re-issue a
   * bounded snapshot on demand, or refuse them").
   */
  readonly blockedFields: readonly string[];
}

/**
 * Builds a `SortSpec` from AG Grid's `api.getColumnState()`. Only columns
 * with an active `sort` contribute a field, ordered by `sortIndex` (AG
 * Grid's own multi-column sort order) -- `colId` becomes `SortField.field`
 * since this package has no AG Grid `ColDef` to consult for a separate
 * `field` name.
 */
export function translateSortModel(
  columnState: readonly SortColumnState[],
  { mode, nonStreamableFields }: TranslateSortModelOptions,
): SortTranslation {
  const requested: SortField[] = columnState
    .filter((col): col is SortColumnState & { sort: 'asc' | 'desc' } => col.sort != null)
    .sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0))
    .map((col) => ({ field: col.colId, direction: col.sort }));

  if (mode !== 'server' || !nonStreamableFields || nonStreamableFields.size === 0) {
    return { sort: { mode, fields: requested }, blockedFields: [] };
  }

  const blockedFields: string[] = [];
  const fields = requested.filter((field) => {
    if (!nonStreamableFields.has(field.field)) return true;
    blockedFields.push(field.field);
    return false;
  });
  return { sort: { mode, fields }, blockedFields };
}

/** The subset of AG Grid's per-column filter models this translation understands. */
export interface SimpleFilterModelLike {
  readonly filterType?: string;
  readonly type?: string | null;
  readonly filter?: unknown;
  readonly filterTo?: unknown;
}

export interface SetFilterModelLike {
  readonly filterType?: 'set';
  readonly values: ReadonlyArray<string | number | boolean | null>;
}

export type FilterModelLike = SimpleFilterModelLike | SetFilterModelLike;

/** The subset of AG Grid's `FilterModel` this translation needs: keyed by colId, per `api.getFilterModel()`. */
export type AgFilterModel = Readonly<Record<string, FilterModelLike>>;

const TEXT_OPERATORS = new Set<string>([
  'equals',
  'notEqual',
  'contains',
  'notContains',
  'startsWith',
  'endsWith',
]);

const NUMBER_OPERATORS = new Set<string>([
  'equals',
  'notEqual',
  'lessThan',
  'lessThanOrEqual',
  'greaterThan',
  'greaterThanOrEqual',
  'inRange',
]);

/**
 * Translates one AG Grid column filter model into a `FilterCondition`, or
 * `undefined` if it has no `ClientFilterSpec` representation. `undefined`
 * covers two cases, both dropped silently rather than thrown: AG Grid
 * options with no equivalent operator (`blank`/`notBlank`/date presets --
 * `ClientFilterSpec` only models the operators `viewport-core`'s
 * `matchesClientFilter` implements), and AG Grid's combined-condition
 * models (`{ operator: 'AND'|'OR', conditions: [...] }`), since
 * `ClientFilterSpec` is one condition per field, not a per-field boolean
 * tree.
 */
function toFilterCondition(model: FilterModelLike): FilterCondition | undefined {
  if (model.filterType === 'set') {
    return { kind: 'set', values: (model as SetFilterModelLike).values };
  }
  if (model.filterType === 'text') {
    const { type, filter } = model as SimpleFilterModelLike;
    if (typeof type !== 'string' || !TEXT_OPERATORS.has(type)) {
      return undefined;
    }
    if (typeof filter !== 'string') return undefined;
    return {
      kind: 'text',
      operator: type as Extract<FilterCondition, { kind: 'text' }>['operator'],
      value: filter,
    };
  }
  if (model.filterType === 'number') {
    const { type, filter, filterTo } = model as SimpleFilterModelLike;
    if (typeof type !== 'string' || !NUMBER_OPERATORS.has(type)) return undefined;
    if (typeof filter !== 'number') return undefined;
    return {
      kind: 'number',
      operator: type as Extract<FilterCondition, { kind: 'number' }>['operator'],
      value: filter,
      valueTo: typeof filterTo === 'number' ? filterTo : undefined,
    };
  }
  return undefined;
}

/**
 * Builds a `ClientFilterSpec` from AG Grid's `api.getFilterModel()`. Columns
 * whose model has no `ClientFilterSpec` representation (see
 * `toFilterCondition`) are omitted rather than throwing -- an unsupported
 * filter type simply doesn't narrow the client-side view for that column.
 */
export function translateFilterModel(filterModel: AgFilterModel): ClientFilterSpec {
  const spec: Record<string, FilterCondition> = {};
  for (const [field, model] of Object.entries(filterModel)) {
    const condition = toFilterCondition(model);
    if (condition) spec[field] = condition;
  }
  return spec;
}
