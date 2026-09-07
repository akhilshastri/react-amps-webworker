// `performance.memory` reader (plan §6: "JS heap after snapshot"). Chrome-
// only, non-standard API -- not in the TS DOM lib types, so this is typed by
// hand and returns `undefined` on any browser lacking it (the probe is
// Chromium-only per plan §2 "dev-only target: modern Chromium", but this
// still degrades honestly rather than throwing if run somewhere else).
export interface HeapSnapshot {
  readonly usedJSHeapSizeMB: number;
  readonly totalJSHeapSizeMB: number;
  readonly jsHeapSizeLimitMB: number;
}

interface PerformanceMemory {
  readonly usedJSHeapSize: number;
  readonly totalJSHeapSize: number;
  readonly jsHeapSizeLimit: number;
}

const BYTES_PER_MB = 1024 * 1024;

export function readHeapSnapshot(): HeapSnapshot | undefined {
  const memory = (performance as Performance & { memory?: PerformanceMemory }).memory;
  if (!memory) return undefined;
  return {
    usedJSHeapSizeMB: memory.usedJSHeapSize / BYTES_PER_MB,
    totalJSHeapSizeMB: memory.totalJSHeapSize / BYTES_PER_MB,
    jsHeapSizeLimitMB: memory.jsHeapSizeLimit / BYTES_PER_MB,
  };
}
