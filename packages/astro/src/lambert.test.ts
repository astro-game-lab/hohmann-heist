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
import {
  lambertMinimumTime,
  revolutionCeilingFor,
  solveLambert,
  solveLambertBranches,
  stumpffC,
  stumpffS,
} from './lambert.js';
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
/*
 * ---------------------------------------------------------------------------
 * Multiple revolutions (#51, FR-007).
 *
 * The oracles above extend to the multi-revolution problem without weakening,
 * and that is the point of building them the way they were built. An orbit
 * sampled at two true anomalies still knows its own velocity at both ends; the
 * only change is that the elapsed time gains N whole periods, which turns the
 * same question into the N-revolution one. Propagation still has to land on r2.
 *
 * What these cannot supply is a Tier 3 reference. Curtis does not treat the
 * multi-revolution case at all -- Algorithm 5.2 is zero-revolution only, and the
 * book has no worked example -- so docs/PHYSICS.md carries that row as still
 * owed by #54 and #55 rather than as covered here.
 * ---------------------------------------------------------------------------
 */

/** The transfer an orbit itself makes between two true anomalies, after N laps. */
const revolutionCase = (orbit: OrbitShape, nuFrom: number, nuTo: number, revolutions: number) => {
  const from = stateFromElements({ ...orbit, trueAnomaly: normalize(nuFrom) }, MU_EARTH);
  const to = stateFromElements({ ...orbit, trueAnomaly: normalize(nuTo) }, MU_EARTH);
  const dt = seconds(
    timeBetween(orbit, nuFrom, nuTo) + revolutions * period(semiMajorAxis(orbit), MU_EARTH),
  );
  return { from, to, dt };
};

/** Semi-major axis of the transfer a solution describes. */
const transferSemiMajorAxis = (position: State['position'], velocity: State['velocity']): number =>
  semiMajorAxis(elementsFromState(position, velocity, MU_EARTH));

const multiRevOrbits: readonly (readonly [string, OrbitShape, number, number])[] = [
  ['circular LEO, quarter turn', shape(6.9e6, 0, 0.0, 0, 0, 0), 0, Math.PI / 2],
  ['circular LEO, past half a turn', shape(6.9e6, 0, 0.0, 0, 0, 0), 0.3, 0.3 + 4.0],
  ['inclined circular', shape(7.2e6, 0, 0.9, 1.1, 0, 0), 0.2, 0.2 + 1.4],
  ['mild ellipse', shape(9.0e6, 0.2, 0.4, 1.1, 2.3, 0), 0.4, 2.6],
  ['eccentric, across periapsis', shape(9.0e6, 0.7, 0.4, 1.1, 2.3, 0), 5.6, 0.9],
  ['GEO-scale, long arc', shape(4.2e7, 0.1, 0.05, 0.3, 0.7, 0), 0.5, 5.4],
];

describe('Lambert — multiple revolutions recover an orbit they were not told about', () => {
  /*
   * The primary oracle again, with N whole periods added to the elapsed time. The
   * orbit is then one of the N-revolution transfers between the same two points,
   * so the correct answer is still known exactly and the solver still has to find
   * it without being told which orbit it is looking for -- only now it has to
   * find it among several transfers that all take exactly as long.
   */
  for (const revolutions of [1, 2, 3]) {
    it.each(multiRevOrbits)(`%s, ${String(revolutions)} revolutions`, (_l, orbit, nuA, nuB) => {
      const { from, to, dt } = revolutionCase(orbit, nuA, nuB, revolutions);
      const found = solveLambertBranches(from.position, to.position, dt, 'prograde', MU_EARTH);

      expect(found.failures).toEqual([]);

      const matches = found.branches.filter(
        (b) => V.norm(V.sub(b.departureVelocity, from.velocity)) / V.norm(from.velocity) < 1e-9,
      );
      expect(matches, 'exactly one branch is the orbit itself').toHaveLength(1);

      const [orbitBranch] = matches;
      if (orbitBranch === undefined) return;
      expect(orbitBranch.revolutions, 'and it is the N-revolution one').toBe(revolutions);
      expectClose(orbitBranch.arrivalVelocity, to.velocity, 1e-9, 'arrival velocity');

      // The same transfer is reachable by name, which is what a stored plan does.
      const byName = solveLambert(from.position, to.position, dt, 'prograde', MU_EARTH, {
        revolutions: orbitBranch.revolutions,
        branch: orbitBranch.branch === 'single' ? 'low' : orbitBranch.branch,
      });
      expect(byName.converged).toBe(true);
      if (!byName.converged) return;
      expectClose(byName.departureVelocity, orbitBranch.departureVelocity, 1e-11, 'by name');
    });
  }
});

