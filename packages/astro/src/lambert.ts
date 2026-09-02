/**
 * Lambert's problem, zero revolution.
 *
 * Given two positions and a time of flight, find the conic joining them. This is
 * the targeting computer: the player picks a departure and an arrival and the
 * solver says what the burn costs. `docs/PRODUCT.md` section 8.3.6 is the screen it
 * feeds, and section 8.3.7's porkchop plot is the same solve run over a grid.
 *
 * Universal variables, so one formulation covers the elliptic, parabolic and
 * hyperbolic cases with no branch on conic class — the same reason the propagator
 * will use them (#56). The iteration variable `z` is the reciprocal semi-major axis
 * scaled by the universal anomaly squared: negative is hyperbolic, zero parabolic,
 * positive elliptic, and `z = 4 pi^2` is one full revolution, which is why it is the
 * open upper bound of the zero-revolution problem.
 *
 * ```
 * A     = sin(dnu) sqrt(r1 r2 / (1 - cos dnu))
 * y(z)  = r1 + r2 + A (z S(z) - 1) / sqrt(C(z))
 * chi   = sqrt(y / C)
 * dt(z) = (chi^3 S(z) + A sqrt(y)) / sqrt(mu)
 * ```
 *
 * `C` and `S` are the Stumpff functions. `dt(z)` is strictly increasing on its
 * domain and spans `(0, infinity)`, so the zero-revolution solution is unique and a
 * bracketed search cannot pick the wrong one.
 *
 * ## Transfer direction is the caller's, never the geometry's
 *
 * Two positions admit two transfers: the short way round and the long way. Which
 * one is wanted is a *decision*, not something to be read off the inputs, so
 * `direction` is a required argument. Inferring it from the geometry — taking the
 * transfer angle as the smaller of the two, say — silently returns a different
 * trajectory than the caller asked for whenever the target has moved past half a
 * revolution, and does so without any error to notice.
 *
 * `'prograde'` means the transfer's angular momentum points along `+z` in the
 * inertial frame, `'retrograde'` along `-z`. That is a statement about the ECI
 * frame `frames.ts` defines and not about the central body's rotation, which the
 * two-body model does not know about.
 *
 * ## The domain, and what is rejected
 *
 * **Collinear positions are rejected with a typed error.** At a transfer angle of
 * exactly 0 or pi the two position vectors do not span a plane, so the orbital plane
 * is undefined — at pi *every* plane containing the line is a valid answer, and the
 * solver would return one of them with no indication that the other infinity of
 * solutions existed. This is a genuine singularity of the problem rather than of the
 * method, and no formulation removes it.
 *
 * Near-collinear is not rejected but is ill-conditioned, and that is worth knowing:
 * within a degree or so of pi the plane's orientation swings hard on small changes
 * in either position. The rejection threshold is on `sin(dnu)` and is deliberately
 * tight, so that the caller gets a usable answer wherever one exists and the
 * conditioning is documented rather than hidden behind a wide refusal.
 *
 * **Non-convergence is a return value, never an exception and never a plausible
 * wrong answer** — the `KeplerResult` convention from `kepler.ts`, for the same
 * reason. A quietly wrong departure velocity becomes a trajectory that misses by
 * kilometres with nothing pointing back at the cause.
 *
 * ## Sources
 *
 * The universal-variable formulation is Bate, Mueller and White, *Fundamentals of
 * Astrodynamics* (Dover, 1971), chapter 5, as presented by Curtis, *Orbital
 * Mechanics for Engineering Students*, 4th ed., Algorithm 5.2, and by Vallado,
 * *Fundamentals of Astrodynamics and Applications*, Algorithm 57.
 *
 * Validated against Curtis Examples 5.2 (elliptical) and 5.3 (hyperbolic), read
 * from that edition per the section 7.6 process rule, to `3e-5` relative — the
 * book's printed precision. `lambert.test.ts` also checks two oracles that are
 * independent of this solver without being independent of the repository: an
 * ellipse built by the element machinery whose transfer time comes from Kepler's
 * equation, and the endpoint reproduced by propagating the returned velocity.
 *
 * The `poliastro.iod.izzo` cross-check remains #54's, as does Vallado.
 */
import type { Metres, MetresPerSec, Seconds, Vec3 } from '@hh/math';
import { brent, metresPerSec, normalize, TAU, V } from '@hh/math';

import type { EciVector } from './frames.js';
import { eci } from './frames.js';

/** Which way round the transfer goes. See the module docstring. */
export type TransferDirection = 'prograde' | 'retrograde';

/** How the answer was reached. Useful in tests, and when diagnosing a slow solve. */
export type LambertMethod = 'newton' | 'bracketed';

