// Tunable constants for the worker-side pipeline (plan §3, §6 "M6 tunes
// these against measurements, not intuition" -- these are the M2 starting
// points, not final values).
export const FLUSH_INTERVAL_MS = 16; // no requestAnimationFrame in a dedicated worker -- a timer stands in for it.
export const SNAPSHOT_PROGRESS_THROTTLE_MS = 250; // <=4/sec per protocol.
export const STATS_INTERVAL_MS = 1_000; // <=1/sec per protocol.
export const DEFAULT_OVERSCAN_ROWS = 20;
export const DEFAULT_INITIAL_WINDOW_ROWS = 100; // assumed visible window before the first real sub.viewport arrives.
// Debounce before an out-of-window sub.viewport triggers an AMPS-side
// repage (plan §4/M4b: "~150ms debounce" -- a scroll fling must settle to
// one re-subscription, not one per intermediate scroll position).
export const REPAGE_DEBOUNCE_MS = 150;
