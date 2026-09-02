/**
 * Lambert's problem, zero and multiple revolutions.
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
 * ## Multiple revolutions, and why there are two of each
 *
 * `z = 4 pi^2` is one full revolution, and it is the open upper bound of the
 * zero-revolution problem for the reason above. Past it the same picture repeats
 * once per revolution: the transfer that arrives after `N` complete circuits lives
 * on `z` in `(4 pi^2 N^2, 4 pi^2 (N+1)^2)`, because `sqrt(z)` is the eccentric
 * anomaly swept, `dE + 2 pi N`, and `dE` runs over one turn.
 *
 * What changes is monotonicity. Both ends of an `N >= 1` interval correspond to a
 * semi-major axis going to infinity — at the low end the transfer arc shrinks
 * towards nothing while `N` circuits remain, at the high end it grows towards a
 * full turn — so the time of flight diverges at both, and in between it has a
 * single minimum. That is the whole structure of the multi-revolution problem:
 *
 * - Below the minimum, **no** transfer with that many revolutions exists.
 * - Above it there are **two**, one either side.
 * - Exactly at it the two coincide.
 *
 * So a time of flight admits the zero-revolution transfer plus a pair for every
 * revolution count whose minimum it clears, and `solveLambertBranches` returns all
 * of them. How many that is comes from the time of flight itself, via
 * `revolutionCeilingFor`, rather than from an assumed cap.
 *
 * ## Branch naming
 *
 * `'low'` and `'high'` name a branch by which side of the minimum it sits on in
 * `z`, and nothing else. That is a definition rather than an observation, which is
 * what section 11.4 needs from a label a stored plan will carry: the same
 * `(revolutions, branch)` pair has to mean the same transfer on every runtime and
 * after any change to how the search finds it.
 *
 * The physical reading is that `'low'` is the higher-energy transfer — it has the
 * larger semi-major axis of the two, measured across every geometry in
 * `lambert.test.ts`, and the asymptotic argument is that a common time of flight
 * needs `a_low^(3/2) 2 pi N = a_high^(3/2) 2 pi (N+1)`. It is deliberately not the
 * name: `a` is not monotone along the high branch, which passes through the
 * minimum-energy ellipse on its way back out, so "the low-energy branch" would not
 * pick out one of the two.
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
 * **The multi-revolution case has no external reference yet.** Curtis does not
 * treat it — Algorithm 5.2 is zero-revolution only — so both oracles above carry it
 * instead, extended by adding whole periods to the elapsed time so that the correct
 * velocity at both ends stays known in closed form. That is a real check and it is
 * not an independent one, which is the distinction `docs/PHYSICS.md` draws between
 * its Tier 2 and Tier 3 tables. Vallado Ch. 7 and the `poliastro.iod.izzo`
 * cross-check remain #54's and #55's, for zero and multiple revolutions alike.
 */
import type { Metres, MetresPerSec, Seconds, Vec3 } from '@hh/math';
import { brent, metresPerSec, normalize, seconds, TAU, V } from '@hh/math';

import type { EciVector } from './frames.js';
import { eci } from './frames.js';

/** Which way round the transfer goes. See the module docstring. */
export type TransferDirection = 'prograde' | 'retrograde';

/** How the answer was reached. Useful in tests, and when diagnosing a slow solve. */
export type LambertMethod = 'newton' | 'bracketed';

/**
 * Which of a revolution's two solutions a result is. See "Branch naming" above.
 *
 * `'single'` is the zero-revolution solution, which has no twin. `'minimum'` is the
 * degenerate case where the requested time of flight sits at the N-revolution
 * minimum and the two branches have collapsed onto one.
 */
export type LambertBranch = 'single' | LambertBranchChoice;

/** The branch a caller can ask for. `'single'` is implied by `revolutions: 0`. */
export type LambertBranchChoice = 'low' | 'high' | 'minimum';

