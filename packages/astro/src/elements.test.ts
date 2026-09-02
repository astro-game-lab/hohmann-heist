import { describe, expect, it } from 'vitest';

import type { Radians } from '@hh/math';
import { angularDifference, metres, metresPerSec, radians, toDegrees, V } from '@hh/math';

import { MU_EARTH, R_GEO } from './constants.js';
import type { ClassicalElements, Degeneracy, OrbitShape } from './elements.js';
import {
  apoapsisRadius,
  elementsFromState,
  periapsisRadius,
  semiMajorAxis,
  specificAngularMomentum,
  stateFromElements,
} from './elements.js';
import { eci } from './frames.js';

const KM = 1e3;

/**
 * Curtis works in km, km/s and km^3/s^2 throughout. Conversion happens here, at the
 * boundary, and nowhere else.
 *
 * The book's mu is 398,600 km^3/s^2, which differs from our `MU_EARTH` by 1.1e-8
 * relative. The tests below pass *the book's* value, not ours. At the tolerance
 * these tests run to the difference is immaterial, but a reference test that
 * silently substitutes a different constant is no longer testing what it cites.
 */
const MU_CURTIS = 398_600 * KM ** 3;

const position = (x: number, y: number, z: number) => eci(V.vec3(metres(x), metres(y), metres(z)));
const velocity = (x: number, y: number, z: number) =>
  eci(V.vec3(metresPerSec(x), metresPerSec(y), metresPerSec(z)));

/** Relative comparison, with the deviation in the failure message. */
const expectRelative = (actual: number, expected: number, tol: number, what: string): void => {
  const deviation = Math.abs(actual - expected) / Math.abs(expected);
  expect(
    deviation,
    `${what}: expected ${String(expected)}, got ${String(actual)} (relative ${deviation.toExponential(2)})`,
  ).toBeLessThanOrEqual(tol);
};

/** Angular comparison that survives the wrap at 0 / 2pi. */
const expectAngle = (actual: Radians, expected: number, tol: number, what: string): void => {
  const deviation = Math.abs(angularDifference(expected, actual));
  expect(
    deviation,
    `${what}: expected ${String(expected)} rad, got ${String(actual)} rad (off by ${deviation.toExponential(2)})`,
  ).toBeLessThanOrEqual(tol);
};

/*
 * ---------------------------------------------------------------------------
 * Tier 3 — independent reference
 *
 * Curtis, H.D., "Orbital Mechanics for Engineering Students", 4th edition,
 * Butterworth-Heinemann / Elsevier, 2020. ISBN 978-0-08-102133-0.
 *
 * Both examples were read from the book itself, per the process rule in
 * docs/PRODUCT.md section 7.6. Values below are transcribed from the printed
 * pages; nothing here was copied out of docs/PRODUCT.md.
 *
 * TOLERANCE. These run to 1e-3 relative, and that number is the *book's* printed
 * precision, not a knob turned until the suite went green. Curtis prints four
 * significant figures and rounds his intermediate steps: an inclination printed as
 * 153.2 deg has a half-ulp of 0.05 deg, which is 3.3e-4 relative, and the observed
 * deviation is 3.2e-4 — just inside where rounding alone puts it. The remaining
 * quantities land between 1e-5 and 3.9e-4. Tightening past 1e-3 would be asserting
 * digits the book never printed.
 * ---------------------------------------------------------------------------
 */

const CURTIS_TOL = 1e-3;

