// The AG Grid Theming-API skin shared by both grids (`<OrdersGrid>` and
// `<OrderDetailsGrid>`), plus the tab-accent hash both the shell's tab
// labels and this theme's per-tab selection tint need to agree on -- one
// hash function, two consumers, so they can never drift apart.
//
// Design spec: `plan/notes/M7-ux-design.md` §5 (theming) and §2.1/§4.3
// (accent). Every colour param below is a `var(--token)` string, confirmed
// passthrough at the type level (`ColorValue = string | {...}`, §10.3) --
// this is what makes ONE theme object serve both light and dark for free:
// the grid's colours already follow the app's `.dark` class the moment the
// underlying custom properties (`@amps-ui/ui`'s `index.css`) flip, with no
// `setGridOption('theme', ...)` call needed.
//
// Consumed by: `viewport-grid.tsx` (default `theme` prop),
// `@amps-ui/feature-orders`'s `<OrdersGrid>` (per-instance accent override),
// `apps/trading-ui/src/shell` (tab accent dots, `Following` toolbar/picker).
import { themeQuartz } from 'ag-grid-community';

/**
 * Five hues, deliberately disjoint from every semantic colour in §4 (P&L
 * green/red, side blue/orange, status amber/green/gray) -- an accent dot
 * must never be mistaken for a data value.
 */
export const TAB_ACCENTS = ['violet', 'cyan', 'pink', 'indigo', 'teal'] as const;
export type TabAccent = (typeof TAB_ACCENTS)[number];

/**
 * Deterministic hue from a tab's `instanceId` -- no new state, no
 * reordering-on-close bugs (spec §2.1). Same instanceId always resolves to
 * the same hue for the lifetime of the tab.
 */
export function tabAccent(instanceId: string): TabAccent {
  let hash = 0;
  for (let i = 0; i < instanceId.length; i++) hash = (hash * 31 + instanceId.charCodeAt(i)) >>> 0;
  // `hash % TAB_ACCENTS.length` is always a valid index -- non-null assert
  // past `noUncheckedIndexedAccess`, which can't see that.
  return TAB_ACCENTS[hash % TAB_ACCENTS.length] as TabAccent;
}

// Density/typography (§3.2) and colour wiring (§5). `wrapperBorderRadius: 0`
// -- a blotter pane is not a floating card.
export const blotterTheme = themeQuartz.withParams({
  rowHeight: 28,
  headerHeight: 30,
  fontSize: 12.5,
  headerFontSize: 12.5,
  headerFontWeight: 500,
  spacing: 4,
  cellHorizontalPadding: 8,
  backgroundColor: 'var(--background)',
  foregroundColor: 'var(--foreground)',
  headerBackgroundColor: 'var(--muted)',
  headerTextColor: 'var(--foreground)',
  borderColor: 'var(--border)',
  rowHoverColor: 'var(--muted)',
  wrapperBorderRadius: 0,
});

/**
 * `blotterTheme` plus a per-tab selection tint (§2.3) -- the one param that
 * genuinely needs a JS-side value per instance, since it depends on
 * `instanceId`, not on light/dark. Callers memoize this on `instanceId`
 * (e.g. `<OrdersGrid>`) since a `Theme` object is meant to be created once
 * per tab, not per row/cell.
 */
export function accentSelectionTheme(instanceId: string) {
  return blotterTheme.withParams({
    selectedRowBackgroundColor: `var(--accent-${tabAccent(instanceId)}-3)`,
  });
}
