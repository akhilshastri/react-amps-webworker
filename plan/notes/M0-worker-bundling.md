# M0 — worker bundling spike results

## Outcome: PASS. Fallback 1 wins.

Fallback 1 from the plan (native ES module worker + `optimizeDeps.include`) worked on
the first try. Fallback 2 (`importScripts`) and fallback 3 (vendor an esbuild ESM
prebuild) were not needed.

## Verified facts about `amps@5.3.4-0.378635.60b2fcc`

- `package.json`: `main: "amps.js"`, no `module`/`exports` field. Confirmed UMD/CJS-only
  as the brief states.
- `amps.js` is itself a **webpack UMD bundle** (`webpackUniversalModuleDefinition`
  wrapper, internal `__webpack_require__(<numeric id>)` calls between its own modules).
  Those internal calls are *not* real Node `require()` calls a bundler needs to
  externally resolve — they're self-contained references into webpack's own module
  registry baked into the file.
- The only real dynamic `require` in the whole file is one line, guarded:
  `var W3WebSocket = (IS_NODE || IS_ELECTRON) ? (eval('require')('websocket')).w3cwebsocket : WebSocket;`
  It's written as `eval('require')` specifically so static analysis by a bundler can't
  see it as an import to resolve. In a worker (not Node, not Electron) the condition is
  false and it falls through to the global `WebSocket`, which dedicated workers have.
  This is *why* fallback 1 worked with no extra config: there is nothing in the file a
  bundler needs to resolve that it can't.
- Confirmed `amps.IS_WEBWORKER` is exported from the module but this was not tested at
  runtime (not needed for M0 — nothing in the worker branches on it).

## Winning config

`vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    include: ['amps'],
  },
});
```

Worker spawned from the main thread with the `?worker` suffix import (Vite's own
worker-constructor sugar, resolved at build time to `new Worker(url, { type: 'module' })`):

```ts
import SpikeWorker from './worker.ts?worker';
const worker = new SpikeWorker();
```

Import shim (`src/amps-shim.ts`), the single file that would change if a fallback swap
were ever needed:

```ts
export { Client, Command } from 'amps';
```

Worker entry (`src/worker.ts`) imports only from the shim, never `'amps'` directly, per
plan. Connects, runs `new Command('sow').topic('orders').batchSize(1000)`, counts `sow`
messages, resolves the wrapping promise on `group_end` (not on `execute()`'s own
resolution — that only means "sent"), then `postMessage({ count })`.

## Vite version

Pinned **7.3.6** per plan decision D2. `bun install` resolved exactly that version (no
range drift) with `@vitejs/plugin-react@4.7.0`.

## Verification performed (dev)

- `bunx vite --port 5177`, ready in 746ms.
- `curl http://localhost:5177/src/worker.ts` — worker source served as native ESM,
  importing `/src/amps-shim.ts`.
- `curl http://localhost:5177/src/amps-shim.ts` — Vite rewrote the `from 'amps'` import
  to `from "/node_modules/.vite/deps/amps.js?v=..."`, i.e. `optimizeDeps.include`
  pre-bundled it into ESM ahead of time, exactly as fallback 1 predicts.
- Fetched that pre-bundled `deps/amps.js` directly: it's esbuild's `__commonJS` wrapper
  around the original UMD file, `export default require_amps()`. Grepped it for bare
  `require(` calls needing external resolution: **zero**. The only `require(`-shaped
  text is the internal webpack module registry described above.

## Verification performed (build + preview)

- `bunx vite build`: succeeded. One warning (expected, harmless):
  `Use of eval in "node_modules/amps/amps.js" ... strongly discouraged` — this is the
  guarded `eval('require')('websocket')` line above; it doesn't get invoked in a
  worker/browser context.
- Output: `dist/assets/worker-BwFtliOe.js` (83KB, separate chunk from the 194KB main
  bundle) and `dist/assets/index-*.js`.
- Inspected the worker chunk directly:
  - No unresolved `require(` calls (grepped for `<identifier>require(` patterns; only
    hits are Rollup-commonjs-plugin-generated `requireAmps()` / internal
    `__webpack_require__`, both self-contained in the same file).
  - No stray `module.exports` at top level — the one present is inside the
    commonjs-interop closure Rollup generates, not global-scope pollution.
  - The `eval(` call is present (as expected, it's part of the vendored amps.js source)
    but unreachable in a worker context per the `IS_NODE || IS_ELECTRON` guard above.
- `bunx vite preview --port 5178`: served `dist/index.html`, which loads
  `assets/index-*.js`; grepped that bundle for how it constructs the worker and found
  `new Worker("/assets/worker-BwFtliOe.js",{type:"module",...})` — confirms Vite emitted
  a real ES module worker for production, matching `worker.format: 'es'`.
  `curl -I` on the worker chunk returned `200 OK`, `Content-Type: text/javascript`.

## What was NOT verified (and why)

I do not have a real browser (no Chromium/Playwright available in this shell
environment) to click through and watch the page actually print `1000` under dev and
under preview. Everything above is shell-level: source inspection, bundle inspection,
and independently confirming the AMPS query logic itself is correct by running the
identical `sow`-on-`orders`-with-`batchSize(1000)` sequence directly under both `node`
and `bun` (outside a worker) against the live instance — both returned `count = 1000`.
Combined with the bundle-level absence of any unresolved CJS artifact in either mode,
this is strong but not a substitute for an actual browser run.

**A QA agent with real Chrome should confirm**, using the app at
`apps/trading-ui` (M1) with the same worker config:

```
bun run dev      # then open http://localhost:5173 (or whatever port Vite picks), confirm the page shows 1000
bun run build && bun run preview   # open the printed preview URL, confirm 1000 again
```

## Addendum (from M1 wiring)

When the winning config was carried into the real workspace's shared
`vite.config.base.ts` (`optimizeDeps.include: ['amps']`) and `bun run dev`
started against the M1 skeleton app -- which has no worker wired up yet,
all packages being stubs -- Vite printed a harmless warning:

```
Failed to resolve dependency: amps, present in client 'optimizeDeps.include'
```

This is expected at this stage: nothing in the current module graph
actually imports `amps` yet (that only happens once `data-worker`'s real
worker script, built in M2, imports the `amps-shim`), so esbuild's dep
scanner has nothing to crawl from. The dev server still starts and serves
the page fine; this is not a regression of the M0 finding, just a
consequence of M1 being stub-only. Expect this warning to disappear on its
own once M2 wires the real worker import.

## Surprises

- Fallback 1 worked with zero friction — no `optimizeDeps.exclude` tricks, no manual
  externalization. The reason, on inspection, is that `amps.js` is already a
  self-contained webpack bundle with no loose top-level `require()` of external
  packages; the UMD wrapper pattern esbuild/Rollup both understand natively. The plan
  flagged this as the highest-risk item of the whole project, but it resolved
  cleanly because the *specific* CJS shape amps ships (an internally-bundled UMD file,
  not a package with real `require('some-other-package')` calls) is exactly the shape
  both esbuild's and Rollup's CJS interop handle best.
- The one genuine risk inside the file — `eval('require')('websocket')` — is guarded by
  an environment check that is false in a worker, so it never fires. Worth flagging: if
  a future amps version changes that guard or the eval string, this would silently break
  only in a worker/browser context, not in Node-based tests. Not exercised by any of the
  `bun test` integration tests in the plan (those run under Bun directly, not through a
  bundled worker), so this is a known gap in coverage — not a blocker, just noted.