describe('Curtis 4th ed., Example 4.3 (section 4.4, pp. 193-195) — state to elements', () => {
  // Given, from the printed example.
  const r = position(-6045 * KM, -3490 * KM, 2500 * KM);
  const v = velocity(-3.457 * KM, 6.618 * KM, 2.533 * KM);

  const elements = elementsFromState(r, v, MU_CURTIS);

  it('recovers the six orbital elements the book prints', () => {
    // Curtis solves this with his Algorithm 4.2.
    expectRelative(specificAngularMomentum(elements, MU_CURTIS), 58_310 * KM ** 2, CURTIS_TOL, 'h');
    expectRelative(toDegrees(elements.inclination), 153.2, CURTIS_TOL, 'inclination');
    expectRelative(toDegrees(elements.raan), 255.3, CURTIS_TOL, 'RAAN');
    expectRelative(elements.eccentricity, 0.1712, CURTIS_TOL, 'eccentricity');
    expectRelative(toDegrees(elements.argp), 20.07, CURTIS_TOL, 'argument of periapsis');
    expectRelative(toDegrees(elements.trueAnomaly), 28.45, CURTIS_TOL, 'true anomaly');
  });

  it('recovers the derived quantities the book goes on to compute', () => {
    expectRelative(periapsisRadius(elements), 7284 * KM, CURTIS_TOL, 'periapsis radius');
    expectRelative(apoapsisRadius(elements), 10_290 * KM, CURTIS_TOL, 'apoapsis radius');
    expectRelative(semiMajorAxis(elements), 8788 * KM, CURTIS_TOL, 'semi-major axis');
  });

  it('is a retrograde ellipse with no degenerate axis', () => {
    // i > 90 deg, which the book remarks on. Both angular elements are meaningful.
    expect(toDegrees(elements.inclination)).toBeGreaterThan(90);
    expect(elements.eccentricity).toBeLessThan(1);
    expect(elements.degeneracy).toBe<Degeneracy>('none');
  });
});

describe('Curtis 4th ed., Example 4.7 (section 4.6, p. 211) — elements to state', () => {
  // Given, from the printed example. Curtis specifies h rather than p; p = h^2 / mu.
  const H = 80_000 * KM ** 2;
  const shape: OrbitShape = {
    semiLatusRectum: metres((H * H) / MU_CURTIS),
    eccentricity: 1.4,
    inclination: radians(Math.PI / 6),
    raan: radians((40 * Math.PI) / 180),
    argp: radians(Math.PI / 3),
    trueAnomaly: radians(Math.PI / 6),
  };

  it('reproduces the perifocal state', () => {
    // The book prints the perifocal intermediates before rotating them. Zeroing the
    // three orientation angles makes the inertial frame coincide with the perifocal
    // one, which reaches those intermediates through the public API rather than
    // widening it to expose them.
    const { position: r, velocity: v } = stateFromElements(
      { ...shape, inclination: radians(0), raan: radians(0), argp: radians(0) },
      MU_CURTIS,
    );
    expectRelative(r.x, 6285.0 * KM, CURTIS_TOL, 'r_pqw x');
    expectRelative(r.y, 3628.6 * KM, CURTIS_TOL, 'r_pqw y');
    expect(r.z).toBe(0);
    expectRelative(v.x, -2.4913 * KM, CURTIS_TOL, 'v_pqw x');
    expectRelative(v.y, 11.29 * KM, CURTIS_TOL, 'v_pqw y');
    expect(v.z).toBe(0);
  });

  it('reproduces the geocentric equatorial state', () => {
    // Curtis solves this with his Algorithm 4.5.
    const { position: r, velocity: v } = stateFromElements(shape, MU_CURTIS);
    expectRelative(r.x, -4040 * KM, CURTIS_TOL, 'r_eci x');
    expectRelative(r.y, 4815 * KM, CURTIS_TOL, 'r_eci y');
    expectRelative(r.z, 3629 * KM, CURTIS_TOL, 'r_eci z');
    expectRelative(v.x, -10.39 * KM, CURTIS_TOL, 'v_eci x');
    expectRelative(v.y, -4.772 * KM, CURTIS_TOL, 'v_eci y');
    expectRelative(v.z, 1.744 * KM, CURTIS_TOL, 'v_eci z');
  });

  it('is hyperbolic, and the inverse recovers the book’s elements exactly', () => {
    // Not a book value — this closes the loop between the two cited algorithms, so a
    // sign error that cancelled between them would still be caught here.
    const state = stateFromElements(shape, MU_CURTIS);
    const back = elementsFromState(state.position, state.velocity, MU_CURTIS);
    expect(back.eccentricity).toBeGreaterThan(1);
    expectRelative(back.semiLatusRectum, shape.semiLatusRectum, 1e-12, 'p');
    expectRelative(back.eccentricity, shape.eccentricity, 1e-12, 'e');
    expectAngle(back.inclination, shape.inclination, 1e-12, 'inclination');
    expectAngle(back.raan, shape.raan, 1e-12, 'RAAN');
    expectAngle(back.argp, shape.argp, 1e-12, 'argument of periapsis');
    expectAngle(back.trueAnomaly, shape.trueAnomaly, 1e-12, 'true anomaly');
  });
});

