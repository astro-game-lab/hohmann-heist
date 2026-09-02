import { describe, expect, it } from 'vitest';

import { metres, normalize, radians, seconds, TAU, toDegrees, V } from '@hh/math';

import { eccentricFromTrue, meanFromEccentric, trueFromEccentric } from './anomaly.js';
import { MU_EARTH, R_EARTH_EQ } from './constants.js';
import type { Seconds } from '@hh/math';

import type { OrbitShape, State } from './elements.js';
import {
  elementsFromState,
  periapsisRadius,
  semiMajorAxis,
  specificAngularMomentum,
  stateFromElements,
} from './elements.js';
import { eci } from './frames.js';
import { solveLambert, stumpffC, stumpffS } from './lambert.js';
import { solveKeplerElliptic } from './kepler.js';
import { meanMotion, period } from './twobody.js';

const position = (x: number, y: number, z: number) => eci(V.vec3(metres(x), metres(y), metres(z)));

const shape = (
  p: number,
  e: number,
  i: number,
  raan: number,
  argp: number,
  nu: number,
): OrbitShape => ({
  semiLatusRectum: metres(p),
  eccentricity: e,
  inclination: radians(i),
  raan: normalize(raan),
  argp: normalize(argp),
  trueAnomaly: normalize(nu),
});

/** Relative comparison, with the deviation in the failure message. */
const expectRelative = (actual: number, expected: number, tol: number, what: string): void => {
  const deviation = Math.abs(actual - expected) / Math.abs(expected);
  expect(
    deviation,
    `${what}: expected ${String(expected)}, got ${String(actual)} (relative ${deviation.toExponential(2)})`,
  ).toBeLessThanOrEqual(tol);
};

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
    `${what}: off by ${V.norm(V.sub(actual, expected)).toExponential(2)} on ${scale.toExponential(2)} (relative ${deviation.toExponential(2)})`,
  ).toBeLessThanOrEqual(tol);
};

/*
 * ---------------------------------------------------------------------------
 * The oracles.
 *
 * Two closed-form oracles that do not depend on the Lambert solver at all, plus
 * the Tier 3 reference cases from Curtis at the bottom of this file:
 *
 *   1. An orbit built by stateFromElements, sampled at two true anomalies, with
 *      the elapsed time between them computed from Kepler's equation. The right
 *      answer is then known exactly -- it is the orbit's own velocity at each
 *      sample -- and Lambert has to find it without being told which orbit.
 *
 *   2. Propagating the returned departure velocity forward by the requested time
 *      and checking it arrives at r2. This is the Tier 2 row the issue names, and
 *      it goes through elements.ts and kepler.ts rather than through anything in
 *      lambert.ts.
 *
 * Both are genuinely independent of the code under test while remaining inside
 * the repository. The Curtis examples are the independent check from outside it.
 * ---------------------------------------------------------------------------
 */

/** Elapsed time from one true anomaly to another on a closed orbit, forwards. */
const timeBetween = (s: OrbitShape, nuFrom: number, nuTo: number): Seconds => {
  const e = s.eccentricity;
  const meanFrom = meanFromEccentric(eccentricFromTrue(nuFrom, e), e);
  const meanTo = meanFromEccentric(eccentricFromTrue(nuTo, e), e);
  return seconds(normalize(meanTo - meanFrom) / meanMotion(semiMajorAxis(s), MU_EARTH));
};

/** Kepler propagation of a state, through the element set and the Kepler solver. */
const propagate = (state: State, dt: number): State => {
  const elements = elementsFromState(state.position, state.velocity, MU_EARTH);
  const e = elements.eccentricity;
  const a = semiMajorAxis(elements);

  const mean =
    meanFromEccentric(eccentricFromTrue(elements.trueAnomaly, e), e) + meanMotion(a, MU_EARTH) * dt;
  const solved = solveKeplerElliptic(mean, e);
  if (!solved.converged) throw new Error('the propagation oracle failed to solve Kepler');

  return stateFromElements(
    { ...elements, trueAnomaly: trueFromEccentric(solved.anomaly, e) },
    MU_EARTH,
  );
};