describe('Lambert — every returned branch is a real transfer', () => {
  /*
   * docs/PHYSICS.md Tier 2, and the acceptance criterion #51 states: EVERY branch,
   * not just the one that happens to be the orbit the case was built from,
   * independently reproduces the endpoint when propagated.
   *
   * This is the check that stops a second branch from being decoration. A solver
   * that found the minimum in the wrong place, or that returned the same root
   * twice under two labels, or that reported a branch on the strength of a
   * residual it never actually drove to zero, all fail here.
   *
   * TOLERANCE 1e-9 relative on the arrival position, the figure section 7.6
   * states. Observed worst case across the 158 branches this grid produces is
   * 1.1e-11, on the two-revolution low branch of the eccentric case -- two orders
   * inside the tolerance, and two orders looser than the zero-revolution grid
   * above, which is the cost of a transfer that crosses periapsis three times.
   */
  it('lands on r2 to 1e-9 relative, across a grid of geometries and revolutions', () => {
    let checked = 0;
    for (const [label, orbit, nuA, nuB] of multiRevOrbits) {
      for (const revolutions of [1, 2, 3]) {
        const { from, to, dt } = revolutionCase(orbit, nuA, nuB, revolutions);
        const found = solveLambertBranches(from.position, to.position, dt, 'prograde', MU_EARTH);
        expect(found.failures, `${label}, ${String(revolutions)} revs`).toEqual([]);

        for (const branch of found.branches) {
          const arrived = propagate(
            { position: from.position, velocity: branch.departureVelocity },
            dt,
          );
          expectClose(
            arrived.position,
            to.position,
            1e-9,
            `${label}: ${String(branch.revolutions)} revs, ${branch.branch} branch`,
          );
          checked++;
        }
      }
    }
    // Guards against the whole loop passing because nothing was returned.
    expect(checked).toBeGreaterThan(50);
  });

  it('returns branches that are genuinely different transfers', () => {
    const { from, to, dt } = revolutionCase(shape(9.0e6, 0.2, 0.4, 1.1, 2.3, 0), 0.4, 2.6, 2);
    const { branches } = solveLambertBranches(from.position, to.position, dt, 'prograde', MU_EARTH);

    const speeds = branches.map((b) => V.norm(b.departureVelocity));
    for (let i = 0; i < speeds.length; i++) {
      for (let j = i + 1; j < speeds.length; j++) {
        const [a, b] = [speeds[i], speeds[j]];
        if (a === undefined || b === undefined) continue;
        expect(
          Math.abs(a - b),
          `branches ${String(i)} and ${String(j)} are the same`,
        ).toBeGreaterThan(0.5);
      }
    }
  });
});