/** What a Lambert solve returns. */
export type LambertResult =
  | {
      readonly converged: true;
      /** Velocity at `r1` that puts the spacecraft on the transfer, in m/s. */
      readonly departureVelocity: EciVector<MetresPerSec>;
      /** Velocity at `r2` on arrival, in m/s. */
      readonly arrivalVelocity: EciVector<MetresPerSec>;
      /** Transfer angle actually used, in `[0, 2pi)`. */
      readonly transferAngle: number;
      readonly iterations: number;
      readonly method: LambertMethod;
    }
  | {
      readonly converged: false;
      readonly reason: 'max-iterations' | 'out-of-domain';
      readonly iterations: number;
    };

/** Tuning for a Lambert solve. */
export interface LambertOptions {
  /**
   * Relative tolerance on the time of flight. Default 1e-12.
   *
   * Stated on the time rather than on `z` because the time is what the caller
   * asked for and is dimensionless once divided through, whereas `z` has no
   * natural scale and the same absolute step means different things at different
   * transfer geometries.
   */
  readonly tolerance?: number;
  /** Newton iteration cap before falling back to bracketing. Default 30. */
  readonly maxIterations?: number;
}

const DEFAULT_TOLERANCE = 1e-12;
const DEFAULT_MAX_ITERATIONS = 30;

/**
 * Below this `sin(dnu)` the two positions are treated as collinear.
 *
 * Tight on purpose: this rejects a genuine singularity, not a region of poor
 * conditioning, and a wide threshold would refuse transfers that have a perfectly
 * good answer. At LEO radii it corresponds to the positions being about 7 cm off
 * the line through the centre.
 */
const COLLINEAR_TOLERANCE = 1e-8;

/** One full revolution in `z`. The zero-revolution problem lives strictly below it. */
const ONE_REVOLUTION = TAU * TAU;

/**
 * How far below one revolution the search is allowed to look.
 *
 * `z` cannot reach `4 pi^2` — the time of flight diverges there — but it cannot get
 * arbitrarily close either, and the reason is float64 rather than the mathematics.
 * `C(z) = (1 - cos sqrt z) / z` at `sqrt z = 2 pi - d` needs `d^2 / 2` to survive
 * being added to 1, so everything within about `1.5e-8` of `2 pi` returns `C = 0`
 * exactly and the time of flight comes back `Infinity`. Measured: at `4 pi^2 - 1e-7`
 * and closer, `C` is identically zero.
 *
 * `1e-4` keeps `C` around `8e-13`, comfortably resolved, and still admits a transfer
 * of roughly `4e19` seconds — about `1e12` years. Nothing this game can ask for
 * comes near it, and a request beyond it is reported as out of domain rather than
 * silently answered from a `NaN`.
 */
const REVOLUTION_MARGIN = 1e-4;

/**
 * Series threshold for the Stumpff functions.
 *
 * Below this the closed forms lose their significant digits to cancellation:
 * `C(z) = (1 - cos sqrt z)/z` differences two numbers that agree to `z/2`. Seven
 * terms of the series is exact to float64 at `|z| = 0.1` — the eighth contributes
 * about `1e-16` relative — so nothing is given up by switching over.
 */
const SERIES_LIMIT = 0.1;

/** Number of series terms. Seven is exact to float64 at the threshold above. */
const SERIES_TERMS = 7;

/**
 * Stumpff `C(z) = sum (-z)^k / (2k+2)!`.
 *
 * `(1 - cos sqrt z) / z` for `z > 0`, `(cosh sqrt(-z) - 1) / (-z)` for `z < 0`,
 * and `1/2` at zero — but evaluated by series near zero, where those forms cancel.
 *
 * The factorial is carried forward by its own recurrence rather than looked up:
 * `(2k+2)!` becomes `(2k+4)!` on multiplying by `(2k+3)(2k+4)`, which keeps the
 * series self-contained and needs no table to stay in step with the loop bound.
 */
export const stumpffC = (z: number): number => {
  if (Math.abs(z) <= SERIES_LIMIT) {
    let sum = 0;
    let term = 1;
    let denominator = 2; // (2*0 + 2)!
    for (let k = 0; k < SERIES_TERMS; k++) {
      sum += term / denominator;
      term *= -z;
      denominator *= (2 * k + 3) * (2 * k + 4);
    }
    return sum;
  }
  if (z > 0) {
    const root = Math.sqrt(z);
    return (1 - Math.cos(root)) / z;
  }
  const root = Math.sqrt(-z);
  return (Math.cosh(root) - 1) / -z;
};

/**
 * Stumpff `S(z) = sum (-z)^k / (2k+3)!`.
 *
 * `(sqrt z - sin sqrt z) / z^(3/2)` for `z > 0`, `(sinh sqrt(-z) - sqrt(-z)) /
 * (-z)^(3/2)` for `z < 0`, and `1/6` at zero. Same cancellation, same remedy.
 */