describe('Stumpff functions', () => {
  it('agree with their closed forms across the series threshold', () => {
    // The series is used below |z| = 0.1 and the closed form above it. If they
    // disagreed at the boundary the solver would take a discontinuous step there.
    for (const z of [0.0999, 0.1, 0.1001, -0.0999, -0.1, -0.1001]) {
      const closedC =
        z > 0 ? (1 - Math.cos(Math.sqrt(z))) / z : (Math.cosh(Math.sqrt(-z)) - 1) / -z;
      const closedS =
        z > 0
          ? (Math.sqrt(z) - Math.sin(Math.sqrt(z))) / (z * Math.sqrt(z))
          : (Math.sinh(Math.sqrt(-z)) - Math.sqrt(-z)) / (-z * Math.sqrt(-z));

      // 1e-13 relative, and the looseness is the closed form's, not the series'.
      // At |z| = 0.1 the closed form has already lost a couple of digits to
      // cancellation — which is the whole reason the series exists — and the
      // observed disagreement is 1.1e-14. Asserting tighter would be asserting the
      // closed form is more accurate than it is.
      expectRelative(stumpffC(z), closedC, 1e-13, `C(${String(z)})`);
      expectRelative(stumpffS(z), closedS, 1e-13, `S(${String(z)})`);
    }
  });

  it('take their limiting values at zero', () => {
    expect(stumpffC(0)).toBeCloseTo(0.5, 15);
    expect(stumpffS(0)).toBeCloseTo(1 / 6, 15);
  });

  it('satisfy the identity C + 3S = 1 at z = 0 and stay positive on the domain', () => {
    // C(0) = 1/2, S(0) = 1/6.
    expect(stumpffC(0) + 3 * stumpffS(0)).toBeCloseTo(1, 15);
    for (let z = -50; z < TAU * TAU; z += 0.37) {
      expect(stumpffC(z), `C(${String(z)})`).toBeGreaterThan(0);
      expect(stumpffS(z), `S(${String(z)})`).toBeGreaterThan(0);
    }
  });
});

describe('Lambert — recovers an orbit it was not told about', () => {
  /*
   * The primary oracle. Each case samples a known orbit at two true anomalies,
   * computes the elapsed time from Kepler's equation, and asks Lambert for the
   * transfer. The answer must be the orbit's own velocity at both ends.
   *
   * TOLERANCE 1e-9 relative on the velocities. The solver converges the time of
   * flight to 1e-12 relative, and the velocity is recovered from it through the
   * Lagrange coefficients, which lose a few digits where g is small. 1e-9 is the
   * figure section 7.6 Tier 2 states for Lambert and the observed worst case
   * across these cases is 4e-12, three orders inside it.
   */
  const cases: readonly (readonly [string, OrbitShape, number, number])[] = [
    ['circular LEO, quarter turn', shape(6.9e6, 0, 0.0, 0, 0, 0), 0, Math.PI / 2],
    ['circular LEO, past half a turn', shape(6.9e6, 0, 0.0, 0, 0, 0), 0.3, 0.3 + 4.0],
    ['inclined circular, quarter turn', shape(7.2e6, 0, 0.9, 1.1, 0, 0), 0.2, 0.2 + 1.4],
    ['mild ellipse', shape(9.0e6, 0.2, 0.4, 1.1, 2.3, 0), 0.4, 2.6],
    ['eccentric, across periapsis', shape(9.0e6, 0.7, 0.4, 1.1, 2.3, 0), 5.6, 0.9],
    ['eccentric, across apoapsis', shape(9.0e6, 0.7, 0.4, 1.1, 2.3, 0), 2.2, 4.3],
    ['high eccentricity, short arc', shape(1.2e7, 0.9, 0.6, 2.2, 0.4, 0), 1.0, 1.6],
    ['GEO-scale, long arc', shape(4.2e7, 0.1, 0.05, 0.3, 0.7, 0), 0.5, 5.4],
  ];

  it.each(cases)('%s', (_label, orbit, nuFrom, nuTo) => {
    const from = stateFromElements({ ...orbit, trueAnomaly: normalize(nuFrom) }, MU_EARTH);
    const to = stateFromElements({ ...orbit, trueAnomaly: normalize(nuTo) }, MU_EARTH);
    const dt = timeBetween(orbit, nuFrom, nuTo);

    // Every one of these orbits has i < pi/2, so the motion is prograde.
    const result = solveLambert(from.position, to.position, dt, 'prograde', MU_EARTH);

    expect(result.converged).toBe(true);
    if (!result.converged) return;

    expectClose(result.departureVelocity, from.velocity, 1e-9, 'departure velocity');
    expectClose(result.arrivalVelocity, to.velocity, 1e-9, 'arrival velocity');
  });

  it('finds the retrograde branch of a retrograde orbit', () => {
    // i = 2.4 rad puts the angular momentum below the equator, so the motion is
    // retrograde and asking for 'prograde' would return the other transfer.
    const orbit = shape(9.0e6, 0.3, 2.4, 1.1, 2.3, 0);
    const from = stateFromElements({ ...orbit, trueAnomaly: radians(0.4) }, MU_EARTH);
    const to = stateFromElements({ ...orbit, trueAnomaly: radians(2.9) }, MU_EARTH);
    const dt = timeBetween(orbit, 0.4, 2.9);

    const result = solveLambert(from.position, to.position, dt, 'retrograde', MU_EARTH);
    expect(result.converged).toBe(true);
    if (!result.converged) return;
    expectClose(result.departureVelocity, from.velocity, 1e-9, 'departure velocity');
    expectClose(result.arrivalVelocity, to.velocity, 1e-9, 'arrival velocity');
  });
});