/** A transfer this solver found. */
export interface LambertSolution {
  readonly converged: true;
  /** Velocity at `r1` that puts the spacecraft on the transfer, in m/s. */
  readonly departureVelocity: EciVector<MetresPerSec>;
  /** Velocity at `r2` on arrival, in m/s. */
  readonly arrivalVelocity: EciVector<MetresPerSec>;
  /** Transfer angle actually used, in `[0, 2pi)`. */
  readonly transferAngle: number;
  /** Complete revolutions before arrival. Zero for the classical solution. */
  readonly revolutions: number;
  /** Which branch of `revolutions` this is. */
  readonly branch: LambertBranch;
  readonly iterations: number;
  readonly method: LambertMethod;
}

/** A transfer this solver could not find, reported rather than thrown. */
export interface LambertFailure {
  readonly converged: false;
  readonly reason: 'max-iterations' | 'out-of-domain';
  /** The revolution count that was asked for. */
  readonly revolutions: number;
  /** The branch that was asked for. */
  readonly branch: LambertBranch;
  readonly iterations: number;
}

/** What a Lambert solve returns. */
export type LambertResult = LambertSolution | LambertFailure;

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
  /**
   * Complete revolutions before arrival. Default 0.
   *
   * A non-zero count makes `branch` meaningful, because from one revolution up
   * there are two transfers for the same time of flight rather than one.
   */
  readonly revolutions?: number;
  /** Which branch to return when `revolutions` is non-zero. Default `'low'`. */
  readonly branch?: LambertBranchChoice;
}

/** Tuning for an enumeration of every branch. */
export interface LambertBranchesOptions {
  /** Relative tolerance on the time of flight. Default 1e-12. */
  readonly tolerance?: number;
  /**
   * Ceiling on the revolution count searched. Default 100.
   *
   * This is a bound on the *work*, not on the answer: the feasible count is
   * derived from the time of flight and is almost always the smaller of the two.
   * When it is not, `revolutionCeiling` exceeds `revolutionsSearched` and the
   * caller can see that the search was cut rather than exhausted.
   */
  readonly maxRevolutions?: number;
}

/** Every branch a given time of flight admits, in a defined order. */
export interface LambertBranches {
  /**
   * The transfers, ordered `(0, single)`, `(1, low)`, `(1, high)`, `(2, low)`, ...
   *
   * The order is part of the contract, not an artefact of the search: a stored
   * plan referencing a branch has to mean the same transfer on every runtime
   * (`docs/PRODUCT.md` section 11.4).
   */
  readonly branches: readonly LambertSolution[];
  /**
   * Highest revolution count the time of flight could admit, from the bound in
   * `revolutionCeilingFor`. An upper bound, not a count of what was found.
   */
  readonly revolutionCeiling: number;
  /** Highest revolution count actually searched: `min(ceiling, maxRevolutions)`. */
  readonly revolutionsSearched: number;
  /**
   * Branches that were expected to exist but did not converge. Empty in every
   * case tested; present so that a failure is reported rather than silently
   * missing from `branches`.
   */
  readonly failures: readonly LambertFailure[];
}

