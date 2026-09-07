// Delta merge -- the single most important correctness rule for
// `order_details` (CLIENT.md, plan §3): a `p`/`publish` message on a
// `sow_and_delta_subscribe` carries only the fields that changed (the
// spike observed both 7-field and 6-field deltas -- never assume which
// fields are present, and never index by position; field order is not
// stable). Merging with `Object.assign` preserves whatever the delta
// didn't mention; replacing the stored record with the delta would blank
// out the 17 static fields (`venue`, `execId`, `lastPx`, ...).
//
// This mutates and returns `existing` -- callers (data-worker) hold the
// row by reference in `viewport-core`'s `RowStore`, so no re-`set()` is
// needed after merging.
import type { RowData } from '@amps-ui/protocol';

export function mergeDelta(existing: RowData, patch: RowData): RowData {
  return Object.assign(existing, patch);
}