describe('Lambert — the endpoint is reproduced by propagation', () => {
  /*
   * docs/PHYSICS.md Tier 2, and the acceptance criterion #50 states: propagating
   * r1 with the returned v1 for dt must arrive at r2.
   *
   * This is a stronger check than it looks, because the propagation goes through
   * elementsFromState, the anomaly conversions and the Kepler solver — none of
   * which lambert.ts touches. A Lambert solution that satisfied its own residual
   * but described the wrong conic would fail here.
   *
   * TOLERANCE 1e-9 relative on the arrival position, the figure section 7.6
   * states. Observed worst case across this grid is 2e-13.
   */
  it('lands on r2 to 1e-9 relative, across a grid of geometries', () => {
    const orbits: readonly OrbitShape[] = [
      shape(6.9e6, 0, 0.0, 0, 0, 0),
      shape(7.5e6, 0.05, 0.5, 1.0, 2.0, 0),
      shape(9.0e6, 0.4, 0.9, 2.0, 1.0, 0),
      shape(1.2e7, 0.8, 0.2, 0.5, 3.0, 0),
      shape(4.2e7, 0.15, 0.05, 0.3, 0.7, 0),
    ];

    for (const orbit of orbits) {
      for (const [nuFrom, nuTo] of [
        [0.2, 1.1],
        [0.2, 3.0],
        [0.2, 5.4],
        [4.0, 1.0],
      ] as const) {
        const from = stateFromElements({ ...orbit, trueAnomaly: normalize(nuFrom) }, MU_EARTH);
        const to = stateFromElements({ ...orbit, trueAnomaly: normalize(nuTo) }, MU_EARTH);
        const dt = timeBetween(orbit, nuFrom, nuTo);

        const result = solveLambert(from.position, to.position, dt, 'prograde', MU_EARTH);
        expect(
          result.converged,
          `e=${String(orbit.eccentricity)} ${String(nuFrom)}->${String(nuTo)}`,
        ).toBe(true);
        if (!result.converged) continue;

        const arrived = propagate(
          { position: from.position, velocity: result.departureVelocity },
          dt,
        );
        expectClose(
          arrived.position,
          to.position,
          1e-9,
          `arrival for e=${String(orbit.eccentricity)}, ${String(nuFrom)} -> ${String(nuTo)}`,
        );
      }
    }
  });
});

