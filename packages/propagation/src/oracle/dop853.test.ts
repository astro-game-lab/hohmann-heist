/**
 * The numerical oracle (#58, FR-009).
 *
 * An oracle whose own fitness is assumed is not an oracle, so this file measures
 * it rather than asserting that it works. Three things are established, in order:
 *
 * 1. **The tableau is an 8th-order method.** Asserted from the order conditions,
 *    not from a citation — see below. This is what makes the coefficients
 *    verifiable inside the repository rather than trusted.
 * 2. **It converges at 8th order against the analytic propagator.** A clean
 *    `2^8` error ratio per halving is a joint statement about both: a wrong
 *    tableau would not converge at order 8, and a wrong reference would make the
 *    error plateau instead of shrinking.
 * 3. **Its energy behaviour is measured and recorded**, so `docs/PHYSICS.md` can
 *    state what this oracle is good for instead of implying it is exact.
 */
import { MU_EARTH, eci, period, stateFromElements } from '@hh/astro';
import type { State } from '@hh/astro';
import { V, metres, radians, seconds } from '@hh/math';
import { describe, expect, it } from 'vitest';

import { propagate } from '../universal.js';
import { TABLEAU, integrate } from './dop853.js';

/**
 * Read one element of a numeric sequence.
 *
 * `noUncheckedIndexedAccess` is on, and it is on for a good reason, so the tableau
 * is read through this rather than through a non-null assertion that would suppress
 * the check the compiler is right to make.
 */
const at = (values: ArrayLike<number>, index: number): number => values[index] ?? Number.NaN;

const orbit = (a: number, e: number, nu: number): State =>
  stateFromElements(
    {
      semiLatusRectum: metres(Math.abs(a * (1 - e * e))),
      eccentricity: e,
      inclination: radians(0.4),
      raan: radians(1.1),
      argp: radians(2.2),
      trueAnomaly: radians(nu),
    },
    MU_EARTH,
  );

const specificEnergy = (s: State): number =>
  V.normSq(s.velocity) / 2 - MU_EARTH / V.norm(s.position);

const relativePosition = (got: State, want: State): number =>
  V.distance(got.position, want.position) / V.norm(want.position);

const analytic = (s: State, dt: number): State => {
  const result = propagate(s, seconds(dt), MU_EARTH);
  if (!result.converged) throw new Error(`analytic reference failed: ${result.reason}`);
  return result.state;
};

const numeric = (s: State, dt: number, options = {}): State => {
  const result = integrate(s, seconds(dt), MU_EARTH, options);
  if (!result.converged) throw new Error(`integration failed: ${result.reason}`);
  return result.state;
};

describe('the tableau satisfies the order conditions', () => {
  /**
   * The coefficients are Hairer, Norsett and Wanner's, but they are *checked* here
   * rather than cited here. A citation cannot catch a transcription error and this
   * can: the conditions below are necessary for a method of order 8, they involve
   * every coefficient, and they are violated by a wrong digit almost anywhere.
   */
  it('has every stage row summing to its abscissa', () => {
    // sum_j a_ij = c_i is the consistency condition, and it is the one a mistyped
    // coefficient breaks first. Each row is compared against an ulp of its own
    // largest entry, because the ninth row sums numbers of order 40 and cannot be
    // expected to land nearer than float64 lets it.
    for (const [i, row] of TABLEAU.a.entries()) {
      const sum = row.reduce((total, value) => total + value, 0);
      const largest = row.reduce((max, value) => Math.max(max, Math.abs(value)), 1);
      expect(Math.abs(sum - at(TABLEAU.c, i))).toBeLessThan(32 * Number.EPSILON * largest);
    }
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8])('satisfies the quadrature condition at order %i', (k) => {
    // sum_i b_i c_i^(k-1) = 1/k. An 8th-order method integrates a polynomial of
    // degree 7 exactly, so this must hold for k up to 8.
    let sum = 0;
    for (const [i, weight] of TABLEAU.b.entries()) sum += weight * at(TABLEAU.c, i) ** (k - 1);
    expect(Math.abs(sum - 1 / k)).toBeLessThan(1e-15);
  });

  it('fails the quadrature condition at order 9, as an 8th-order method must', () => {
    // The negative half of the claim, and the half that makes the positive half
    // mean something: a tableau that satisfied every condition would not be this
    // method, and one that satisfied none would fail the test above. The observed
    // residual is 2.7e-5, thirteen orders above the ones that hold.
    let sum = 0;
    for (const [i, weight] of TABLEAU.b.entries()) sum += weight * at(TABLEAU.c, i) ** 8;
    expect(Math.abs(sum - 1 / 9)).toBeGreaterThan(1e-9);
  });
});

