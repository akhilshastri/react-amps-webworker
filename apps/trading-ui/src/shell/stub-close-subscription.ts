// Stand-in for the real `sub.close` request (plan §5: "Tab close
// intercepted via `onAction` on `Actions.DELETE_TAB` -> call a stubbed
// `sub.close(subId)` before letting the action through ... Stub the call
// now; M4 wires it to the real `DataClient`.").
//
// M3B ships no worker and no AMPS connection at all (plan §7 M3B: "No AMPS
// data at all"), so there is no `DataClient` in this app yet to call. When
// M4 adds one, this function's body becomes
// `dataClient.closeSubscription(toSubscriptionId(subId))`
// (`@amps-ui/worker-client`'s `DataClient.closeSubscription`,
// `@amps-ui/protocol`'s `toSubscriptionId`) -- the call site in
// `shell-layout.tsx` does not need to change, only this function.
export function stubCloseSubscription(subId: string): void {
  console.info(`[shell] sub.close (stub) subId=${subId}`);
}
