import { describe, expect, it } from 'vitest';

import type { Radians } from '@hh/math';
import { angularDifference, metres, metresPerSec, normalize, radians, TAU, V } from '@hh/math';

import { MU_EARTH } from './constants.js';
import type { OrbitShape } from './elements.js';
import { elementsFromState, stateFromElements } from './elements.js';
import type { EquinoctialElements } from './equinoctial.js';
import {
  classicalFromEquinoctial,
  eccentricity,
  equinoctialFromClassical,
  equinoctialFromState,
  inclination,
  stateFromEquinoctial,
} from './equinoctial.js';
import { eci } from './frames.js';

const position = (x: number, y: number, z: number) => eci(V.vec3(metres(x), metres(y), metres(z)));
const velocity = (x: number, y: number, z: number) =>
  eci(V.vec3(metresPerSec(x), metresPerSec(y), metresPerSec(z)));

const shape = (
  semiMajorAxis: number,
  e: number,
  i: number,
  raan: number,
  argp: number,
  nu: number,
): OrbitShape => ({
  semiLatusRectum: metres(semiMajorAxis * (1 - e * e)),
  eccentricity: e,
  inclination: radians(i),
  raan: normalize(raan),
  argp: normalize(argp),
  trueAnomaly: normalize(nu),
});

/** Relative comparison, with the deviation in the failure message. */
const expectRelative = (actual: number, expected: number, tol: number, what: string): void => {
  const deviation = Math.abs(actual - expected) / Math.max(Math.abs(expected), Number.MIN_VALUE);
  expect(
    deviation,
    `${what}: expected ${String(expected)}, got ${String(actual)} (relative ${deviation.toExponential(2)})`,
  ).toBeLessThanOrEqual(tol);
};

