# M6 — Performance pass: measurements

Method: measure first, then tune (plan §6/§7 M6). All numbers below come from the
`/perf` probe (`apps/trading-ui/src/perf/**`) driven against the **live** AMPS
instance (1,493,999 `order_details` rows, ticking at the rate reported by
`sow.json` at measurement time, ~2,200-2,500 upd/s) through a real Chromium
browser — no synthetic/mocked timing anywhere in this document.

## Environment

| item | value |
|---|---|
| browser | `Chrome/152.0.7977.65` (Windows, headless), driven from WSL via the `wsl-chrome-debugging` skill (CDP over a PowerShell TCP relay) |
| viewport | 1700×1000 |
| app | `bun run dev` (Vite dev server), `http://localhost:5173/?perf` |
| AMPS | live instance, `ws://localhost:9018/amps/json`, shared with concurrent M5 work — not restarted |
| dataset | `orders` = 1,000 rows; `order_details` = 1,493,999 rows |
| measurement technique | in-page `requestAnimationFrame` deltas for frame timing (not CDP `Performance` domain — see Methodology notes), `performance.memory` for heap, `WorkerEvent` interception for patch/reset traffic |

## Method

For each target size, `pickOrdersForTarget` (`order-picker.ts`) greedily selects
the fewest largest `orders` whose `childCount` sums to (never over) the target,
then `run-probe.ts`:

1. Opens `order_details` with `sub.open`'s `window: { topN: actualSum, skipN: 0 }`
   — i.e. the **entire** selection loads in one AMPS-paginated window, not the
   production `WINDOW_ROWS` (2,000) with repaging. This isolates "how does the
   pipeline perform once N rows are loaded and rendering" from "how does
   repaging while scrolling past a smaller window perform" (M4's concern,
   not re-tested here — see Gaps).
2. Times `sub.open` → first `snapshot.progress` → first non-empty `rows.reset`
   → `snapshot.complete`.
3. Reads `performance.memory` (main thread) immediately after the snapshot.
4. Runs an 8-second scripted scroll (`scroll-driver.ts`: a triangle-wave sweep
   of the grid's real scrollable element, driven by setting `scrollTop` on
   every `requestAnimationFrame`, which fires the same native `scroll` event
   AG Grid's Viewport row model listens to — genuinely exercises the same
   code path a mouse-wheel fling would), sampling the gap between consecutive
   `requestAnimationFrame` callbacks throughout.
5. Reads `performance.memory` again after the scroll, and reports patch/reset
   message counts, row counts, and byte sizes (`JSON.stringify(...).length`
   as a wire-size proxy) separately for the load phase and the scroll phase.

Default sort is `/detailId ASC` (the plan's documented safe/bounded key —
CORRECTED §4: `lastUpdated`/`tickSeq` are the ones that degenerate a
paginated subscription to the full topic rate; `detailId` is static and
stays bounded). Every run below uses this default; **the plan's
`lastUpdated`/`tickSeq` streaming hazard was not re-tested here** since M3A
already measured it directly (plan §4 table) and nothing in this milestone's
scope touches sort translation.

## Headline table (production `DETAILS_BATCH_SIZE` = 2,000)

| target | actual rows | orders in filter | open→progress ms | open→first row ms | open→group_end ms | worker elapsedMs | heap after snapshot MB | heap after scroll MB | frame p50 ms | frame p95 ms | frame mean ms | frame max ms | frames >33ms | frames >50ms | scroll msgs/s | scroll rows/s | scroll bytes/s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1,000 | 999 | 1 | 132 | 310 | 312 | 255 | 27.8 | 31.8 | 16.7 | 16.8 | 17.61 | 366.7 | 3/455 | 3/455 | 2000.0† | 57000† | 26,983,000† |
| 10,000 | 10,000 | 2 | 187 | 2,379 | 2,380 | 2,320 | 36.9 | 32.0 | 16.7 | 16.7 | 17.86 | 449.9 | 3/448 | 3/448 | 0.93 | 26.4 | 12,160 |
| 100,000 | 99,999 | 11 | 230 | 19,377 | 19,378 | 19,254 | 25.8 | 32.7 | 16.7 | 16.8 | 19.19 | 833.3 | 5/417 | 4/417 | 13.11 | 253.5 | 118,960 |

