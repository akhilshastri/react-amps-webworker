// Per-tab order selection store (plan §5, supersedes D4: shared selection
// was withdrawn -- "a cloned tab must be independent or cloning is
// pointless"). One `OrderSelectionStore` instance per grid tab/instanceId,
// never shared across tabs; `apps/trading-ui` (M4) owns creating one per
// flexlayout tab and feeding it `AgGridReact`'s selection events.
//
// `cloneFrom` is what lets "add tab" (plan §5) copy a snapshot of the source
// tab's selection into a fresh, independently mutable store that diverges
// immediately from the moment it's created.
import { useSyncExternalStore } from 'react';
import type { Order } from './order';

export type OrderSelectionListener = (selection: readonly Order[]) => void;

export class OrderSelectionStore {
  private selection: readonly Order[];
  private readonly listeners = new Set<OrderSelectionListener>();

  constructor(initial: readonly Order[] = []) {
    this.selection = initial;
  }

  getSelection(): readonly Order[] {
    return this.selection;
  }

  /** Replaces the whole selection (the natural shape of AG Grid's `api.getSelectedRows()`) and notifies subscribers. */
  setSelection(orders: readonly Order[]): void {
    this.selection = orders;
    for (const listener of this.listeners) listener(this.selection);
  }

  clear(): void {
    this.setSelection([]);
  }

  /** Returns an unsubscribe function, matching this codebase's other event-source conventions (e.g. `SubscriptionHandle.onEvent`). */
  subscribe(listener: OrderSelectionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * A point-in-time copy of the current selection, safe to hand to a clone
   * -- a plain array copy so later mutation of the source store's selection
   * can never leak into a clone that already snapshotted it.
   */
  snapshot(): readonly Order[] {
    return [...this.selection];
  }

  /** Creates a new, independent store seeded with `source`'s current selection. The clone then diverges immediately (plan §5): further changes to either store never affect the other. */
  static cloneFrom(source: OrderSelectionStore): OrderSelectionStore {
    return new OrderSelectionStore(source.snapshot());
  }
}

/** React binding for `OrderSelectionStore`, mirroring `@amps-ui/grid-viewport`'s `useViewportSubscription` effect/cleanup pattern. */
export function useOrderSelection(store: OrderSelectionStore): readonly Order[] {
  return useSyncExternalStore(
    (onStoreChange) => store.subscribe(onStoreChange),
    () => store.getSelection(),
  );
}