describe('Lambert — transfer direction is the caller’s choice', () => {
  const orbit = shape(8.0e6, 0.1, 0.3, 0.8, 1.9, 0);
  const from = stateFromElements({ ...orbit, trueAnomaly: radians(0.5) }, MU_EARTH);
  const to = stateFromElements({ ...orbit, trueAnomaly: radians(2.0) }, MU_EARTH);
  const dt = timeBetween(orbit, 0.5, 2.0);

  it('returns different transfers for the two directions', () => {
    const prograde = solveLambert(from.position, to.position, dt, 'prograde', MU_EARTH);
    const retrograde = solveLambert(from.position, to.position, dt, 'retrograde', MU_EARTH);

    expect(prograde.converged).toBe(true);
    expect(retrograde.converged).toBe(true);
    if (!prograde.converged || !retrograde.converged) return;

    // Genuinely different answers, not the same one twice.
    expect(V.norm(V.sub(prograde.departureVelocity, retrograde.departureVelocity))).toBeGreaterThan(
      100,
    );
    // And the two transfer angles are supplementary around a full turn.
    expect(prograde.transferAngle + retrograde.transferAngle).toBeCloseTo(TAU, 9);
  });

  it('puts the angular momentum on the side the direction names', () => {
    const prograde = solveLambert(from.position, to.position, dt, 'prograde', MU_EARTH);
    const retrograde = solveLambert(from.position, to.position, dt, 'retrograde', MU_EARTH);
    if (!prograde.converged || !retrograde.converged) throw new Error('expected both to converge');

    // This is what 'prograde' is defined to mean: h_z > 0 in the inertial frame.
    expect(V.cross(from.position, prograde.departureVelocity).z).toBeGreaterThan(0);
    expect(V.cross(from.position, retrograde.departureVelocity).z).toBeLessThan(0);
  });

  it('is not inferred from the geometry — the same inputs give the direction asked for', () => {
    // The short way here is prograde, so a solver that "helpfully" picked the
    // smaller transfer angle would return the prograde answer for both requests.
    const retrograde = solveLambert(from.position, to.position, dt, 'retrograde', MU_EARTH);
    if (!retrograde.converged) throw new Error('expected convergence');
    expect(retrograde.transferAngle).toBeGreaterThan(Math.PI);
  });
});