† The 1,000-row scroll-phase rate is an artifact of the rate formula
(`messages / (lastMessageAt - firstMessageAt)`): with only 2 messages 0.5ms
apart, the tiny observed span inflates the rate to a meaningless number. See
"Rate anomaly" under Methodology notes — don't read this cell as "the
pipeline emits 2000 msg/s at 1k rows," it emits 2 messages total in 8s, same
order of magnitude as the other two rows.

Raw JSON (`ProbeResult[]`, includes `loadPhaseStats`/`scrollPhaseStats`
verbatim) is in this session's scratch output; the table above is the
`formatMarkdownTable` (`probe-report.ts`) rendering of the same data the page
itself displayed and wrote to `window.__PERF_RESULTS__`.

## batchSize A/B (100k target only)

| batchSize | open→group_end ms | worker elapsedMs |
|---|---|---|
| 2,000 (production) | 19,378 | 19,254 |
| 20,000 (10x) | 18,250 | 18,105 |

A 10x increase in `batchSize` bought ~6% — noise-level for a single run each,
not a real lever at this scale. See recommendation below.

## Does a ~100k-row details subscription scroll at 60fps while ticking?

**Yes, for the rendering/scroll path — but the honest answer has two halves,
and the plan's phrasing conflates them.**

- **Once loaded and scrolling, yes, cleanly.** Frame time p50/p95 sit at
  16.7-16.8ms (exactly one frame at 60Hz) at **all three sizes including
  100k**, with mean only slightly above that (17.6-19.2ms) and just 4-5
  frames out of ~420-455 exceeding 50ms per run — all of them explained by a
  single large outlier per run (367ms / 450ms / 833ms), which is almost
  certainly the AG Grid instance's own first-mount/layout cost landing inside
  the sampled window (the scroll starts measuring the instant the grid's
  scroll element appears in the DOM), not sustained scroll jank. There is no
  evidence in this data of the frame rate degrading as row count grows from
  1k to 100k — the scroll/render/tick-apply path scales flat.
