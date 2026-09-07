import { describe, expect, test } from 'bun:test';
import { DirtyKeyConflator } from './conflator';

/** A controllable fake clock -- the whole point of injecting one (plan §1). */
function fakeClock(startAt = 0) {
  let now = startAt;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('DirtyKeyConflator', () => {
  test('is not due with nothing marked, even after time passes', () => {
    const clock = fakeClock();
    const conflator = new DirtyKeyConflator(clock.now);
    clock.advance(100);
    expect(conflator.isDue(16)).toBe(false);
  });

  test('is not due before the interval elapses, even with dirty keys', () => {
    const clock = fakeClock();
    const conflator = new DirtyKeyConflator(clock.now);
    conflator.mark('a');
    clock.advance(10);
    expect(conflator.isDue(16)).toBe(false);
  });

  test('becomes due once the interval elapses with something dirty', () => {
    const clock = fakeClock();
    const conflator = new DirtyKeyConflator(clock.now);
    conflator.mark('a');
    clock.advance(16);
    expect(conflator.isDue(16)).toBe(true);
  });

  test('drain returns the accumulated keys, clears them, and resets the flush clock', () => {
    const clock = fakeClock();
    const conflator = new DirtyKeyConflator(clock.now);
    conflator.mark('a');
    conflator.mark('b');
    conflator.mark('a'); // duplicate marks conflate to one entry
    clock.advance(16);
    const drained = conflator.drain();
    expect([...drained].sort()).toEqual(['a', 'b']);
    expect(conflator.pending).toBe(0);
    // Immediately after draining, not due again even though time hasn't moved.
    expect(conflator.isDue(16)).toBe(false);
  });

  test('a fresh mark after a drain requires a full new interval before it is due again', () => {
    const clock = fakeClock();
    const conflator = new DirtyKeyConflator(clock.now);
    conflator.mark('a');
    clock.advance(16);
    conflator.drain();
    conflator.mark('b');
    clock.advance(10);
    expect(conflator.isDue(16)).toBe(false);
    clock.advance(6);
    expect(conflator.isDue(16)).toBe(true);
  });
});
