# M5 finding: live `oof` for a content-filter mismatch could not be reproduced

Plan §6 asks M5 to verify that `oof` fires when a live `order_details` row
ticks out of a narrow filter (CLIENT.md's own documented example: a
`/markPrice` range filter), with an explicit fallback: "If this proves
flaky in practice, downgrade to a manual check and say so — do not chase
it." This note is that downgrade.

## What was tried (against the live instance, no server restarts)

1. **Probabilistic `/markPrice` range filter**, CLIENT.md's own worked
   example. Picked the order with the largest `childCount` (`ORD-000426`,
   9,968 rows), snapshotted its current `markPrice` distribution (bounded by
   `/orderId = '...'`, never an unfiltered `order_details` query), and
   subscribed again with a band around the median (~250–1,100 matching rows
   depending on band width). Ran for 10s, 10s, then 90s. Confirmed via a
   side probe that ~150–170 real ticks/10s were landing on this order's rows
   (matching CLIENT.md's ~16.7 updates/sec figure for this specific order,
   and the ~2,500/s topic-wide rate) and that tick magnitudes were tiny
   (median ~0.0004, max observed ~0.0014, against a price around 0.78) — so
   even a modest band should see occasional edge crossings. **Zero `oof` in
   ~110 cumulative seconds.**

2. **Deterministic `/tickSeq < K` filter.** `tickSeq` increments by exactly
   1 on every single update (CLIENT.md), so this removes the probabilistic
   element entirely: pick `K` one above the most common current `tickSeq`
   value so thousands of rows sit exactly at the boundary, and ANY one of
   their next ticks is guaranteed to violate the filter. Ran for 15s and
   40s, via both `sow_and_delta_subscribe` and `sow_and_subscribe`. Live
   `p`/`publish` messages kept arriving throughout (140+ in the 40s run),
   but every single one of them had `tickSeq` still below `K` — i.e. this
   approach never even reproduced the violating precondition, which is
   itself informative (see below).

## What this suggests

Combined with M3A/M4's earlier measurement (carry-forward C5: AMPS **never**
sends `oof` for a row displaced out of a paginated `top_n` window — only for
a genuine filter mismatch, per CLIENT.md), this instance appears not to emit
`oof` for a live content-filter mismatch on `order_details` under load
either, at least not observably from this JS client across ~3 cumulative
minutes of live probing with two independent methods. That contradicts
CLIENT.md's explicit documented example. Two hypotheses, neither confirmed
(no access to server-side config/logs, and per the task's constraints this
agent must not touch or restart the AMPS server to investigate further):

- Content-filter re-evaluation may not run against `delta_publish`-updated
  fields for this topic/instance configuration.
- Some instance-level setting suppresses `oof` delivery specifically (only
  a hypothesis — the paginated-window case (C5) is a documented AMPS
  behavior, not a config issue, so this would be a separate, instance-level
  cause).

## What this means for the app

Client-side handling of `oof` (`packages/data-worker/src/runtime.ts`'s
`onOof`, `onRowLeavesView`) is implemented correctly per CLIENT.md's
documented contract and is unit-tested (`runtime.test.ts`) against a
synthetic `oof` message, so the code path itself is not in question — this
finding is about whether the LIVE instance ever actually emits one for this
app's traffic pattern. Practically, this means the app cannot rely on `oof`
firing for column-level filters pushed to AMPS in this environment; the
already-implemented client-side `top_n` trim (C5) remains the load-bearing
mechanism for bounding a live subscription, exactly as the corrected plan
§4 already concluded for the window-displacement case.

## What's committed

`packages/amps-client/integration/live-oof-filter-mismatch.integration.test.ts`
asserts what WAS verified (the content filter correctly bounds the
snapshot to the expected subset) and reports whether an `oof` showed up
during that specific run via `console.warn` rather than a hard failure, so
the suite doesn't go permanently red over an instance-level behavior this
agent cannot fix or further diagnose without restarting the server.
