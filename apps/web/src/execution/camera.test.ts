/**
 * The playback camera (#147, FR-404, FR-601).
 *
 * #147's criteria are three properties and two behaviours, and they are tested as such:
 *
 * - **Smoothed in simulation time, not per frame.** The camera is a pure function of the
 *   playback epoch, so the test is that the same epoch gives the same camera — twice, and
 *   regardless of anything else. A wall-clock ease could not pass this.
 * - **No scale jump between "far apart" and "metres apart".** The window length is
 *   continuous in the epoch, and the framing it produces changes by a bounded amount
 *   across a small step. Asserted as a bound on the ratio between successive scales, over
 *   the whole run, at the resolution a frame actually uses.
 * - **No effect on the outcome.** Structural — nothing here returns anything but a
 *   `Camera` — and asserted end to end in `screens/ContractScreen.test.tsx`, where the
 *   same run is played twice and only the camera differs.
 *
 * The bodies are plain functions of the epoch rather than a real timeline. What is being
 * tested is the framing policy, and driving it with two analytic circles makes the
 * geometry something a reader can check by hand.
 */
import { eci, epoch, type EciVector, type Epoch } from '@hh/astro';
import type { Metres } from '@hh/math';
import { metres } from '@hh/math';
import { EQUATORIAL_BASIS, createCamera, type Viewport } from '@hh/render';
import { describe, expect, it } from 'vitest';

import {
  MIN_FRAME_EXTENT_M,
  MIN_WINDOW_SECONDS,
  createFollow,
  followBounds,
  followCamera,
  followTo,
  followWindowSeconds,
  manualFollow,
  recentreFollow,
  type FollowContext,
} from './camera.js';

const VIEWPORT: Viewport = { width: 1200, height: 800, devicePixelRatio: 1 };

const START = epoch(0);
const END = epoch(21_600);
const PERIOD = 5560;
const ENCOUNTER = epoch(4123);

/** A circle of radius `r`, going round once per `PERIOD`, offset in phase by `phase`. */
const circle =
  (r: number, phase: number) =>
  (at: Epoch): EciVector<Metres> => {
    const theta = (2 * Math.PI * at) / PERIOD + phase;
    return eci({
      x: metres(r * Math.cos(theta)),
      y: metres(r * Math.sin(theta)),
      z: metres(0),
    });
  };

const context = (over: Partial<FollowContext> = {}): FollowContext => ({
  shipAt: circle(6_778_137, 0),
  targetAt: circle(7_178_137, 0.24),
  startEpoch: START,
  endEpoch: END,
  encounterEpoch: ENCOUNTER,
  periodSeconds: PERIOD,
  ...over,
});

