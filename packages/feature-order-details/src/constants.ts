// Tunable constants for the details grid's subscription lifecycle (plan §4).
// Kept separate from `data-worker/src/constants.ts` -- these are main-thread,
// feature-specific decisions (what the *caller* asks the worker for), not
// worker-internal pipeline timing.

/**
 * Server-side AMPS pagination window size (plan §4: "`WINDOW_ROWS` starts
 * at 2,000 (20,000 measured at 478ms)"). Selecting all 1,000 orders
 * (1,493,999 rows) costs the same as selecting one -- this is what bounds
 * that, regardless of how large the selection is.
 */
export const WINDOW_ROWS = 2_000;

/**
 * The amps client's own default batchSize is 10, far too small for a bulk
 * load (brief/plan §3). Tuned 2,000 -> 20,000 in M7 per
 * `plan/notes/M6-measurements.md` (measured 2,002ms -> 1,346ms median on the
 * AMPS leg of a snapshot load) -- this is the AMPS-side batch size, not
 * `WINDOW_ROWS`, so it improves only that leg of load time (~7% of the
 * total), not the client-side majority.
 */
export const DETAILS_BATCH_SIZE = 20_000;

/** Default sort when nothing else is requested (plan §4: "Default sort stays `/detailId ASC`"). */
export const DEFAULT_ORDER_BY = '/detailId ASC';

/**
 * Selection -> subscription debounce (plan §4: "250ms trailing... arrow-
 * keying down the orders grid must not thrash subscriptions").
 */
export const SELECTION_DEBOUNCE_MS = 250;

/**
 * Fields whose rank changes on every tick (CLIENT.md: `lastUpdated` is set
 * to "now" and `tickSeq` increments on every one of the ~2,500 updates/sec)
 * so every update instantly re-qualifies for the top of a paginated sort,
 * degenerating the subscription from a bounded window to the entire topic
 * (plan §4 CORRECTED, measured: 2/s -> 2550/s). Declared here (not in
 * `@amps-ui/grid-viewport`, which never learns topic-specific field names)
 * and passed into `translateSortModel({ mode: 'server', nonStreamableFields })`.
 */
export const NON_STREAMABLE_SORT_FIELDS: ReadonlySet<string> = new Set(['lastUpdated', 'tickSeq']);
