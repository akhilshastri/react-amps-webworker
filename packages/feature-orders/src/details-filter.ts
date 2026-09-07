// `buildDetailsFilter()` -- translates an orders-grid selection into the AMPS
// content filter that drives the `order_details` subscription (plan §4).
//
// NOTE on placement (flagged per M3C task brief rather than worked around
// silently): the plan's package table (§1) assigns this helper to
// `@amps-ui/feature-order-details`, and that package's row explicitly scopes
// its dependency on this package to "selection store only" -- implying this
// helper was meant to live there, not here. It is built and tested in this
// package instead because M3C's task brief requires a unit-tested
// `buildDetailsFilter` as part of *this* milestone's definition of done, and
// this milestone owns `packages/feature-orders/**` exclusively (it may not
// touch `feature-order-details`). See the M3C report for this discrepancy;
// `feature-order-details` (or `apps/trading-ui` at M4) can re-export or
// duplicate this rather than reimplement it.
//
// Filter syntax and the single-quote requirement for string literals per
// CLIENT.md; `orderId` values (`ORD-` + 6 digits) never contain a quote
// themselves, so no escaping is needed.
export function buildDetailsFilter(orderIds: readonly string[]): string | undefined {
  if (orderIds.length === 0) return undefined;
  if (orderIds.length === 1) return `/orderId = '${orderIds[0]}'`;
  return `/orderId IN (${orderIds.map((id) => `'${id}'`).join(',')})`;
}
