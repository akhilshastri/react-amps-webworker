import type { UserConfig } from 'vite';

// Shared Vite config, re-exported by apps/trading-ui/vite.config.ts.
//
// Carries the winning R1 mitigation from M0 (plan/notes/M0-worker-bundling.md):
// `amps` is UMD/CommonJS with no ESM build, and it works unmodified inside a
// Vite worker bundle -- in dev because `optimizeDeps.include` pre-bundles it
// to ESM ahead of time, in build because `worker.format: 'es'` makes Vite
// emit a real ES module worker chunk. See that file for the verification
// steps (bundle inspection for unresolved CJS artifacts, `sow` on `orders`
// returning exactly 1000 rows).
//
// Any app in this workspace that spawns the data worker should start from
// this base rather than re-deriving the worker settings.
export const sharedViteConfig: UserConfig = {
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    include: ['amps'],
  },
};
