// Row/topic types and literals shared by both request and event messages.
// Kept topic-agnostic on purpose (plan §1: "the reusable grid never learns
// the words 'orders' or 'childCount'") -- feature packages own column
// shapes; this package only owns the wire-level row/topic vocabulary.

/**
 * One AMPS row as delivered to a handler: the JSON TypeHelper already
 * materialized it (plan/brief: "zero-allocation decode" is not achievable
 * here), so it arrives as a plain object. Field order is NOT stable
 * (CLIENT.md), so callers must always access by name.
 */
export type RowData = Record<string, unknown>;

/** Sparse map keyed by absolute row index -- the wire shape for both `rows.patch` and `rows.reset`. */
export type SparseRowMap = Record<number, RowData>;

/** AMPS subscription mode a `sub.open` can request (plan §3). */
export type SubMode = 'sow' | 'sow_and_subscribe' | 'sow_and_delta_subscribe';

/** Connection lifecycle state driving the app-level banner (plan §3 `conn.state`). */
export type ConnState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed' | 'failed';

/** One column's contribution to a multi-column sort (stable secondary keys). */
export interface SortField {
  readonly field: string;
  readonly direction: 'asc' | 'desc';
}

/**
 * A column sort request translated from AG Grid's `api.getColumnState()`
 * on the main thread (that translation is the main thread's job -- this
 * package stays AG-Grid-free). Not specified verbatim in the plan.
 *
 * v2 (M3A, plan amended §4): firmed up from a bare `{field,direction}[]`
 * into a union discriminated on `mode`, because the two grids in this app
 * apply a sort completely differently and the worker needs to be told
 * which:
 *  - `'local'` -- the worker re-sorts its own plain-`Array` sort index in
 *    place, no network round trip (the `orders` grid: 1,000 static rows,
 *    already fully loaded).
 *  - `'server'` -- the worker translates `fields` into an AMPS `orderBy`
 *    string and re-issues the paginated subscription (the `order_details`
 *    grid: sorting up to 1.5M rows in JS is a non-starter, so AMPS does it
 *    -- plan §4 "Sorting is delegated to AMPS via `orderBy`").
 * An empty `fields` array means "clear the sort", i.e. fall back to the
 * subscription's default order (`keyField ASC`).
 */
export type SortSpec =
  | { readonly mode: 'local'; readonly fields: readonly SortField[] }
  | { readonly mode: 'server'; readonly fields: readonly SortField[] };

/**
 * One column filter's condition. Deliberately its own vocabulary rather
 * than AG Grid's `getFilterModel()` shape -- this package must not depend
 * on ag-grid types (plan §1: `protocol` is zero-dependency); the main
 * thread translates AG Grid's filter model into this shape, and the
 * worker-side consumer (`viewport-core`'s `matchesClientFilter`)
 * interprets it, not this package.
 */
export type FilterCondition =
  | {
      readonly kind: 'text';
      readonly operator:
        | 'equals'
        | 'notEqual'
        | 'contains'
        | 'notContains'
        | 'startsWith'
        | 'endsWith';
      readonly value: string;
    }
  | {
      readonly kind: 'number';
      readonly operator:
        | 'equals'
        | 'notEqual'
        | 'lessThan'
        | 'lessThanOrEqual'
        | 'greaterThan'
        | 'greaterThanOrEqual'
        | 'inRange';
      readonly value: number;
      /** Only meaningful for `'inRange'`: the upper bound (`value` is the lower bound). */
      readonly valueTo?: number;
    }
  | {
      readonly kind: 'set';
      readonly values: ReadonlyArray<string | number | boolean | null>;
    };

/**
 * Client-side column filter model, applied by the worker over the
 * already-loaded row store (plan D3), keyed by field name. v2 (M3A) firms
 * this up from an opaque `Record<string, unknown>` into a precise
 * discriminated union (`FilterCondition`) per column so the worker can
 * evaluate it without guessing a shape. A row matches the spec when it
 * matches every column condition present (AND across columns, matching AG
 * Grid's own default `filterModel` semantics).
 */
export type ClientFilterSpec = Readonly<Record<string, FilterCondition>>;

/**
 * AMPS-side pagination window a subscription can request, either at open
 * time or via a later `sub.window` repage (plan §4: `Command` has no
 * `skipN()` and `topN()` is deprecated in favor of the free-form
 * `options('top_n=W,skip_n=S')` string). M4b addition to `SubOpenRequest`
 * (requests.ts) -- the plan's original §3 message table only added a
 * `window` to the later `sub.window` repage, not to `sub.open` itself, but
 * the details grid's very *first* subscription must already be bounded: an
 * unbounded initial snapshot on a large selection would try to stream the
 * whole thing before any follow-up `sub.window` could bound it (exactly the
 * "never query `order_details` unfiltered" hazard CLIENT.md warns about,
 * just reached one request later).
 *
 * Mirrors `@amps-ui/amps-client`'s worker-internal `SubscriptionWindow`
 * (`subscription.ts`) -- duplicated rather than imported because
 * `amps-client` is a worker-only package and `protocol` must stay
 * dependency-free (plan §1) so both sides of the worker boundary can be
 * built against it independently.
 */
export interface WindowSpec {
  readonly topN: number;
  readonly skipN: number;
}
