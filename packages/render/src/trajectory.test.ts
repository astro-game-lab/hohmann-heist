import { MU_EARTH, period, semiMajorAxis } from '@hh/astro';
import type { OrbitShape } from '@hh/astro';
import { radians } from '@hh/math';
import { metres } from '@hh/math';
import { describe, expect, it } from 'vitest';

import {
  DASH_CURRENT_ORBIT,
  DASH_PLANNED_FALLBACK,
  DASH_TARGET_ORBIT,
  TRAJECTORY_PATTERNS,
} from './style.js';
import { DEFAULT_DOTS_PER_REVOLUTION, MAX_DOTS, equalTimeDots } from './trajectory.js';

/** An orbit with a given semi-latus rectum and eccentricity, equatorial, at periapsis. */
const orbit = (semiLatusRectumM: number, eccentricity: number, trueAnomaly = 0): OrbitShape => ({
  semiLatusRectum: metres(semiLatusRectumM),
  eccentricity,
  inclination: radians(0),
  raan: radians(0),
  argp: radians(0),
  trueAnomaly: radians(trueAnomaly),
});

/**
 * Distance between two positions, `NaN` if either is missing.
 *
 * Accepts `undefined` rather than making every call site assert: indexed reads are
 * `T | undefined` under `noUncheckedIndexedAccess`, and `NaN` propagates into a failed
 * assertion where a fallback of zero could quietly satisfy one.
 */
const distance = (
  a: { x: number; y: number; z: number } | undefined,
  b: { x: number; y: number; z: number } | undefined,
): number =>
  a === undefined || b === undefined ? Number.NaN : Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

const periodOf = (shape: OrbitShape): number => period(semiMajorAxis(shape), MU_EARTH);

/**
 * Read one element of an array as a number.
 *
 * `noUncheckedIndexedAccess` types every indexed read as possibly `undefined`, and the
 * lint config rules out both ways of asserting otherwise. `NaN` rather than a fallback
 * value, so a missing element fails the assertion it was standing in for.
 */
const num = (array: readonly number[], index: number): number => array[index] ?? Number.NaN;

describe('the three trajectory styles are patterns, not colours', () => {
  it('gives each of the three a distinct pattern', () => {
    // §8.3.4 principle 5 and #108's first criterion. Roughly one man in twelve is
    // red-green colour blind, and the planner is three overlapping lines on a dark
    // field: if colour were the only channel, a third of the information would be
    // missing for a meaningful slice of players.
    const asKeys = TRAJECTORY_PATTERNS.map((p) => JSON.stringify(p));
    expect(new Set(asKeys).size).toBe(3);
  });

  it('distinguishes them in greyscale, because none of them mentions a colour', () => {
    // The patterns are pure geometry — there is no colour in them to lose. That is what
    // "distinguishable in greyscale and to a monochromat" means structurally.
    expect(DASH_CURRENT_ORBIT).toEqual([]);
    expect(DASH_TARGET_ORBIT.length).toBeGreaterThan(0);
    // Long marks with short gaps read as a broken line; short marks with long gaps read
    // as dots. That contrast is what separates target from plan at a glance.
    expect(num(DASH_TARGET_ORBIT, 0)).toBeGreaterThan(num(DASH_PLANNED_FALLBACK, 0));
    expect(num(DASH_PLANNED_FALLBACK, 1)).toBeGreaterThan(num(DASH_PLANNED_FALLBACK, 0) * 2);
  });
});

