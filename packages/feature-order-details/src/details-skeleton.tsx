// Placeholder rows for a details grid's genuinely first-ever load (design
// spec §8.2): plain `<div>` strips widthed off the real `columnDefs`, not
// real AG Grid rows -- cheap, no grid instantiation cost, and avoids a
// fully blank `AgGridReact` while nothing has ever loaded here yet. Only
// used before the first `snapshot.complete` (`order-details-grid.tsx`); a
// selection change on an already-populated pane keeps showing its old rows
// instead (plan §4's "no blank grid between selections"), so this never
// reappears after that first load.
import { Skeleton } from '@amps-ui/ui';
import type { ColDef } from 'ag-grid-community';

const SKELETON_ROW_COUNT = 10;
const SKELETON_ROW_HEIGHT = 28; // matches `blotterTheme.rowHeight` (`@amps-ui/grid-viewport`).

export function DetailsSkeleton<T>({ columnDefs }: { columnDefs: readonly ColDef<T>[] }) {
  return (
    <div className="flex h-full flex-col overflow-hidden" aria-hidden>
      {Array.from({ length: SKELETON_ROW_COUNT }, (_, rowIndex) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed-length, never-reordered list of decorative placeholder rows with no identity of their own.
          key={rowIndex}
          className="flex shrink-0 items-center gap-2 border-b px-2"
          style={{ height: SKELETON_ROW_HEIGHT }}
        >
          {columnDefs.map((col, colIndex) => (
            <Skeleton
              key={col.field ?? colIndex}
              className="h-3.5 shrink-0"
              style={{ width: (col.width ?? 100) - 16 }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
