// Shared percentile math for the `/perf` probe's reporting (plan §6: "report
// p50 and p95, not just a mean" for frame timing; also used for patch-size
// distributions). Pure, no DOM/timers -- kept separate from `frame-sampler.ts`
// and `patch-tracker.ts` so both can share one tested implementation instead
// of each hand-rolling a sort-and-index.
export interface Distribution {
  readonly count: number;
  readonly mean: number;
  readonly p50: number;
  readonly p95: number;
  readonly max: number;
}

const EMPTY_DISTRIBUTION: Distribution = { count: 0, mean: 0, p50: 0, p95: 0, max: 0 };

/** Nearest-rank percentile (0-100) over an already-sorted (ascending) array -- shared by `percentile` and `summarize` so a caller that's already sorted the data (`summarize`) never pays for a second sort. */
function percentileFromSorted(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length) - 1;
  const index = Math.min(sorted.length - 1, Math.max(0, rank));
  return sorted[index] ?? 0;
}

/** Nearest-rank percentile (0-100) over `values`. `values` need not be pre-sorted. */
export function percentile(values: readonly number[], p: number): number {
  return percentileFromSorted(
    [...values].sort((a, b) => a - b),
    p,
  );
}

/** Summarizes `values` as count/mean/p50/p95/max in one pass over a sorted copy. */
export function summarize(values: readonly number[]): Distribution {
  if (values.length === 0) return EMPTY_DISTRIBUTION;
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  return {
    count: sorted.length,
    mean: sum / sorted.length,
    p50: percentileFromSorted(sorted, 50),
    p95: percentileFromSorted(sorted, 95),
    max: sorted[sorted.length - 1] ?? 0,
  };
}