describe('equal-time dots', () => {
  it('samples one full revolution at the requested count', () => {
    const shape = orbit(7_000_000, 0.1);
    const dots = equalTimeDots({
      elements: shape,
      mu: MU_EARTH,
      durationSeconds: periodOf(shape),
    });

    // One revolution at N dots per revolution gives N intervals, so N + 1 samples —
    // the last landing back on the first.
    expect(dots.points).toHaveLength(DEFAULT_DOTS_PER_REVOLUTION + 1);
    expect(dots.intervalSeconds).toBeCloseTo(periodOf(shape) / DEFAULT_DOTS_PER_REVOLUTION, 6);
    expect(dots.capped).toBe(false);
  });

  it('closes the loop: the sample one period later is where it started', () => {
    const shape = orbit(7_000_000, 0.3);
    const dots = equalTimeDots({
      elements: shape,
      mu: MU_EARTH,
      durationSeconds: periodOf(shape),
    });

    const first = dots.points[0];
    const last = dots.points[dots.points.length - 1];
    expect(first).toBeDefined();
    expect(last).toBeDefined();
    // Kepler's solver tolerance over a whole revolution, at a 7 000 km radius.
    expect(distance(first, last)).toBeLessThan(1);
  });

  /**
   * The assertion #108 exists for.
   *
   * A naive implementation reaches for `setLineDash`, which spaces marks by arc length
   * because that is the only thing it can measure. The result looks almost right and says
   * the exact opposite of what §9.3 wants: equal-distance dots claim the speed is
   * constant, which is false for every eccentric orbit and false in a way this game is
   * trying to teach.
   *
   * The physical content: with dots at equal time, the gap between consecutive dots is
   * the distance travelled in that time, so the gap *is* the speed. Vis-viva gives
   * `v_p / v_a = (1 + e) / (1 - e)`, and that ratio should appear directly in the
   * spacing.
   */
  describe('spacing is equal in time, not in distance', () => {
    for (const e of [0.1, 0.3, 0.6]) {
      it(`shows v_p / v_a = (1+e)/(1-e) in the dot gaps at e = ${String(e)}`, () => {
        const shape = orbit(7_000_000, e);
        const dots = equalTimeDots({
          elements: shape,
          mu: MU_EARTH,
          durationSeconds: periodOf(shape),
          // A fine sampling, so a gap is a good approximation to v * dt rather than a
          // chord across a large arc.
          dotsPerRevolution: 720,
          maxDots: 1024,
        });

        const gaps: number[] = [];
        for (let i = 1; i < dots.points.length; i++) {
          gaps.push(distance(dots.points[i - 1], dots.points[i]));
        }

        // The arc starts at periapsis, so the first gap is the periapsis one and the
        // gap half a revolution later is the apoapsis one.
        const atPeriapsis = num(gaps, 0);
        const atApoapsis = num(gaps, Math.floor(gaps.length / 2));

        const expected = (1 + e) / (1 - e);
        // Within 1%: a gap is a chord over a finite step, not an instantaneous speed, so
        // it under-reads curvature slightly. 720 samples per revolution puts that error
        // well below the tolerance, and the tolerance is the measured limit rather than
        // a number tuned until it passed.
        expect(atPeriapsis / atApoapsis).toBeCloseTo(expected, 2);

        // And the direction, stated plainly: dots are sparse at periapsis and dense at
        // apoapsis, which is §9.3's sentence turned into an assertion.
        expect(atPeriapsis).toBeGreaterThan(atApoapsis);
      });
    }

    it('would fail for equal-distance spacing, which is the point', () => {
      // The counter-example, so the assertion above cannot pass vacuously. If dots were
      // spaced by arc length, every gap would be identical and the ratio would be 1.
      const e = 0.6;
      const shape = orbit(7_000_000, e);
      const dots = equalTimeDots({
        elements: shape,
        mu: MU_EARTH,
        durationSeconds: periodOf(shape),
        dotsPerRevolution: 720,
        maxDots: 1024,
      });

      const gaps: number[] = [];
      for (let i = 1; i < dots.points.length; i++) {
        gaps.push(distance(dots.points[i - 1], dots.points[i]));
      }
      const smallest = Math.min(...gaps);
      const largest = Math.max(...gaps);
      // Nowhere near uniform: a factor of four at e = 0.6.
      expect(largest / smallest).toBeCloseTo((1 + e) / (1 - e), 1);
    });

    it('is uniform for a circular orbit, where speed genuinely is constant', () => {
      // The degenerate case that separates "spaced by time" from "spaced by nothing in
      // particular": at e = 0 the two conventions agree, and they should.
      const shape = orbit(7_000_000, 0);
      const dots = equalTimeDots({
        elements: shape,
        mu: MU_EARTH,
        durationSeconds: periodOf(shape),
        dotsPerRevolution: 360,
      });

      const gaps: number[] = [];
      for (let i = 1; i < dots.points.length; i++) {
        gaps.push(distance(dots.points[i - 1], dots.points[i]));
      }
      expect(Math.max(...gaps) / Math.min(...gaps)).toBeCloseTo(1, 9);
    });
  });

  it('starts where the arc starts, not at periapsis', () => {
    // A plan's arc runs from one impulse to the next, so it begins wherever the previous
    // burn left the spacecraft.
    const atApoapsis = orbit(7_000_000, 0.4, Math.PI);
    const dots = equalTimeDots({
      elements: atApoapsis,
      mu: MU_EARTH,
      durationSeconds: 60,
      dotsPerRevolution: 720,
    });

    const first = dots.points[0];
    // Apoapsis radius is p / (1 - e).
    const expectedRadius = 7_000_000 / (1 - 0.4);
    expect(Math.hypot(first?.x ?? 0, first?.y ?? 0, first?.z ?? 0)).toBeCloseTo(expectedRadius, 3);
  });

  it('stops at the arc’s end rather than running round the whole conic', () => {
    const shape = orbit(7_000_000, 0.1);
    const full = periodOf(shape);
    const dots = equalTimeDots({
      elements: shape,
      mu: MU_EARTH,
      durationSeconds: full / 4,
    });
    expect(dots.points.length).toBeCloseTo(DEFAULT_DOTS_PER_REVOLUTION / 4 + 1, 0);
  });

  it('caps a long arc and says so', () => {
    // A 14-hour horizon at 96 dots a revolution is thousands of dots; the frame budget
    // says no, and the caller is told rather than left to wonder.
    const shape = orbit(7_000_000, 0.1);
    const dots = equalTimeDots({
      elements: shape,
      mu: MU_EARTH,
      durationSeconds: periodOf(shape) * 50,
    });
    expect(dots.points).toHaveLength(MAX_DOTS);
    expect(dots.capped).toBe(true);
  });

  it('rejects an orbit it cannot sample rather than drawing nothing', () => {
    // An empty result would draw as a missing trajectory, which reads as a rendering bug
    // rather than the input error it is. §6.4's L4 makes a hyperbolic plan illegal
    // anyway, so the caller has a bigger problem than dot spacing.
    const hyperbolic = orbit(7_000_000, 1.4);
    expect(() =>
      equalTimeDots({ elements: hyperbolic, mu: MU_EARTH, durationSeconds: 100 }),
    ).toThrow(RangeError);

    const parabolic = orbit(7_000_000, 1);
    expect(() =>
      equalTimeDots({ elements: parabolic, mu: MU_EARTH, durationSeconds: 100 }),
    ).toThrow(RangeError);

    const shape = orbit(7_000_000, 0.1);
    expect(() => equalTimeDots({ elements: shape, mu: 0, durationSeconds: 100 })).toThrow(
      RangeError,
    );
    expect(() => equalTimeDots({ elements: shape, mu: MU_EARTH, durationSeconds: 0 })).toThrow(
      RangeError,
    );
  });
});