describe('followWindowSeconds', () => {
  it('is the ship’s period far from the encounter', () => {
    expect(followWindowSeconds(epoch(20_000), context())).toBe(PERIOD);
  });

  it('closes to the minimum at the encounter', () => {
    expect(followWindowSeconds(ENCOUNTER, context())).toBe(MIN_WINDOW_SECONDS);
  });

  it('shrinks monotonically as the encounter approaches', () => {
    // The scale-jump criterion, at the level of the quantity that causes it.
    let previous = Number.POSITIVE_INFINITY;
    for (let at = ENCOUNTER - 4000; at <= ENCOUNTER; at += 50) {
      const window = followWindowSeconds(epoch(at), context());
      expect(window).toBeLessThanOrEqual(previous);
      previous = window;
    }
  });

  it('is continuous — no step larger than the step in the epoch', () => {
    // A regime switch would show up here as a jump of hundreds of seconds between two
    // epochs one second apart. §8.4 rejects regime changes for exactly this reason.
    for (let at = 0; at < 20_000; at += 37) {
      const here = followWindowSeconds(epoch(at), context());
      const there = followWindowSeconds(epoch(at + 1), context());
      expect(Math.abs(there - here)).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('stays wide for a contract with no encounter', () => {
    // A `reach_orbit` contract has nothing to close in on.
    const none = context({ encounterEpoch: null });
    expect(followWindowSeconds(START, none)).toBe(PERIOD);
    expect(followWindowSeconds(END, none)).toBe(PERIOD);
  });

  it('falls back to the minimum for an orbit with no period', () => {
    // An open arc. `L4` makes one illegal to commit, so this is the defensive path
    // rather than one a real run reaches — and it returns a number, not `NaN`.
    const open = context({ periodSeconds: Number.POSITIVE_INFINITY, encounterEpoch: null });
    expect(followWindowSeconds(START, open)).toBe(MIN_WINDOW_SECONDS);
  });

  it('never goes below the minimum, whatever the period', () => {
    const tiny = context({ periodSeconds: 1 });
    expect(followWindowSeconds(ENCOUNTER, tiny)).toBe(MIN_WINDOW_SECONDS);
  });
});

describe('followBounds', () => {
  it('always contains the ship’s current position', () => {
    // The window is clipped to the run, so the head is a sample at every epoch —
    // including at the two ends, where the window is one-sided.
    for (const at of [START, epoch(100), ENCOUNTER, epoch(20_000), END]) {
      const bounds = followBounds(at, context(), EQUATORIAL_BASIS);
      const ship = context().shipAt(at);
      expect(bounds).not.toBeNull();
      expect(ship?.x).toBeGreaterThanOrEqual(bounds?.minU ?? Number.NaN);
      expect(ship?.x).toBeLessThanOrEqual(bounds?.maxU ?? Number.NaN);
      expect(ship?.y).toBeGreaterThanOrEqual(bounds?.minV ?? Number.NaN);
      expect(ship?.y).toBeLessThanOrEqual(bounds?.maxV ?? Number.NaN);
    }
  });

  it('never frames a box smaller than the minimum extent', () => {
    // Two craft a metre apart would otherwise produce a scale of thousands of pixels per
    // metre — a view of nothing, at the most important moment of the run.
    const together = context({
      shipAt: () => eci({ x: metres(6_778_137), y: metres(0), z: metres(0) }),
      targetAt: () => eci({ x: metres(6_778_138), y: metres(0), z: metres(0) }),
    });
    const bounds = followBounds(ENCOUNTER, together, EQUATORIAL_BASIS);
    expect((bounds?.maxU ?? 0) - (bounds?.minU ?? 0)).toBeGreaterThanOrEqual(MIN_FRAME_EXTENT_M);
    expect((bounds?.maxV ?? 0) - (bounds?.minV ?? 0)).toBeGreaterThanOrEqual(MIN_FRAME_EXTENT_M);
  });

  it('frames the ship alone when the contract has no target', () => {
    const solo = context({ targetAt: null, encounterEpoch: null });
    expect(followBounds(START, solo, EQUATORIAL_BASIS)).not.toBeNull();
  });

  it('returns null when nothing in the window can be located', () => {
    // A timeline that answered no epoch. The caller keeps the camera it has rather than
    // being handed a degenerate one.
    const blind = context({ shipAt: () => null, targetAt: null });
    expect(followBounds(START, blind, EQUATORIAL_BASIS)).toBeNull();
  });

  it('skips a sample it cannot locate without losing the rest', () => {
    const patchy = context({
      shipAt: (at) => (at > 2000 && at < 3000 ? null : circle(6_778_137, 0)(at)),
    });
    expect(followBounds(epoch(2500), patchy, EQUATORIAL_BASIS)).not.toBeNull();
  });
});

describe('followCamera — #147’s properties', () => {
  const cameraAt = (at: Epoch, ctx = context()) =>
    followCamera(at, ctx, VIEWPORT, EQUATORIAL_BASIS);

  it('is a pure function of the epoch', () => {
    // The whole "simulation time, not per frame" criterion. A wall-clock ease would
    // return a different camera on the second call, because time would have passed.
    for (const at of [START, ENCOUNTER, epoch(12_345), END]) {
      expect(cameraAt(at)).toEqual(cameraAt(at));
    }
  });

  it('gives the same camera at every playback speed, because speed is not an input', () => {
    // Stated as a signature rather than as a behaviour: there is no speed to pass.
    expect(cameraAt(epoch(9000))).toEqual(cameraAt(epoch(9000)));
  });

  it('changes scale by a bounded ratio across a frame-sized step', () => {
    // #147's scale-jump criterion, measured. At 10 000× a 60 fps frame advances about
    // 167 s of mission time, which is the step used here; a regime switch would show up
    // as a ratio far outside this band.
    const step = 167;
    let previous = cameraAt(START)?.scale ?? Number.NaN;
    for (let at = step; at <= 20_000; at += step) {
      const scale = cameraAt(epoch(at))?.scale ?? Number.NaN;
      const ratio = scale / previous;
      expect(ratio).toBeGreaterThan(0.5);
      expect(ratio).toBeLessThan(2);
      previous = scale;
    }
  });

  it('ends up closer at the encounter than at the start', () => {
    // The behaviour the window exists to produce: the run opens on the orbits and closes
    // on the encounter. Higher scale is more pixels per metre.
    const wide = cameraAt(START)?.scale ?? 0;
    const close = cameraAt(ENCOUNTER)?.scale ?? 0;
    expect(close).toBeGreaterThan(wide);
  });

  it('returns null rather than a degenerate camera when nothing can be framed', () => {
    expect(cameraAt(START, context({ shipAt: () => null, targetAt: null }))).toBeNull();
  });
});

describe('FR-404 — suspend and recentre', () => {
  const camera = createCamera({
    centre: eci({ x: metres(0), y: metres(0), z: metres(0) }),
    scale: 1e-5,
    autoScale: 1e-5,
    basis: EQUATORIAL_BASIS,
    viewport: VIEWPORT,
  });
  const other = { ...camera, scale: 2e-5 };

  it('follows the run while the run owns the camera', () => {
    const state = createFollow(camera);
    expect(followTo(state, other).camera).toBe(other);
  });

  it('stops following once the player has panned or zoomed', () => {
    // FR-404's *"until explicitly recentred"*. A player who panned away to look at
    // something keeps looking at it, however far the run has moved on.
    const suspended = manualFollow(createFollow(camera), other);
    expect(suspended.mode).toBe('suspended');
    expect(followTo(suspended, camera)).toBe(suspended);
  });

  it('returns the same object when there is nothing to adopt', () => {
    const state = createFollow(camera);
    expect(followTo(state, null)).toBe(state);
  });

  it('hands the camera back on recentre', () => {
    const suspended = manualFollow(createFollow(camera), other);
    const recentred = recentreFollow(suspended, camera);
    expect(recentred.mode).toBe('follow');
    expect(recentred.camera).toBe(camera);
  });

  it('keeps the current camera when recentring has nothing to frame', () => {
    const suspended = manualFollow(createFollow(camera), other);
    expect(recentreFollow(suspended, null).camera).toBe(other);
    expect(recentreFollow(suspended, null).mode).toBe('follow');
  });
});
