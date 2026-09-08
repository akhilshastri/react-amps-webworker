// shadcn's standard `Skeleton` (M7 §9/§8.2) -- vendored the same way every
// other component in this package was (see this package's `index.ts` header):
// a plain `div` with `tw-animate-css`'s pulse animation, no new runtime
// dependency. Used to render placeholder rows for a details grid's genuinely
// first-ever load (`@amps-ui/feature-order-details`'s `order-details-grid.tsx`).
import { cn } from 'cn';
import type * as React from 'react';

function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="skeleton"
      className={cn('animate-pulse rounded-md bg-accent', className)}
      {...props}
    />
  );
}

export { Skeleton };
