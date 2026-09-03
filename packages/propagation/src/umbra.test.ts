/**
 * Cylindrical umbra intervals (#64, FR-008, DEP-06).
 *
 * ## The independent reference
 *
 * For a circular orbit of radius `r` with the Sun in the orbital plane, a
 * cylindrical shadow of radius `R` subtends a central angle of `2 asin(R/r)`, so
 * the eclipse lasts
 *
 * ```
 * T · asin(R/r) / π
 * ```
 *
 * That is trigonometry on a circle, not orbital mechanics, and it owes nothing to
 * this module. It also lands on two published figures: **36.1 minutes** of darkness
 * per orbit at 400 km, which is the commonly quoted ISS figure, and **69.4 minutes**
 * at geostationary altitude, against the ~70 minutes quoted as the maximum
 * geostationary eclipse near equinox. Both are asserted below.
 *
 * More generally, a circular orbit is eclipsed at all only when its beta angle
 * satisfies `sin β < R/r`. That gives an exact grazing condition to test either
 * side of, which is what #64's "grazing geometry produces no spurious intervals"
 * needs to be checked against something other than an eyeball.
 *
 * For eccentric and open orbits there is no closed form, so the boundaries are
 * checked geometrically instead: the **DOP853 oracle** is propagated to each
 * returned epoch and asked whether the spacecraft really is on the shadow
 * cylinder's surface, on the anti-sunward side.
 */
import {
  MU_EARTH,
  R_EARTH_EQ,
  R_GEO,
  eci,
  epoch,
  period,
  semiMajorAxis,
  stateFromElements,
} from '@hh/astro';
import type { EciVector, Epoch, State } from '@hh/astro';
import { V, metres, radians, seconds } from '@hh/math';
import { describe, expect, it } from 'vitest';

import { createArc } from './arc.js';
import { integrate } from './oracle/index.js';
import { findUmbraIntervals } from './umbra.js';

const START = epoch(0);
/** Sun along +x, in the orbital plane of every equatorial case below. */
const SUN_IN_PLANE: EciVector = eci(V.vec3(1, 0, 0));

const conic = (p: number, e: number, nu = 0.3, inclination = 0, raan = 0, argp = 0): State =>
  stateFromElements(
    {
      semiLatusRectum: metres(p),
      eccentricity: e,
      inclination: radians(inclination),
      raan: radians(raan),
      argp: radians(argp),
      trueAnomaly: radians(nu),
    },
    MU_EARTH,
  );

const arcOf = (state: State, start: Epoch = START) =>
  createArc({ startEpoch: start, endEpoch: epoch(start + 1), state, mu: MU_EARTH });

/** Where the oracle says the spacecraft is at `t`, relative to the shadow cylinder. */
const oracleShadowAt = (
  state: State,
  t: Epoch,
  sun: EciVector,
): { along: number; perp: number } => {
  const result = integrate(state, seconds(t - START), MU_EARTH, { relativeTolerance: 1e-13 });
  if (!result.converged) throw new Error(`oracle failed to reach ${String(t)}`);
  const unit = V.normalize(sun);
  const along = V.dot(result.state.position, unit);
  return {
    along,
    perp: Math.hypot(
      result.state.position.x - along * unit.x,
      result.state.position.y - along * unit.y,
      result.state.position.z - along * unit.z,
    ),
  };
};