describe('Lambert — the revolution count comes from the time of flight', () => {
  const orbit = shape(6.9e6, 0, 0.0, 0, 0, 0);
  const { from, to } = revolutionCase(orbit, 0, Math.PI / 2, 0);

  it('never claims a ceiling below a transfer that demonstrably exists', () => {
    /*
     * The ceiling is an upper bound derived from the time of flight, so the way to
     * catch it being wrong is to hold up a transfer that does exist and check the
     * bound admits it. Each orbit provides one per revolution count: itself.
     */
    for (const [label, o, nuA, nuB] of multiRevOrbits) {
      for (const revolutions of [1, 2, 3, 7]) {
        const c = revolutionCase(o, nuA, nuB, revolutions);
        const ceiling = revolutionCeilingFor(c.from.position, c.to.position, c.dt, MU_EARTH);
        expect(ceiling, `${label}, ${String(revolutions)} revs`).toBeGreaterThanOrEqual(
          revolutions,
        );
      }
    }
  });

  it('does not depend on which way round the transfer goes', () => {
    const dt = seconds(4 * period(semiMajorAxis(orbit), MU_EARTH));
    // The chord is a property of the two points, so both directions share a bound.
    expect(revolutionCeilingFor(from.position, to.position, dt, MU_EARTH)).toBe(
      revolutionCeilingFor(to.position, from.position, dt, MU_EARTH),
    );
  });

  it('asking for more revolutions than the clock allows returns no solution, not a wrong one', () => {
    const dt = seconds(timeBetween(orbit, 0, Math.PI / 2) + period(semiMajorAxis(orbit), MU_EARTH));
    const ceiling = revolutionCeilingFor(from.position, to.position, dt, MU_EARTH);

    const beyond = solveLambert(from.position, to.position, dt, 'prograde', MU_EARTH, {
      revolutions: ceiling + 1,
    });
    expect(beyond.converged).toBe(false);
    if (beyond.converged) return;
    expect(beyond.reason).toBe('out-of-domain');
    expect(beyond.revolutions).toBe(ceiling + 1);
  });

  it('steps the branch count up exactly as the time of flight crosses each minimum', () => {
    /*
     * The structural claim, tested through the public surface: below the
     * N-revolution minimum there is no N-revolution transfer, above it there are
     * two. If lambertMinimumTime put the minimum too high the first case would
     * find branches it says cannot exist; too low and the second would fail to
     * converge, which shows up as a non-empty `failures`.
     */
    for (const revolutions of [1, 2, 3]) {
      const minimum = lambertMinimumTime(
        from.position,
        to.position,
        'prograde',
        MU_EARTH,
        revolutions,
      );
      expect(minimum).not.toBeNull();
      if (minimum === null) return;

      const countAt = (dt: number): number => {
        const found = solveLambertBranches(
          from.position,
          to.position,
          seconds(dt),
          'prograde',
          MU_EARTH,
        );
        expect(found.failures, `failures at ${String(dt)}`).toEqual([]);
        return found.branches.filter((b) => b.revolutions === revolutions).length;
      };

      expect(countAt(minimum.timeOfFlight * (1 - 1e-6)), 'below the minimum').toBe(0);
      expect(countAt(minimum.timeOfFlight * (1 + 1e-6)), 'above the minimum').toBe(2);
      expect(countAt(minimum.timeOfFlight * 3), 'well above the minimum').toBe(2);
    }
  });

  it('the minimum is never slower than a transfer that exists', () => {
    // The other side of the same coin, on the geometries the orbits provide.
    for (const [label, o, nuA, nuB] of multiRevOrbits) {
      for (const revolutions of [1, 2, 3]) {
        const c = revolutionCase(o, nuA, nuB, revolutions);
        const minimum = lambertMinimumTime(
          c.from.position,
          c.to.position,
          'prograde',
          MU_EARTH,
          revolutions,
        );
        expect(minimum, `${label}, ${String(revolutions)} revs`).not.toBeNull();
        if (minimum === null) continue;
        expect(minimum.timeOfFlight).toBeLessThanOrEqual(c.dt);
      }
    }
  });

  it('caps the search without pretending the ceiling was lower', () => {
    const dt = seconds(20 * period(semiMajorAxis(orbit), MU_EARTH));
    const found = solveLambertBranches(from.position, to.position, dt, 'prograde', MU_EARTH, {
      maxRevolutions: 2,
    });
    expect(found.revolutionsSearched).toBe(2);
    expect(found.revolutionCeiling).toBeGreaterThan(2);
    expect(Math.max(...found.branches.map((b) => b.revolutions))).toBe(2);
  });
});

