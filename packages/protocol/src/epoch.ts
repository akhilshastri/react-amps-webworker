// Epoch ordering helper shared by both sides of the worker boundary.
// See brands.ts for what an Epoch is; see plan §3 "Every subscription-scoped
// message carries `epoch`" for the protocol rule this implements.
import type { Epoch } from './brands';

/**
 * True when `incoming` belongs to a superseded request for the same subId
 * and should be dropped without being applied. Used identically on the
 * main thread (dropping late worker events) and in the worker (dropping
 * a request that arrived after a newer one was already issued).
 */
export function isStaleEpoch(currentEpoch: Epoch, incoming: Epoch): boolean {
  return incoming < currentEpoch;
}
