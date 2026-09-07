// Magnitude-aware number formatting for the orders grid (CLIENT.md: "prices
// under 10 (FX) carry 4dp, everything else 2dp"). Decimals are NEVER a fixed
// 2dp here on purpose -- a hardcoded 2dp would silently truncate FX-range
// prices like `1.2345` to `1.23`.
//
// Shared by `columns.ts` (grid `valueFormatter`s) and directly unit-tested
// (M3C DoD: "assert 4dp under 10 and 2dp at/above 10").
const numberFormatters = new Map<number, Intl.NumberFormat>();

function formatterFor(decimals: number): Intl.NumberFormat {
  let formatter = numberFormatters.get(decimals);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    numberFormatters.set(decimals, formatter);
  }
  return formatter;
}

/** `< 10` -> 4dp (FX-range prices), `>= 10` -> 2dp (CLIENT.md). */
export function decimalsForMagnitude(value: number): 2 | 4 {
  return Math.abs(value) < 10 ? 4 : 2;
}

/**
 * Formats a price-like number (`limitPrice`, `avgFillPrice`, `notional`)
 * with comma grouping and magnitude-aware decimals. `notional` is large
 * ("format it readably", brief) -- comma grouping is what makes an
 * eight-digit number scannable at a glance.
 */
export function formatMagnitudeAwareNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '';
  return formatterFor(decimalsForMagnitude(value)).format(value);
}

const integerFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** Formats a whole-number field (`quantity`, `filledQty`, `childCount`) with comma grouping, no decimals. */
export function formatInteger(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '';
  return integerFormatter.format(value);
}

/** Formats an ISO 8601 timestamp (`createdAt`) for display; passes an unparseable value through unchanged rather than showing "Invalid Date". */
export function formatTimestamp(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