export const stumpffS = (z: number): number => {
  if (Math.abs(z) <= SERIES_LIMIT) {
    let sum = 0;
    let term = 1;
    let denominator = 6; // (2*0 + 3)!
    for (let k = 0; k < SERIES_TERMS; k++) {
      sum += term / denominator;
      term *= -z;
      denominator *= (2 * k + 4) * (2 * k + 5);
    }
    return sum;
  }
  if (z > 0) {
    const root = Math.sqrt(z);
    return (root - Math.sin(root)) / (z * root);
  }
  const root = Math.sqrt(-z);
  return (Math.sinh(root) - root) / (-z * root);
};

/**
 * Solve Lambert's problem for the zero-revolution transfer.
 *
 * Newton on `z` with a bracketed fallback, matching `kepler.ts` — and the fallback
 * is a tested path rather than decoration. Newton's derivative is well behaved over
 * most of the domain but the function steepens without bound as `z` approaches
 * `4 pi^2`, so a long transfer can throw a Newton step clean out of the domain; the
 * bracketed search then finishes the job on an interval where monotonicity
 * guarantees a root.
 *
 * @param mu Gravitational parameter of the central body, in m^3 s^-2. Explicit for
 * the same reason as everywhere else in this package.
 *
 * @throws RangeError when the two positions are collinear, when either has zero
 * length, or when the time of flight is not finite and positive. All four are
 * inputs that do not describe a transfer, as distinct from a transfer this solver
 * failed to find — which is a return value.
 */