describe('convergence order, measured', () => {
  /**
   * One step per call, by handing `integrate` a span equal to its own initial step
   * and tolerances loose enough that nothing is ever rejected. The step sequence is
   * then exactly `steps` equal steps, which is what an order measurement needs and
   * an adaptive controller will not give.
   */
  const fixedStep = (start: State, dt: number, steps: number): State => {
    const h = dt / steps;
    let current = start;
    for (let i = 0; i < steps; i++) {
      const result = integrate(current, seconds(h), MU_EARTH, {
        initialStep: h,
        relativeTolerance: 1e30,
        absoluteTolerance: 1e30,
      });
      if (!result.converged) throw new Error(`fixed-step integration failed: ${result.reason}`);
      expect(result.steps).toBe(1);
      current = result.state;
    }
    return current;
  };

  it('halving the step divides the error by about 2^8', () => {
    /**
     * On a circular orbit, because an order measurement only means something once
     * the asymptotic regime is reached and eccentricity delays it. Measured
     * per-halving orders over one period: 7.90, 7.88, 7.89, 7.91, 7.93, 7.96, 7.90
     * at e = 0; 6.72 rising to 7.93 at e = 0.2; and frankly erratic at e = 0.6,
     * where a fixed step badly mismatches a fast periapsis passage. None of that is
     * a defect in the method — it is what fixed steps do on an eccentric orbit, and
     * it is why the adaptive controller exists.
     *
     * This test earned its keep immediately: it caught a real transcription error
     * in `a[12][4]`, which had lost its exponent. The observed order was -0.09.
     */
    const a = 1.2e7;
    const start = orbit(a, 0, 0.5);
    const dt = period(metres(a), MU_EARTH);
    const reference = analytic(start, dt);

    const errors = [4, 8, 16, 32].map((steps) =>
      relativePosition(fixedStep(start, dt, steps), reference),
    );

    for (let i = 1; i < errors.length; i++) {
      const observedOrder = Math.log2(at(errors, i - 1) / at(errors, i));
      // A tableau with a wrong coefficient is not 8th order, and a wrong analytic
      // reference would make these errors plateau rather than shrink at a clean
      // rate. Both are excluded by the same measurement.
      expect(observedOrder).toBeGreaterThan(7.5);
      expect(observedOrder).toBeLessThan(8.5);
    }
  });
});

