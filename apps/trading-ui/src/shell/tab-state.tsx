// Per-tab selection state (plan §5, amended: "Selection is PER-TAB, not
// global ... A cloned details tab that followed a single shared selection
// would always show data identical to its source, making clone pointless.
// Each tab owns its own selection state; cloning copies it once.").
//
// Deliberately plain React state (a `Record<instanceId, TabSelectionState>`
// held by one provider at the shell root) rather than a module-level
// external store: this is small (one selection snapshot per open tab, not
// per-row data -- that lives in the worker/viewport-core, plan §1), so
// there is no case for `useSyncExternalStore` here.
//
// M4b: holds the full `Order[]` (not just ids) -- the details grid's
// `rowCountHint`/footer need `childCount` (`projectDetailRowCount`,
// `@amps-ui/feature-orders`), which a bare id list can't provide, and
// `<ViewportGrid>`'s `onSelectionChanged` (M4a) already hands back full row
// data alongside the keys. `getState` is also called CROSS-TAB: an
// order-details tab reads a *different* tab's slot (`model.ts`'s
// `sourceOrdersTabId`) directly by passing that tab's instanceId, not just
// its own -- this was already possible with `useTabState`'s existing
// per-instanceId shape, no new registry needed.
//
// Consumed by: `shell-layout.tsx`'s orders/order-details tab content
// (writes its own selection / reads its source orders tab's), `tab-actions.ts`
// (clone).
import type { Order } from '@amps-ui/feature-orders';
import { type ReactNode, createContext, useCallback, useContext, useMemo, useState } from 'react';

export interface TabSelectionState {
  readonly selectedOrders: readonly Order[];
}

const DEFAULT_TAB_STATE: TabSelectionState = {
  selectedOrders: [],
};

export interface TabStateContextValue {
  getState(instanceId: string): TabSelectionState;
  setState(instanceId: string, patch: Partial<TabSelectionState>): void;
  /** Copies `fromInstanceId`'s current snapshot to `toInstanceId`. One-time copy -- the two then diverge. */
  cloneState(fromInstanceId: string, toInstanceId: string): void;
  removeState(instanceId: string): void;
}

const TabStateContext = createContext<TabStateContextValue | null>(null);

export function TabStateProvider({ children }: { children: ReactNode }) {
  const [states, setStates] = useState<Record<string, TabSelectionState>>({});

  const getState = useCallback(
    (instanceId: string) => states[instanceId] ?? DEFAULT_TAB_STATE,
    [states],
  );

  const setState = useCallback((instanceId: string, patch: Partial<TabSelectionState>) => {
    setStates((prev) => ({
      ...prev,
      [instanceId]: { ...(prev[instanceId] ?? DEFAULT_TAB_STATE), ...patch },
    }));
  }, []);

  const cloneState = useCallback((fromInstanceId: string, toInstanceId: string) => {
    setStates((prev) => ({
      ...prev,
      [toInstanceId]: prev[fromInstanceId] ?? DEFAULT_TAB_STATE,
    }));
  }, []);

  const removeState = useCallback((instanceId: string) => {
    setStates((prev) => {
      if (!(instanceId in prev)) return prev;
      const next = { ...prev };
      delete next[instanceId];
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ getState, setState, cloneState, removeState }),
    [getState, setState, cloneState, removeState],
  );

  return <TabStateContext.Provider value={value}>{children}</TabStateContext.Provider>;
}

function useTabStateContext(): TabStateContextValue {
  const ctx = useContext(TabStateContext);
  if (!ctx) throw new Error('useTabState/useTabStateActions must be used within TabStateProvider');
  return ctx;
}

/** Reads and updates one tab's own selection snapshot. */
export function useTabState(
  instanceId: string,
): [TabSelectionState, (patch: Partial<TabSelectionState>) => void] {
  const ctx = useTabStateContext();
  const setState = useCallback(
    (patch: Partial<TabSelectionState>) => ctx.setState(instanceId, patch),
    [ctx, instanceId],
  );
  return [ctx.getState(instanceId), setState];
}

/**
 * The shell's tab-lifecycle actions (add/close), rather than a tab's own
 * content. `getState`/`setState` are included alongside `cloneState`/
 * `removeState` for `tab-actions.ts`'s order-details clone case: a details
 * tab's own slot is never written directly (it reads through
 * `sourceOrdersTabId`, `model.ts`), so cloning one needs to resolve and
 * copy the CURRENT source selection rather than the generic `cloneState`.
 */
export function useTabStateActions(): TabStateContextValue {
  return useTabStateContext();
}
