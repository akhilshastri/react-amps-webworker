import { describe, expect, test } from 'bun:test';
import {
  decimalsForMagnitude,
  formatInteger,
  formatMagnitudeAwareNumber,
  formatTimestamp,
} from './format';

describe('decimalsForMagnitude', () => {
  test('under 10 (FX range) -> 4dp', () => {
    expect(decimalsForMagnitude(9.999)).toBe(4);
    expect(decimalsForMagnitude(0.5)).toBe(4);
    expect(decimalsForMagnitude(-3.2)).toBe(4);
  });

  test('at/above 10 -> 2dp', () => {
    expect(decimalsForMagnitude(10)).toBe(2);
    expect(decimalsForMagnitude(483.57)).toBe(2);
    expect(decimalsForMagnitude(52_624_988.82)).toBe(2);
  });
});

describe('formatMagnitudeAwareNumber', () => {
  test('formats an FX-range price with 4dp, never a hardcoded 2dp', () => {
    expect(formatMagnitudeAwareNumber(1.2345)).toBe('1.2345');
    expect(formatMagnitudeAwareNumber(1.2)).toBe('1.2000');
  });

  test('formats a >=10 price with 2dp and comma grouping', () => {
    expect(formatMagnitudeAwareNumber(483.57)).toBe('483.57');
    expect(formatMagnitudeAwareNumber(52_624_988.82)).toBe('52,624,988.82');
  });

  test('the boundary value 10 itself uses 2dp ("at/above 10")', () => {
    expect(formatMagnitudeAwareNumber(10)).toBe('10.00');
  });

  test('empty string for null/undefined/NaN', () => {
    expect(formatMagnitudeAwareNumber(null)).toBe('');
    expect(formatMagnitudeAwareNumber(undefined)).toBe('');
    expect(formatMagnitudeAwareNumber(Number.NaN)).toBe('');
  });
});

describe('formatInteger', () => {
  test('groups thousands with no decimals', () => {
    expect(formatInteger(108_826)).toBe('108,826');
    expect(formatInteger(0)).toBe('0');
  });

  test('empty string for null/undefined', () => {
    expect(formatInteger(null)).toBe('');
    expect(formatInteger(undefined)).toBe('');
  });
});

describe('formatTimestamp', () => {
  test('formats a valid ISO 8601 string to a locale string', () => {
    const formatted = formatTimestamp('2026-09-06T09:44:09.442Z');
    expect(formatted).not.toBe('');
    expect(formatted).not.toBe('2026-09-06T09:44:09.442Z');
  });

  test('passes an unparseable value through unchanged rather than "Invalid Date"', () => {
    expect(formatTimestamp('not-a-date')).toBe('not-a-date');
  });

  test('empty string for null/undefined/empty', () => {
    expect(formatTimestamp(null)).toBe('');
    expect(formatTimestamp(undefined)).toBe('');
    expect(formatTimestamp('')).toBe('');
  });
});
