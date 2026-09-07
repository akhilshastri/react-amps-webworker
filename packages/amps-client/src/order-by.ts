// Translates a worker-side `SortField` list into AMPS's `orderBy` syntax.
//
// Used by `@amps-ui/data-worker`'s runtime for the details topic's
// server-delegated sort (plan amended §4, protocol v2 `SortSpec` with
// `mode: 'server'`): sorting up to 1.5M `order_details` rows in JS is a
// non-starter, so a sort change there re-issues the AMPS subscription with
// a new `orderBy` string instead. `orderBy` takes `/field ASC` or
// `/field DESC` (CLIENT.md); multiple fields are comma-separated.
import type { SortField } from '@amps-ui/protocol';

export function buildOrderBy(fields: readonly SortField[]): string {
  return fields.map(({ field, direction }) => `/${field} ${direction.toUpperCase()}`).join(',');
}
