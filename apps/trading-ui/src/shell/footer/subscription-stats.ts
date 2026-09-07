// The shape a per-tab footer needs, independent of where it comes from
// (plan §5: "sourced from that tab's own `stats` / `rows.count` events ...
// The footer also shows: snapshot progress while loading, updates/sec, and
// the age of the last tick"). M3B fed this from a mock generator; M4b's
// `use-subscription-stats.ts` feeds it from the real
// `stats`/`snapshot.progress`/`snapshot.complete` worker events
// (`@amps-ui/protocol`) without `<TabFooter>` itself changing.
export type SubscriptionPhase = 'connecting' | 'snapshot' | 'live';

export interface SubscriptionStats {
  readonly phase: SubscriptionPhase;
  /** Rows received so far. A running count toward `rowCount` while `snapshot`; the loaded count once `live`. */
  readonly received: number;
  /**
   * The true total (plan §4: `sum(childCount)` for a details subscription --
   * exact and independent of what's loaded -- NOT `sow.json`, plan §5).
   * `undefined` until known.
   */
  readonly rowCount: number | undefined;
  /**
   * `[start, end)` of the currently loaded server-side window, when the
   * subscription is a bounded window over a larger true total (plan §4's
   * AMPS-paginated window). `null` when the subscription has loaded
   * everything (e.g. the 1,000-row orders grid), so a partial view is never
   * mistaken for the whole set (plan §4/§5).
   */
  readonly loadedWindow: readonly [start: number, end: number] | null;
  readonly updatesPerSec: number;
  readonly lastTickAt: number | null;
}