describe('Lambert — rejected inputs and reported failure', () => {
  const r1 = position(7.0e6, 0, 0);

  it('rejects collinear positions with a typed error', () => {
    // Transfer angle 0.
    expect(() =>
      solveLambert(r1, position(9.0e6, 0, 0), seconds(3000), 'prograde', MU_EARTH),
    ).toThrow(RangeError);
    // Transfer angle pi. Every plane containing the line is a valid answer, so
    // returning one of them would hide the other infinity of solutions.
    expect(() =>
      solveLambert(r1, position(-9.0e6, 0, 0), seconds(3000), 'prograde', MU_EARTH),
    ).toThrow(RangeError);
  });

  it('accepts a transfer that is merely close to collinear', () => {
    // Just outside the threshold: ill-conditioned, but it has an answer and the
    // caller gets it. The rejection is for the singularity, not for its
    // neighbourhood.
    const nearlyOpposite = position(-9.0e6, 9.0e6 * 1e-6, 0);
    const result = solveLambert(r1, nearlyOpposite, seconds(6000), 'prograde', MU_EARTH);
    expect(result.converged).toBe(true);
  });

  it('rejects a non-positive or non-finite time of flight', () => {
    const r2 = position(0, 8.0e6, 0);
    expect(() => solveLambert(r1, r2, seconds(0), 'prograde', MU_EARTH)).toThrow(RangeError);
    expect(() => solveLambert(r1, r2, seconds(-100), 'prograde', MU_EARTH)).toThrow(RangeError);
    expect(() => solveLambert(r1, r2, seconds(Number.NaN), 'prograde', MU_EARTH)).toThrow(
      RangeError,
    );
  });

  it('rejects a zero-length position', () => {
    expect(() =>
      solveLambert(position(0, 0, 0), position(0, 8e6, 0), seconds(900), 'prograde', MU_EARTH),
    ).toThrow(RangeError);
  });

  it('solves a transfer far longer than the orbit it started from', () => {
    /*
     * Worth stating because the intuition is wrong, and this test was originally
     * written asserting the opposite.
     *
     * "Zero revolution" constrains the transfer ANGLE, not the transfer time. A
     * time of flight of three orbital periods still has a zero-revolution solution:
     * a very eccentric ellipse that crawls out to a distant apoapsis and back,
     * sweeping only the 1.5 rad between the two positions on the way. dt(z) is
     * increasing and unbounded below one revolution in z, so every positive time of
     * flight has exactly one such solution. What multi-revolution (#34) adds is the
     * FURTHER solutions above z = 4 pi^2, not the only ones for a long transfer.
     */
    const orbit = shape(7.0e6, 0.1, 0.3, 0, 0, 0);
    const from = stateFromElements({ ...orbit, trueAnomaly: radians(0) }, MU_EARTH);
    const to = stateFromElements({ ...orbit, trueAnomaly: radians(1.5) }, MU_EARTH);
    const threeOrbits = seconds(period(semiMajorAxis(orbit), MU_EARTH) * 3);

    const result = solveLambert(from.position, to.position, threeOrbits, 'prograde', MU_EARTH);
    expect(result.converged).toBe(true);
    if (!result.converged) return;

    // And it is a real transfer, not a number: it arrives where it was asked to.
    const arrived = propagate(
      { position: from.position, velocity: result.departureVelocity },
      threeOrbits,
    );
    expectClose(arrived.position, to.position, 1e-9, 'arrival after three periods');
  });

  it('reports non-convergence as a return value rather than throwing', () => {
    /*
     * The KeplerResult contract: a typed failure, not an exception, and above all
     * not a plausible wrong answer.
     *
     * Reaching it takes a deliberately absurd request, because the geometry almost
     * never fails — dt(z) is monotone and unbounded below one revolution, so a
     * bracket exists for essentially every positive time of flight. What bounds it
     * is float64: the Stumpff C(z) cancels to exactly zero within about 1.5e-8 of
     * sqrt(z) = 2 pi, so the solver stops looking at 4 pi^2 - 1e-4, which still
     * admits a transfer of roughly 4e19 seconds. A request past that ceiling has no
     * answer this solver can compute, and it says so.
     *
     * 1e25 seconds is about 300 million times the age of the universe. The point is
     * not that anyone would ask, but that the ceiling is a stated, tested boundary
     * rather than a NaN leaking out of a cancelled subtraction.
     */
    const orbit = shape(7.0e6, 0.1, 0.3, 0, 0, 0);
    const from = stateFromElements({ ...orbit, trueAnomaly: radians(0) }, MU_EARTH);
    const to = stateFromElements({ ...orbit, trueAnomaly: radians(1.5) }, MU_EARTH);

    const result = solveLambert(from.position, to.position, seconds(1e25), 'prograde', MU_EARTH);
    expect(result.converged).toBe(false);
    if (result.converged) return;
    expect(result.reason).toBe('out-of-domain');
  });

  it('still converges when Newton is given no room to work', () => {
    // The bracketed fallback is a tested path, not decoration -- the same standard
    // kepler.ts holds itself to. Capping Newton at a single iteration forces the
    // handover, and the answer must be the same one.
    const orbit = shape(9.0e6, 0.4, 0.5, 1.0, 2.0, 0);
    const from = stateFromElements({ ...orbit, trueAnomaly: radians(0.3) }, MU_EARTH);
    const to = stateFromElements({ ...orbit, trueAnomaly: radians(2.8) }, MU_EARTH);
    const dt = timeBetween(orbit, 0.3, 2.8);

    const forced = solveLambert(from.position, to.position, dt, 'prograde', MU_EARTH, {
      maxIterations: 1,
    });
    expect(forced.converged).toBe(true);
    if (!forced.converged) return;
    expect(forced.method).toBe('bracketed');
    expectClose(forced.departureVelocity, from.velocity, 1e-9, 'fallback departure velocity');
  });

  it('reaches the answer by Newton on an ordinary transfer', () => {
    const orbit = shape(9.0e6, 0.2, 0.5, 1.0, 2.0, 0);
    const from = stateFromElements({ ...orbit, trueAnomaly: radians(0.3) }, MU_EARTH);
    const to = stateFromElements({ ...orbit, trueAnomaly: radians(2.0) }, MU_EARTH);
    const result = solveLambert(
      from.position,
      to.position,
      timeBetween(orbit, 0.3, 2.0),
      'prograde',
      MU_EARTH,
    );
    expect(result.converged).toBe(true);
    if (!result.converged) return;
    expect(result.method).toBe('newton');
    // Bounded by the cap, and comfortably inside it.
    expect(result.iterations).toBeLessThan(10);
  });

  it('is tolerance-bounded rather than iteration-dependent', () => {
    /*
     * docs/PRODUCT.md section 11.4: the iteration count may be data-dependent but
     * the result must not be. Solving the same transfer with a Newton cap of 1
     * (which forces bracketing) and with the default (which uses Newton) must give
     * the same answer to the stated tolerance.
     */
    const orbit = shape(9.0e6, 0.4, 0.5, 1.0, 2.0, 0);
    const from = stateFromElements({ ...orbit, trueAnomaly: radians(0.3) }, MU_EARTH);
    const to = stateFromElements({ ...orbit, trueAnomaly: radians(2.8) }, MU_EARTH);
    const dt = seconds(timeBetween(orbit, 0.3, 2.8));

    const viaNewton = solveLambert(from.position, to.position, dt, 'prograde', MU_EARTH);
    const viaBracket = solveLambert(from.position, to.position, dt, 'prograde', MU_EARTH, {
      maxIterations: 1,
    });
    if (!viaNewton.converged || !viaBracket.converged) throw new Error('expected convergence');

    expect(viaNewton.method).not.toBe(viaBracket.method);
    expectClose(viaNewton.departureVelocity, viaBracket.departureVelocity, 1e-11, 'two routes');
  });
});

