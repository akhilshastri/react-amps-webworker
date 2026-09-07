// apps/trading-ui/src/shell -- the layout shell (plan §5, §7 M3B).
//
// Owns: the flexlayout-react model/factory (`model.ts`, `shell-layout.tsx`),
// add-tab-by-cloning (`tab-actions.ts`), per-tab selection state
// (`tab-state.tsx`), the stubbed subscription-close call
// (`stub-close-subscription.ts`), the per-tab footer fed by mock stats
// (`footer/`), and the app-level connection banner fed by a mock state
// (`connection-banner/`). No AMPS, no real subscriptions -- see each
// module's header for what M3C/M4 swap in.
//
// Consumed by: `apps/trading-ui/src/App.tsx`.
export { Shell } from './shell';
