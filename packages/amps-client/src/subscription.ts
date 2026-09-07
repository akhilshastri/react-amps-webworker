// Types for the amps-client <-> data-worker boundary (inside the worker,
// NOT the frozen main<->worker protocol -- that lives in `@amps-ui/protocol`
// and is untouched by this file). data-worker calls `AmpsConnection.
// openSubscription` with a `SubscriptionSpec` and a `SubscriptionSink`; this
// keeps `connection.ts` ignorant of epochs, dirty sets, and sort indices --
// those are `viewport-core` / `data-worker` concerns.
import type { RowData, SubMode } from '@amps-ui/protocol';

/**
 * AMPS-side pagination window (`options('top_n=W,skip_n=S')`, plan §3/§4).
 * `Command` has no `skipN()` and `topN()` is deprecated in favor of this
 * free-form options string. M2 never sets this (no pagination); it exists
 * now so M4's repaging doesn't require touching this file.
 */
export interface SubscriptionWindow {
  readonly topN: number;
  readonly skipN: number;
}

/** What to subscribe to. `batchSize` is required on purpose -- the amps client's default is 10. */
export interface SubscriptionSpec {
  readonly topic: string;
  readonly mode: SubMode;
  readonly filter?: string;
  readonly orderBy?: string;
  readonly batchSize: number;
  readonly keyField: string;
  readonly window?: SubscriptionWindow;
}

/**
 * Callbacks `AmpsConnection.openSubscription` drives as AMPS messages
 * arrive, branching on `message.header.command()` per CLIENT.md / plan §3.
 * `onDelta` hands back the RAW partial fields from a `p`/`publish` message
 * -- merging (`mergeDelta`, see delta.ts) is the caller's job, since the
 * caller (data-worker) is the one holding the existing row in `RowStore`.
 */
export interface SubscriptionSink {
  /** `group_begin` -- a (re)snapshot is starting. */
  onSnapshotBegin?(): void;
  /** `sow` -- one full record from the snapshot. */
  onSowRow(key: string, row: RowData): void;
  /** `group_end` -- snapshot complete. This is the only "loaded" signal. */
  onSnapshotComplete(rowCount: number, elapsedMs: number): void;
  /** `p` / `publish` -- a partial delta. Caller must merge, never replace. */
  onDelta(key: string, patch: RowData): void;
  /** `oof` -- the row no longer matches the filter. */
  onOof(key: string): void;
}
