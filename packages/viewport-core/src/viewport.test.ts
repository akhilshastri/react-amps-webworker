import { describe, expect, test } from 'bun:test';
import { ViewportProjection, clampWindow } from './viewport';

describe('clampWindow', () => {
  test('applies overscan symmetrically and clamps to [0, rowCount-1]', () => {
    expect(clampWindow(100, 150, 20, 10_000)).toEqual({ start: 80, end: 170 });
  });

  test('clamps the start at 0 near the top of the list', () => {
    expect(clampWindow(0, 50, 20, 10_000)).toEqual({ start: 0, end: 70 });
  });

  test('clamps the end at rowCount-1 near the bottom of the list', () => {
    expect(clampWindow(9_950, 9_990, 20, 10_000)).toEqual({ start: 9_930, end: 9_999 });
  });

  test('an empty row set yields an empty (start=0, end=-1) window', () => {
    expect(clampWindow(0, 99, 20, 0)).toEqual({ start: 0, end: -1 });
  });

  test('overscan wider than the whole set still clamps to valid bounds', () => {
    expect(clampWindow(0, 5, 1_000, 10)).toEqual({ start: 0, end: 9 });
  });
});

describe('ViewportProjection', () => {
  test('defaults to the initial window before any setRange call', () => {
    const projection = new ViewportProjection(20, 100);
    projection.reclamp(10_000);
    expect(projection.windowStart).toBe(0);
    expect(projection.windowEnd).toBe(119); // 99 + 20 overscan
  });

  test('setRange updates the window and contains() reflects it', () => {
    const projection = new ViewportProjection(10, 100);
    projection.setRange(500, 540, 10_000);
    expect(projection.windowStart).toBe(490);
    expect(projection.windowEnd).toBe(550);
    expect(projection.contains(490)).toBe(true);
    expect(projection.contains(550)).toBe(true);
    expect(projection.contains(489)).toBe(false);
    expect(projection.contains(551)).toBe(false);
  });

  test('reclamp re-derives the window when rowCount shrinks (e.g. after an oof removal)', () => {
    const projection = new ViewportProjection(10, 100);
    projection.setRange(9_900, 9_990, 10_000);
    expect(projection.windowEnd).toBe(9_999);
    projection.reclamp(9_950);
    expect(projection.windowEnd).toBe(9_949);
  });
});
