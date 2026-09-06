/**
 * The title background's transfer — #118.
 *
 * §8.3.1 claims the background is *"a real, propagated LEO→GEO transfer … the actual sim,
 * not an animation"*. That is a physical claim on a screen, so it is checked the way
 * `docs/PHYSICS.md` § Testing asks: against an **independent closed form**, computed here
 * from the vis-viva equation rather than taken from the module under test.
 *
 * The reference is Curtis's statement of the Hohmann transfer, which is standard textbook
 * material and derivable in three lines from vis-viva:
 *
 *   Δv₁ = |√(μ(2/r₁ − 1/aₜ)) − √(μ/r₁)|
 *   Δv₂ = |√(μ/r₂) − √(μ(2/r₂ − 1/aₜ))|,  aₜ = (r₁ + r₂)/2
 *   t   = π√(aₜ³/μ)
 *
 * Written out below rather than imported, so that a bug in `@hh/astro`'s `hohmannTransfer`
 * would fail this test rather than be confirmed by it. The tolerance is `1e-9` relative —
 * float64 round-off over two square roots, not a fudge factor.
 */
import { MU_EARTH, R_EARTH_EQ, R_GEO, elementsFromState } from '@hh/astro';
import { stateAt } from '@hh/sim';
import { describe, expect, it } from 'vitest';

import { BACKGROUND_TIME_SCALE, PARKING_RADIUS_M, buildBackgroundTransfer } from './background.js';

/** Vis-viva, independently. */
const speedOn = (r: number, a: number): number => Math.sqrt(MU_EARTH * (2 / r - 1 / a));

describe('the title background transfer', () => {
  const r1 = PARKING_RADIUS_M;
  const r2 = R_GEO;
  const at = (r1 + r2) / 2;

  it('departs from a 400 km circular orbit', () => {
    expect(PARKING_RADIUS_M).toBe(R_EARTH_EQ + 400_000);
  });

  it('sizes both burns to the closed form', () => {
    const { firstBurnMps, secondBurnMps } = buildBackgroundTransfer();

    const expectedFirst = Math.abs(speedOn(r1, at) - Math.sqrt(MU_EARTH / r1));
    const expectedSecond = Math.abs(Math.sqrt(MU_EARTH / r2) - speedOn(r2, at));

    expect(firstBurnMps).toBeCloseTo(expectedFirst, 9);
    expect(secondBurnMps).toBeCloseTo(expectedSecond, 9);

    // And the pair should total the ~3.9 km/s that makes LEO→GEO the transfer everyone
    // quotes. A sanity band, not an oracle — the assertions above are the real check.
    expect(firstBurnMps + secondBurnMps).toBeGreaterThan(3800);
    expect(firstBurnMps + secondBurnMps).toBeLessThan(4000);
  });

  it('flies the half-ellipse for the closed-form time of flight', () => {
    const { transferSeconds } = buildBackgroundTransfer();
    expect(transferSeconds).toBeCloseTo(Math.PI * Math.sqrt(at ** 3 / MU_EARTH), 6);
  });

  it('propagates three arcs — park, transfer, destination', () => {
    const { timeline } = buildBackgroundTransfer();
    expect(timeline.arcs).toHaveLength(3);
    expect(timeline.impulses).toHaveLength(2);
  });

  /**
   * The claim that matters: the picture is read out of a propagation.
   *
   * If the ship's radius on the last arc is GEO, the burns did what the closed form said
   * they would *and* the propagator agreed — which is the whole of "it is the actual sim".
   * Checked through `stateAt`, which is the same call the component's every frame makes.
   */
  it('arrives on a circular orbit at GEO', () => {
    const { timeline, loopEnd } = buildBackgroundTransfer();

    const arrival = stateAt(timeline, loopEnd);
    expect(arrival.converged).toBe(true);
    if (!arrival.converged) return;

    const elements = elementsFromState(arrival.state.position, arrival.state.velocity, timeline.mu);

    // Within a kilometre of GEO over a quarter-orbit coast, and circular to 1e-4. Both
    // limits are the quantisation of the burns (DEP-09 rounds Δv to 1e-4 m/s), not a
    // tolerance chosen to make this pass.
    const radius = elements.semiLatusRectum / (1 + elements.eccentricity);
    expect(Math.abs(radius - R_GEO)).toBeLessThan(1000);
    expect(elements.eccentricity).toBeLessThan(1e-4);
  });

  it('starts on the parking orbit and reaches the loop point inside the horizon', () => {
    const { timeline, loopEnd } = buildBackgroundTransfer();
    expect(loopEnd).toBeGreaterThan(timeline.startEpoch);
    expect(loopEnd).toBeLessThan(timeline.horizon);
  });

  it("loops at §8.3.1's stated rate", () => {
    expect(BACKGROUND_TIME_SCALE).toBe(2000);
  });

  /** Determinism (§11.4): same inputs, same trajectory, every time. */
  it('is deterministic', () => {
    const a = buildBackgroundTransfer();
    const b = buildBackgroundTransfer();
    expect(a.firstBurnMps).toBe(b.firstBurnMps);
    expect(a.secondBurnMps).toBe(b.secondBurnMps);
    expect(a.loopEnd).toBe(b.loopEnd);
    expect(a.timeline.impulses.map((impulse) => impulse.epoch)).toEqual(
      b.timeline.impulses.map((impulse) => impulse.epoch),
    );
  });
});
