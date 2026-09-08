// The small accent-colour dot (design spec §2.1/§2.2/§8.1) that makes the
// master(Orders)->details link legible: an Orders tab's own dot, the same
// dot on the Details tab paired to it (`sourceOrdersTabId`, `model.ts`), and
// the same dot again in the Details toolbar's "Following" chip and the
// "Change" picker's per-tab menu items (`grid-tab/order-details-tab-content.tsx`).
// One tiny component so all four call sites render the identical mark.
import type { TabAccent } from '@amps-ui/grid-viewport';

export function AccentDot({ accent, className }: { accent: TabAccent; className?: string }) {
  return (
    <span
      aria-hidden
      className={['inline-block size-1.5 shrink-0 rounded-full', className]
        .filter(Boolean)
        .join(' ')}
      style={{ backgroundColor: `var(--accent-${accent}-9)` }}
    />
  );
}
