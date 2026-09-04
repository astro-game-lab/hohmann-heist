/**
 * #103's suspend/restore transition, "testable as a state machine, without a canvas and
 * without a clock" — which is the criterion this file exists to discharge. Every camera
 * below is a plain value and every elapsed time is an argument.
 */
import { metres, V } from '@hh/math';
import { eci } from '@hh/astro';
import {
  EQUATORIAL_BASIS,
  REFRAME_DURATION_SECONDS,
  boundsOfSphere,
  frameBounds,
  needsReframe,
  type Camera,
} from '@hh/render';
import { describe, expect, it } from 'vitest';

import {
  advanceFraming,
  contentChanged,
  createFraming,
  isEasing,
  manualCamera,
  recentreFraming,
} from './framing.js';

const VIEWPORT = { width: 1200, height: 800, devicePixelRatio: 1 };

/** A camera framing a sphere of `radius` — the shape auto-framing actually produces. */
const framing = (radius: number): Camera =>
  frameBounds(boundsOfSphere(radius), VIEWPORT, EQUATORIAL_BASIS);

const NEAR = framing(7_000_000);
/** Far enough that `needsReframe`'s 20% scale test fires; asserted below, not assumed. */
const FAR = framing(42_000_000);

describe('the fixtures are on the right sides of the 20% gate', () => {
  it('FAR needs a re-frame from NEAR, and NEAR does not need one from itself', () => {
    // Stated first, because every test below is only meaningful if this holds. A fixture
    // that quietly fell inside the threshold would make half this file pass vacuously.
    expect(needsReframe(NEAR, FAR)).toBe(true);
    expect(needsReframe(NEAR, NEAR)).toBe(false);
  });
});

describe('auto mode follows the content', () => {
  it('starts at rest', () => {
    const state = createFraming(NEAR);
    expect(state.mode).toBe('auto');
    expect(isEasing(state)).toBe(false);
    expect(state.camera).toBe(NEAR);
  });

  it('starts an ease when the content moves past the threshold', () => {
    const state = contentChanged(createFraming(NEAR), FAR);
    expect(isEasing(state)).toBe(true);
    expect(state.ease?.to).toBe(FAR);
    // The camera has not moved yet — the ease begins on the next advance, not on the
    // decision to ease.
    expect(state.camera).toBe(NEAR);
  });

  it('does not twitch on a change below the threshold (§8.4, ordinary scrubbing)', () => {
    const state = createFraming(NEAR);
    // The same object back, not merely an equal one: the caller skips a re-render on
    // identity, so this is part of the contract rather than an implementation detail.
    expect(contentChanged(state, NEAR)).toBe(state);
  });

  it('measures a mid-ease change against the ease target, not the moving camera', () => {
    const easing = advanceFraming(contentChanged(createFraming(NEAR), FAR), 0.2, false);
    expect(isEasing(easing)).toBe(true);
    // The camera is now somewhere between NEAR and FAR. Asking again for FAR must not
    // restart the ease — measured from the moving camera it would look like a fresh 20%
    // change every frame, and the ease would never converge.
    const again = contentChanged(easing, FAR);
    expect(again).toBe(easing);
  });
});

