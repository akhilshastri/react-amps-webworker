// apps/trading-ui/src/shell -- the layout shell (plan §5, §7 M3B; real
// AMPS wiring M4b).
//
// Owns: the single worker + `DataClient` (`shell.tsx`), the flexlayout-react
// model/factory (`model.ts`, `shell-layout.tsx`), add-tab-by-cloning
// (`tab-actions.ts`), per-tab selection state (`tab-state.tsx`), the real
// `<OrdersGrid>`/`<OrderDetailsGrid>` tab content and subscription-close on
// tab delete (`grid-tab/`), the per-tab footer fed by real `stats` events
// (`footer/`), and the app-level connection banner fed by the real
// `conn.state` (`connection-banner/`).
//
// Consumed by: `apps/trading-ui/src/App.tsx`.
export { Shell } from './shell';
