// Client-side column filter predicates (plan D3): the worker applies these
// over the already-loaded row store -- never pushed to AMPS as a `filter`
// string, unlike the master-selection filter that drives `sub.open`/
// `sub.update`'s own `filter` field.
//
// `ClientFilterSpec` (protocol shared.ts, v2) is a `Record<field, FilterCondition>`;
// a row matches the whole spec only if it matches every present column's
// condition (AND across columns -- AG Grid's own default `filterModel`
// semantics on the main-thread side that produces this shape).
//
// Consumed by `@amps-ui/data-worker`'s runtime to decide which rows belong
// in the sort index once a `clientFilter` is active.
import type { ClientFilterSpec, FilterCondition, RowData } from '@amps-ui/protocol';

type TextCondition = Extract<FilterCondition, { kind: 'text' }>;
type NumberCondition = Extract<FilterCondition, { kind: 'number' }>;
type SetCondition = Extract<FilterCondition, { kind: 'set' }>;

function matchesText(value: unknown, condition: TextCondition): boolean {
  const haystack = value === null || value === undefined ? '' : String(value).toLowerCase();
  const needle = condition.value.toLowerCase();
  switch (condition.operator) {
    case 'equals':
      return haystack === needle;
    case 'notEqual':
      return haystack !== needle;
    case 'contains':
      return haystack.includes(needle);
    case 'notContains':
      return !haystack.includes(needle);
    case 'startsWith':
      return haystack.startsWith(needle);
    case 'endsWith':
      return haystack.endsWith(needle);
  }
}

/** `value` is coerced to a number the same way `compareValues` (comparators.ts) would treat it; a non-numeric value never matches. */
function matchesNumber(value: unknown, condition: NumberCondition): boolean {
  const n = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(n)) return false;
  switch (condition.operator) {
    case 'equals':
      return n === condition.value;
    case 'notEqual':
      return n !== condition.value;
    case 'lessThan':
      return n < condition.value;
    case 'lessThanOrEqual':
      return n <= condition.value;
    case 'greaterThan':
      return n > condition.value;
    case 'greaterThanOrEqual':
      return n >= condition.value;
    case 'inRange':
      return n >= condition.value && n <= (condition.valueTo ?? condition.value);
  }
}

function matchesSet(value: unknown, condition: SetCondition): boolean {
  return condition.values.includes(value as string | number | boolean | null);
}

function matchesCondition(value: unknown, condition: FilterCondition): boolean {
  switch (condition.kind) {
    case 'text':
      return matchesText(value, condition);
    case 'number':
      return matchesNumber(value, condition);
    case 'set':
      return matchesSet(value, condition);
  }
}

/** True when `row` satisfies every column condition in `spec`. An undefined or empty spec matches every row. */
export function matchesClientFilter(row: RowData, spec: ClientFilterSpec | undefined): boolean {
  if (!spec) return true;
  for (const [field, condition] of Object.entries(spec)) {
    if (!matchesCondition(row[field], condition)) return false;
  }
  return true;
}
