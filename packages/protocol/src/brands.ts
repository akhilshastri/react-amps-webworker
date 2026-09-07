// Branded primitive types for the main<->worker message contract.
// Plain `string`/`number` would let a raw subId leak in where an epoch is
// expected (and vice versa) with no compile-time signal. Branding closes
// that hole for free; the runtime value is still just a string/number.
//
// Consumed by every other file in this package (requests.ts, events.ts,
// epoch.ts) and by every package that speaks the worker protocol
// (amps-client, worker-client, viewport-core, data-worker, grid-viewport).

declare const brand: unique symbol;

/** Attaches a compile-time-only tag `B` to primitive type `T`. */
export type Brand<T, B extends string> = T & { readonly [brand]: B };

/** Identifies one logical subscription. Plan §5: `subId === instanceId` (the flexlayout tab's id). */
export type SubscriptionId = Brand<string, 'SubscriptionId'>;

/**
 * Monotonic per-subId version counter. Allocated on the main thread,
 * bumped on every `sub.open` and `sub.update` (plan §3). Both sides drop
 * any message stamped with an epoch lower than the current one for that
 * subId -- this is how a superseded snapshot is discarded.
 */
export type Epoch = Brand<number, 'Epoch'>;

export function toSubscriptionId(id: string): SubscriptionId {
  return id as SubscriptionId;
}

export function toEpoch(n: number): Epoch {
  return n as Epoch;
}

/**
 * Protocol version stamped on every message (plan §3: `{ v: 1, type, ... }`).
 *
 * Bumped 1 -> 2 in M3A to close two v1 gaps found by the M2 agents (plan §10
 * C3): `ping` had no reply (see `PongEvent` in events.ts), and `SortSpec` /
 * `ClientFilterSpec` (shared.ts) were too loosely typed to drive real
 * sorting/filtering. Every other package that speaks this protocol
 * (`worker-client`, `grid-viewport`) needs a matching update -- that is M4's
 * job, not this package's.
 */
export const PROTOCOL_VERSION = 2;
export type ProtocolVersion = typeof PROTOCOL_VERSION;