describe('agreement with the analytic solution', () => {
  it('reproduces one period to the requested tolerance', () => {
    for (const [a, e] of [
      [6.6e6, 0],
      [1.2e7, 0.3],
      [4.2e7, 0.7],
    ] as const) {
      const start = orbit(a, e, 0.5);
      const dt = period(metres(a), MU_EARTH);
      const tolerance = 1e-12;
      const got = numeric(start, dt, { relativeTolerance: tolerance, absoluteTolerance: 1e-9 });
      // The controller bounds the *local* error of each step, so the global error
      // over a period is a multiple of the requested tolerance rather than equal to
      // it. Measured over this grid at rtol 1e-10, 1e-12 and 1e-13: between 9x and
      // 290x, worst at e = 0.7 and the tightest tolerance, where the step count is
      // highest and round-off has begun competing with truncation. The bound is
      // 1000x — loose enough to be about the method rather than about one engine's
      // `Math.sqrt`, tight enough that losing an order of accuracy would fail it.
      expect(relativePosition(got, analytic(start, dt))).toBeLessThan(1000 * tolerance);
    }
  });

  it('integrates backwards, which is the same code', () => {
    const a = 1.2e7;
    const start = orbit(a, 0.3, 0.9);
    // Widened to a plain number before negating: `Seconds` is a branded type and
    // negating one produces something that is not, which lint is right to object to.
    const orbitalPeriod: number = period(metres(a), MU_EARTH);
    const dt = -orbitalPeriod;
    expect(relativePosition(numeric(start, dt), analytic(start, dt))).toBeLessThan(1e-10);
  });

  it('tightening the tolerance costs steps and buys accuracy', () => {
    const a = 1.2e7;
    const start = orbit(a, 0.3, 0.5);
    const dt = 3 * period(metres(a), MU_EARTH);
    const reference = analytic(start, dt);

    const loose = integrate(start, seconds(dt), MU_EARTH, { relativeTolerance: 1e-8 });
    const tight = integrate(start, seconds(dt), MU_EARTH, { relativeTolerance: 1e-13 });
    expect(loose.converged && tight.converged).toBe(true);
    if (!loose.converged || !tight.converged) return;

    expect(tight.steps).toBeGreaterThan(loose.steps);
    expect(relativePosition(tight.state, reference)).toBeLessThan(
      relativePosition(loose.state, reference),
    );
  });
});

describe('energy behaviour, measured rather than assumed', () => {
  /**
   * This is an explicit Runge-Kutta method, not a symplectic one, so its energy
   * error is not bounded — it wanders, and over enough orbits it wanders far. That
   * is exactly why FR-009 forbids it in the game path and why the game propagates
   * analytically. Recording the number is what turns "unsuitable for long spans"
   * from an assertion into a measurement.
   *
   * The figure this test holds to is carried into `docs/PHYSICS.md`.
   */
  it('drifts linearly in orbit count, at about 4.5e-13 per orbit at rtol 1e-13', () => {
    const a = 1.2e7;
    const start = orbit(a, 0.2, 0);
    const orbitalPeriod = period(metres(a), MU_EARTH);
    const energy0 = specificEnergy(start);
    const drift = new Map<number, number>();

    let current = start;
    for (let i = 1; i <= 100; i++) {
      current = numeric(current, orbitalPeriod, { relativeTolerance: 1e-13 });
      if (i === 1 || i === 100) {
        drift.set(i, Math.abs((specificEnergy(current) - energy0) / energy0));
      }
    }

    // Measured: 4.34e-13, 4.50e-12 and 4.52e-11 after 1, 10 and 100 orbits at rtol
    // 1e-13, and ten times each of those at rtol 1e-12. The growth is **linear** in
    // orbit count and proportional to the tolerance, which is the signature of a
    // non-symplectic method accumulating truncation error rather than of one whose
    // energy error is bounded. That is what `docs/PHYSICS.md` records, and it is
    // the reason FR-009 keeps this out of the game path: over a long enough span it
    // drifts without limit, and the analytic path does not drift at all.
    expect(drift.get(1) ?? 1).toBeLessThan(2e-12);
    expect(drift.get(100) ?? 1).toBeLessThan(2e-10);
    const growth = (drift.get(100) ?? 1) / (drift.get(1) ?? 1);
    expect(growth).toBeGreaterThan(30);
    expect(growth).toBeLessThan(300);
  });

  it('drifts in angular momentum too, about three times less than in energy', () => {
    // Worth stating precisely, because the intuitive claim — that an explicit RK
    // method conserves angular momentum far better than energy — is not what
    // happens here. Measured over 100 orbits at rtol 1e-13: 4.5e-11 in energy
    // against 1.4e-11 in angular momentum. Better, but by a factor of three rather
    // than by orders of magnitude.
    const a = 1.2e7;
    const start = orbit(a, 0.2, 0);
    const momentum0 = V.cross(start.position, start.velocity);
    const moved = numeric(start, 10 * period(metres(a), MU_EARTH), { relativeTolerance: 1e-13 });
    const momentum = V.cross(moved.position, moved.velocity);
    expect(V.distance(momentum, momentum0) / V.norm(momentum0)).toBeLessThan(1e-11);
  });
});

