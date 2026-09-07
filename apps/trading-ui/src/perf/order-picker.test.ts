import { describe, expect, test } from 'bun:test';
import { pickOrdersForTarget } from './order-picker';

function order(orderId: string, childCount: number) {
  return { orderId, childCount } as import('@amps-ui/feature-orders').Order;
}

describe('pickOrdersForTarget', () => {
  test('exact match when a subset sums exactly to the target (plan §6: 3 orders -> 2537)', () => {
    const orders = [order('ORD-A', 97), order('ORD-B', 2314), order('ORD-C', 126)];
    const pick = pickOrdersForTarget(orders, 2537);
    expect(pick.actualSum).toBe(2537);
    expect(new Set(pick.orderIds)).toEqual(new Set(['ORD-A', 'ORD-B', 'ORD-C']));
  });

  test('never overshoots the target', () => {
    const orders = [order('ORD-A', 900), order('ORD-B', 200), order('ORD-C', 5)];
    const pick = pickOrdersForTarget(orders, 1_000);
    expect(pick.actualSum).toBeLessThanOrEqual(1_000);
  });

  test('packs the largest orders first for a big target', () => {
    const orders = Array.from({ length: 20 }, (_, i) => order(`ORD-${i}`, (i + 1) * 100));
    const pick = pickOrdersForTarget(orders, 5_000);
    // The 20 childCounts sum to 21,000; a target of 5,000 should be reachable
    // with far fewer than 20 orders since it greedily takes the biggest first.
    expect(pick.orderIds.length).toBeLessThan(10);
    expect(pick.actualSum).toBeGreaterThan(4_000);
  });

  test('empty orders list picks nothing', () => {
    const pick = pickOrdersForTarget([], 1_000);
    expect(pick.orderIds).toEqual([]);
    expect(pick.actualSum).toBe(0);
  });

  test('target larger than every order combined caps at the total available', () => {
    const orders = [order('ORD-A', 10), order('ORD-B', 20)];
    const pick = pickOrdersForTarget(orders, 1_000_000);
    expect(pick.actualSum).toBe(30);
    expect(pick.orderIds.length).toBe(2);
  });
});
