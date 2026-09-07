// Drives a scripted "sustained scroll" over an AG Grid viewport's scrollable
// element while sampling `requestAnimationFrame` deltas (plan §6: "frame
// time during sustained scroll ... `requestAnimationFrame` deltas -- report
// p50 and p95"). CDP's `Performance` domain was the plan's other suggested
// method; rAF deltas were chosen instead so the measurement is entirely
// in-page (no CDP session required to *take* the measurement, only to drive
// the browser and read the result -- see the `wsl-chrome-debugging` skill's
// virtual-time-budget trap, which this sidesteps by never touching the
// devtools protocol for timing).
//
// Setting `scrollTop` on a real element fires a native `scroll` event
// asynchronously, which is what AG Grid's Viewport row model listens to
// internally to call `IViewportDatasource.setViewportRange` (see
// `@amps-ui/grid-viewport`'s `datasource.ts`) -- so this genuinely exercises
// the same code path a mouse-wheel fling would, just with a scripted,
// reproducible motion profile instead of relying on synthetic mouse events.
//
// No `bun test` coverage: this needs a real DOM element with layout
// (`scrollHeight`/`clientHeight`) and a real `requestAnimationFrame`, which
// is exactly the "browser-only, cannot be `bun test`" category plan §6
// already carves out for this probe.

/** One continuous sweep from top to bottom and back, synced to elapsed time rather than a fixed per-frame step, so the sweep completes in `durationMs` regardless of the actual frame rate achieved. */
function scrollFractionAt(elapsedMs: number, durationMs: number): number {
  const t = Math.min(1, elapsedMs / durationMs);
  // Triangle wave 0 -> 1 -> 0 over the full duration: down for the first
  // half, back up for the second. Two direction changes exercise both
  // scroll-forward and scroll-backward repage/window-catch-up paths, not
  // just one.
  return t < 0.5 ? t * 2 : 2 - t * 2;
}

export interface ScrollRunResult {
  /** Time (ms) between consecutive `requestAnimationFrame` callbacks, in order. */
  readonly frameDeltasMs: readonly number[];
}

/**
 * Scrolls `container` in a triangle-wave sweep for `durationMs`, recording
 * the gap between consecutive animation frames throughout. Resolves once
 * the duration has elapsed (real time -- no `setTimeout`/virtual-clock
 * shortcuts, per the skill's warning that virtual time desyncs from live
 * WebSocket data).
 */
export function runSustainedScroll(
  container: HTMLElement,
  durationMs: number,
): Promise<ScrollRunResult> {
  return new Promise((resolve) => {
    const scrollRange = Math.max(0, container.scrollHeight - container.clientHeight);
    const frameDeltasMs: number[] = [];
    const startedAt = performance.now();
    let lastFrameAt = startedAt;

    function tick(now: number): void {
      frameDeltasMs.push(now - lastFrameAt);
      lastFrameAt = now;

      const elapsed = now - startedAt;
      if (elapsed >= durationMs) {
        resolve({ frameDeltasMs });
        return;
      }

      container.scrollTop = Math.round(scrollFractionAt(elapsed, durationMs) * scrollRange);
      requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
  });
}

/**
 * Locates AG Grid's own scrollable content element inside `root` (plan §6's
 * probe needs to drive the grid ag-grid renders, not a wrapper this package
 * controls -- `@amps-ui/grid-viewport`'s `<ViewportGrid>` exposes no scroll
 * API, only an imperative `clearSelection`).
 *
 * `.ag-body-viewport` -- AG Grid's class name for this element in older
 * majors -- does not exist in 36.1.0's DOM (verified live: `?m2` renders
 * `ag-grid-viewport`/`ag-body-vertical-scroll-viewport`/
 * `ag-body-vertical-scroll-container` instead, a different internal scroll
 * architecture). `.ag-grid-viewport` was confirmed live to be the element
 * that actually owns row content (`overflow-y: auto`, `scrollHeight` equal
 * to the full row count's rendered height) and whose `scrollTop` moves
 * rendered rows; `.ag-body-vertical-scroll-viewport` is a synced but
 * separate visual scrollbar track, not the content itself.
 */
export function findScrollContainer(root: HTMLElement): HTMLElement | undefined {
  return root.querySelector<HTMLElement>('.ag-grid-viewport') ?? undefined;
}

/**
 * Polls `root` (via `requestAnimationFrame`, real time) until AG Grid has
 * mounted its scroll body, or rejects after `timeoutMs`. Needed because
 * `<ViewportGrid>` mounts asynchronously relative to the React state update
 * that renders it (`run-probe.ts` opens a subscription; `perf-page.tsx`
 * reacts to the resulting handle by rendering the grid a render cycle
 * later) -- `root` itself (an always-rendered wrapper `perf-page.tsx` holds
 * a ref to) exists from the first render, only its AG-Grid child arrives late.
 */
export function waitForScrollContainer(root: HTMLElement, timeoutMs = 5_000): Promise<HTMLElement> {
  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    function poll(): void {
      const found = findScrollContainer(root);
      if (found) {
        resolve(found);
        return;
      }
      if (performance.now() - startedAt > timeoutMs) {
        reject(new Error(`AG Grid scroll body not found under root within ${timeoutMs}ms`));
        return;
      }
      requestAnimationFrame(poll);
    }
    poll();
  });
}