/** The fastest transfer for a given revolution count, and where it sits in `z`. */
export interface LambertMinimum {
  readonly revolutions: number;
  /** The universal variable at the minimum. The two branches meet here. */
  readonly z: number;
  /** Time of flight there. No `revolutions`-revolution transfer is faster. */
  readonly timeOfFlight: Seconds;
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
 * The same inset, expressed in `sqrt(z)` so it can be applied at any revolution.
 *
 * `C(z)` vanishes at *every* `sqrt(z) = 2 pi k`, not only at the first one, because
 * `cos(2 pi k) = 1` exactly. So each N-revolution interval is bounded below and
 * above by the same cancellation the zero-revolution ceiling runs into, and the
 * argument that fixes the margin is about `sqrt(z)` rather than `z`: writing
 * `sqrt(z) = 2 pi k + d`, the numerator is `1 - cos d ~ d^2 / 2`, which stops being
 * resolvable against 1 below `d ~ 2e-8` whatever `k` is.
 *
 * `REVOLUTION_MARGIN / (4 pi)` is that same distance read off the zero-revolution
 * ceiling, so the two agree there to 6e-11 in `z`. The zero-revolution path keeps
 * using the constant above so its documented `4 pi^2 - 1e-4` bound stays exact.
 */
const SQRT_Z_MARGIN = REVOLUTION_MARGIN / (2 * TAU);

/**
 * Ceiling on the revolution count searched when the caller states none.
 *
 * A hundred revolutions is about six days in low Earth orbit and far beyond any
 * transfer this game asks for, so in practice the time of flight is what bounds the
 * search. It exists because the feasible count grows without bound as the time of
 * flight does, and enumerating branches for a time of flight of 1e19 seconds is not
 * a service to anyone.
 */
const DEFAULT_MAX_REVOLUTIONS = 100;

/**
 * How many times an interval end may be doubled away from its revolution boundary.
 *
 * The starting inset is `SQRT_Z_MARGIN` and the half-width of an interval in
 * `sqrt(z)` is `pi`, so nineteen doublings cross it. Thirty is slack for a geometry
 * that needs more room than the Stumpff cancellation alone would ask for.
 */
const BACKOFF_STEPS = 30;

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
 * The parts of a Lambert problem that depend on the geometry alone.
 *
 * Built once and shared by every solve on the same pair of positions, which is what
 * lets the zero-revolution search and the multi-revolution branches be the same
 * formulation rather than two implementations that have to be kept in agreement.
 *
 * @throws RangeError when the two positions are collinear or either has zero
 * length. Both are inputs that do not describe a transfer.
 */
const geometryOf = (
  r1: EciVector<Metres>,
  r2: EciVector<Metres>,
  direction: TransferDirection,
  mu: number,
): LambertGeometry => {
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

  // The chord from the law of cosines rather than from the vector difference,
  // because cos(2 pi - x) = cos(x) makes it explicit that the chord -- and so the
  // minimum-energy ellipse and the revolution ceiling built on it -- is a property
  // of the two points and not of which way round the transfer goes.
  const chord = Math.sqrt(
    r1Mag * r1Mag + r2Mag * r2Mag - 2 * r1Mag * r2Mag * Math.cos(transferAngle),
  );

  const yAt = (z: number): number =>
    r1Mag + r2Mag + (a * (z * stumpffS(z) - 1)) / Math.sqrt(stumpffC(z));

  /** Time of flight at `z`, or NaN where `z` is outside the domain. */
  const timeAt = (z: number): number => {
    const y = yAt(z);
    if (!(y > 0)) return Number.NaN;
    const chi = Math.sqrt(y / stumpffC(z));
    return (chi ** 3 * stumpffS(z) + a * Math.sqrt(y)) / Math.sqrt(mu);
  };

  /**
   * Derivative of the time of flight with respect to `z`.
   *
   * Curtis Algorithm 5.2. The `z = 0` case is a separate limit rather than a
   * removable one -- the general form divides by `z` -- and it was checked against a
   * central difference across the domain while this was written; see
   * `lambert.test.ts`, which keeps that check.
   *
   * It earns a second job in the multi-revolution problem, where its root locates
   * the minimum that separates the two branches.
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
  const finish = (
    z: number,
    revolutions: number,
    branch: LambertBranch,
    iterations: number,
    method: LambertMethod,
  ): LambertSolution => {
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
      revolutions,
      branch,
      iterations,
      method,
    };
  };

  return {
    transferAngle,
    chordCoefficient: a,
    minimumEnergySemiMajorAxis: (r1Mag + r2Mag + chord) / 4,
    yAt,
    timeAt,
    timeDerivative,
    finish,
  };
};

/** The geometry-only half of a Lambert problem. See `geometryOf`. */
interface LambertGeometry {
  /** Transfer angle actually used, before normalisation. */
  readonly transferAngle: number;
  /** `A` in the module docstring, carrying the sign of `sin(dnu)`. */
  readonly chordCoefficient: number;
  /** `s / 2`: the minimum-energy ellipse through both points. */
  readonly minimumEnergySemiMajorAxis: number;
  readonly yAt: (z: number) => number;
  readonly timeAt: (z: number) => number;
  readonly timeDerivative: (z: number) => number;
  readonly finish: (
    z: number,
    revolutions: number,
    branch: LambertBranch,
    iterations: number,
    method: LambertMethod,
  ) => LambertSolution;
}

/** Shared rejection, so every entry point refuses the same times of flight. */
const requireTimeOfFlight = (timeOfFlight: Seconds): void => {
  if (!(timeOfFlight > 0) || !Number.isFinite(timeOfFlight)) {
    throw new RangeError(`time of flight must be finite and positive, got ${String(timeOfFlight)}`);
  }
};

/** Shared rejection for a revolution count that is not one. */
const requireRevolutions = (revolutions: number, least: number): void => {
  if (!Number.isInteger(revolutions) || revolutions < least) {
    throw new RangeError(
      `revolutions must be an integer of at least ${String(least)}, got ${String(revolutions)}`,
    );
  }
};

/**
 * Bracket tolerance for a Brent search on `z`, scaled to where the bracket sits.
 *
 * `brent` takes an absolute width, and `z` runs as `4 pi^2 N^2` -- about 39 at one
 * revolution and 40 000 at thirty-one. A fixed 1e-14 is a few ULP at the first and
 * an order of magnitude below one ULP at the last, where the search could never
 * satisfy it: it would spend its whole budget and then report failure on a bracket
 * it had in fact resolved as far as float64 allows. Scaling keeps the stopping
 * condition a statement about precision rather than about magnitude.
 */
const bracketTolerance = (lo: number, hi: number): number =>
  Math.max(1e-14, 4 * Number.EPSILON * Math.max(Math.abs(lo), Math.abs(hi)));

/** A `z` interval, inset from both of its revolution boundaries. */
interface RevolutionInterval {
  readonly lo: number;
  readonly hi: number;
}

/**
 * The usable `z` interval for `revolutions` complete revolutions.
 *
 * The mathematical interval is `(4 pi^2 N^2, 4 pi^2 (N+1)^2)`, whose ends are the
 * two `sqrt(z) = 2 pi k` boundaries where `C(z)` vanishes. Each end is walked away
 * from its boundary in doublings until `y(z)` is positive, the time of flight is
 * finite, and the slope has the sign the divergence demands -- negative at the low
 * end, positive at the high end, because the time of flight goes to infinity at
 * both. Those two signs are the whole point: they bracket the minimum.
 *
 * The `y > 0` condition is not decoration. At the lower boundary `y` tends to
 * `r1 + r2 - sqrt(2) A`, and `A` tends to `sqrt(2) r` as the transfer angle closes,
 * so a near-collinear geometry drives `y` towards zero there and the interval has to
 * start further in. This is the multi-revolution face of the same ill-conditioning
 * the module docstring describes for near-collinear zero-revolution transfers.
 *
 * `null` when no usable interval exists, which is a report rather than a guess.
 */
const revolutionIntervalOf = (
  g: LambertGeometry,
  revolutions: number,
): RevolutionInterval | null => {
  const usable = (z: number, wantFalling: boolean): boolean => {
    if (!(g.yAt(z) > 0) || !Number.isFinite(g.timeAt(z))) return false;
    const slope = g.timeDerivative(z);
    if (!Number.isFinite(slope)) return false;
    return wantFalling ? slope < 0 : slope > 0;
  };

  const walk = (boundary: number, inward: number, wantFalling: boolean): number | null => {
    let delta = SQRT_Z_MARGIN;
    for (let n = 0; n < BACKOFF_STEPS && delta < Math.PI; n++, delta *= 2) {
      const z = (boundary + inward * delta) ** 2;
      if (usable(z, wantFalling)) return z;
    }
    return null;
  };

  const lo = walk(TAU * revolutions, 1, true);
  const hi = walk(TAU * (revolutions + 1), -1, false);
  if (lo === null || hi === null || !(lo < hi)) return null;
  return { lo, hi };
};

/** Where the two branches of a revolution meet: the root of `dt/dz`. */
interface RevolutionMinimum {
  readonly z: number;
  readonly iterations: number;
}

/**
 * Locate the N-revolution minimum by rooting the derivative rather than by
 * minimising the time of flight directly.
 *
 * The derivative is already written down, already used by Newton, and already
 * checked against a central difference, so this needs no minimiser and no second
 * formulation to keep in step. The interval's two ends straddle the root by
 * construction, which is what `revolutionIntervalOf` establishes.
 */
const minimumOf = (g: LambertGeometry, interval: RevolutionInterval): RevolutionMinimum | null => {
  const found = brent(g.timeDerivative, interval.lo, interval.hi, {
    tolerance: bracketTolerance(interval.lo, interval.hi),
    maxIterations: 200,
  });
  if (!found.converged) return null;
  return { z: found.root, iterations: found.iterations };
};

/** The revolution ceiling, for a geometry already built. */
const ceilingOf = (g: LambertGeometry, timeOfFlight: number, mu: number): number =>
  Math.floor(timeOfFlight / (TAU * Math.sqrt(g.minimumEnergySemiMajorAxis ** 3 / mu)));

/**
 * Highest revolution count a time of flight could admit, for any transfer between
 * these two points.
 *
 * Every multi-revolution transfer is an ellipse, and Lagrange's form of the time of
 * flight is
 *
 * ```
 * t = sqrt(a^3 / mu) [ 2 pi N + (alpha - sin alpha) - (beta - sin beta) ]
 * ```
 *
 * with `beta <= alpha` and `x - sin x` increasing, so the bracket is at least
 * `2 pi N`. The semi-major axis is at least that of the minimum-energy ellipse
 * through the two points, `s / 2`, so
 *
 * ```
 * t >= 2 pi N sqrt((s/2)^3 / mu)     =>     N <= t / (2 pi sqrt((s/2)^3 / mu))
 * ```
 *
 * That is the acceptance criterion's "computed from the time of flight rather than
 * assumed", and it is a true ceiling rather than a heuristic: no N above it can
 * have a solution. It is also tight -- across every geometry tested it returns
 * exactly the feasible count -- so the search it bounds wastes almost nothing.
 *
 * Independent of `direction`: `s` is built from the chord, and the chord is a
 * property of the two points. Both ways round the same pair of positions have the
 * same ceiling.
 *
 * @throws RangeError on the same inputs as `solveLambert`.
 */
export const revolutionCeilingFor = (
  r1: EciVector<Metres>,
  r2: EciVector<Metres>,
  timeOfFlight: Seconds,
  mu: number,
): number => {
  requireTimeOfFlight(timeOfFlight);
  return ceilingOf(geometryOf(r1, r2, 'prograde', mu), timeOfFlight, mu);
};

/**
 * The fastest `revolutions`-revolution transfer between two points, and the `z` at
 * which it happens.
 *
 * Below this time of flight there is no transfer with this many revolutions; above
 * it there are two. At it the two coincide, which is the boundary case
 * `solveLambertBranches` reports as a single `'minimum'` branch rather than as a
 * duplicated pair.
 *
 * `null` when the geometry admits no usable interval for this revolution count.
 *
 * @throws RangeError for `revolutions` below 1 -- the zero-revolution time of
 * flight is strictly increasing and has no interior minimum -- and on the same
 * inputs as `solveLambert`.
 */
export const lambertMinimumTime = (
  r1: EciVector<Metres>,
  r2: EciVector<Metres>,
  direction: TransferDirection,
  mu: number,
  revolutions: number,
): LambertMinimum | null => {
  requireRevolutions(revolutions, 1);
  const g = geometryOf(r1, r2, direction, mu);
  const interval = revolutionIntervalOf(g, revolutions);
  if (interval === null) return null;
  const minimum = minimumOf(g, interval);
  if (minimum === null) return null;
  const timeOfFlight = g.timeAt(minimum.z);
  if (!Number.isFinite(timeOfFlight)) return null;
  return { revolutions, z: minimum.z, timeOfFlight: seconds(timeOfFlight) };
};

/**
 * Solve one branch on an interval already known to bracket it.
 *
 * The time of flight is monotone on each side of the minimum, so a bracketed search
 * cannot pick the wrong root -- the same guarantee the zero-revolution fallback
 * relies on, applied to half an interval instead of the whole of one.
 */
const solveOnBranch = (
  g: LambertGeometry,
  timeOfFlight: number,
  revolutions: number,
  branch: 'low' | 'high',
  tolerance: number,
  interval: RevolutionInterval,
  minimum: RevolutionMinimum,
): LambertResult => {
  const residual = (z: number): number => g.timeAt(z) - timeOfFlight;
  const outer = branch === 'low' ? interval.lo : interval.hi;
  const lo = branch === 'low' ? interval.lo : minimum.z;
  const hi = branch === 'low' ? minimum.z : interval.hi;

  // The far end of the branch is where the time of flight diverges, so it is
  // normally far above anything asked for. When it is not, the request is past what
  // the Stumpff functions can resolve on this side -- the same float64 ceiling the
  // zero-revolution search runs into, reported the same way rather than answered
  // from a cancelled subtraction.
  if (!(residual(outer) > 0)) {
    return {
      converged: false,
      reason: 'out-of-domain',
      revolutions,
      branch,
      iterations: minimum.iterations,
    };
  }

  const found = brent(residual, lo, hi, {
    tolerance: bracketTolerance(lo, hi),
    maxIterations: 200,
  });
  const iterations = minimum.iterations + found.iterations;
  if (!found.converged || !(Math.abs(residual(found.root)) <= tolerance * timeOfFlight)) {
    return { converged: false, reason: 'max-iterations', revolutions, branch, iterations };
  }
  return g.finish(found.root, revolutions, branch, iterations, 'bracketed');
};

/** One requested `(revolutions, branch)` transfer, from first principles. */
const solveRevolution = (
  g: LambertGeometry,
  timeOfFlight: number,
  revolutions: number,
  branch: LambertBranchChoice,
  tolerance: number,
): LambertResult => {
  const fail = (
    reason: 'max-iterations' | 'out-of-domain',
    iterations: number,
  ): LambertFailure => ({ converged: false, reason, revolutions, branch, iterations });

  const interval = revolutionIntervalOf(g, revolutions);
  if (interval === null) return fail('out-of-domain', 0);

  const minimum = minimumOf(g, interval);
  if (minimum === null) return fail('max-iterations', 200);

  const minimumTime = g.timeAt(minimum.z);
  if (!Number.isFinite(minimumTime)) return fail('out-of-domain', minimum.iterations);

  // Below the fastest transfer with this many revolutions there is no such
  // transfer. Say so, rather than returning the nearest one that does exist -- that
  // is the whole point of the acceptance criterion about asking for too many.
  if (minimumTime > timeOfFlight) return fail('out-of-domain', minimum.iterations);

  const atMinimum = Math.abs(minimumTime - timeOfFlight) <= tolerance * timeOfFlight;
  if (branch === 'minimum') {
    if (!atMinimum) return fail('out-of-domain', minimum.iterations);
    return g.finish(minimum.z, revolutions, 'minimum', minimum.iterations, 'bracketed');
  }
  // The two branches have collapsed onto one. Return it under the label that was
  // asked for: a caller re-solving a stored plan gets the transfer it stored, and
  // it is `solveLambertBranches` -- where a duplicate would actually be a duplicate
  // -- that reports the collapse as a single `'minimum'` entry instead.
  if (atMinimum) {
    return g.finish(minimum.z, revolutions, branch, minimum.iterations, 'bracketed');
  }

  return solveOnBranch(g, timeOfFlight, revolutions, branch, tolerance, interval, minimum);
};

/** The zero-revolution search: Newton from the parabolic point, then bracketing. */
const solveZeroRevolution = (
  g: LambertGeometry,
  timeOfFlight: number,
  tolerance: number,
  maxIterations: number,
): LambertResult => {
  const residual = (z: number): number => g.timeAt(z) - timeOfFlight;
  const converged = (z: number): boolean => Math.abs(residual(z)) <= tolerance * timeOfFlight;
  const fail = (
    reason: 'max-iterations' | 'out-of-domain',
    iterations: number,
  ): LambertFailure => ({ converged: false, reason, revolutions: 0, branch: 'single', iterations });

  // ---- Newton -------------------------------------------------------------
  // z = 0 is the parabolic starter: it is inside the domain for every geometry
  // this solver accepts, and it is the point whose derivative is best conditioned.
  let z = 0;
  let newtonIterations = 0;
  for (let n = 1; n <= maxIterations; n++) {
    newtonIterations = n;
    const value = residual(z);
    if (!Number.isFinite(value)) break;
    if (Math.abs(value) <= tolerance * timeOfFlight) return g.finish(z, 0, 'single', n, 'newton');

    const slope = g.timeDerivative(z);
    if (!Number.isFinite(slope) || slope === 0) break;

    const next = z - value / slope;
    // A step that leaves the zero-revolution domain is a step Newton cannot take.
    // Hand over rather than clamp: clamping would silently converge on the bound.
    if (
      !Number.isFinite(next) ||
      next >= ONE_REVOLUTION - REVOLUTION_MARGIN ||
      !(g.yAt(next) > 0)
    ) {
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
  if (!(residual(high) > 0)) return fail('out-of-domain', newtonIterations);

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
    if (!(g.yAt(trial) > 0) || !Number.isFinite(residual(trial))) {
      step /= 2;
      if (step < 1e-13) break;
      continue;
    }
    low = trial;
    if (residual(low) <= 0) bracketed = true;
    else step *= 2;
  }

  const iterations = newtonIterations + walkIterations;
  if (!bracketed) return fail('out-of-domain', iterations);

  const fallback = brent(residual, low, high, {
    // Bracket width in z, tightened well past what the time tolerance needs so the
    // stopping condition below is what actually decides convergence.
    tolerance: 1e-14,
    maxIterations: 200,
  });
  const total = iterations + fallback.iterations;

  if (fallback.converged && converged(fallback.root)) {
    return g.finish(fallback.root, 0, 'single', total, 'bracketed');
  }
  return fail('max-iterations', total);
};

/**
 * Solve Lambert's problem for one transfer.
 *
 * With `revolutions: 0`, the default, this is the classical problem: Newton on `z`
 * from the parabolic point with a bracketed fallback, matching `kepler.ts` -- and
 * the fallback is a tested path rather than decoration. Newton's derivative is well
 * behaved over most of the domain but the function steepens without bound as `z`
 * approaches `4 pi^2`, so a long transfer can throw a Newton step clean out of the
 * domain; the bracketed search then finishes the job on an interval where
 * monotonicity guarantees a root.
 *
 * With `revolutions` at one or more, the answer is one of the two branches named by
 * `branch`. There is no Newton phase there: the interval is known, the minimum
 * separating the branches is located first, and each branch is then monotone on its
 * half, so a bracketed search is both guaranteed and quick. A request the time of
 * flight cannot satisfy -- too few seconds for that many revolutions -- comes back
 * as `out-of-domain` rather than as the nearest transfer that does exist.
 *
 * @param mu Gravitational parameter of the central body, in m^3 s^-2. Explicit for
 * the same reason as everywhere else in this package.
 *
 * @throws RangeError when the two positions are collinear, when either has zero
 * length, when the time of flight is not finite and positive, or when `revolutions`
 * is not a non-negative integer. All are inputs that do not describe a transfer, as
 * distinct from a transfer this solver failed to find -- which is a return value.
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
  const revolutions = options.revolutions ?? 0;

  requireTimeOfFlight(timeOfFlight);
  requireRevolutions(revolutions, 0);

  const g = geometryOf(r1, r2, direction, mu);
  return revolutions === 0
    ? solveZeroRevolution(g, timeOfFlight, tolerance, maxIterations)
    : solveRevolution(g, timeOfFlight, revolutions, options.branch ?? 'low', tolerance);
};

/**
 * Every transfer between two positions that takes exactly this long (FR-007).
 *
 * The zero-revolution solution, then both branches of every revolution count the
 * time of flight admits, in that order. The count is derived from the time of
 * flight by `revolutionCeilingFor` and then confirmed one revolution at a time
 * against the minimum, so a request for more revolutions than the clock allows
 * yields fewer branches rather than wrong ones.
 *
 * The order is a contract, not an artefact: `docs/PRODUCT.md` section 11.4 requires
 * that a stored plan naming a branch mean the same transfer on every runtime, and
 * an ordering that fell out of the search would not survive a change to the search.
 *
 * @throws RangeError on the same inputs as `solveLambert`, and when
 * `maxRevolutions` is not a non-negative integer.
 */
export const solveLambertBranches = (
  r1: EciVector<Metres>,
  r2: EciVector<Metres>,
  timeOfFlight: Seconds,
  direction: TransferDirection,
  mu: number,
  options: LambertBranchesOptions = {},
): LambertBranches => {
  const tolerance = options.tolerance ?? DEFAULT_TOLERANCE;
  const maxRevolutions = options.maxRevolutions ?? DEFAULT_MAX_REVOLUTIONS;

  requireTimeOfFlight(timeOfFlight);
  if (!Number.isInteger(maxRevolutions) || maxRevolutions < 0) {
    throw new RangeError(
      `maxRevolutions must be a non-negative integer, got ${String(maxRevolutions)}`,
    );
  }

  const g = geometryOf(r1, r2, direction, mu);
  const branches: LambertSolution[] = [];
  const failures: LambertFailure[] = [];

  const record = (result: LambertResult): void => {
    if (result.converged) branches.push(result);
    else failures.push(result);
  };

  record(solveZeroRevolution(g, timeOfFlight, tolerance, DEFAULT_MAX_ITERATIONS));

  const revolutionCeiling = ceilingOf(g, timeOfFlight, mu);
  const revolutionsSearched = Math.min(revolutionCeiling, maxRevolutions);

  for (let n = 1; n <= revolutionsSearched; n++) {
    const interval = revolutionIntervalOf(g, n);
    if (interval === null) continue;
    const minimum = minimumOf(g, interval);
    if (minimum === null) continue;

    const minimumTime = g.timeAt(minimum.z);
    // The ceiling is an upper bound, so counts below it can still be infeasible.
    // Skipping is the honest answer: there is no such transfer, and there is no
    // failure to report either.
    if (!Number.isFinite(minimumTime) || minimumTime > timeOfFlight) continue;

    // Exactly at the minimum the two branches are the same transfer. One entry,
    // labelled for what it is -- returning it twice would be a duplicate, and
    // returning neither would lose a solution that exists.
    if (Math.abs(minimumTime - timeOfFlight) <= tolerance * timeOfFlight) {
      branches.push(g.finish(minimum.z, n, 'minimum', minimum.iterations, 'bracketed'));
      continue;
    }

    record(solveOnBranch(g, timeOfFlight, n, 'low', tolerance, interval, minimum));
    record(solveOnBranch(g, timeOfFlight, n, 'high', tolerance, interval, minimum));
  }

  return { branches, revolutionCeiling, revolutionsSearched, failures };
};