describe('deterministic step-size control (§11.4)', () => {
  it('takes the same steps in the same order every time', () => {
    const start = orbit(1.2e7, 0.4, 1.3);
    const first = integrate(start, seconds(5e4), MU_EARTH);
    const second = integrate(start, seconds(5e4), MU_EARTH);
    // Not merely equal answers: the same accepted and rejected step counts, the
    // same evaluation count, the same smallest step. An oracle whose step sequence
    // moved between runs could not be used to decide whether anything else had.
    expect(second).toStrictEqual(first);
  });

  it('does not mutate the state it was given', () => {
    const start = orbit(1.2e7, 0.4, 1.3);
    const snapshot = { position: { ...start.position }, velocity: { ...start.velocity } };
    numeric(start, 5e4);
    expect({ position: { ...start.position }, velocity: { ...start.velocity } }).toStrictEqual(
      snapshot,
    );
  });

  it('reports the cost it actually paid', () => {
    const result = integrate(orbit(1.2e7, 0.4, 1.3), seconds(5e4), MU_EARTH);
    expect(result.converged).toBe(true);
    if (!result.converged) return;
    expect(result.steps).toBeGreaterThan(0);
    expect(result.rejected).toBeGreaterThanOrEqual(0);
    // Step doubling costs three 12-stage steps plus two derivative evaluations per
    // attempt, so the evaluation count is a large multiple of the step count and is
    // reported rather than left to be guessed at.
    expect(result.evaluations).toBeGreaterThan(30 * result.steps);
    expect(result.smallestStep).toBeGreaterThan(0);
  });
});

describe('failure is a return value', () => {
  const start = orbit(1.2e7, 0.3, 0.5);

  it.each([
    ['a non-positive gravitational parameter', { mu: 0 }],
    ['a non-finite gravitational parameter', { mu: Number.NaN }],
  ])('reports %s as out-of-domain', (_label, { mu }) => {
    const result = integrate(start, seconds(600), mu);
    expect(result.converged).toBe(false);
    if (result.converged) return;
    expect(result.reason).toBe('out-of-domain');
  });

  it.each([['a non-finite span', { dt: Number.POSITIVE_INFINITY }]])(
    'reports %s as out-of-domain',
    (_label, { dt }) => {
      const result = integrate(start, seconds(dt), MU_EARTH);
      expect(result.converged).toBe(false);
      if (result.converged) return;
      expect(result.reason).toBe('out-of-domain');
    },
  );

  it.each([
    ['a non-positive absolute tolerance', { absoluteTolerance: 0 }],
    ['a non-positive relative tolerance', { relativeTolerance: -1 }],
  ])('reports %s as out-of-domain', (_label, options) => {
    const result = integrate(start, seconds(600), MU_EARTH, options);
    expect(result.converged).toBe(false);
    if (result.converged) return;
    expect(result.reason).toBe('out-of-domain');
  });

  it('reports a zero-radius state as out-of-domain', () => {
    const result = integrate(
      { ...start, position: eci(V.scale(start.position, 0)) },
      seconds(600),
      MU_EARTH,
    );
    expect(result.converged).toBe(false);
    if (result.converged) return;
    expect(result.reason).toBe('out-of-domain');
  });

  it('reports max-steps rather than running forever', () => {
    const result = integrate(start, seconds(1e7), MU_EARTH, {
      relativeTolerance: 1e-14,
      maxSteps: 5,
    });
    expect(result.converged).toBe(false);
    if (result.converged) return;
    expect(result.reason).toBe('max-steps');
    expect(result.steps).toBe(5);
  });

  it('returns the state unchanged for a zero span', () => {
    const result = integrate(start, seconds(0), MU_EARTH);
    expect(result.converged).toBe(true);
    if (!result.converged) return;
    expect(result.steps).toBe(0);
    expect(relativePosition(result.state, start)).toBe(0);
  });
});