/*
 * ---------------------------------------------------------------------------
 * Tier 1 — closed form, derived by hand rather than taken from a reference.
 * ---------------------------------------------------------------------------
 */

describe('closed-form states', () => {
  it('matches the hand-derived state at periapsis', () => {
    // At periapsis the radius is a(1-e) and the velocity is purely transverse with
    // magnitude sqrt(mu(1+e) / (a(1-e))). Both follow from the conic equation and
    // vis-viva in two lines, independently of anything in elements.ts.
    const a = 12_000 * KM;
    const e = 0.25;
    const { position: r, velocity: v } = stateFromElements(
      {
        semiLatusRectum: metres(a * (1 - e * e)),
        eccentricity: e,
        inclination: radians(0),
        raan: radians(0),
        argp: radians(0),
        trueAnomaly: radians(0),
      },
      MU_EARTH,
    );

    const expectedRadius = a * (1 - e);
    const expectedSpeed = Math.sqrt((MU_EARTH * (1 + e)) / (a * (1 - e)));

    expectRelative(V.norm(r), expectedRadius, 1e-12, 'periapsis radius');
    expectRelative(V.norm(v), expectedSpeed, 1e-12, 'periapsis speed');
    // Purely transverse: no radial component at an apsis.
    expect(Math.abs(V.dot(r, v)) / (V.norm(r) * V.norm(v))).toBeLessThan(1e-15);
  });

  it('reads a circular equatorial orbit at GEO as circular and equatorial', () => {
    const speed = Math.sqrt(MU_EARTH / R_GEO);
    const elements = elementsFromState(position(R_GEO, 0, 0), velocity(0, speed, 0), MU_EARTH);

    expectRelative(elements.semiLatusRectum, R_GEO, 1e-12, 'p');
    expect(elements.eccentricity).toBeLessThan(1e-15);
    expect(elements.inclination).toBeLessThan(1e-15);
    expect(elements.degeneracy).toBe<Degeneracy>('circular-equatorial');
    // Both meaningless angles are suppressed to zero, not left as noise.
    expect(elements.raan).toBe(0);
    expect(elements.argp).toBe(0);
    // The surviving angle is the true longitude, and the state sits on the x-axis.
    expectAngle(elements.trueAnomaly, 0, 1e-12, 'true longitude');
  });

  it('holds |r x v| = sqrt(mu p) and the vis-viva energy for a converted state', () => {
    // Two invariants that are independent of the conversion: the first is the
    // definition of p, the second is the energy integral of the two-body problem.
    const shape: OrbitShape = {
      semiLatusRectum: metres(11_000 * KM),
      eccentricity: 0.35,
      inclination: radians(0.7),
      raan: radians(1.9),
      argp: radians(2.6),
      trueAnomaly: radians(1.1),
    };
    const { position: r, velocity: v } = stateFromElements(shape, MU_EARTH);

    const h = V.norm(V.cross(r, v));
    expectRelative(
      h,
      Math.sqrt(MU_EARTH * shape.semiLatusRectum),
      1e-12,
      'specific angular momentum',
    );

    const energy = V.normSq(v) / 2 - MU_EARTH / V.norm(r);
    expectRelative(energy, -MU_EARTH / (2 * semiMajorAxis(shape)), 1e-12, 'specific energy');
  });

  it('gives a parabola zero energy and an infinite semi-major axis', () => {
    const shape: OrbitShape = {
      semiLatusRectum: metres(14_000 * KM),
      eccentricity: 1,
      inclination: radians(0.4),
      raan: radians(0.2),
      argp: radians(1.5),
      trueAnomaly: radians(0.8),
    };
    const { position: r, velocity: v } = stateFromElements(shape, MU_EARTH);

    expect(semiMajorAxis(shape)).toBe(Number.POSITIVE_INFINITY);
    const energy = V.normSq(v) / 2 - MU_EARTH / V.norm(r);
    // Scale-relative: the two terms are each ~1e7, so an absolute epsilon would be
    // meaningless. Zero within float64 cancellation of quantities that size.
    expect(Math.abs(energy) / (MU_EARTH / V.norm(r))).toBeLessThan(1e-15);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Tier 2 — round trips, including every degenerate combination.
 *
 * The randomised property suite belongs to #53. This is a curated grid, chosen so
 * that each singularity and each conic class appears at least once.
 * ---------------------------------------------------------------------------
 */

interface RoundTripCase {
  readonly name: string;
  readonly shape: OrbitShape;
  readonly degeneracy: Degeneracy;
}

const shape = (
  e: number,
  i: number,
  raan: number,
  argp: number,
  nu: number,
  p = 9_000 * KM,
): OrbitShape => ({
  semiLatusRectum: metres(p),
  eccentricity: e,
  inclination: radians(i),
  raan: radians(raan),
  argp: radians(argp),
  trueAnomaly: radians(nu),
});

const ROUND_TRIP: readonly RoundTripCase[] = [
  { name: 'general ellipse', shape: shape(0.3, 0.7, 1.2, 2.4, 0.9), degeneracy: 'none' },
  { name: 'eccentric ellipse', shape: shape(0.9, 1.1, 4.5, 0.3, 3.7), degeneracy: 'none' },
  { name: 'polar orbit', shape: shape(0.4, Math.PI / 2, 0.5, 1.0, 3.0), degeneracy: 'none' },
  { name: 'parabola', shape: shape(1, 0.6, 2.2, 1.4, 0.8), degeneracy: 'none' },
  { name: 'hyperbola', shape: shape(1.5, 0.9, 3.3, 2.1, 0.5), degeneracy: 'none' },
  // Circular: argp is suppressed, so the input has to carry the canonical 0 for the
  // round trip to be an identity rather than an approximation.
  { name: 'circular inclined', shape: shape(0, 0.6, 1.1, 0, 2.0), degeneracy: 'circular' },
  // Equatorial: raan is suppressed. Both orientations, because the node vector
  // vanishes at i = 0 and at i = pi alike.
  {
    name: 'equatorial ellipse, prograde',
    shape: shape(0.2, 0, 0, 1.3, 0.4),
    degeneracy: 'equatorial',
  },
  {
    name: 'equatorial ellipse, retrograde',
    shape: shape(0.2, Math.PI, 0, 1.3, 0.4),
    degeneracy: 'equatorial',
  },
  {
    name: 'circular equatorial, prograde',
    shape: shape(0, 0, 0, 0, 1.7),
    degeneracy: 'circular-equatorial',
  },
  {
    name: 'circular equatorial, retrograde',
    shape: shape(0, Math.PI, 0, 0, 1.7),
    degeneracy: 'circular-equatorial',
  },
];

describe('elements -> state -> elements', () => {
  it.each(ROUND_TRIP)('is the identity for a $name', ({ shape: input, degeneracy }) => {
    const { position: r, velocity: v } = stateFromElements(input, MU_EARTH);
    const back: ClassicalElements = elementsFromState(r, v, MU_EARTH);

    expect(back.degeneracy).toBe(degeneracy);
    expectRelative(back.semiLatusRectum, input.semiLatusRectum, 1e-12, 'p');
    expect(Math.abs(back.eccentricity - input.eccentricity)).toBeLessThanOrEqual(1e-12);
    expectAngle(back.inclination, input.inclination, 1e-12, 'inclination');
    expectAngle(back.raan, input.raan, 1e-12, 'RAAN');
    expectAngle(back.argp, input.argp, 1e-12, 'argument of periapsis');
    expectAngle(back.trueAnomaly, input.trueAnomaly, 1e-12, 'true anomaly');
  });
});

describe('state -> elements -> state', () => {
  it.each(ROUND_TRIP)('is the identity for a $name', ({ shape: input }) => {
    const original = stateFromElements(input, MU_EARTH);
    const rebuilt = stateFromElements(
      elementsFromState(original.position, original.velocity, MU_EARTH),
      MU_EARTH,
    );

    expect(
      V.distance(rebuilt.position, original.position) / V.norm(original.position),
    ).toBeLessThan(1e-12);
    expect(
      V.distance(rebuilt.velocity, original.velocity) / V.norm(original.velocity),
    ).toBeLessThan(1e-12);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Error paths. Every one of these would otherwise return a plausible-looking
 * number that is not a position.
 * ---------------------------------------------------------------------------
 */

describe('rejected inputs', () => {
  it('rejects a rectilinear state rather than returning NaN elements', () => {
    // Position and velocity parallel: h = 0, the orbital plane does not exist.
    expect(() =>
      elementsFromState(position(7000 * KM, 0, 0), velocity(1000, 0, 0), MU_EARTH),
    ).toThrow(RangeError);
  });

  it('rejects a true anomaly beyond the asymptotes of a hyperbola', () => {
    // For e = 1.5 the limiting true anomaly is acos(-1/e) = 2.3005 rad. Past it the
    // trajectory does not exist and 1 + e cos(nu) has gone negative.
    expect(() => stateFromElements(shape(1.5, 0.3, 0.4, 0.5, 2.5), MU_EARTH)).toThrow(RangeError);
    // Just inside it is fine.
    expect(() => stateFromElements(shape(1.5, 0.3, 0.4, 0.5, 2.2), MU_EARTH)).not.toThrow();
  });

  it('rejects a non-positive or non-finite semi-latus rectum', () => {
    expect(() => stateFromElements(shape(0.1, 0, 0, 0, 0, 0), MU_EARTH)).toThrow(RangeError);
    expect(() => stateFromElements(shape(0.1, 0, 0, 0, 0, -1), MU_EARTH)).toThrow(RangeError);
    expect(() =>
      stateFromElements(shape(0.1, 0, 0, 0, 0, Number.POSITIVE_INFINITY), MU_EARTH),
    ).toThrow(RangeError);
  });

  it('rejects a negative eccentricity', () => {
    expect(() => stateFromElements(shape(-0.1, 0, 0, 0, 0), MU_EARTH)).toThrow(RangeError);
  });

  it('refuses to report an apoapsis for an open orbit', () => {
    expect(() => apoapsisRadius(shape(1, 0, 0, 0, 0))).toThrow(RangeError);
    expect(() => apoapsisRadius(shape(1.5, 0, 0, 0, 0))).toThrow(RangeError);
  });
});

describe('derived quantities', () => {
  it('reports a negative semi-major axis for a hyperbola, by convention', () => {
    expect(semiMajorAxis(shape(1.5, 0, 0, 0, 0))).toBeLessThan(0);
  });

  it('relates periapsis, apoapsis and the semi-major axis', () => {
    const s = shape(0.42, 0.3, 0.1, 0.2, 0.5);
    expectRelative(
      (periapsisRadius(s) + apoapsisRadius(s)) / 2,
      semiMajorAxis(s),
      1e-12,
      'a from rp and ra',
    );
  });
});