/** Distance between two vectors, as a fraction of the first one's magnitude. */
const expectClose = <T extends number>(
  actual: V.Vec3<T>,
  expected: V.Vec3<T>,
  tol: number,
  what: string,
): void => {
  const scale = V.norm(expected);
  const deviation = V.norm(V.sub(actual, expected)) / scale;
  expect(
    deviation,
    `${what}: off by ${V.norm(V.sub(actual, expected)).toExponential(2)} on a magnitude of ${scale.toExponential(2)} (relative ${deviation.toExponential(2)})`,
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
 * The grid.
 *
 * docs/PRODUCT.md section 7.4 states the domain of validity as altitudes from
 * 100 km to about 400 000 km and eccentricity up to 0.95, so the semi-major axes
 * span 6.6e6 m (a low circular orbit) to 4e8 m (past lunar distance) and the
 * eccentricities run to 0.95. Inclination includes both poles of both charts,
 * 0 and pi exactly, which is the whole point of the set.
 *
 * Curated rather than randomised, and deliberately so: the randomised sweep is
 * #53's job, and a fixed grid that names its degenerate cases explicitly is what
 * makes a regression here readable.
 * ---------------------------------------------------------------------------
 */

const SEMI_MAJOR_AXES = [6.6e6, 7.0e6, 4.2164e7, 1.2e8, 4.0e8];
const ECCENTRICITIES = [0, 1e-12, 1e-8, 0.001, 0.3, 0.7, 0.95];
const INCLINATIONS = [0, 1e-9, 0.4, Math.PI / 2, Math.PI - 0.4, Math.PI - 1e-9, Math.PI];
const ANGLES = [0, 0.7, 2.5, 4.1, 5.9];

/** Every combination the grid describes, as classical shapes. */
const grid = (): OrbitShape[] => {
  const out: OrbitShape[] = [];
  for (const a of SEMI_MAJOR_AXES)
    for (const e of ECCENTRICITIES)
      for (const i of INCLINATIONS)
        // raan and nu take the same angle; argp takes a different one from the
        // same list, so the three are never accidentally equal.
        for (let n = 0; n < ANGLES.length; n++) {
          const raan = ANGLES[n] ?? 0;
          const argp = ANGLES[(n + 2) % ANGLES.length] ?? 0;
          out.push(shape(a, e, i, raan, argp, raan));
        }
  return out;
};

describe('equinoctial elements — round trip through a Cartesian state', () => {
  /*
   * TOLERANCE. 1e-12 relative is the figure the issue and docs/PRODUCT.md section
   * 7.6 Tier 2 ask for. The observed worst case across this grid is around 1e-14,
   * two orders inside it; the gap is headroom for the trigonometry, not slack
   * hiding a defect. Tightening to the observed value would make the test a
   * tripwire for irrelevant last-bit changes in Math.sin between engines, which
   * docs/PHYSICS.md explicitly declines to depend on.
   */
  const ROUND_TRIP_TOL = 1e-12;

  it('reproduces the state it came from, across the whole grid', () => {
    for (const s of grid()) {
      const start = stateFromElements(s, MU_EARTH);
      const elements = equinoctialFromState(start.position, start.velocity, MU_EARTH);
      const back = stateFromEquinoctial(elements, MU_EARTH);

      const label = `a=${String(s.semiLatusRectum)} e=${String(s.eccentricity)} i=${String(s.inclination)}`;
      expectClose(back.position, start.position, ROUND_TRIP_TOL, `position (${label})`);
      expectClose(back.velocity, start.velocity, ROUND_TRIP_TOL, `velocity (${label})`);
    }
  });

  it('reproduces the elements it came from, across the whole grid', () => {
    // i = pi/2 is excluded and gets its own test below: it sits exactly on the
    // boundary between the two charts, where which one is chosen is decided by the
    // sign of a quantity that is zero in exact arithmetic.
    for (const s of grid().filter((c) => c.inclination !== Math.PI / 2)) {
      const start = stateFromElements(s, MU_EARTH);
      const first = equinoctialFromState(start.position, start.velocity, MU_EARTH);
      const middle = stateFromEquinoctial(first, MU_EARTH);
      const second = equinoctialFromState(middle.position, middle.velocity, MU_EARTH);

      const label = `a=${String(s.semiLatusRectum)} e=${String(s.eccentricity)} i=${String(s.inclination)}`;
      expectRelative(second.semiLatusRectum, first.semiLatusRectum, ROUND_TRIP_TOL, `p (${label})`);
      expect(Math.abs(second.f - first.f), `f (${label})`).toBeLessThanOrEqual(1e-12);
      expect(Math.abs(second.g - first.g), `g (${label})`).toBeLessThanOrEqual(1e-12);
      expect(Math.abs(second.h - first.h), `h (${label})`).toBeLessThanOrEqual(1e-12);
      expect(Math.abs(second.k - first.k), `k (${label})`).toBeLessThanOrEqual(1e-12);
      expect(second.retrograde, `chart (${label})`).toBe(first.retrograde);
      expectAngle(second.trueLongitude, first.trueLongitude, 1e-11, `L (${label})`);
    }
  });

  it('may change chart at exactly i = pi/2, and still describes the same orbit', () => {
    /*
     * The one place the element round trip is not an identity, stated rather than
     * excluded quietly. At i = pi/2 the angular momentum's z component is zero in
     * exact arithmetic, so its computed sign is round-off, and a state that comes
     * back through the other chart is expressed in different h and k. That is not
     * a defect: both charts are exactly as well conditioned here (s^2 = 2 in each),
     * and they describe the same orbit, which is what the assertion checks.
     *
     * It does not threaten determinism (NFR-008) either. equinoctialFromState is a
     * pure function of the state, so the same state always yields the same chart;
     * what varies is only whether a *round trip* returns to the chart it started in.
     */
    let flipped = 0;
    for (const s of grid().filter((c) => c.inclination === Math.PI / 2)) {
      const start = stateFromElements(s, MU_EARTH);
      const first = equinoctialFromState(start.position, start.velocity, MU_EARTH);
      const middle = stateFromEquinoctial(first, MU_EARTH);
      const second = equinoctialFromState(middle.position, middle.velocity, MU_EARTH);
      if (second.retrograde !== first.retrograde) flipped++;

      // Whichever chart it lands in, the state is preserved.
      expectClose(
        stateFromEquinoctial(second, MU_EARTH).position,
        start.position,
        1e-12,
        'position',
      );
      expectClose(
        stateFromEquinoctial(second, MU_EARTH).velocity,
        start.velocity,
        1e-12,
        'velocity',
      );
      // Both charts put the pole at 45 degrees, so |(h, k)| is 1 either way.
      expect(Math.hypot(second.h, second.k)).toBeCloseTo(1, 10);
    }
    // Guards the premise: if this ever reaches zero the test has stopped covering
    // the case it exists for, and the exclusion above is no longer needed.
    expect(flipped).toBeGreaterThan(0);
  });
});

describe('equinoctial elements — agreement with the classical set', () => {
  /*
   * The classical path is already validated against Curtis (elements.test.ts), so
   * agreeing with it over the non-degenerate part of the grid is what pins the
   * basis-vector derivation in equinoctial.ts. Degenerate cases are excluded here
   * on purpose: that is exactly where the classical angles carry no information,
   * so agreement there would be meaningless in both directions.
   */
  const nonDegenerate = () =>
    grid().filter(
      (s) => s.eccentricity > 1e-6 && Math.sin(s.inclination) > 1e-6 && s.eccentricity < 1,
    );

  it('converting a state directly agrees with converting its classical elements', () => {
    for (const s of nonDegenerate()) {
      const state = stateFromElements(s, MU_EARTH);
      const direct = equinoctialFromState(state.position, state.velocity, MU_EARTH);
      const viaClassical = equinoctialFromClassical(
        elementsFromState(state.position, state.velocity, MU_EARTH),
      );

      expect(direct.retrograde).toBe(viaClassical.retrograde);
      expectRelative(direct.semiLatusRectum, viaClassical.semiLatusRectum, 1e-12, 'p');
      expect(Math.abs(direct.f - viaClassical.f)).toBeLessThanOrEqual(1e-11);
      expect(Math.abs(direct.g - viaClassical.g)).toBeLessThanOrEqual(1e-11);
      expect(Math.abs(direct.h - viaClassical.h)).toBeLessThanOrEqual(1e-11);
      expect(Math.abs(direct.k - viaClassical.k)).toBeLessThanOrEqual(1e-11);
      expectAngle(direct.trueLongitude, viaClassical.trueLongitude, 1e-10, 'L');
    }
  });

  it('recovers the classical elements it was built from', () => {
    for (const s of nonDegenerate()) {
      const back = classicalFromEquinoctial(equinoctialFromClassical(s));

      expectRelative(back.semiLatusRectum, s.semiLatusRectum, 1e-14, 'p');
      expectRelative(back.eccentricity, s.eccentricity, 1e-12, 'e');
      expectAngle(back.inclination, s.inclination, 1e-12, 'i');
      expectAngle(back.raan, s.raan, 1e-11, 'raan');
      expectAngle(back.argp, s.argp, 1e-11, 'argp');
      expectAngle(back.trueAnomaly, s.trueAnomaly, 1e-11, 'nu');
      expect(back.degeneracy).toBe('none');
    }
  });

  it('applies the same degeneracy conventions elements.ts does', () => {
    // One case per convention, checked against what elementsFromState reports for
    // the same physical state rather than against a restatement of the rule.
    const cases: readonly OrbitShape[] = [
      shape(7.0e6, 0, 0.4, 1.1, 0, 2.2), // circular, inclined
      shape(7.0e6, 0.2, 0, 0, 1.1, 2.2), // equatorial, eccentric
      shape(7.0e6, 0, 0, 0, 0, 2.2), // both
      shape(7.0e6, 0, Math.PI, 0, 0, 2.2), // both, retrograde equatorial
    ];

    for (const s of cases) {
      const state = stateFromElements(s, MU_EARTH);
      const classical = elementsFromState(state.position, state.velocity, MU_EARTH);
      const viaEquinoctial = classicalFromEquinoctial(
        equinoctialFromState(state.position, state.velocity, MU_EARTH),
      );

      expect(viaEquinoctial.degeneracy).toBe(classical.degeneracy);
      expectAngle(viaEquinoctial.raan, classical.raan, 1e-9, 'raan');
      expectAngle(viaEquinoctial.argp, classical.argp, 1e-9, 'argp');
      expectAngle(viaEquinoctial.trueAnomaly, classical.trueAnomaly, 1e-9, 'nu');
    }
  });
});

describe('equinoctial elements — non-singular where the classical set is not', () => {
  const degenerate: readonly (readonly [string, OrbitShape])[] = [
    ['circular', shape(7.0e6, 0, 0.6, 1.3, 2.0, 3.1)],
    ['equatorial, prograde', shape(7.0e6, 0.3, 0, 0, 2.0, 3.1)],
    ['equatorial, retrograde', shape(7.0e6, 0.3, Math.PI, 0, 2.0, 3.1)],
    ['circular and equatorial', shape(7.0e6, 0, 0, 0, 0, 3.1)],
    ['circular and retrograde equatorial', shape(7.0e6, 0, Math.PI, 0, 0, 3.1)],
  ];

  it.each(degenerate)('has every element defined and finite: %s', (_label, s) => {
    const state = stateFromElements(s, MU_EARTH);
    const elements = equinoctialFromState(state.position, state.velocity, MU_EARTH);

    for (const [name, value] of Object.entries(elements)) {
      if (typeof value === 'number') {
        expect(Number.isFinite(value), `${name} is ${String(value)}`).toBe(true);
      }
    }
    expect(elements.trueLongitude).toBeGreaterThanOrEqual(0);
    expect(elements.trueLongitude).toBeLessThan(TAU);
  });

  it.each(degenerate)('still round-trips exactly: %s', (_label, s) => {
    const start = stateFromElements(s, MU_EARTH);
    const back = stateFromEquinoctial(
      equinoctialFromState(start.position, start.velocity, MU_EARTH),
      MU_EARTH,
    );
    expect(V.norm(V.sub(back.position, start.position))).toBeLessThanOrEqual(
      1e-12 * V.norm(start.position),
    );
    expect(V.norm(V.sub(back.velocity, start.velocity))).toBeLessThanOrEqual(
      1e-12 * V.norm(start.velocity),
    );
  });

  it('never divides by a small number: s^2 stays in [1, 2] at every inclination', () => {
    // The design claim from the module docstring, asserted rather than described.
    // s^2 = 1 + h^2 + k^2 = 2 / (1 + I cos i), which the chart selection bounds.
    for (let n = 0; n <= 720; n++) {
      const i = (Math.PI * n) / 720;
      const state = stateFromElements(shape(7.0e6, 0.1, i, 1.0, 2.0, 3.0), MU_EARTH);
      const { h, k } = equinoctialFromState(state.position, state.velocity, MU_EARTH);
      const s2 = 1 + h * h + k * k;
      expect(s2, `i = ${String(i)} rad`).toBeGreaterThanOrEqual(1);
      expect(s2, `i = ${String(i)} rad`).toBeLessThanOrEqual(2 + 1e-12);
    }
  });

  it('switches chart at i = pi/2, where the two charts agree', () => {
    // Either chart is valid here; what matters is that they describe the same
    // orbit, which is what makes the switch safe.
    const s = shape(7.0e6, 0.1, Math.PI / 2, 1.0, 2.0, 3.0);
    const state = stateFromElements(s, MU_EARTH);
    const chosen = equinoctialFromState(state.position, state.velocity, MU_EARTH);
    const other: EquinoctialElements = { ...chosen, retrograde: !chosen.retrograde };

    // Flipping the flag alone does not describe the same orbit; rebuilding through
    // the classical set in the other chart does.
    const rebuilt = equinoctialFromClassical(classicalFromEquinoctial(chosen));
    expect(Math.hypot(chosen.h, chosen.k)).toBeCloseTo(1, 12);
    expect(Math.hypot(other.h, other.k)).toBeCloseTo(1, 12);

    const viaOther = stateFromEquinoctial(rebuilt, MU_EARTH);
    expect(V.norm(V.sub(viaOther.position, state.position))).toBeLessThanOrEqual(
      1e-12 * V.norm(state.position),
    );
  });
});

describe('equinoctial elements — conditioning at low eccentricity', () => {
  /*
   * ---------------------------------------------------------------------------
   * The measurement that justifies the element set existing, and deliberately not
   * the measurement #47 asked for.
   *
   * #47 asked for a test showing the equinoctial route recovers *eccentricity*
   * more accurately than the classical route. It does not, and cannot: e at 1e-10
   * carries about 5e-16 of absolute error whichever way it is computed, because
   * that is the float64 representation limit of the state itself rather than a
   * property of the algebra. Three formulations were measured -- the eccentricity
   * vector as elements.ts computes it, (v x h)/mu - rhat, and hypot(p/r - 1,
   * h (r.v)/(mu r)) -- and all three sit on the same floor, within 20 percent of
   * each other. Asserting otherwise would have meant tuning a test until a false
   * claim passed. The second test below pins that down so the false claim cannot
   * quietly reappear.
   *
   * What is real is the *periapsis direction*, and there the gap is enormous.
   * argp is an angle to a direction whose length is e, so its error scales as
   * 5e-16 / e; f and g are components of that direction and stay flat. Two
   * separate things go wrong for the classical set as e falls, and they are
   * asserted separately:
   *
   *   above e = 1e-8   argp is returned, and degrades by a decade per decade of e
   *   below e = 1e-8   argp is not returned at all -- the circular convention sets
   *                    it to zero and reports degeneracy 'circular'
   * ---------------------------------------------------------------------------
   */

  const RAAN = 1.0;
  const ARGP = 2.0;
  const INCLINATION = 0.4;
  const LONGITUDE_OF_PERIAPSIS = ARGP + RAAN;

  /** Worst error in each route's periapsis direction, over a full revolution. */
  const measure = (
    e: number,
  ): { argpError: number; fgError: number; classicalEError: number; equinoctialEError: number } => {
    let argpError = 0;
    let fgError = 0;
    let classicalEError = 0;
    let equinoctialEError = 0;

    for (let n = 0; n < 32; n++) {
      const nu = (TAU * n) / 32;
      const state = stateFromElements(shape(7.0e6, e, INCLINATION, RAAN, ARGP, nu), MU_EARTH);

      const classical = elementsFromState(state.position, state.velocity, MU_EARTH);
      argpError = Math.max(argpError, Math.abs(angularDifference(ARGP, classical.argp)));
      classicalEError = Math.max(classicalEError, Math.abs(classical.eccentricity - e));

      const equinoctial = equinoctialFromState(state.position, state.velocity, MU_EARTH);
      fgError = Math.max(
        fgError,
        Math.hypot(
          equinoctial.f - e * Math.cos(LONGITUDE_OF_PERIAPSIS),
          equinoctial.g - e * Math.sin(LONGITUDE_OF_PERIAPSIS),
        ),
      );
      equinoctialEError = Math.max(equinoctialEError, Math.abs(eccentricity(equinoctial) - e));
    }
    return { argpError, fgError, classicalEError, equinoctialEError };
  };

  it('loses a decade of argument of periapsis for every decade of eccentricity', () => {
    // Above the degeneracy threshold, where the classical set still returns an
    // angle. Measured: 5.4e-12, 4.4e-10, 4.8e-9, 1.7e-8 -- one decade per decade.
    const at1e4 = measure(1e-4);
    const at1e6 = measure(1e-6);
    const at1e7 = measure(1e-7);
    const at2e8 = measure(2e-8);
    const decades = [at1e4, at1e6, at1e7, at2e8];

    // Monotone: every decade of e costs precision in argp.
    expect(at1e6.argpError).toBeGreaterThan(at1e4.argpError);
    expect(at1e7.argpError).toBeGreaterThan(at1e6.argpError);
    expect(at2e8.argpError).toBeGreaterThan(at1e7.argpError);

    // Two decades of e cost about two decades of argp: 5.4e-12 to 4.4e-10.
    expect(at1e6.argpError).toBeGreaterThan(at1e4.argpError * 30);
    expect(at2e8.argpError).toBeGreaterThan(1e-9);

    // The equinoctial direction, over the same range, does not move.
    for (const measured of decades) {
      expect(measured.fgError).toBeLessThan(1e-14);
    }
    expect(at2e8.fgError).toBeLessThan(at2e8.argpError * 1e-5);
  });

  it('keeps the periapsis direction below the threshold, where the classical set discards it', () => {
    // Below e = 1e-8 the classical convention suppresses argp entirely, so the
    // direction is not merely imprecise -- it is gone, and the returned zero is a
    // convention rather than a measurement.
    for (const e of [1e-9, 1e-10, 1e-12]) {
      const state = stateFromElements(shape(7.0e6, e, INCLINATION, RAAN, ARGP, 1.3), MU_EARTH);

      const classical = elementsFromState(state.position, state.velocity, MU_EARTH);
      expect(classical.degeneracy).toBe('circular');
      expect(classical.argp).toBe(0);

      // The equinoctial set still carries it, to the representation floor.
      const { fgError } = measure(e);
      expect(fgError).toBeLessThan(1e-14);
    }
  });

  it('does not claim better eccentricity magnitude, because there is none to claim', () => {
    // The honest counterpart to the assertions above. Both routes sit on the same
    // floor, so a future change that appears to "improve" one of them should fail
    // here and be understood rather than celebrated.
    for (const e of [1e-4, 1e-8, 1e-10, 1e-12]) {
      const { classicalEError, equinoctialEError } = measure(e);

      expect(classicalEError).toBeLessThan(1e-14);
      expect(equinoctialEError).toBeLessThan(1e-14);

      // Within an order of magnitude of each other, in both directions. The floor
      // itself is around 5e-16 and is a property of the state, not of the route.
      const floor = 1e-16;
      expect(equinoctialEError).toBeLessThan(Math.max(classicalEError, floor) * 10);
      expect(classicalEError).toBeLessThan(Math.max(equinoctialEError, floor) * 10);
    }
  });
});

describe('equinoctial elements — derived accessors and rejected inputs', () => {
  it('reports eccentricity and inclination consistently with the classical set', () => {
    for (const s of [
      shape(7.0e6, 0.3, 0.4, 1.0, 2.0, 3.0),
      shape(7.0e6, 0.3, Math.PI - 0.4, 1.0, 2.0, 3.0),
      shape(7.0e6, 0.0, 0.0, 0, 0, 3.0),
      shape(7.0e6, 0.0, Math.PI, 0, 0, 3.0),
    ]) {
      const state = stateFromElements(s, MU_EARTH);
      const elements = equinoctialFromState(state.position, state.velocity, MU_EARTH);
      // Absolute, not relative: three of these cases are exactly circular, where a
      // relative comparison against zero is not a comparison at all.
      expect(Math.abs(eccentricity(elements) - s.eccentricity)).toBeLessThanOrEqual(
        1e-8 * Math.max(s.eccentricity, 1),
      );
      expectAngle(inclination(elements), s.inclination, 1e-12, 'i');
    }
  });

  it('rejects a rectilinear orbit rather than returning NaN', () => {
    expect(() =>
      equinoctialFromState(position(7.0e6, 0, 0), velocity(1000, 0, 0), MU_EARTH),
    ).toThrow(RangeError);
  });

  it('rejects a non-positive or non-finite semi-latus rectum', () => {
    const base = equinoctialFromClassical(shape(7.0e6, 0.1, 0.4, 1, 2, 3));
    expect(() => stateFromEquinoctial({ ...base, semiLatusRectum: metres(0) }, MU_EARTH)).toThrow(
      RangeError,
    );
    expect(() =>
      stateFromEquinoctial(
        { ...base, semiLatusRectum: metres(Number.POSITIVE_INFINITY) },
        MU_EARTH,
      ),
    ).toThrow(RangeError);
  });

  it('rejects a true longitude outside the asymptotes of an open orbit', () => {
    // A hyperbola with e = 2 and its periapsis at longitude 0: 1 + 2 cos L is
    // negative for L near pi, where the trajectory does not exist.
    const hyperbolic: EquinoctialElements = {
      semiLatusRectum: metres(1.0e7),
      f: 2,
      g: 0,
      h: 0,
      k: 0,
      trueLongitude: radians(Math.PI),
      retrograde: false,
    };
    expect(() => stateFromEquinoctial(hyperbolic, MU_EARTH)).toThrow(RangeError);
    // And is fine at periapsis.
    expect(() =>
      stateFromEquinoctial({ ...hyperbolic, trueLongitude: radians(0) }, MU_EARTH),
    ).not.toThrow();
  });

  it('normalises the true longitude to [0, 2pi)', () => {
    for (const s of grid().slice(0, 200)) {
      const state = stateFromElements(s, MU_EARTH);
      const { trueLongitude } = equinoctialFromState(state.position, state.velocity, MU_EARTH);
      expect(trueLongitude).toBeGreaterThanOrEqual(0);
      expect(trueLongitude).toBeLessThan(TAU);
    }
  });
});
