// apps/trading-ui/src/shell -- the layout shell (plan §5, §7 M3B; real
// AMPS wiring M4b).
//
// Owns: the single worker + `DataClient` (`shell.tsx`), the flexlayout-react
// model/factory (`model.ts`, `shell-layout.tsx`), add-tab-by-cloning
// (`tab-actions.ts`), per-tab selection state (`tab-state.tsx`), the real
// `<OrdersGrid>`/`<OrderDetailsGrid>` tab content and subscription-close on
// tab delete (`grid-tab/`), the per-tab footer fed by real `stats` events
// (`footer/`), the app-level connection banner fed by the real `conn.state`
// (`connection-banner/`), error-event toasts (`error-toasts.ts`, M5), and
// teardown on unmount AND on `pagehide` so a real tab/window close also
// releases the worker's AMPS connection (`shell.tsx`, M5).
//
// Consumed by: `apps/trading-ui/src/App.tsx`.
export { Shell } from './shell';