describe('a circular orbit with the Sun in its plane', () => {
  it.each([
    ['400 km', 6_778_137, 36.1],
    ['geostationary', R_GEO, 69.4],
  ])(
    'is eclipsed for the closed-form fraction of every revolution at %s',
    (_label, r, publishedMinutes) => {
      const arc = arcOf(conic(r, 0));
      const T = period(semiMajorAxis(arc.elements), MU_EARTH);
      const intervals = findUmbraIntervals(arc, SUN_IN_PLANE, R_EARTH_EQ, START, epoch(2.5 * T));
      const interior = intervals.filter((i) => !i.clippedStart && !i.clippedEnd);

      expect(interior.length).toBeGreaterThanOrEqual(2);
      const expected = (T * Math.asin(R_EARTH_EQ / r)) / Math.PI;
      for (const interval of interior) {
        expect((interval.end - interval.start) / expected).toBeCloseTo(1, 9);
      }

      // And the closed form itself lands on the published figure, to the precision it
      // is published at. This is the check that would catch a wrong constant, which
      // agreeing with our own formula would not.
      expect(expected / 60).toBeCloseTo(publishedMinutes, 1);
    },
  );

  it('repeats once per revolution', () => {
    const arc = arcOf(conic(6_778_137, 0));
    const T = period(semiMajorAxis(arc.elements), MU_EARTH);
    const interior = findUmbraIntervals(arc, SUN_IN_PLANE, R_EARTH_EQ, START, epoch(4 * T)).filter(
      (i) => !i.clippedStart && !i.clippedEnd,
    );

    for (let i = 1; i < interior.length; i++) {
      expect((interior[i]?.start ?? 0) - (interior[i - 1]?.start ?? 0)).toBeCloseTo(T, 6);
    }
  });

  it('puts every boundary on the shadow cylinder, on the anti-sunward side', () => {
    const state = conic(6_778_137, 0);
    const arc = arcOf(state);
    const T = period(semiMajorAxis(arc.elements), MU_EARTH);

    for (const interval of findUmbraIntervals(
      arc,
      SUN_IN_PLANE,
      R_EARTH_EQ,
      START,
      epoch(2.5 * T),
    )) {
      for (const [t, clipped] of [
        [interval.start, interval.clippedStart],
        [interval.end, interval.clippedEnd],
      ] as const) {
        if (clipped) continue;
        const { along, perp } = oracleShadowAt(state, t, SUN_IN_PLANE);
        expect(perp / R_EARTH_EQ).toBeCloseTo(1, 9);
        expect(along).toBeLessThan(0);
      }
    }
  });

  it('is in shadow at the middle of an interval and in sunlight either side', () => {
    const state = conic(6_778_137, 0);
    const arc = arcOf(state);
    const T = period(semiMajorAxis(arc.elements), MU_EARTH);
    const interval = findUmbraIntervals(arc, SUN_IN_PLANE, R_EARTH_EQ, START, epoch(2.5 * T)).find(
      (i) => !i.clippedStart && !i.clippedEnd,
    );

    expect(interval).toBeDefined();
    if (interval === undefined) return;

    const inShadow = (t: Epoch): boolean => {
      const { along, perp } = oracleShadowAt(state, t, SUN_IN_PLANE);
      return along < 0 && perp < R_EARTH_EQ;
    };
    expect(inShadow(epoch((interval.start + interval.end) / 2))).toBe(true);
    expect(inShadow(epoch(interval.start - 30))).toBe(false);
    expect(inShadow(epoch(interval.end + 30))).toBe(false);
  });

  it('is deterministic, ordered and non-overlapping', () => {
    const arc = arcOf(conic(6_778_137, 0));
    const T = period(semiMajorAxis(arc.elements), MU_EARTH);
    const call = () => findUmbraIntervals(arc, SUN_IN_PLANE, R_EARTH_EQ, START, epoch(4 * T));
    const intervals = call();

    expect(intervals.length).toBeGreaterThan(1);
    for (let i = 1; i < intervals.length; i++) {
      expect(intervals[i]?.start).toBeGreaterThan(intervals[i - 1]?.end ?? 0);
    }
    for (const interval of intervals) expect(interval.end).toBeGreaterThan(interval.start);
    expect(call()).toEqual(intervals);
  });
});

