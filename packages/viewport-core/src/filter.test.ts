import { describe, expect, test } from 'bun:test';
import type { ClientFilterSpec } from '@amps-ui/protocol';
import { matchesClientFilter } from './filter';

describe('matchesClientFilter', () => {
  test('undefined or empty spec matches every row', () => {
    expect(matchesClientFilter({ venue: 'NYSE' }, undefined)).toBe(true);
    expect(matchesClientFilter({ venue: 'NYSE' }, {})).toBe(true);
  });

  describe('text conditions', () => {
    const contains: ClientFilterSpec = {
      venue: { kind: 'text', operator: 'contains', value: 'ys' },
    };

    test('contains is case-insensitive', () => {
      expect(matchesClientFilter({ venue: 'NYSE' }, contains)).toBe(true);
      expect(matchesClientFilter({ venue: 'NASDAQ' }, contains)).toBe(false);
    });

    test('equals/notEqual/startsWith/endsWith', () => {
      expect(
        matchesClientFilter(
          { venue: 'NYSE' },
          { venue: { kind: 'text', operator: 'equals', value: 'nyse' } },
        ),
      ).toBe(true);
      expect(
        matchesClientFilter(
          { venue: 'NYSE' },
          { venue: { kind: 'text', operator: 'notEqual', value: 'nyse' } },
        ),
      ).toBe(false);
      expect(
        matchesClientFilter(
          { venue: 'NYSE' },
          { venue: { kind: 'text', operator: 'startsWith', value: 'ny' } },
        ),
      ).toBe(true);
      expect(
        matchesClientFilter(
          { venue: 'NYSE' },
          { venue: { kind: 'text', operator: 'endsWith', value: 'se' } },
        ),
      ).toBe(true);
    });

    test('a missing field is treated as an empty string', () => {
      expect(
        matchesClientFilter({}, { venue: { kind: 'text', operator: 'equals', value: '' } }),
      ).toBe(true);
    });
  });

  describe('number conditions', () => {
    test('comparison operators', () => {
      const row = { markPrice: 100 };
      expect(
        matchesClientFilter(row, { markPrice: { kind: 'number', operator: 'equals', value: 100 } }),
      ).toBe(true);
      expect(
        matchesClientFilter(row, {
          markPrice: { kind: 'number', operator: 'greaterThan', value: 50 },
        }),
      ).toBe(true);
      expect(
        matchesClientFilter(row, {
          markPrice: { kind: 'number', operator: 'lessThan', value: 50 },
        }),
      ).toBe(false);
    });

    test('inRange is inclusive on both ends', () => {
      const spec: ClientFilterSpec = {
        markPrice: { kind: 'number', operator: 'inRange', value: 10, valueTo: 20 },
      };
      expect(matchesClientFilter({ markPrice: 10 }, spec)).toBe(true);
      expect(matchesClientFilter({ markPrice: 20 }, spec)).toBe(true);
      expect(matchesClientFilter({ markPrice: 20.01 }, spec)).toBe(false);
    });

    test('a non-numeric value never matches', () => {
      expect(
        matchesClientFilter(
          { markPrice: 'not-a-number' },
          { markPrice: { kind: 'number', operator: 'greaterThan', value: 0 } },
        ),
      ).toBe(false);
    });
  });

  describe('set conditions', () => {
    test('matches any value in the set', () => {
      const spec: ClientFilterSpec = { status: { kind: 'set', values: ['FILLED', 'PARTIAL'] } };
      expect(matchesClientFilter({ status: 'FILLED' }, spec)).toBe(true);
      expect(matchesClientFilter({ status: 'CANCELLED' }, spec)).toBe(false);
    });
  });

  test('multiple column conditions are ANDed together', () => {
    const spec: ClientFilterSpec = {
      venue: { kind: 'text', operator: 'equals', value: 'nyse' },
      markPrice: { kind: 'number', operator: 'greaterThan', value: 100 },
    };
    expect(matchesClientFilter({ venue: 'NYSE', markPrice: 150 }, spec)).toBe(true);
    expect(matchesClientFilter({ venue: 'NYSE', markPrice: 50 }, spec)).toBe(false);
    expect(matchesClientFilter({ venue: 'NASDAQ', markPrice: 150 }, spec)).toBe(false);
  });
});