export const solveLambert = (
  r1: EciVector<Metres>,
  r2: EciVector<Metres>,
  timeOfFlight: Seconds,
  direction: TransferDirection,
  mu: number,
  options: LambertOptions = {},
): LambertResult => {
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;

  if (!(timeOfFlight > 0) || !Number.isFinite(timeOfFlight)) {
    throw new RangeError(`time of flight must be finite and positive, got ${String(timeOfFlight)}`);
  }

  const r1Mag = V.norm(r1);
  const r2Mag = V.norm(r2);
  if (r1Mag === 0 || r2Mag === 0) {
    throw new RangeError('Lambert needs two positions with non-zero radius');
  }

  const crossed = V.cross(r1, r2);
  const sineTerm = V.norm(crossed);
  if (sineTerm / (r1Mag * r2Mag) < COLLINEAR_TOLERANCE) {
    throw new RangeError(
      'the transfer plane is undefined for collinear positions: the transfer angle is 0 or pi',
    );
  }

  // The unsigned angle between the vectors, then the branch the caller asked for.
  // atan2 rather than acos on the normalised dot product, which is banned by lint
  // (NFR-006) and would lose most of its digits for a nearly straight transfer.
  const bare = Math.atan2(sineTerm, V.dot(r1, r2));
  const shortWayIsPrograde = crossed.z >= 0;
  const takeShortWay = direction === 'prograde' ? shortWayIsPrograde : !shortWayIsPrograde;
  const transferAngle = takeShortWay ? bare : TAU - bare;

  // A carries the sign of sin(dnu), so it is negative for a transfer past half a
  // revolution. That sign is what makes one formulation cover both directions.
  const a = Math.sin(transferAngle) * Math.sqrt((r1Mag * r2Mag) / (1 - Math.cos(transferAngle)));

  const yAt = (z: number): number =>
    r1Mag + r2Mag + (a * (z * stumpffS(z) - 1)) / Math.sqrt(stumpffC(z));

  /** Time of flight at `z`, or NaN where `z` is outside the domain. */
  const timeAt = (z: number): number => {
    const y = yAt(z);
    if (!(y > 0)) return Number.NaN;
    const chi = Math.sqrt(y / stumpffC(z));
    return (chi ** 3 * stumpffS(z) + a * Math.sqrt(y)) / Math.sqrt(mu);
  };

  /** Residual whose root is the answer. Increasing in `z` throughout the domain. */
  const residual = (z: number): number => timeAt(z) - timeOfFlight;

  /**
   * Derivative of the time of flight with respect to `z`.
   *
   * Curtis Algorithm 5.2. The `z = 0` case is a separate limit rather than a
   * removable one — the general form divides by `z` — and it was checked against a
   * central difference across the domain while this was written; see
   * `lambert.test.ts`, which keeps that check.
   */
  const timeDerivative = (z: number): number => {
    const y = yAt(z);
    if (z === 0) {
      return (
        ((Math.SQRT2 / 40) * y ** 1.5 + (a / 8) * (Math.sqrt(y) + a * Math.sqrt(1 / (2 * y)))) /
        Math.sqrt(mu)
      );
    }
    const c = stumpffC(z);
    const s = stumpffS(z);
    return (
      ((y / c) ** 1.5 * ((1 / (2 * z)) * (c - (3 * s) / (2 * c)) + (3 * s * s) / (4 * c)) +
        (a / 8) * (3 * (s / c) * Math.sqrt(y) + a * Math.sqrt(c / y))) /
      Math.sqrt(mu)
    );
  };

  /** Build the answer from a converged `z`, via the Lagrange coefficients. */
  const finish = (z: number, iterations: number, method: LambertMethod): LambertResult => {
    const y = yAt(z);
    const f = 1 - y / r1Mag;
    const g = a * Math.sqrt(y / mu);
    const gDot = 1 - y / r2Mag;

    const departure: Vec3 = {
      x: (r2.x - f * r1.x) / g,
      y: (r2.y - f * r1.y) / g,
      z: (r2.z - f * r1.z) / g,
    };
    const arrival: Vec3 = {
      x: (gDot * r2.x - r1.x) / g,
      y: (gDot * r2.y - r1.y) / g,
      z: (gDot * r2.z - r1.z) / g,
    };

    return {
      converged: true,
      departureVelocity: eci(
        V.vec3(metresPerSec(departure.x), metresPerSec(departure.y), metresPerSec(departure.z)),
      ),
      arrivalVelocity: eci(
        V.vec3(metresPerSec(arrival.x), metresPerSec(arrival.y), metresPerSec(arrival.z)),
      ),
      transferAngle: normalize(transferAngle),
      iterations,
      method,
    };
  };

  const converged = (z: number): boolean => Math.abs(residual(z)) <= tolerance * timeOfFlight;

  // ---- Newton -------------------------------------------------------------
  // z = 0 is the parabolic starter: it is inside the domain for every geometry
  // this solver accepts, and it is the point whose derivative is best conditioned.
  let z = 0;
  let newtonIterations = 0;
  for (let n = 1; n <= maxIterations; n++) {
    newtonIterations = n;
    const value = residual(z);
    if (!Number.isFinite(value)) break;
    if (Math.abs(value) <= tolerance * timeOfFlight) return finish(z, n, 'newton');

    const slope = timeDerivative(z);
    if (!Number.isFinite(slope) || slope === 0) break;

    const next = z - value / slope;
    // A step that leaves the zero-revolution domain is a step Newton cannot take.
    // Hand over rather than clamp: clamping would silently converge on the bound.
    if (!Number.isFinite(next) || next >= ONE_REVOLUTION - REVOLUTION_MARGIN || !(yAt(next) > 0)) {
      break;
    }
    z = next;
  }

  // ---- Bracketed fallback -------------------------------------------------
  // The residual is increasing and spans (-timeOfFlight, infinity) on the domain,
  // so a bracket exists whenever a solution does. The upper end is as close to one
  // revolution as float64 allows the Stumpff functions to be evaluated; see
  // REVOLUTION_MARGIN. The back-off loop is belt and braces for a geometry whose
  // y(z) overflows earlier than the Stumpff cancellation does.
  let high = ONE_REVOLUTION - REVOLUTION_MARGIN;
  for (let n = 0; n < 60 && !Number.isFinite(residual(high)); n++) high /= 2;
  if (!(residual(high) > 0)) {
    return { converged: false, reason: 'out-of-domain', iterations: newtonIterations };
  }

  // Walk down from the parabolic point in doubling steps, halving whenever a step
  // would leave the domain, which drives the low end onto the boundary where the
  // time of flight falls to zero and the residual is certainly negative.
  let low = 0;
  let step = 1;
  let bracketed = residual(0) <= 0;
  let walkIterations = 0;
  while (!bracketed && walkIterations < 400) {
    walkIterations++;
    const trial = low - step;
    if (!(yAt(trial) > 0) || !Number.isFinite(residual(trial))) {
      step /= 2;
      if (step < 1e-13) break;
      continue;
    }
    low = trial;
    if (residual(low) <= 0) bracketed = true;
    else step *= 2;
  }

  const iterations = newtonIterations + walkIterations;
  if (!bracketed) {
    return { converged: false, reason: 'out-of-domain', iterations };
  }

  const fallback = brent(residual, low, high, {
    // Bracket width in z, tightened well past what the time tolerance needs so the
    // stopping condition below is what actually decides convergence.
    tolerance: 1e-14,
    maxIterations: 200,
  });
  const total = iterations + fallback.iterations;

  if (fallback.converged && converged(fallback.root)) {
    return finish(fallback.root, total, 'bracketed');
  }
  return { converged: false, reason: 'max-iterations', iterations: total };
};