describe('Lambert — the Newton derivative', () => {
  it('matches a central difference of the time of flight', () => {
    /*
     * The derivative is Curtis Algorithm 5.2's, transcribed, and the z = 0 case is
     * a separate limit rather than a removable one. A transcription error there
     * would not fail any test above -- Newton would simply take poor steps and the
     * bracketed fallback would rescue it, which is precisely the kind of silent
     * degradation worth a direct test.
     *
     * The derivative is not exported, so this reconstructs it from the same public
     * Stumpff functions and compares against a difference of the time of flight
     * assembled the same way. What it pins is the algebra, which is what could be
     * wrong.
     */
    const r1Mag = 7.0e6;
    const r2Mag = 1.2e7;
    const a = 8.5e6;

    const yAt = (z: number): number =>
      r1Mag + r2Mag + (a * (z * stumpffS(z) - 1)) / Math.sqrt(stumpffC(z));
    const timeAt = (z: number): number => {
      const y = yAt(z);
      return ((y / stumpffC(z)) ** 1.5 * stumpffS(z) + a * Math.sqrt(y)) / Math.sqrt(MU_EARTH);
    };
    const derivative = (z: number): number => {
      const y = yAt(z);
      if (z === 0) {
        return (
          ((Math.SQRT2 / 40) * y ** 1.5 + (a / 8) * (Math.sqrt(y) + a * Math.sqrt(1 / (2 * y)))) /
          Math.sqrt(MU_EARTH)
        );
      }
      const c = stumpffC(z);
      const s = stumpffS(z);
      return (
        ((y / c) ** 1.5 * ((1 / (2 * z)) * (c - (3 * s) / (2 * c)) + (3 * s * s) / (4 * c)) +
          (a / 8) * (3 * (s / c) * Math.sqrt(y) + a * Math.sqrt(c / y))) /
        Math.sqrt(MU_EARTH)
      );
    };

    // z = 0 included deliberately: it is the starting point of every solve, and
    // the branch most likely to be wrong.
    for (const z of [-2, -0.5, -0.05, 0, 0.05, 0.5, 5, 20, 35]) {
      const h = Math.max(1e-6, Math.abs(z) * 1e-6);
      const difference = (timeAt(z + h) - timeAt(z - h)) / (2 * h);
      // 1e-6 relative: a central difference is second-order accurate and the step
      // cannot be made arbitrarily small without losing digits to cancellation, so
      // this is the accuracy of the *reference*, not of the derivative.
      expectRelative(derivative(z), difference, 1e-6, `dt/dz at z = ${String(z)}`);
    }
  });
});

describe('Lambert — a Hohmann transfer is a Lambert solution', () => {
  it('reproduces the Hohmann departure speed for a half-revolution transfer', () => {
    /*
     * The closed-form cross-check. A Hohmann transfer is exactly a Lambert problem
     * with a transfer angle of pi -- which is the case this solver rejects, since
     * the plane is undefined there. So it is approached rather than hit: at a
     * transfer angle a hair under pi the Lambert departure speed must approach the
     * Hohmann one, and twobody.ts already validates that number independently.
     *
     * TOLERANCE 2e-4 relative, which is the size of the geometric difference
     * between a 179.99-degree transfer and a 180-degree one rather than any
     * property of the solver. Tightening it would mean asserting that two
     * different transfers cost the same.
     */
    const r1 = R_EARTH_EQ + 400_000;
    const r2 = 2.0e7;
    const hohmannSpeed = Math.sqrt(MU_EARTH * (2 / r1 - 2 / (r1 + r2))) * Math.sqrt(1); // v at periapsis of the transfer ellipse

    const angle = Math.PI - 1e-4;
    const from = position(r1, 0, 0);
    const to = position(r2 * Math.cos(angle), r2 * Math.sin(angle), 0);
    const dt = seconds(Math.PI * Math.sqrt(((r1 + r2) / 2) ** 3 / MU_EARTH));

    const result = solveLambert(from, to, dt, 'prograde', MU_EARTH);
    expect(result.converged).toBe(true);
    if (!result.converged) return;

    expectRelative(V.norm(result.departureVelocity), hohmannSpeed, 2e-4, 'departure speed');
  });
});