describe('Lambert — the two branches meet at the minimum', () => {
  const orbit = shape(7.5e6, 0.05, 0.5, 1.0, 2.0, 0);
  const { from, to } = revolutionCase(orbit, 0.2, 3.0, 0);

  it('returns one branch there, not two identical ones and not a NaN', () => {
    /*
     * The acceptance criterion's boundary case. At exactly the minimum the two
     * roots have collapsed onto each other, and both wrong answers are easy to
     * produce: bracket each side anyway and get the same transfer twice, or divide
     * by a bracket of zero width and get NaN out of the Lagrange coefficients.
     */
    for (const revolutions of [1, 2]) {
      const minimum = lambertMinimumTime(
        from.position,
        to.position,
        'prograde',
        MU_EARTH,
        revolutions,
      );
      expect(minimum).not.toBeNull();
      if (minimum === null) return;

      const found = solveLambertBranches(
        from.position,
        to.position,
        minimum.timeOfFlight,
        'prograde',
        MU_EARTH,
      );
      expect(found.failures).toEqual([]);

      const atN = found.branches.filter((b) => b.revolutions === revolutions);
      expect(atN, `${String(revolutions)} revolutions`).toHaveLength(1);
      const [only] = atN;
      if (only === undefined) return;
      expect(only.branch).toBe('minimum');

      for (const component of [only.departureVelocity, only.arrivalVelocity]) {
        for (const v of [component.x, component.y, component.z]) {
          expect(Number.isFinite(v)).toBe(true);
        }
      }

      // And it is a transfer, not merely a finite number.
      const arrived = propagate(
        { position: from.position, velocity: only.departureVelocity },
        minimum.timeOfFlight,
      );
      expectClose(arrived.position, to.position, 1e-9, 'arrival at the minimum');
    }
  });

  it('is reachable by name, so a plan stored at the minimum round-trips', () => {
    const minimum = lambertMinimumTime(from.position, to.position, 'prograde', MU_EARTH, 1);
    if (minimum === null) throw new Error('expected a minimum');

    const named = solveLambert(
      from.position,
      to.position,
      minimum.timeOfFlight,
      'prograde',
      MU_EARTH,
      {
        revolutions: 1,
        branch: 'minimum',
      },
    );
    expect(named.converged).toBe(true);
    if (!named.converged) return;
    expect(named.branch).toBe('minimum');

    // Either ordinary label finds the same transfer, because both brackets end on it.
    for (const branch of ['low', 'high'] as const) {
      const either = solveLambert(
        from.position,
        to.position,
        minimum.timeOfFlight,
        'prograde',
        MU_EARTH,
        {
          revolutions: 1,
          branch,
        },
      );
      expect(either.converged).toBe(true);
      if (!either.converged) continue;
      expectClose(
        either.departureVelocity,
        named.departureVelocity,
        1e-9,
        `${branch} at the minimum`,
      );
    }
  });

  it('refuses the minimum label away from the minimum', () => {
    const minimum = lambertMinimumTime(from.position, to.position, 'prograde', MU_EARTH, 1);
    if (minimum === null) throw new Error('expected a minimum');

    const away = solveLambert(
      from.position,
      to.position,
      seconds(minimum.timeOfFlight * 1.5),
      'prograde',
      MU_EARTH,
      {
        revolutions: 1,
        branch: 'minimum',
      },
    );
    expect(away.converged).toBe(false);
    if (away.converged) return;
    expect(away.reason).toBe('out-of-domain');
  });

  it('the two branches converge on each other as the time of flight approaches it', () => {
    const minimum = lambertMinimumTime(from.position, to.position, 'prograde', MU_EARTH, 1);
    if (minimum === null) throw new Error('expected a minimum');

    const separation = (excess: number): number => {
      const low = solveLambert(
        from.position,
        to.position,
        seconds(minimum.timeOfFlight * (1 + excess)),
        'prograde',
        MU_EARTH,
        { revolutions: 1, branch: 'low' },
      );
      const high = solveLambert(
        from.position,
        to.position,
        seconds(minimum.timeOfFlight * (1 + excess)),
        'prograde',
        MU_EARTH,
        { revolutions: 1, branch: 'high' },
      );
      if (!low.converged || !high.converged) throw new Error('expected convergence');
      return V.norm(V.sub(low.departureVelocity, high.departureVelocity));
    };

    expect(separation(1e-2)).toBeGreaterThan(separation(1e-4));
    expect(separation(1e-4)).toBeGreaterThan(separation(1e-6));
  });
});

