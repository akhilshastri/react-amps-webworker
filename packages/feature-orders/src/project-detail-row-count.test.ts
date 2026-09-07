import { describe, expect, test } from 'bun:test';
import { projectDetailRowCount } from './project-detail-row-count';

describe('projectDetailRowCount', () => {
  test('== sum(childCount) over the selection (verified exact against live AMPS this session: 3 orders -> 2537, plan §4)', () => {
    const selection = [{ childCount: 97 }, { childCount: 2314 }, { childCount: 126 }];
    expect(projectDetailRowCount(selection)).toBe(2537);
  });

  test('empty selection -> 0', () => {
    expect(projectDetailRowCount([])).toBe(0);
  });

  test('is exact, not an estimate: sums arbitrary counts precisely, including a single-order selection', () => {
    expect(projectDetailRowCount([{ childCount: 9968 }])).toBe(9968);
    expect(
      projectDetailRowCount([
        { childCount: 1 },
        { childCount: 2 },
        { childCount: 3 },
        { childCount: 4 },
      ]),
    ).toBe(10);
  });

  test('a zero childCount contributes nothing', () => {
    expect(projectDetailRowCount([{ childCount: 0 }, { childCount: 42 }])).toBe(42);
  });
});
