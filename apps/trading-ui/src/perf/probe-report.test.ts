import { describe, expect, test } from 'bun:test';
import { EMPTY_PATCH_STATS, computeRates } from './metrics/patch-tracker';
import { formatMarkdownTable, toReportRow } from './probe-report';
import type { ProbeResult } from './run-probe';

function makeResult(overrides: Partial<ProbeResult> = {}): ProbeResult {
  return {
    targetRows: 1_000,
    actualRows: 987,
    orderCount: 3,
    batchSize: 2_000,
    timings: {
      openToFirstProgressMs: 12.3,
      openToFirstResetMs: 45.6,
      openToGroupEndMs: 45.6,
      workerReportedElapsedMs: 30,
    },
    heapAfterSnapshot: { usedJSHeapSizeMB: 50.2, totalJSHeapSizeMB: 80, jsHeapSizeLimitMB: 4096 },
    heapAfterScroll: { usedJSHeapSizeMB: 52.7, totalJSHeapSizeMB: 80, jsHeapSizeLimitMB: 4096 },
    frameTiming: { count: 480, mean: 16.8, p50: 16.6, p95: 20.1, max: 40 },
    framesOver33ms: 2,
    framesOver50ms: 0,
    totalFrames: 480,
    loadPhaseStats: EMPTY_PATCH_STATS,
    scrollPhaseStats: EMPTY_PATCH_STATS,
    scrollPhaseRates: computeRates(EMPTY_PATCH_STATS),
    ...overrides,
  };
}

describe('toReportRow', () => {
  test('formats timings and heap with rounding, and "n/a" for missing values', () => {
    const row = toReportRow(
      makeResult({
        timings: {
          openToFirstProgressMs: undefined,
          openToFirstResetMs: 45.6,
          openToGroupEndMs: 45.6,
          workerReportedElapsedMs: 30,
        },
      }),
    );
    expect(row.openToFirstProgressMs).toBe('n/a');
    expect(row.openToFirstResetMs).toBe('46'); // rounded to 0 digits
    expect(row.targetRows).toBe('1,000');
    expect(row.heapAfterSnapshotMB).toBe('50.2');
  });

  test('formats frame stats to 2 decimal places', () => {
    const row = toReportRow(makeResult());
    expect(row.frameP50Ms).toBe('16.6');
    expect(row.frameP95Ms).toBe('20.1');
  });

  test('missing heap reading formats as "n/a"', () => {
    const row = toReportRow(
      makeResult({ heapAfterSnapshot: undefined, heapAfterScroll: undefined }),
    );
    expect(row.heapAfterSnapshotMB).toBe('n/a');
    expect(row.heapAfterScrollMB).toBe('n/a');
  });
});

describe('formatMarkdownTable', () => {
  test('renders a header, divider, and one row per result', () => {
    const table = formatMarkdownTable([makeResult(), makeResult({ targetRows: 10_000 })]);
    const lines = table.split('\n');
    expect(lines[0]).toContain('target');
    expect(lines[1]).toMatch(/^\|(---\|)+$/);
    expect(lines.length).toBe(4); // header + divider + 2 rows
    expect(lines[2]).toContain('1,000');
    expect(lines[3]).toContain('10,000');
  });
});