describe('Lambert — branch order is a contract', () => {
  /*
   * docs/PRODUCT.md section 11.4. A plan that names a branch has to name the same
   * transfer on every runtime, so the order is asserted as an exact sequence
   * rather than left to whatever the search happens to produce.
   */
  it('is zero-revolution first, then low before high, ascending', () => {
    const orbit = shape(6.9e6, 0, 0.0, 0, 0, 0);
    const { from, to } = revolutionCase(orbit, 0, Math.PI / 2, 0);
    const dt = seconds(4 * period(semiMajorAxis(orbit), MU_EARTH));

    // Four revolutions fit, not three: the minimum-energy ellipse through these
    // two points is smaller than the circular orbit they were sampled from, so it
    // laps faster and four of its transfers fit inside four of the orbit's periods.
    const { branches } = solveLambertBranches(from.position, to.position, dt, 'prograde', MU_EARTH);
    expect(branches.map((b) => [b.revolutions, b.branch])).toEqual([
      [0, 'single'],
      [1, 'low'],
      [1, 'high'],
      [2, 'low'],
      [2, 'high'],
      [3, 'low'],
      [3, 'high'],
      [4, 'low'],
      [4, 'high'],
    ]);
  });

  it('is the same sequence whichever route the zero-revolution solve took', () => {
    // The iteration count is data-dependent; the ordering must not be.
    const orbit = shape(9.0e6, 0.4, 0.5, 1.0, 2.0, 0);
    const { from, to } = revolutionCase(orbit, 0.3, 2.8, 0);
    const dt = seconds(3 * period(semiMajorAxis(orbit), MU_EARTH));

    const a = solveLambertBranches(from.position, to.position, dt, 'prograde', MU_EARTH);
    const b = solveLambertBranches(from.position, to.position, dt, 'prograde', MU_EARTH, {
      maxRevolutions: 99,
    });
    expect(a.branches.map((x) => [x.revolutions, x.branch])).toEqual(
      b.branches.map((x) => [x.revolutions, x.branch]),
    );
  });
});

