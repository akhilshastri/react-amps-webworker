// Tunable constants for the `/perf` probe (plan §6/M6: "roughly 1k/10k/100k
// rows"). Kept in one place so a re-run at different sizes/durations is a
// one-line edit, not a hunt through `run-probe.ts`.
//
// This module owns nothing outside `apps/trading-ui/src/perf/**` (M6 task
// scope) -- it deliberately imports the *production* tuning constants from
// `@amps-ui/feature-order-details` (batchSize, default orderBy) rather than
// inventing probe-only values, so what gets measured here is the pipeline
// as configured for real users, not a hypothetical one.
export const PERF_TARGET_ROWS = [1_000, 10_000, 100_000] as const;
export type PerfTargetRows = (typeof PERF_TARGET_ROWS)[number];

/** How long the scripted scroll runs per target size, sampling frame deltas throughout (plan §6: "frame time during sustained scroll"). */
export const SCROLL_DURATION_MS = 8_000;

/** Ceiling for `sub.open` -> `snapshot.complete`; the 100k case is expected to take longest. */
export const SNAPSHOT_TIMEOUT_MS = 30_000;

/** Hardcoded per plan §1 assumptions ("Single AMPS instance ... hardcoded in an env var"), matching `m2-slice.tsx`/`shell.tsx`. */
export const AMPS_URI = 'ws://localhost:9018/amps/json';

/** A row height wide enough to reliably identify `.ag-row` elements while scrolling; not load-bearing, just makes the sweep math legible. */
export const ROW_HEIGHT_PX_ESTIMATE = 28;