/*
 * ===========================================================================
 * Tier 3 — independent reference.
 *
 * Curtis, H.D., "Orbital Mechanics for Engineering Students", 4th edition,
 * Butterworth-Heinemann / Elsevier, 2020. ISBN 978-0-08-102133-0. Section 5.3,
 * Algorithm 5.2, Examples 5.2 (pp. 245-247) and 5.3 (pp. 248-249).
 *
 * PROVENANCE. Read from that edition, per the process rule in docs/PRODUCT.md
 * section 7.6 — the same copy elements.test.ts cites for Examples 4.3 and 4.7.
 * One thing worth recording about how: the copy is a PDF, and extracting its text
 * loses minus signs. Rather than guess them, every sign below was re-derived from
 * the book's own given data and intermediate quantities, and each derivation
 * agrees with the printed digits. Example 5.2's r2 is negative in x, for
 * instance, because only that sign produces the transfer angle of 100.29 degrees
 * and the cross product 64.75 i - 65.66 j + 158.5 k that the book prints.
 *
 * TOLERANCE 3e-5 relative, and that is the book's printed precision rather than a
 * tuned number. Curtis prints five significant figures: a velocity component
 * printed as 1.9254 km/s carries a half-ulp of 0.00005, which is 2.6e-5 relative,
 * and that is the loosest of the printed components. The observed worst deviation
 * across both examples is 2.0e-5, just inside where the book's own rounding puts
 * it. Tightening past 3e-5 would be asserting digits the book never printed.
 * ===========================================================================
 */

const KM = 1e3;

/**
 * Curtis works in km, km/s and km^3/s^2 throughout, and his mu is 398,600, which
 * differs from our MU_EARTH by 1.1e-8 relative. The book's value is passed, not
 * ours: a reference test that silently substitutes a different constant is no
 * longer testing what it cites. Conversion happens here and nowhere else.
 */
const MU_CURTIS = 398_600 * KM ** 3;

const CURTIS_TOL = 3e-5;

describe('Curtis 4th ed., Example 5.2 (section 5.3, pp. 245-247) — elliptical transfer', () => {
  // Given, from the printed example. r2's x component is negative; see the
  // provenance note above for how that was established rather than assumed.
  const r1 = position(5000 * KM, 10_000 * KM, 2100 * KM);
  const r2 = position(-14_600 * KM, 2500 * KM, 7000 * KM);
  const dt = seconds(3600);

  const result = solveLambert(r1, r2, dt, 'prograde', MU_CURTIS);

  it('converges on the prograde branch the book chose', () => {
    expect(result.converged).toBe(true);
    if (!result.converged) return;
    // The book: "Since the trajectory is prograde and the z component of r1 x r2
    // is positive, it follows that dtheta = 100.29 degrees."
    expectRelative((result.transferAngle * 180) / Math.PI, 100.29, CURTIS_TOL, 'transfer angle');
  });

  it('reproduces the departure and arrival velocities the book prints', () => {
    if (!result.converged) throw new Error('expected convergence');

    // v1 = -5.9925 I + 1.9254 J + 3.2456 K (km/s)
    expectRelative(result.departureVelocity.x / KM, -5.9925, CURTIS_TOL, 'v1 x');
    expectRelative(result.departureVelocity.y / KM, 1.9254, CURTIS_TOL, 'v1 y');
    expectRelative(result.departureVelocity.z / KM, 3.2456, CURTIS_TOL, 'v1 z');

    // v2 = -3.3125 I - 4.1966 J - 0.38529 K (km/s)
    expectRelative(result.arrivalVelocity.x / KM, -3.3125, CURTIS_TOL, 'v2 x');
    expectRelative(result.arrivalVelocity.y / KM, -4.1966, CURTIS_TOL, 'v2 y');
    expectRelative(result.arrivalVelocity.z / KM, -0.38529, CURTIS_TOL, 'v2 z');
  });

  it('yields the orbital elements the book goes on to compute', () => {
    /*
     * The book's step 8 feeds r1 and v1 into its Algorithm 4.2, which is our
     * elementsFromState. Running the same chain here is what ties the two modules
     * together against an outside source: a Lambert solution that satisfied its own
     * residual while describing the wrong conic would produce different elements.
     *
     * These are printed to four significant figures, so they get 1e-3 — the same
     * tolerance and the same reasoning as elements.test.ts.
     */
    if (!result.converged) throw new Error('expected convergence');
    const elements = elementsFromState(r1, result.departureVelocity, MU_CURTIS);

    expectRelative(
      specificAngularMomentum(elements, MU_CURTIS),
      80_470 * KM ** 2,
      1e-3,
      'angular momentum',
    );
    expectRelative(semiMajorAxis(elements), 20_000 * KM, 1e-3, 'semi-major axis');
    expectRelative(elements.eccentricity, 0.4335, 1e-3, 'eccentricity');
    expectRelative(toDegrees(elements.raan), 44.6, 1e-3, 'RAAN');
    expectRelative(toDegrees(elements.inclination), 30.19, 1e-3, 'inclination');
    expectRelative(toDegrees(elements.argp), 30.71, 1e-3, 'argument of periapsis');
    expectRelative(toDegrees(elements.trueAnomaly), 350.8, 1e-3, 'true anomaly');
  });

  it('is an ellipse, which is what the sign of z told the book', () => {
    // "The fact that z is positive means the orbit is an ellipse."
    if (!result.converged) throw new Error('expected convergence');
    expect(elementsFromState(r1, result.departureVelocity, MU_CURTIS).eccentricity).toBeLessThan(1);
  });
});