describe('Lambert — what the branch names mean', () => {
  it('the low branch is the higher-energy transfer', () => {
    /*
     * Named for its side of the minimum in z, because that is definitional and a
     * stored plan needs a label that cannot drift. The physical correspondence is
     * an observation, so it is measured rather than asserted in the name: across
     * this grid the low branch always has the larger semi-major axis, and the
     * asymptotic argument is a_low^(3/2) N = a_high^(3/2) (N + 1).
     */
    let compared = 0;
    for (const [label, orbit, nuA, nuB] of multiRevOrbits) {
      for (const revolutions of [1, 2, 3]) {
        const { from, to, dt } = revolutionCase(orbit, nuA, nuB, revolutions);
        const { branches } = solveLambertBranches(
          from.position,
          to.position,
          dt,
          'prograde',
          MU_EARTH,
        );

        const low = branches.find((b) => b.revolutions === revolutions && b.branch === 'low');
        const high = branches.find((b) => b.revolutions === revolutions && b.branch === 'high');
        if (low === undefined || high === undefined) continue;

        expect(
          transferSemiMajorAxis(from.position, low.departureVelocity),
          `${label}, ${String(revolutions)} revs`,
        ).toBeGreaterThan(transferSemiMajorAxis(from.position, high.departureVelocity));
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(15);
  });

  it('both branches are ellipses, whatever the zero-revolution transfer was', () => {
    // A transfer that comes back round cannot be open, so a negative or infinite
    // semi-major axis here would mean the branch was not what it claimed.
    const { from, to, dt } = revolutionCase(shape(9.0e6, 0.7, 0.4, 1.1, 2.3, 0), 5.6, 0.9, 2);
    const { branches } = solveLambertBranches(from.position, to.position, dt, 'prograde', MU_EARTH);

    for (const branch of branches.filter((b) => b.revolutions > 0)) {
      const a = transferSemiMajorAxis(from.position, branch.departureVelocity);
      expect(Number.isFinite(a), `${String(branch.revolutions)} ${branch.branch}`).toBe(true);
      expect(a).toBeGreaterThan(0);
    }
  });
});

describe('Lambert — the zero-revolution answer is unchanged', () => {
  const orbit = shape(9.0e6, 0.2, 0.4, 1.1, 2.3, 0);
  const { from, to } = revolutionCase(orbit, 0.4, 2.6, 0);
  const dt = timeBetween(orbit, 0.4, 2.6);

  it('is what an explicit revolutions: 0 asks for', () => {
    const implicit = solveLambert(from.position, to.position, dt, 'prograde', MU_EARTH);
    const explicit = solveLambert(from.position, to.position, dt, 'prograde', MU_EARTH, {
      revolutions: 0,
    });
    expect(explicit).toEqual(implicit);
    expect(implicit.converged).toBe(true);
    if (!implicit.converged) return;
    expect(implicit.revolutions).toBe(0);
    expect(implicit.branch).toBe('single');
  });

  it('is the only branch when the time of flight clears no minimum', () => {
    const found = solveLambertBranches(from.position, to.position, dt, 'prograde', MU_EARTH);
    expect(found.branches).toHaveLength(1);
    expect(found.revolutionCeiling).toBe(0);
    expect(found.failures).toEqual([]);

    const direct = solveLambert(from.position, to.position, dt, 'prograde', MU_EARTH);
    expect(found.branches[0]).toEqual(direct);
  });

  it('is still reported as a failure rather than thrown when it cannot be found', () => {
    // The zero-revolution ceiling, reached through the enumerating entry point:
    // the failure is carried in `failures` rather than dropped from `branches`.
    const found = solveLambertBranches(
      from.position,
      to.position,
      seconds(1e25),
      'prograde',
      MU_EARTH,
      { maxRevolutions: 0 },
    );
    expect(found.branches).toEqual([]);
    expect(found.failures).toHaveLength(1);
    expect(found.failures[0]?.reason).toBe('out-of-domain');
    expect(found.failures[0]?.branch).toBe('single');
  });
});

describe('Lambert — rejected multi-revolution inputs', () => {
  const orbit = shape(6.9e6, 0, 0.0, 0, 0, 0);
  const { from, to, dt } = revolutionCase(orbit, 0, Math.PI / 2, 2);

  it('rejects a revolution count that is not a non-negative integer', () => {
    for (const revolutions of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        solveLambert(from.position, to.position, dt, 'prograde', MU_EARTH, { revolutions }),
      ).toThrow(RangeError);
    }
  });

  it('rejects a search cap that is not a non-negative integer', () => {
    for (const maxRevolutions of [-1, 2.5, Number.NaN]) {
      expect(() =>
        solveLambertBranches(from.position, to.position, dt, 'prograde', MU_EARTH, {
          maxRevolutions,
        }),
      ).toThrow(RangeError);
    }
  });

  it('rejects asking the zero-revolution problem for a minimum it does not have', () => {
    // dt(z) is strictly increasing below one revolution, so there is no interior
    // minimum to return and no sensible number to invent.
    expect(() => lambertMinimumTime(from.position, to.position, 'prograde', MU_EARTH, 0)).toThrow(
      RangeError,
    );
    expect(() => lambertMinimumTime(from.position, to.position, 'prograde', MU_EARTH, 1.5)).toThrow(
      RangeError,
    );
  });

  it('runs out on the low branch before the high one, and says so either way', () => {
    /*
     * The multi-revolution face of the ceiling the zero-revolution solver
     * documents, and it is not symmetric. Each branch reaches its own revolution
     * boundary, where the time of flight diverges, and the low branch's boundary
     * is the nearer one -- at this geometry it tops out around 1.4e19 s against
     * the high branch's 4.0e20 s. So there is a window where one branch of the
     * same revolution has an answer and the other has none.
     *
     * Past that, both stop converging rather than starting to lie. At 1e19 s the
     * time of flight moves by about 4e10 s per ULP of z, so the 1e-12 relative
     * tolerance is not reachable at any z float64 can represent, and the solver
     * reports max-iterations. That is the honest outcome: bracketed, but not
     * resolvable to the precision it promises.
     */
    const orbit = shape(6.9e6, 0, 0.0, 0, 0, 0);
    const far = revolutionCase(orbit, 0, Math.PI / 2, 0);
    const ask = (dt: number, branch: 'low' | 'high') =>
      solveLambert(far.from.position, far.to.position, seconds(dt), 'prograde', MU_EARTH, {
        revolutions: 1,
        branch,
      });

    const low = ask(2e19, 'low');
    expect(low.converged, 'the low branch has no root left at 2e19 s').toBe(false);
    if (low.converged) return;
    expect(low.reason).toBe('out-of-domain');
    expect(low.branch).toBe('low');

    // The high branch still brackets it, and still refuses to claim a precision
    // it cannot deliver.
    const high = ask(2e19, 'high');
    expect(high.converged).toBe(false);
    if (high.converged) return;
    expect(high.reason).toBe('max-iterations');

    // Far enough out, neither has anything at all.
    expect(ask(5e20, 'high').converged).toBe(false);
  });

  it('carries a branch failure in `failures` rather than dropping it', () => {
    const orbit = shape(6.9e6, 0, 0.0, 0, 0, 0);
    const far = revolutionCase(orbit, 0, Math.PI / 2, 0);
    const found = solveLambertBranches(
      far.from.position,
      far.to.position,
      seconds(2e19),
      'prograde',
      MU_EARTH,
      { maxRevolutions: 1 },
    );
    expect(found.branches).toEqual([]);
    expect(found.failures.map((f) => [f.revolutions, f.branch, f.reason])).toEqual([
      [0, 'single', 'max-iterations'],
      [1, 'low', 'out-of-domain'],
      [1, 'high', 'max-iterations'],
    ]);
  });

  it('rejects the same geometry and times the zero-revolution solver rejects', () => {
    const straight = position(-9.0e6, 0, 0);
    expect(() =>
      solveLambertBranches(position(7.0e6, 0, 0), straight, dt, 'prograde', MU_EARTH),
    ).toThrow(RangeError);
    expect(() =>
      solveLambertBranches(from.position, to.position, seconds(0), 'prograde', MU_EARTH),
    ).toThrow(RangeError);
    expect(() => revolutionCeilingFor(from.position, to.position, seconds(-1), MU_EARTH)).toThrow(
      RangeError,
    );
  });
});

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

/*
 * ---------------------------------------------------------------------------
 * Tier 3 — independent reference (#54)
 *
 * Vallado, D. A., "Fundamentals of Astrodynamics and Applications", 4th edition,
 * Microcosm Press / Springer, 2013. ISBN 978-1-881883-18-0. Example 7-5,
 * section 7.6 "Two Position Vectors and Time -- Lambert's Problem", p. 497.
 *
 * Read from that edition per the process rule in docs/PRODUCT.md section 7.6, and
 * -- as with the Curtis cases above -- **from an image of the printed page rather
 * than from the PDF's text layer**, because that layer is not to be trusted with
 * a minus sign. The arrival velocity's x component is negative and that was
 * confirmed visually, not inferred.
 *
 * ## What this closes that Curtis could not
 *
 * Curtis 5.2 and 5.3 are three-dimensional transfers on inclined orbits. This one
 * is **planar and equatorial** -- both positions have zero z, so the angular
 * momentum lies along +K and the transfer runs through the geometry where an
 * inclination-based branch would be degenerate. It also uses a different solver
 * family as its reference: Vallado's is the universal-variable formulation with a
 * bisection outer loop, not Curtis's Algorithm 5.2.
 *
 * ## mu
 *
 * Vallado's 398,600.4418 km^3/s^2 is `MU_EARTH` exactly, so this case uses ours
 * rather than a book-specific constant. That is a statement about the book, not a
 * shortcut: `MU_CURTIS` above exists precisely because Curtis's 398,600 is not.
 * ---------------------------------------------------------------------------
 */

describe("Vallado 4th ed., Example 7-5 (section 7.6, p. 497) — Lambert's problem", () => {
  // GIVEN r0 = 15,945.34 I km; r = 12,214.838 99 I + 10,249.467 31 J km;
  //       dt = 76.0 min; tm = short way.
  const r1 = position(15_945.34 * KM, 0, 0);
  const r2 = position(12_214.83899 * KM, 10_249.46731 * KM, 0);
  const dt = seconds(76 * 60);

  // "Short way" is tm = +1, meaning a transfer angle below 180 degrees. Both
  // positions lie in the equatorial plane and r1 x r2 points along +K, so the
  // short way is the prograde one and the two conventions agree here. Stated
  // rather than assumed, because they do not agree in general.
  const result = solveLambert(r1, r2, dt, 'prograde', MU_EARTH);

  it('takes the short way the book specifies', () => {
    expect(result.converged).toBe(true);
    if (!result.converged) return;
    // The book: "Dnu = 40 deg".
    expectRelative((result.transferAngle * 180) / Math.PI, 40, 1e-6, 'transfer angle');
    expect(result.revolutions).toBe(0);
    expect(result.branch).toBe('single');
  });

  it('reproduces the departure and arrival velocities the book prints', () => {
    if (!result.converged) throw new Error('expected convergence');

    /*
     * v0 = 2.058 913 I + 2.915 965 J km/s
     * v  = -3.451 565 I + 0.910 315 J km/s
     *
     * TOLERANCE. 1e-5 relative -- the book's printed precision, not a tuned
     * number. Vallado prints seven significant figures, so a half-ulp of the last
     * digit is 5e-7 / 0.91 = 5.5e-7 relative on the smallest component, and his
     * own iteration table stops at a time of flight of 76.00 min against the
     * requested 76.0 -- a solve that in his words "converges slowly at the end".
     *
     * Observed worst deviation 8.3e-7, which is just above that half-ulp and is
     * the residual of his stopping point rather than of our solve: our transfer
     * angle comes out at 40.000 001 15 degrees against his printed 40. 1e-5 is
     * where the book's own convergence puts the answer, with a margin.
     */
    const TOL = 1e-5;
    expectRelative(result.departureVelocity.x / KM, 2.058913, TOL, 'v0 x');
    expectRelative(result.departureVelocity.y / KM, 2.915965, TOL, 'v0 y');
    expect(Math.abs(result.departureVelocity.z)).toBeLessThan(1e-9);

    expectRelative(result.arrivalVelocity.x / KM, -3.451565, TOL, 'v x');
    expectRelative(result.arrivalVelocity.y / KM, 0.910315, TOL, 'v y');
    expect(Math.abs(result.arrivalVelocity.z)).toBeLessThan(1e-9);
  });

  it('lands the transfer back on r2, independently of the book', () => {
    // The book's numbers check our conventions; this checks our arithmetic, and
    // the two failing together would mean something very different from either
    // failing alone.
    if (!result.converged) throw new Error('expected convergence');
    const elements = elementsFromState(r1, result.departureVelocity, MU_EARTH);
    expect(elements.eccentricity).toBeLessThan(1);
    expectClose(
      propagate({ position: r1, velocity: result.departureVelocity }, dt).position,
      r2,
      1e-9,
      'arrival',
    );
  });

  it('is the equatorial geometry the example was chosen for', () => {
    // Both positions have zero z, so this is the i = 0 degenerate case for the
    // classical element set -- the one Curtis 5.2 and 5.3 never reach.
    if (!result.converged) throw new Error('expected convergence');
    const elements = elementsFromState(r1, result.departureVelocity, MU_EARTH);
    expect(elements.degeneracy).toBe('equatorial');
    expect(elements.inclination).toBeCloseTo(0, 12);
  });
});
