// DirtyKeyConflator -- accumulates dirty row keys between flushes.
//
// The worker has no `requestAnimationFrame` (plan §3 gotcha); data-worker
// drives the actual flush with a ~16ms `setInterval`. This class holds the
// *decision* of whether a flush is due, with the clock injected, so the
// timing logic is 100% `bun test`-able without a real timer (plan §1:
// viewport-core has "no timers of its own -- clock injected").
export class DirtyKeyConflator {
  private dirty = new Set<string>();
  private lastFlushAt: number;

  constructor(private readonly clock: () => number) {
    this.lastFlushAt = clock();
  }

  mark(key: string): void {
    this.dirty.add(key);
  }

  get pending(): number {
    return this.dirty.size;
  }

  /** True once something is dirty AND at least `intervalMs` has passed since the last drain. */
  isDue(intervalMs: number): boolean {
    return this.dirty.size > 0 && this.clock() - this.lastFlushAt >= intervalMs;
  }

  /** Drains and returns the accumulated dirty keys, resetting the flush clock. */
  drain(): ReadonlySet<string> {
    const drained = this.dirty;
    this.dirty = new Set();
    this.lastFlushAt = this.clock();
    return drained;
  }
}
