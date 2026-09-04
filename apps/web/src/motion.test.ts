import { describe, expect, it, vi } from 'vitest';

import {
  REDUCED_MOTION_QUERY,
  SCREEN_TRANSITION_MS,
  observeReducedMotion,
  prefersReducedMotion,
  screenTransitionMs,
  type MotionHost,
  type MotionMediaQuery,
} from './motion.js';

/**
 * A media query whose answer the test controls.
 *
 * jsdom implements `matchMedia`, but it answers `false` to everything and never fires a
 * change — so a test that used it could only ever exercise the branch where motion is
 * allowed, which is the branch that does not matter. This is why `motion.ts` takes the
 * host as an argument.
 */
const fakeHost = (
  initial: boolean,
): {
  host: MotionHost;
  /** The spy behind `host.matchMedia`, so asserting on it does not unbind the method. */
  matchMedia: (query: string) => MotionMediaQuery;
  set: (matches: boolean) => void;
  listeners: () => number;
} => {
  const listeners = new Set<() => void>();
  let matches = initial;
  const query: MotionMediaQuery = {
    get matches() {
      return matches;
    },
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
  };
  const matchMedia = vi.fn(() => query);
  return {
    host: { matchMedia },
    matchMedia,
    set: (next) => {
      matches = next;
      for (const listener of listeners) listener();
    },
    listeners: () => listeners.size,
  };
};

describe('screenTransitionMs', () => {
  it('is §9.4’s 160 ms, and zero under the preference', () => {
    expect(screenTransitionMs(false)).toBe(SCREEN_TRANSITION_MS);
    expect(SCREEN_TRANSITION_MS).toBe(160);
    expect(screenTransitionMs(true)).toBe(0);
  });
});

describe('prefersReducedMotion', () => {
  it('asks the media query §8.8 names', () => {
    const { host, matchMedia } = fakeHost(true);
    expect(prefersReducedMotion(host)).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith(REDUCED_MOTION_QUERY);
    expect(REDUCED_MOTION_QUERY).toBe('(prefers-reduced-motion: reduce)');
  });

  it('reports the preference when it is not set', () => {
    expect(prefersReducedMotion(fakeHost(false).host)).toBe(false);
  });

  // Reading a preference must never be the thing that breaks the page: the cost of
  // guessing wrong here is an animation, and the cost of throwing is a blank screen.
  it('answers false rather than throwing on a host with no matchMedia', () => {
    expect(prefersReducedMotion({} as unknown as MotionHost)).toBe(false);
  });
});

describe('observeReducedMotion', () => {
  it('fires immediately, so a caller never reads the preference separately', () => {
    const seen: boolean[] = [];
    observeReducedMotion((v) => seen.push(v), fakeHost(true).host);
    expect(seen).toStrictEqual([true]);
  });

  // Someone toggling the OS setting while the game is open should see the animations
  // stop, not see them stop on the next reload.
  it('fires again when the preference changes', () => {
    const seen: boolean[] = [];
    const { host, set } = fakeHost(false);
    observeReducedMotion((v) => seen.push(v), host);
    set(true);
    set(false);
    expect(seen).toStrictEqual([false, true, false]);
  });

  it('unsubscribes', () => {
    const seen: boolean[] = [];
    const { host, set, listeners } = fakeHost(false);
    const stop = observeReducedMotion((v) => seen.push(v), host);
    stop();
    expect(listeners()).toBe(0);
    set(true);
    expect(seen).toStrictEqual([false]);
  });

  it('reports false and unsubscribes cleanly on a host with no matchMedia', () => {
    const seen: boolean[] = [];
    const stop = observeReducedMotion((v) => seen.push(v), {} as unknown as MotionHost);
    expect(seen).toStrictEqual([false]);
    expect(() => {
      stop();
    }).not.toThrow();
  });
});