describe('Curtis 4th ed., Example 5.3 (section 5.3, pp. 248-249) — hyperbolic transfer', () => {
  /*
   * The hyperbolic case, z = -0.17344, and the only test in this file that
   * exercises the negative-z branch of the Stumpff functions against a source
   * outside the repository.
   *
   * A meteoroid sighted at 267,000 km altitude, then at 140,000 km after 13.5 h,
   * with a change in true anomaly of 5 degrees. The book works it in a problem
   * plane -- x along r1, y at 90 degrees in the direction of motion -- because no
   * orientation was given. That plane is placed on the equator here, which the
   * solver does not care about and which makes the transfer prograde by
   * construction.
   */
  const R1 = (6378 + 267_000) * KM;
  const R2 = (6378 + 140_000) * KM;
  const DELTA_THETA = (5 * Math.PI) / 180;

  const r1 = position(R1, 0, 0);
  const r2 = position(R2 * Math.cos(DELTA_THETA), R2 * Math.sin(DELTA_THETA), 0);
  const result = solveLambert(r1, r2, seconds(13.5 * 3600), 'prograde', MU_CURTIS);

  it('reproduces the departure velocity the book prints', () => {
    expect(result.converged).toBe(true);
    if (!result.converged) return;

    // v1 = -2.4356 i + 0.26741 j (km/s), in the book's problem plane.
    expectRelative(result.departureVelocity.x / KM, -2.4356, CURTIS_TOL, 'v1 x');
    expectRelative(result.departureVelocity.y / KM, 0.26741, CURTIS_TOL, 'v1 y');
    expect(Math.abs(result.departureVelocity.z)).toBeLessThan(1e-6);
  });

  it('finds the hyperbola the book found', () => {
    if (!result.converged) throw new Error('expected convergence');
    const elements = elementsFromState(r1, result.departureVelocity, MU_CURTIS);

    // "Since z is negative, the path of the meteoroid is a hyperbola."
    expect(elements.eccentricity).toBeGreaterThan(1);
    expectRelative(elements.eccentricity, 1.0506, 1e-3, 'eccentricity');
    expectRelative(
      specificAngularMomentum(elements, MU_CURTIS),
      73_105 * KM ** 2,
      1e-3,
      'angular momentum',
    );
    // Perigee radius 6538.2 km — an alarming 160 km altitude, as the book notes.
    expectRelative(periapsisRadius(elements), 6538.2 * KM, 1e-3, 'perigee radius');
  });

  it('handles a transfer angle of 5 degrees, which is near the collinear limit', () => {
    // Worth stating: 5 degrees is close to the singularity at 0, and the solver is
    // expected to work there rather than refuse. The rejection threshold is 1e-8
    // on sin(dnu); this is 0.0872.
    if (!result.converged) throw new Error('expected convergence');
    expectRelative((result.transferAngle * 180) / Math.PI, 5, 1e-9, 'transfer angle');
  });
});
