// Per-tab footer (plan §5: "Footer row count per tab is sourced from that
// tab's own `stats` / `rows.count` events ... shows: snapshot progress
// while loading, updates/sec, and the age of the last tick, so that a
// legitimately quiet narrow filter reads as 'idle, expected' rather than
// 'broken'"). Presentational only -- takes a `SubscriptionStats` snapshot
// and renders it; the real source lives in `use-subscription-stats.ts`
// (M4b swapped in M3B's mock generator here without touching this file).
//
// M7 (design spec §6/§8.3) visual refresh, same information hierarchy:
//  - "rows" (the true total) is `font-medium text-foreground`; "window
//    ...loaded" is `text-muted-foreground` -- a WEIGHT distinction, not
//    colour, so it survives colourblind rendering, per the design spec's
//    own framing of why this must stay legible.
//  - A tooltip on the row-count segment when the true total exceeds the
//    loaded window, turning the footer's own numbers into an explanation
//    (§8.3) rather than requiring the trader to infer what "window" means.
//  - The idle badge's copy changes from "idle Xs ago" to "quiet · Xs" --
//    "idle" reads as a fault state, "quiet" matches the tooltip's own
//    framing that this is expected.
//  - A progress sweep along the footer's full width while a snapshot is
//    loading: determinate (`received / rowCount`) when the true total is
//    already known (the details grid's `rowCountHint`, plan §4), else the
//    indeterminate CSS sweep (`@amps-ui/ui`'s `index.css`) for the orders
//    grid's own snapshot, where no such hint exists.
import { Badge, Separator, Tooltip, TooltipContent, TooltipTrigger } from '@amps-ui/ui';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import type { SubscriptionStats } from './subscription-stats';

// Demo threshold so "quiet is expected" is reachable in a manual QA pass --
// plan §5's real number is "about once every 10 minutes" per row.
const IDLE_THRESHOLD_MS = 15_000;

function formatCount(n: number): string {
  return n.toLocaleString();
}

function formatAgo(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}m ${totalSeconds % 60}s`;
}

function FooterBar({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-7 shrink-0 items-center gap-2 border-t bg-muted/40 px-2 text-xs text-muted-foreground">
      {children}
    </div>
  );
}

/** The snapshot-loading progress sweep (§6/§8.2) -- determinate once a true total is known, indeterminate otherwise. */
function SnapshotProgressBar({ received, total }: { received: number; total: number | undefined }) {
  if (total === undefined || total <= 0) {
    return <div className="snapshot-progress-bar" />;
  }
  const pct = Math.min(100, (received / total) * 100);
  return (
    <div className="h-0.5 w-full bg-muted">
      <div
        className="h-full bg-[var(--status-partial-text)] transition-[width]"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function TabFooter({ stats }: { stats: SubscriptionStats }) {
  // Re-render once a second purely to keep "time since last tick" fresh --
  // `stats` itself doesn't change between ticks.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (stats.phase === 'connecting') {
    return <FooterBar>Connecting…</FooterBar>;
  }

  if (stats.phase === 'snapshot') {
    return (
      <div>
        <FooterBar>
          <Badge variant="secondary">Loading</Badge>
          <span>{formatCount(stats.received)} rows received</span>
        </FooterBar>
        <SnapshotProgressBar received={stats.received} total={stats.rowCount} />
      </div>
    );
  }

  const idleMs = stats.lastTickAt === null ? null : now - stats.lastTickAt;
  const isIdleExpected = idleMs !== null && idleMs > IDLE_THRESHOLD_MS;
  const isPartialWindow =
    stats.loadedWindow !== null && (stats.rowCount ?? 0) > stats.loadedWindow[1];

  const rowsSegment = (
    <span>
      <span className="font-medium text-foreground">
        {stats.rowCount === undefined ? '? rows' : `${formatCount(stats.rowCount)} rows`}
      </span>
      {stats.loadedWindow && (
        <span className="text-muted-foreground">
          {' '}
          · window {formatCount(stats.loadedWindow[0])}–{formatCount(stats.loadedWindow[1])} loaded
        </span>
      )}
    </span>
  );

  return (
    <FooterBar>
      {isPartialWindow && stats.loadedWindow ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-help">{rowsSegment}</span>
          </TooltipTrigger>
          <TooltipContent>
            Showing rows {formatCount(stats.loadedWindow[0])}–{formatCount(stats.loadedWindow[1])}{' '}
            of {formatCount(stats.rowCount ?? 0)}. Scroll to load more.
          </TooltipContent>
        </Tooltip>
      ) : (
        rowsSegment
      )}
      <Separator orientation="vertical" className="h-3" />
      <span>{stats.updatesPerSec}/s</span>
      <Separator orientation="vertical" className="h-3" />
      {idleMs === null ? (
        <span>no ticks yet</span>
      ) : isIdleExpected ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline">quiet · {formatAgo(idleMs)}</Badge>
          </TooltipTrigger>
          <TooltipContent>
            Idle is expected here -- a given row ticks only about once every 10 minutes.
          </TooltipContent>
        </Tooltip>
      ) : (
        <span>last tick {formatAgo(idleMs)} ago</span>
      )}
    </FooterBar>
  );
}