describe('orbits that are never eclipsed', () => {
  const RADIUS = 6_778_137;
  const arc = arcOf(conic(RADIUS, 0));
  const T = period(semiMajorAxis(arc.elements), MU_EARTH);

  it('returns empty for a Sun normal to the orbital plane', () => {
    expect(
      findUmbraIntervals(arc, eci(V.vec3(0, 0, 1)), R_EARTH_EQ, START, epoch(3 * T)),
    ).toHaveLength(0);
  });

  it('returns empty just outside the grazing beta angle, and finds an eclipse just inside it', () => {
    // A circular orbit is eclipsed only while `sin beta < R / r`, where beta is the
    // angle between the Sun direction and the orbital plane. This is the boundary,
    // computed from the geometry rather than from a search.
    const grazing = Math.asin(R_EARTH_EQ / RADIUS);
    const sunAt = (beta: number): EciVector => eci(V.vec3(Math.cos(beta), 0, Math.sin(beta)));

    expect(
      findUmbraIntervals(arc, sunAt(grazing + 0.01), R_EARTH_EQ, START, epoch(3 * T)),
    ).toHaveLength(0);
    expect(
      findUmbraIntervals(arc, sunAt(grazing - 0.01), R_EARTH_EQ, START, epoch(3 * T)).length,
    ).toBeGreaterThan(0);
  });

  it('produces no spurious interval exactly at the grazing beta angle', () => {
    // At the boundary the orbit touches the cylinder without entering it. The
    // predicate never flips, so no interval is opened -- there is no zero-width
    // interval and no unpaired entry.
    const grazing = Math.asin(R_EARTH_EQ / RADIUS);
    const intervals = findUmbraIntervals(
      arc,
      eci(V.vec3(Math.cos(grazing), 0, Math.sin(grazing))),
      R_EARTH_EQ,
      START,
      epoch(3 * T),
    );
    for (const interval of intervals) expect(interval.end).toBeGreaterThan(interval.start);
  });

  it('returns empty when the body is too small to cast a shadow across the orbit', () => {
    // A 1 km body at a beta angle that holds the orbit 1 000 km off the Sun line.
    // Note the in-plane Sun would still eclipse: a coplanar circular orbit passes
    // straight through the anti-sunward axis, where the perpendicular distance is
    // zero, so *any* positive body radius shadows it. It is the out-of-plane
    // geometry that makes the body's size the deciding term.
    const beta = Math.asin(1.0e6 / RADIUS);
    const sun = eci(V.vec3(Math.cos(beta), 0, Math.sin(beta)));
    expect(findUmbraIntervals(arc, sun, 1000, START, epoch(3 * T))).toHaveLength(0);
    expect(findUmbraIntervals(arc, sun, 1.1e6, START, epoch(3 * T)).length).toBeGreaterThan(0);
  });
});

describe('an eccentric orbit', () => {
  // A GTO-like transfer: the eclipse near periapsis is short in seconds and ordinary
  // in anomaly, which is the case the anomaly-uniform sample grid exists for.
  const state = conic(1.2e7, 0.72, 0.1);
  const arc = arcOf(state);
  const T = period(semiMajorAxis(arc.elements), MU_EARTH);

  it('puts every boundary on the shadow cylinder', () => {
    const intervals = findUmbraIntervals(arc, SUN_IN_PLANE, R_EARTH_EQ, START, epoch(2.5 * T));
    expect(intervals.length).toBeGreaterThan(0);

    for (const interval of intervals) {
      for (const [t, clipped] of [
        [interval.start, interval.clippedStart],
        [interval.end, interval.clippedEnd],
      ] as const) {
        if (clipped) continue;
        const { along, perp } = oracleShadowAt(state, t, SUN_IN_PLANE);
        expect(perp / R_EARTH_EQ).toBeCloseTo(1, 8);
        expect(along).toBeLessThan(0);
      }
    }
  });

  it('finds the same intervals on a much finer anomaly grid', () => {
    // The default resolves this geometry; a grid four times finer agrees, which is
    // what makes the default defensible rather than lucky.
    const coarse = findUmbraIntervals(arc, SUN_IN_PLANE, R_EARTH_EQ, START, epoch(2.5 * T));
    const fine = findUmbraIntervals(arc, SUN_IN_PLANE, R_EARTH_EQ, START, epoch(2.5 * T), {
      samplesPerRevolution: 256,
    });

    expect(fine).toHaveLength(coarse.length);
    for (let i = 0; i < coarse.length; i++) {
      expect(coarse[i]?.start).toBeCloseTo(fine[i]?.start ?? 0, 4);
      expect(coarse[i]?.end).toBeCloseTo(fine[i]?.end ?? 0, 4);
    }
  });
});

