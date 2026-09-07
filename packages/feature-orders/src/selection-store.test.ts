import { describe, expect, test } from 'bun:test';
import type { Order } from './order';
import { OrderSelectionStore } from './selection-store';

function fakeOrder(orderId: string, childCount = 0): Order {
  return {
    orderId,
    orderDate: '2026-09-01',
    symbol: 'AAPL',
    instrumentName: 'Apple Inc.',
    assetClass: 'EQUITY',
    exchange: 'NASDAQ',
    side: 'BUY',
    orderType: 'LIMIT',
    tif: 'DAY',
    quantity: 1,
    limitPrice: 1,
    filledQty: 1,
    avgFillPrice: 1,
    status: 'FILLED',
    currency: 'USD',
    notional: 1,
    trader: 't',
    desk: 'd',
    book: 'b',
    clientId: 'c',
    clientName: 'n',
    settlementDate: '2026-09-03',
    childCount,
    createdAt: '2026-09-01T00:00:00.000Z',
  };
}

describe('OrderSelectionStore', () => {
  test('starts empty by default', () => {
    expect(new OrderSelectionStore().getSelection()).toEqual([]);
  });

  test('can start pre-seeded (used by cloneFrom)', () => {
    const store = new OrderSelectionStore([fakeOrder('ORD-000001')]);
    expect(store.getSelection().map((o) => o.orderId)).toEqual(['ORD-000001']);
  });

  test('setSelection replaces the selection and notifies subscribers', () => {
    const store = new OrderSelectionStore();
    const seen: (readonly Order[])[] = [];
    store.subscribe((selection) => seen.push(selection));

    const orders = [fakeOrder('ORD-000001')];
    store.setSelection(orders);

    expect(store.getSelection()).toBe(orders);
    expect(seen).toEqual([orders]);
  });

  test('clear() empties the selection', () => {
    const store = new OrderSelectionStore([fakeOrder('ORD-000001')]);
    store.clear();
    expect(store.getSelection()).toEqual([]);
  });

  test('unsubscribe stops further notifications', () => {
    const store = new OrderSelectionStore();
    let notifications = 0;
    const unsubscribe = store.subscribe(() => {
      notifications++;
    });

    unsubscribe();
    store.setSelection([fakeOrder('ORD-000001')]);

    expect(notifications).toBe(0);
  });

  describe('snapshot-for-clone semantics (plan §5: per-tab selection, cloning copies a snapshot once)', () => {
    test('cloneFrom seeds the clone with a copy of the source selection', () => {
      const source = new OrderSelectionStore();
      source.setSelection([fakeOrder('ORD-000001'), fakeOrder('ORD-000002')]);

      const clone = OrderSelectionStore.cloneFrom(source);

      expect(clone.getSelection().map((o) => o.orderId)).toEqual(['ORD-000001', 'ORD-000002']);
    });

    test('a clone diverges from its source immediately after creation', () => {
      const source = new OrderSelectionStore();
      source.setSelection([fakeOrder('ORD-000001')]);
      const clone = OrderSelectionStore.cloneFrom(source);

      clone.setSelection([fakeOrder('ORD-000002')]);
      expect(source.getSelection().map((o) => o.orderId)).toEqual(['ORD-000001']);
      expect(clone.getSelection().map((o) => o.orderId)).toEqual(['ORD-000002']);

      source.setSelection([]);
      expect(clone.getSelection().map((o) => o.orderId)).toEqual(['ORD-000002']);
    });

    test('snapshot() returns a copy, not a live reference -- later mutation of the source cannot leak into an already-taken snapshot', () => {
      const source = new OrderSelectionStore();
      source.setSelection([fakeOrder('ORD-000001')]);

      const snapshot = source.snapshot();
      source.setSelection([fakeOrder('ORD-000002')]);

      expect(snapshot.map((o) => o.orderId)).toEqual(['ORD-000001']);
      expect(source.getSelection().map((o) => o.orderId)).toEqual(['ORD-000002']);
    });
  });
});
