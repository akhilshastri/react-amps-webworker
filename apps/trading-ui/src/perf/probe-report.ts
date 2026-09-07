// Pure formatting for `ProbeResult` (`run-probe.ts`) into a human-readable
// summary -- used by `perf-page.tsx` to render the on-page results panel and
// to produce the table pasted into `plan/notes/M6-measurements.md`. Kept
// separate from the page component so the formatting logic is `bun test`-able
// without a DOM (`probe-report.test.ts`).
import type { ProbeResult } from './run-probe';

const round = (n: number, digits = 1): number => Number(n.toFixed(digits));

/** One flattened, display-ready row per `ProbeResult` -- every field already rounded/labeled for direct use in a markdown or on-page table. */
export interface ReportRow {
  readonly targetRows: string;
  readonly actualRows: string;
  readonly orderCount: number;
  readonly batchSize: number;
  readonly openToFirstProgressMs: string;
  readonly openToFirstResetMs: string;
  readonly openToGroupEndMs: string;
  readonly workerReportedElapsedMs: string;
  readonly heapAfterSnapshotMB: string;
  readonly heapAfterScrollMB: string;
  readonly frameP50Ms: string;
  readonly frameP95Ms: string;
  readonly frameMeanMs: string;
  readonly frameMaxMs: string;
  readonly framesOver33ms: string;
  readonly framesOver50ms: string;
  readonly scrollMsgsPerSec: string;
  readonly scrollRowsPerSec: string;
  readonly scrollBytesPerSec: string;
}

const na = (v: number | undefined, digits = 0): string =>
  v === undefined ? 'n/a' : String(round(v, digits));

export function toReportRow(result: ProbeResult): ReportRow {
  return {
    targetRows: result.targetRows.toLocaleString(),
    actualRows: result.actualRows.toLocaleString(),
    orderCount: result.orderCount,
    batchSize: result.batchSize,
    openToFirstProgressMs: na(result.timings.openToFirstProgressMs),
    openToFirstResetMs: na(result.timings.openToFirstResetMs),
    openToGroupEndMs: na(result.timings.openToGroupEndMs),
    workerReportedElapsedMs: na(result.timings.workerReportedElapsedMs),
    heapAfterSnapshotMB: result.heapAfterSnapshot
      ? String(round(result.heapAfterSnapshot.usedJSHeapSizeMB))
      : 'n/a',
    heapAfterScrollMB: result.heapAfterScroll
      ? String(round(result.heapAfterScroll.usedJSHeapSizeMB))
      : 'n/a',
    frameP50Ms: String(round(result.frameTiming.p50, 2)),
    frameP95Ms: String(round(result.frameTiming.p95, 2)),
    frameMeanMs: String(round(result.frameTiming.mean, 2)),
    frameMaxMs: String(round(result.frameTiming.max, 2)),
    framesOver33ms: `${result.framesOver33ms} / ${result.totalFrames}`,
    framesOver50ms: `${result.framesOver50ms} / ${result.totalFrames}`,
    scrollMsgsPerSec: String(round(result.scrollPhaseRates.messagesPerSec, 2)),
    scrollRowsPerSec: String(round(result.scrollPhaseRates.rowsPerSec, 2)),
    scrollBytesPerSec: String(round(result.scrollPhaseRates.bytesPerSec, 0)),
  };
}

const COLUMNS: ReadonlyArray<{ readonly header: string; readonly key: keyof ReportRow }> = [
  { header: 'target', key: 'targetRows' },
  { header: 'actual rows', key: 'actualRows' },
  { header: 'orders', key: 'orderCount' },
  { header: 'batchSize', key: 'batchSize' },
  { header: 'open->progress ms', key: 'openToFirstProgressMs' },
  { header: 'open->first row ms', key: 'openToFirstResetMs' },
  { header: 'open->group_end ms', key: 'openToGroupEndMs' },
  { header: 'worker elapsed ms', key: 'workerReportedElapsedMs' },
  { header: 'heap after snapshot MB', key: 'heapAfterSnapshotMB' },
  { header: 'heap after scroll MB', key: 'heapAfterScrollMB' },
  { header: 'frame p50 ms', key: 'frameP50Ms' },
  { header: 'frame p95 ms', key: 'frameP95Ms' },
  { header: 'frame mean ms', key: 'frameMeanMs' },
  { header: 'frame max ms', key: 'frameMaxMs' },
  { header: 'frames >33ms', key: 'framesOver33ms' },
  { header: 'frames >50ms', key: 'framesOver50ms' },
  { header: 'scroll msgs/s', key: 'scrollMsgsPerSec' },
  { header: 'scroll rows/s', key: 'scrollRowsPerSec' },
  { header: 'scroll bytes/s', key: 'scrollBytesPerSec' },
];

/** Renders every result as one GitHub-flavored markdown table, ready to paste into `plan/notes/M6-measurements.md`. */
export function formatMarkdownTable(results: readonly ProbeResult[]): string {
  const rows = results.map(toReportRow);
  const header = `| ${COLUMNS.map((c) => c.header).join(' | ')} |`;
  const divider = `|${COLUMNS.map(() => '---').join('|')}|`;
  const body = rows.map((row) => `| ${COLUMNS.map((c) => row[c.key]).join(' | ')} |`);
  return [header, divider, ...body].join('\n');
}
