// Per-tab selection/filter/sort state (plan §5, amended: "Selection is
// PER-TAB, not global ... A cloned details tab that followed a single
// shared selection would always show data identical to its source, making
// clone pointless. Each tab owns its own selection state; cloning copies
// it once.").
//
// Deliberately plain React state (a `Record<instanceId, TabSelectionState>`
// held by one provider at the shell root) rather than a module-level
// external store: this is small (one snapshot per open tab, not
// per-row data -- that lives in the worker/viewport-core, plan §1), so
// there is no case for `useSyncExternalStore` here.
//
// Consumed by: `placeholder-panel.tsx` (reads/writes its own tab's state),
// `tab-actions.ts` (`cloneState` on tab clone), `shell-layout.tsx`
// (`removeState` on tab close). M3C/M4 feature grids will read/write this
// same per-tab slice instead of a shared/global selection store.
import { type ReactNode, createContext, useCallback, useContext, useMemo, useState } from 'react';

export interface TabSelectionState {
  readonly selectedOrderIds: readonly string[];
  readonly filter: string | null;
}

const DEFAULT_TAB_STATE: TabSelectionState = {
  selectedOrderIds: [],
  filter: null,
};

interface TabStateContextValue {
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

/** Clone/remove, used by the shell's tab lifecycle (add/close) rather than by a tab's own content. */
export function useTabStateActions(): Pick<TabStateContextValue, 'cloneState' | 'removeState'> {
  const ctx = useTabStateContext();
  return ctx;
}