describe('the ease runs against the caller_s clock (§9.4)', () => {
  it('lands exactly on the target after REFRAME_DURATION_SECONDS', () => {
    let state = contentChanged(createFraming(NEAR), FAR);
    state = advanceFraming(state, REFRAME_DURATION_SECONDS, false);
    expect(isEasing(state)).toBe(false);
    expect(state.camera).toBe(FAR);
  });

  it('lands exactly on the target after a long frame rather than overshooting it', () => {
    // #103's "a long frame lands exactly on the target rather than past it". `easeInOut`
    // is a cubic and does not saturate, so an unclamped t = 3.75 would put the camera
    // well beyond FAR. The assertion is identity with FAR, which only holds if t was
    // clamped to 1.
    const state = advanceFraming(
      contentChanged(createFraming(NEAR), FAR),
      REFRAME_DURATION_SECONDS * 3.75,
      false,
    );
    expect(state.camera).toBe(FAR);
    expect(isEasing(state)).toBe(false);
  });

  it('accumulates across frames', () => {
    let state = contentChanged(createFraming(NEAR), FAR);
    const scales: number[] = [];
    for (let i = 0; i < 4; i++) {
      state = advanceFraming(state, REFRAME_DURATION_SECONDS / 4, false);
      scales.push(state.camera.scale);
    }
    // Monotone towards the target, and arriving on the last step.
    expect(scales[3]).toBe(FAR.scale);
    expect(scales[0]).not.toBe(NEAR.scale);
    for (let i = 1; i < scales.length; i++) {
      expect(Math.abs((scales[i] ?? 0) - FAR.scale)).toBeLessThan(
        Math.abs((scales[i - 1] ?? 0) - FAR.scale),
      );
    }
  });

  it('ignores a negative delta rather than running the ease backwards', () => {
    const started = contentChanged(createFraming(NEAR), FAR);
    expect(advanceFraming(started, -5, false).ease?.elapsedSeconds).toBe(0);
  });

  it('does nothing when no ease is in flight', () => {
    const state = createFraming(NEAR);
    expect(advanceFraming(state, 1, false)).toBe(state);
  });

  it('collapses to a single frame under prefers-reduced-motion (§9.4)', () => {
    // The target is still adopted — the preference removes the animation, not the
    // re-framing. A reduced-motion player left on a stale camera would be the bug.
    const state = advanceFraming(contentChanged(createFraming(NEAR), FAR), 1 / 60, true);
    expect(state.camera).toBe(FAR);
    expect(isEasing(state)).toBe(false);
  });
});

describe('manual control suspends auto-framing until recentred (FR-404, §8.5.2)', () => {
  const panned: Camera = {
    ...NEAR,
    centre: eci(V.vec3(metres(1_000_000), metres(0), metres(0))),
  };

  it('suspends on a manual camera and abandons any ease in flight', () => {
    const easing = contentChanged(createFraming(NEAR), FAR);
    const state = manualCamera(easing, panned);
    expect(state.mode).toBe('suspended');
    expect(isEasing(state)).toBe(false);
    expect(state.camera).toBe(panned);
  });

  it('ignores content changes while suspended, however large', () => {
    const state = manualCamera(createFraming(NEAR), panned);
    expect(contentChanged(state, FAR)).toBe(state);
    expect(contentChanged(state, framing(200_000_000))).toBe(state);
  });

  it('restores auto-framing on recentre and eases to the target', () => {
    const suspended = manualCamera(createFraming(NEAR), panned);
    const state = recentreFraming(suspended, FAR);
    expect(state.mode).toBe('auto');
    expect(isEasing(state)).toBe(true);
    expect(advanceFraming(state, REFRAME_DURATION_SECONDS, false).camera).toBe(FAR);
  });

  it('recentres even when the target is unchanged — the gate does not apply to a press', () => {
    // The case the ⌖ button exists for: the player panned away from a plan that has not
    // changed since. `needsReframe(panned, NEAR)` may well decline, and if recentre
    // consulted it the button would do nothing.
    const suspended = manualCamera(createFraming(NEAR), panned);
    const state = recentreFraming(suspended, NEAR);
    expect(isEasing(state)).toBe(true);
    expect(advanceFraming(state, REFRAME_DURATION_SECONDS, false).camera).toBe(NEAR);
  });

  it('a suspended camera stays suspended across an ease it started before suspending', () => {
    let state = contentChanged(createFraming(NEAR), FAR);
    state = manualCamera(state, panned);
    state = advanceFraming(state, REFRAME_DURATION_SECONDS, false);
    expect(state.mode).toBe('suspended');
    expect(state.camera).toBe(panned);
  });
});