- **Getting to that state takes ~19.4 seconds at 100k rows, and this
  contradicts the plan's own extrapolation.** Plan §4 cites a spike of
  "20,000 rows in 478ms" (~42,000 rows/sec). This session's measurement of a
  *filtered* multi-order snapshot (the actual query `buildDetailsFilter`
  issues for a real selection, not an unfiltered/simple `top_n` scan) shows
  a consistent **~0.19-0.26ms per row** across all three sizes (255ms/999,
  2,320ms/10,000, 19,254ms/99,999 rows) — effective throughput of roughly
  **4,000-5,200 rows/sec**, an order of magnitude below the plan's cited
  number. Two things this measurement rules out as the cause: (1) client
  batching — the batchSize A/B above shows a 10x `batchSize` increase buys
  only ~6%; (2) worker/postMessage overhead — `workerReportedElapsedMs`
  (AMPS round-trip only, timed inside the worker) accounts for ~99% of the
  total `openToGroupEndMs`, so there is essentially no client-side tax on top
  of whatever AMPS itself takes. The remaining, most likely explanation is
  that evaluating an `/orderId IN (...)` content filter against 1.49M rows
  (this app's real filter shape for a multi-order selection) costs
  meaningfully more per matched row than whatever query shape the plan's
  spike used — **this is a finding to raise, not a client-side bug to chase**;
  nothing observed here points at a fix inside this codebase (see
  Recommendations).

So: **60fps-while-scrolling holds at 100k rows. "Load it in a snappy amount
of time" does not — a 100k-row window takes ~19 seconds to reach
`group_end`, not the sub-second the plan's earlier spike implied.**

## Recommendations

Everything below is **measured**, not intuited, and marked out where this
probe's data doesn't reach.

| constant | file | current | recommendation | justification |
|---|---|---|---|---|
| `DETAILS_BATCH_SIZE` | `packages/feature-order-details/src/constants.ts` | 2,000 | **No change.** | A/B'd directly (2,000 vs 20,000 at the 100k target): ~6% difference, within single-run noise. `workerReportedElapsedMs` shows the AMPS round trip itself is ~99% of total time regardless of batching — batchSize is not the lever for snapshot latency here. |
| `WINDOW_ROWS` | `packages/feature-order-details/src/constants.ts` | 2,000 | **No change (data supports keeping it, does not argue for raising it).** | Measured per-row snapshot cost (~0.2-0.26ms/row) is roughly constant across 1k/10k/100k, so it extrapolates linearly: loading exactly 2,000 rows should cost on the order of ~400-500ms, consistent with the plan's original sub-second expectation for a *bounded* window. Loading a much larger window up front (as this probe deliberately did, to isolate scroll performance) reproduces the ~19s stall above — i.e. the current bounded-window design is doing its job; the risk is real only if `WINDOW_ROWS` is ever raised without re-measuring. |
| `REPAGE_DEBOUNCE_MS` | `packages/data-worker/src/constants.ts` | 150 | **Not evaluated — gap, not a recommendation.** | This probe intentionally loads the *entire* target size in one window (see Method) specifically to avoid repaging, so it never exercised the repage path at all. Extrapolating from the per-row cost above, a repage of a 2,000-row window costs an estimated ~400-500ms itself, which stacked on a 150ms debounce means a scroll that crosses the loaded window's edge could show a visible ~550-650ms stall before the new page arrives — **not measured directly, worth a follow-up probe that scrolls a selection larger than `WINDOW_ROWS` and times the repage**, rather than tuning this number blind. |
| conflation interval (`FLUSH_INTERVAL_MS`) | `packages/data-worker/src/constants.ts` | 16ms | **No change — insufficient evidence either way.** | Scroll-phase patch traffic in every run was low (1-3 messages, 26-254 rows/sec) because each probe's subscription only had its own small overscan window ticking (CLIENT.md: ~1 tick per row per 10 minutes on average, and only rows inside the visible+overscan window are ever patched — plan §3 step 3), never the topic's full ~2,500 upd/s. Frame timing was already excellent (p50 16.7ms) under this load, so nothing here indicates the 16ms flush is a bottleneck, but this probe never stress-tested a selection ticking at a materially higher rate (e.g. a much wider visible window, or a live-sort-key scenario the plan already flags as unbounded) — a genuine gap, not a "verified fine at all rates" result. |
| overscan (`DEFAULT_OVERSCAN_ROWS`) | `packages/data-worker/src/constants.ts` | 20 rows | **No change — no evidence for or against.** | Not varied independently in this session; scroll performance was already at the 60fps ceiling with the current value, so there was no jank to diagnose that a larger/smaller overscan could plausibly fix. |

## Methodology notes / limitations (things this probe could not or did not measure)

- **Worker-side JS heap was not measurable.** `performance.memory` does not
  exist inside a dedicated Worker context in this Chrome build (verified
  directly: reading it from inside the data worker via Puppeteer's
  `WebWorker.evaluate()` returned `undefined`/`null`, while the same read on
  the main thread works normally). This matters because the actual
  `RowStore`/`SortIndex` for a windowed subscription — up to ~100,000 row
  objects for the largest target here — lives in the **worker**, not the
  main thread; every `heapAfterSnapshot`/`heapAfterScroll` number in the
  table above is the **main thread's** heap only, which stays essentially
  flat (26-37MB) across all three target sizes precisely *because* the
  Viewport row model only ever materializes the visible+overscan window
  (tens of rows) into main-thread JS objects, never the full selection. A
  reader should not conclude "100k rows only costs ~33MB" from this table —
  that number reflects what AG Grid rendered, not what the worker is
  holding. A rough lower-bound estimate from wire-size proxies (a
  `rows.reset` of ~120 rows serializes to ~56KB, i.e. ~470 bytes/row as
  JSON text) would put 100,000 row objects at very roughly 45-50MB of raw
  data before accounting for V8 object/hidden-class overhead — offered as
  an order-of-magnitude sanity check only, not a measurement.
- **Frame-timing methodology captures one grid-mount outlier per run.** The
  scroll sampler starts recording the instant the grid's scroll element
  appears in the DOM, so the single largest frame-delta outlier in every run
  (367-833ms) most likely reflects AG Grid's own first-layout cost, not
  scroll jank. A cleaner version of this probe would discard the first N
  frames before computing p95/max; not done here, so the `frames >33ms` /
  `frames >50ms` / `max` columns are very slightly pessimistic versus "pure
  steady-state scroll."
- **The 1,000-row row's scroll-phase rate numbers are a divide-by-tiny-span
  artifact**, not a real 2,000 msg/s rate — see the table footnote. The rate
  formula (`computeRates`, `patch-tracker.ts`) is deliberately "messages
  observed / the span between the first and last of them," which is correct
  when there are enough samples to define a meaningful span and misleading
  with only 2.
- **The repage path (`sub.window`, `REPAGE_DEBOUNCE_MS`, scrolling past a
  `WINDOW_ROWS`-sized window) was not exercised.** Every run here loads its
  entire target in one window by design (see Method) — this was the
  deliberate choice to cleanly separate "does rendering/ticking degrade with
  row count" from "does repaging on scroll degrade," but it means this
  session has no direct repage-latency or repage-frame-time data. Flagged
  above under `REPAGE_DEBOUNCE_MS`.
- **`lastUpdated`/`tickSeq` streaming degeneration (plan §4 CORRECTED) was
  not re-tested.** Every run used the safe default sort (`/detailId ASC`).
  M3A already measured the unbounded case directly (plan §4's table); this
  milestone's scope didn't call for re-verifying it.
- **One incidental fix needed before any measurement was possible:**
  `scroll-driver.ts` initially targeted `.ag-body-viewport` as AG Grid's
  scrollable element (the class name in older AG Grid majors, and the one
  named in early drafts of this comment). Live inspection of ag-grid-community
  36.1.0's actual rendered DOM (via `?m2`) showed this class does not exist
  in this version — the real scrolling content element is `.ag-grid-viewport`
  (confirmed by observing that setting its `scrollTop` moves rendered row
  content, and that it has `overflow-y: auto` with `scrollHeight` equal to
  the full row count's rendered height; `.ag-body-vertical-scroll-viewport`
  is a separate, synced scrollbar track, not the content). Corrected in
  `scroll-driver.ts`; no other file in this repo referenced the old class
  name.
- **A pre-existing, unrelated test failure was observed but not touched.**
  `packages/amps-client/integration/live-oof-filter-mismatch.integration.test.ts`
  (an M5 file, untracked at time of writing — not edited by this milestone)
  fails reproducibly (`oofKeys.length` expected `> 0`, got `0`) when run
  against the live instance during this session. This is exactly the kind
  of live-timing-dependent integration test the plan itself flags as
  possibly flaky ("If this proves flaky in practice, downgrade to a manual
  check and say so — do not chase it," plan §6) and is outside
  `apps/trading-ui/src/perf/**`, so it was left alone rather than risk
  colliding with M5's concurrent edits to `packages/amps-client`. All 197
  non-flaky unit/integration tests present before this milestone plus the
  29 new ones added here (`order-picker`, `percentile`, `patch-tracker`,
  `probe-report`) pass; `bun run typecheck` and `bunx biome check .` are
  clean except for this one pre-existing file.

## Files delivered (M6 scope: `apps/trading-ui/src/perf/**` + this file)

- `targets.ts` — probe constants (target sizes, scroll duration, timeouts).
- `order-picker.ts` (+ test) — pure greedy order selection for a target
  `childCount` sum.
- `percentile.ts` (+ test) — shared p50/p95/mean/max distribution math.
- `metrics/heap.ts` — `performance.memory` reader.
- `metrics/patch-tracker.ts` (+ test) — pure fold + rate calculation over
  `rows.patch`/`rows.reset` traffic.
- `scroll-driver.ts` — scripted scroll + rAF-delta sampling + AG Grid scroll
  element lookup.
- `run-probe.ts` — orchestrates one full run (open → load timing → scroll →
  heap → report).
- `probe-report.ts` (+ test) — pure formatting into the markdown table above.
- `perf-page.tsx` / `index.ts` — the `/perf` route itself (`App.tsx` routes
  `?perf` to it, mirroring the existing `?m2` pattern).

---

## CORRECTION — the load bottleneck is NOT AMPS-side filter evaluation

M6 attributed the ~19.4s/100k load to "AMPS-side filter evaluation cost", on the grounds that
`workerReportedElapsedMs` accounted for ~99% of wall time. **That inference does not hold.**
`workerReportedElapsedMs` is measured *inside the worker* and therefore includes the worker's own
`JSON.parse` (via the amps TypeHelper), `RowStore` Map insertion, sort-index maintenance and dirty
tracking. It separates worker from main thread — it does not separate AMPS from client.

Measured directly against the same live instance from Bun, issuing the **same IN-clause filter**
`buildDetailsFilter` produces (11 orders, 106,767 projected rows), 3 samples each:

| query | median | throughput |
|---|---|---|
| `IN (11 ids)`, `batchSize=2000` | 2,002ms | 53,330 rows/s |
| `IN (11 ids)`, `batchSize=20000` | **1,346ms** | **79,322 rows/s** |
| `/orderId = '...'` single, 9,968 rows | 752ms | 13,255 rows/s |
| **no filter at all**, `top_n=100000` | 4,908ms | 20,375 rows/s |

Two conclusions:

1. **AMPS delivers ~107k filtered rows in ~1.3s.** The browser path takes ~19.4s for 100k. So
   roughly **93% of the load time is client-side worker processing**, not the server. The
   unfiltered control is *slower* than the filtered query, which rules out filter evaluation as the
   cost — an IN-clause over 11 ids is cheap, and restricting the result set helps rather than hurts.
2. **The optimisation target is worker-side per-row cost** — TypeHelper `JSON.parse`, Map
   insertion, and index maintenance per message — not the AMPS query. That is also where the
   earlier discarded idea of overriding `TypeHelper.helper('json', ...)` would actually pay off, if
   this ever needs to be fast.

### Revised recommendation on `DETAILS_BATCH_SIZE`

M6 recommended no change. Measurement says otherwise, though it is a **minor** lever:

- `packages/feature-order-details/src/constants.ts` — `DETAILS_BATCH_SIZE`, currently `2_000`,
  should be `20_000`. Worth ~1.5x on the AMPS delivery leg (2,002ms → 1,346ms).

Being honest about its size: it improves the ~7% of load time that is AMPS, not the ~93% that is
client-side. It is worth taking because it is a one-constant change, but it will **not** make a
100k-row load feel fast. Do not expect the 19.4s to become 13s.

### Method note

M6's own single-sample caveat applies here too, and it bit: a first single-sample run of this same
probe showed `batchSize=2000` *faster* than `20000` — the reverse of the 3-sample median. Variance
between runs on this instance is large enough (1,128ms–2,356ms for identical queries) that
single-sample comparisons of anything under ~2x are not trustworthy.
