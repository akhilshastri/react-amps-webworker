// A small React binding over `SubscriptionHandle.onEvent` (plan §1 public
// surface). Exists so `<ViewportGrid>`'s footer/status slot and any future
// feature-level status view (e.g. a tab's row-count footer, plan §5) share
// one place that gets the effect/cleanup right, instead of each caller
// re-deriving `useEffect(() => handle.onEvent(cb), [handle])`.
import type { WorkerEvent } from '@amps-ui/protocol';
import type { SubscriptionHandle } from '@amps-ui/worker-client';
import { useEffect } from 'react';

/** Subscribes `onEvent` to every `WorkerEvent` for `handle`'s lifetime. */
export function useViewportSubscription(
  handle: SubscriptionHandle,
  onEvent: (event: WorkerEvent) => void,
): void {
  useEffect(() => handle.onEvent(onEvent), [handle, onEvent]);
}
