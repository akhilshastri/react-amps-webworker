// Pure formatting for the "sort not applied" banner (plan §4/C5: "Surface
// something in the UI when a sort is blocked rather than silently ignoring
// the user's click"). Split out from `order-details-grid.tsx` so the copy
// is unit-testable without mounting a component -- this codebase has no
// jsdom/happy-dom test setup (see `@amps-ui/grid-viewport`'s `selection.ts`
// for the same reasoning applied to a different component).
export function blockedFieldsMessage(fields: readonly string[]): string {
  const label = fields.join(', ');
  return `Sorting by ${label} isn't supported on a live window -- every tick would re-qualify the row for the top of the list, which would stream the entire topic instead of a bounded window. Showing the previous sort instead.`;
}
