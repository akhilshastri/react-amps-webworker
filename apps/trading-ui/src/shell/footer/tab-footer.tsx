// Per-tab footer (plan §5: "Footer row count per tab is sourced from that
// tab's own `stats` / `rows.count` events ... shows: snapshot progress
// while loading, updates/sec, and the age of the last tick, so that a
// legitimately quiet narrow filter reads as 'idle, expected' rather than
// 'broken'"). Presentational only -- takes a `SubscriptionStats` snapshot
// and renders it; the mock generator lives in `use-mock-subscription-stats.ts`
// so M4 can swap the source without touching this component.
import { Badge, Separator, Tooltip, TooltipContent, TooltipTrigger } from '@amps-ui/ui';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import type { SubscriptionStats } from './subscription-stats';

// Demo threshold so "idle is expected" is reachable in a manual QA pass --
// plan §5's real number is "about once every 10 minutes" per row.
const IDLE_THRESHOLD_MS = 15_000;

function formatCount(n: number): string {
  return n.toLocaleString();
}

function formatAgo(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s ago`;
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes}m ${totalSeconds % 60}s ago`;
}

function FooterBar({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-7 shrink-0 items-center gap-2 border-t bg-muted/40 px-2 text-xs text-muted-foreground">
      {children}
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
      <FooterBar>
        <Badge variant="secondary">Loading</Badge>
        <span>{formatCount(stats.received)} rows received</span>
      </FooterBar>
    );
  }

  const idleMs = stats.lastTickAt === null ? null : now - stats.lastTickAt;
  const isIdleExpected = idleMs !== null && idleMs > IDLE_THRESHOLD_MS;

  return (
    <FooterBar>
      <span>
        {stats.rowCount === undefined ? '? rows' : `${formatCount(stats.rowCount)} rows`}
        {stats.loadedWindow &&
          ` · window ${formatCount(stats.loadedWindow[0])}–${formatCount(stats.loadedWindow[1])} loaded`}
      </span>
      <Separator orientation="vertical" className="h-3" />
      <span>{stats.updatesPerSec}/s</span>
      <Separator orientation="vertical" className="h-3" />
      {idleMs === null ? (
        <span>no ticks yet</span>
      ) : isIdleExpected ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline">idle {formatAgo(idleMs)}</Badge>
          </TooltipTrigger>
          <TooltipContent>
            Idle is expected here -- a given row ticks only about once every 10 minutes.
          </TooltipContent>
        </Tooltip>
      ) : (
        <span>last tick {formatAgo(idleMs)}</span>
      )}
    </FooterBar>
  );
}