describe('an open orbit', () => {
  it.each([
    ['a hyperbola', 1.5],
    ['a parabola', 1],
  ])('%s passes through the shadow once', (_label, e) => {
    // Aimed so the outbound leg crosses the anti-sunward axis.
    const state = conic(1.0e7, e, -0.9, 0, 0, Math.PI);
    const arc = arcOf(state);
    const intervals = findUmbraIntervals(arc, SUN_IN_PLANE, R_EARTH_EQ, epoch(-4000), epoch(4000));

    expect(intervals.length).toBeLessThanOrEqual(1);
    for (const interval of intervals) {
      const { along, perp } = oracleShadowAt(state, interval.start, SUN_IN_PLANE);
      expect(perp / R_EARTH_EQ).toBeCloseTo(1, 8);
      expect(along).toBeLessThan(0);
    }
  });
});

describe('the search bounds', () => {
  const arc = arcOf(conic(6_778_137, 0));
  const T = period(semiMajorAxis(arc.elements), MU_EARTH);
  const whole = findUmbraIntervals(arc, SUN_IN_PLANE, R_EARTH_EQ, START, epoch(2.5 * T)).find(
    (i) => !i.clippedStart && !i.clippedEnd,
  );

  it('clips an eclipse already in progress at the start', () => {
    expect(whole).toBeDefined();
    if (whole === undefined) return;
    const inside = epoch((whole.start + whole.end) / 2);
    const intervals = findUmbraIntervals(
      arc,
      SUN_IN_PLANE,
      R_EARTH_EQ,
      inside,
      epoch(inside + 4000),
    );

    expect(intervals[0]?.clippedStart).toBe(true);
    expect(intervals[0]?.start).toBe(inside);
    expect(intervals[0]?.end).toBeCloseTo(whole.end, 5);
  });

  it('clips an eclipse still in progress at the end', () => {
    expect(whole).toBeDefined();
    if (whole === undefined) return;
    const inside = epoch((whole.start + whole.end) / 2);
    const intervals = findUmbraIntervals(
      arc,
      SUN_IN_PLANE,
      R_EARTH_EQ,
      epoch(inside - 4000),
      inside,
    );

    const last = intervals[intervals.length - 1];
    expect(last?.clippedEnd).toBe(true);
    expect(last?.end).toBe(inside);
    expect(last?.start).toBeCloseTo(whole.start, 5);
  });

  it('finds nothing in a zero-length interval', () => {
    expect(findUmbraIntervals(arc, SUN_IN_PLANE, R_EARTH_EQ, START, START)).toHaveLength(0);
  });

  it.each([
    ['a zero body radius', 0],
    ['a negative body radius', -1],
    ['a non-finite body radius', Number.NaN],
  ])('rejects %s', (_label, radius) => {
    expect(() => findUmbraIntervals(arc, SUN_IN_PLANE, radius, START, epoch(T))).toThrow(
      RangeError,
    );
  });

  it('rejects a zero Sun direction', () => {
    expect(() =>
      findUmbraIntervals(arc, eci(V.vec3(0, 0, 0)), R_EARTH_EQ, START, epoch(T)),
    ).toThrow(RangeError);
  });

  it('rejects a reversed interval', () => {
    expect(() => findUmbraIntervals(arc, SUN_IN_PLANE, R_EARTH_EQ, epoch(10), START)).toThrow(
      RangeError,
    );
  });

  it('does not care about the length of the Sun vector', () => {
    const short = findUmbraIntervals(arc, SUN_IN_PLANE, R_EARTH_EQ, START, epoch(2 * T));
    const long = findUmbraIntervals(
      arc,
      eci(V.vec3(1.5e11, 0, 0)),
      R_EARTH_EQ,
      START,
      epoch(2 * T),
    );
    expect(long).toEqual(short);
  });
});
