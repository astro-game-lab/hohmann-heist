/**
 * Universal-variable Kepler propagation.
 *
 * Given a state and an elapsed time, return the state that many seconds later —
 * or earlier. This is the one operation the whole game rests on: every dotted
 * prediction line, every rendezvous, every event search is this function called
 * repeatedly, so it is also the one place where being wrong is least survivable.
 *
 * **One formulation, no branch on conic class.** The universal anomaly `chi`
 * absorbs the difference between an ellipse, a parabola and a hyperbola into the
 * Stumpff functions `C(z)` and `S(z)`, with `z = chi^2 / a`. Negative `z` is
 * hyperbolic, zero parabolic, positive elliptic, and the code above the Stumpff
 * call never asks which. `lambert.ts` uses the same formulation for the same
 * reason, and its `stumpffC` / `stumpffS` are reused here rather than reimplemented
 * — a second copy of a series expansion is a second thing to keep in step.
 *
 * ```
 * F(chi) = sigma0 chi^2 C(z) + (1 - r0/a) chi^3 S(z) + r0 chi - sqrt(mu) dt
 * F'(chi) = r(chi)
 * ```
 *
 * where `sigma0 = r0 . v0 / sqrt(mu)`. The derivative being the radius is not a
 * coincidence and is worth stating, because it is what makes this solver safe:
 * `dt/dchi = r / sqrt(mu)`, the radius is strictly positive on any non-rectilinear
 * orbit, so **`F` is strictly increasing in `chi` and unbounded in both
 * directions**. It therefore has exactly one root, that root has the sign of `dt`,
 * and a bracket grown by doubling cannot fail to straddle it. There is no wrong
 * root to converge on.
 *
 * ## Backwards is not a special case
 *
 * `dt < 0` runs the same code. `F(0) = -sqrt(mu) dt`, so the sign of `dt` picks the
 * side of zero the root lives on and nothing else changes. Time reversal is the
 * sharpest cheap test of a propagator and it is in `universal.test.ts`.
 *
 * ## No numerical integration (D5, FR-009)
 *
 * The state at `t` is a pure function of the state at `t0` and the elapsed time.
 * Nothing is stepped, so nothing accumulates: propagating 17 days in one call is
 * not worse than propagating 17 minutes, and is *better* than 1000 chained calls
 * of 17 days / 1000. `universal.test.ts` asserts exactly that comparison, because
 * it is the property the determinism specification (§11.4, "no accumulation")
 * actually depends on.
 *
 * ## Whole revolutions are removed before solving
 *
 * On a closed orbit the state after `dt` and the state after `dt - N T` are the
 * same state. That is exact, not an approximation, so the solve is done on the
 * remainder and `N` is reported alongside the answer.
 *
 * This is not a micro-optimisation, it is the difference between meeting §13.3 and
 * missing it by four orders of magnitude. `chi` is `sqrt(a) dE`, so `sqrt(z)` is
 * the eccentric anomaly swept, and float64 knows that angle to a *relative* `eps` —
 * an absolute uncertainty of `eps 2 pi N` radians, which turns into a time
 * uncertainty that a further factor of `v dt / r` converts into position error.
 * Both factors run with `N`, so the error grows faster than the revolution count.
 * Measured on the unreduced solver over §13.3's full span: `5e-15` relative at one
 * revolution, `1.3e-10` at ninety-two, `1.9e-8` at four hundred and eighty-six.
 * Reduction holds `sqrt(z)` below `pi` for every `dt`, and what is left is the
 * error in `N T` itself.
 *
 * The reduction is the one place this module asks what conic it is on, and it asks
 * outside the solver rather than inside it: `F` is still evaluated by one
 * branch-free expression, and a hyperbola simply never takes the branch.
 *
 * ## Convergence
 *
 * Non-convergence is a return value, never an exception and never a plausible
 * wrong answer — the `KeplerResult` convention from `@hh/astro`, for the same
 * reason it exists there.
 *
 * The tolerance is **relative on `chi`**, not absolute. `chi` has units of
 * sqrt(metres) and its magnitude runs with `sqrt(a)` times the swept eccentric
 * anomaly, so a fixed absolute tolerance means a different number of significant
 * figures at LEO than at GEO and fewer still after a hundred revolutions.
 * `lambert.ts` rejects an absolute tolerance on `z` on the same grounds and states
 * its tolerance on the time of flight instead; that choice is right there and
 * wrong here. Lambert is *given* a time of flight and asked for a geometry, so the
 * time is what the caller specified. Here the caller specifies the time exactly
 * and wants the state, and stopping when the time residual is small enough leaves
 * a position error of `v dt` times that residual — an amplification of a few
 * thousand over a month at LEO. Driving `chi` to its own last few digits instead
 * puts the answer on the floor set by float64, which is where §13.3's time
 * reversal requirement needs it.
 *
 * ## Sources
 *
 * The universal-variable formulation is Bate, Mueller and White, *Fundamentals of
 * Astrodynamics* (Dover, 1971), chapter 4, as presented by Curtis, *Orbital
 * Mechanics for Engineering Students*, 4th ed., Algorithm 3.4 and equations
 * 3.66-3.69. The per-conic starting values are Vallado, *Fundamentals of
 * Astrodynamics and Applications*, Algorithm 8.
 *
 * These are citations for the *formulation*. No printed number from either book is
 * asserted here — see `universal.test.ts` for what this module is actually checked
 * against, and `docs/PHYSICS.md` for what remains unchecked.
 */
import type { State } from '@hh/astro';
import { eci, stumpffC, stumpffS } from '@hh/astro';
import type { Seconds } from '@hh/math';
import { brent, metres, metresPerSec, TAU, V } from '@hh/math';

/** How the answer was reached. Useful in tests, and when diagnosing a slow solve. */
export type PropagationMethod = 'newton' | 'bracketed';

/** What a propagation returns. */
export type PropagationResult =
  | {
      readonly converged: true;
      /** The state at `t0 + dt`, in the same frame as the input. */
      readonly state: State;
      /**
       * The universal anomaly actually solved for, in sqrt(metres).
       *
       * On a closed orbit this is the anomaly of the *reduced* time
       * `dt - wholeRevolutions T`, so it carries the sign of that remainder rather
       * than of `dt`, and its magnitude never exceeds one revolution. Exposed
       * because it is the natural continuation variable: an event search that has
       * already located a crossing can hand the solver a starting value rather
       * than rediscovering it. Not needed to use the result.
       */
      readonly universalAnomaly: number;
      /**
       * Whole orbits removed from `dt` before solving. Zero on an open orbit, and
       * on a closed one whenever `|dt|` is under half a period.
       *
       * Reported rather than hidden because it is the difference between the
       * anomaly above and the one a caller would compute from `dt` directly.
       */
      readonly wholeRevolutions: number;
      readonly iterations: number;
      readonly method: PropagationMethod;
    }
  | {
      readonly converged: false;
      readonly reason: 'max-iterations' | 'out-of-domain';
      /** Best estimate of the universal anomaly. For diagnostics; not a solution. */
      readonly best: number;
      readonly iterations: number;
    };

/** Tuning for a propagation. */
export interface PropagationOptions {
  /**
   * Relative tolerance on the universal anomaly. Default 1e-14.
   *
   * About 45 ulp: tight enough that the state error is set by round-off in the
   * Lagrange coefficients rather than by the solve, loose enough that Newton is
   * not chasing noise in `F` near the root. See the module docstring for why this
   * is relative rather than absolute, and why it is on `chi` rather than on time.
   */
  readonly tolerance?: number;
  /** Newton iteration cap before falling back to bracketing. Default 30. */
  readonly maxIterations?: number;
}

const DEFAULT_TOLERANCE = 1e-14;
const DEFAULT_MAX_ITERATIONS = 30;

/**
 * The band of `|r0 / a|` in which Barker's equation gives the best starting value.
 *
 * The test is on the dimensionless `r0 / a` rather than on `alpha = 1 / a` because
 * `alpha` carries units: at `a = 4e8 m` — the top of §13.3's generator domain —
 * `alpha` is 2.5e-9, and any absolute threshold tight enough to catch a genuinely
 * near-parabolic orbit would also classify a perfectly ordinary high orbit as one.
 *
 * The width is measured, not assumed. Over a grid of 1 428 propagations spanning
 * `e` from 0 to 3, `a` from 6.6e6 to 4e8 m, five true anomalies and `dt` from
 * -30 d to +30 d:
 *
 * | Band | Mean iterations | Worst | Bracketed fallbacks |
 * | --- | --- | --- | --- |
 * | 1e-8 | 6.41 | 61 | 13 |
 * | 1e-2 | 5.64 | 42 | 2 |
 * | **1e-1** | **5.29** | **24** | **0** |
 * | 3e-1 | 5.17 | 24 | 0 |
 *
 * Barker beats *both* conic starters through the whole band, which is not obvious
 * and is why the band is this wide. The hyperbolic starter is the one that fails
 * badly: its logarithm's argument tends to 1 as `e` tends to 1, so the starting
 * value collapses towards zero exactly where the answer does not, and a
 * near-parabolic hyperbola took 40 to 63 iterations and the fallback. Widening past
 * 1e-1 buys nothing on the worst case and starts applying a parabolic approximation
 * to orbits that are not near-parabolic, so this is where it stops.
 *
 * Only the starting value depends on this. Getting it wrong costs iterations, not
 * correctness: the bracketed fallback does not know about conic class at all.
 */
const BARKER_STARTER_BAND = 1e-1;

/** Iteration cap on doubling the fallback bracket. Reached only if `F` is not finite. */
const MAX_BRACKET_GROWTH = 200;

/**
 * Propagate a state by `dt` seconds, forwards or backwards.
 *
 * @param state Position and velocity in an inertial frame. The result is in that
 * same frame — this is a two-body evolution, and it neither knows nor changes which
 * inertial frame it was handed.
 * @param dt Elapsed time. Negative propagates backwards.
 * @param mu Gravitational parameter of the central body, in m^3 s^-2. Explicit
 * rather than defaulted to Earth's, for the reason `elements.ts` gives.
 */
export const propagate = (
  state: State,
  dt: Seconds,
  mu: number,
  options: PropagationOptions = {},
): PropagationResult => {
  const tol = options.tolerance ?? DEFAULT_TOLERANCE;
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;

  if (!(mu > 0) || !Number.isFinite(mu) || !Number.isFinite(dt)) {
    return { converged: false, reason: 'out-of-domain', best: Number.NaN, iterations: 0 };
  }

  const r0 = V.norm(state.position);
  if (!(r0 > 0) || !Number.isFinite(r0)) {
    return { converged: false, reason: 'out-of-domain', best: Number.NaN, iterations: 0 };
  }

  // Zero elapsed time is answered by identity rather than by solving for chi = 0.
  // The solver would return the same state to round-off, and round-off is not good
  // enough: FR-102 requires an arc evaluated at its own start epoch to return the
  // state it was built from, and "to within 1e-16" is a different promise from
  // "the same numbers".
  if (dt === 0) {
    return {
      converged: true,
      state,
      universalAnomaly: 0,
      wholeRevolutions: 0,
      iterations: 0,
      method: 'newton',
    };
  }

  const sqrtMu = Math.sqrt(mu);
  const rDotV = V.dot(state.position, state.velocity);
  const sigma0 = rDotV / sqrtMu;

  // Reciprocal semi-major axis, from the energy integral. Zero for a parabola,
  // negative for a hyperbola, and never divided by — which is the whole reason the
  // universal formulation uses it rather than `a`.
  const alpha = 2 / r0 - V.normSq(state.velocity) / mu;
  const alphaR0 = alpha * r0;
  const oneMinusAlphaR0 = 1 - alphaR0;

  // Remove whole orbits on a closed orbit, and solve on the remainder. See the
  // module docstring for why this is load-bearing rather than tidy. `Math.round`
  // rather than `Math.trunc` so the remainder is at most half a period either way,
  // which halves the swept anomaly and costs nothing.
  let wholeRevolutions = 0;
  let dtSolve: number = dt;
  if (alpha > 0) {
    const orbitalPeriod = TAU / (sqrtMu * alpha * Math.sqrt(alpha));
    if (Number.isFinite(orbitalPeriod) && Math.abs(dt) > orbitalPeriod / 2) {
      wholeRevolutions = Math.round(dt / orbitalPeriod);
      dtSolve = dt - wholeRevolutions * orbitalPeriod;
    }
  }

  /** `sqrt(mu)` times the time overshoot at `chi`. Strictly increasing; `F(0) = -sqrt(mu) dt`. */
  const residual = (chi: number): number => {
    const chiSq = chi * chi;
    const z = alpha * chiSq;
    return (
      sigma0 * chiSq * stumpffC(z) +
      oneMinusAlphaR0 * chiSq * chi * stumpffS(z) +
      r0 * chi -
      sqrtMu * dtSolve
    );
  };

  /**
   * Build the state at `chi` from the Lagrange coefficients.
   *
   * Written componentwise because `f r0 + g v0` mixes metres with metres per
   * second, and the branded vector helpers deliberately refuse to — the same
   * reason `elements.ts` writes the eccentricity vector out by hand.
   */
  const lagrange = (
    chi: number,
    iterations: number,
    method: PropagationMethod,
  ): PropagationResult => {
    const chiSq = chi * chi;
    const z = alpha * chiSq;
    const c = stumpffC(z);
    const s = stumpffS(z);

    const r = sigma0 * chi * (1 - z * s) + oneMinusAlphaR0 * chiSq * c + r0;
    if (!(r > 0) || !Number.isFinite(r)) {
      return { converged: false, reason: 'out-of-domain', best: chi, iterations };
    }

    const f = 1 - (chiSq / r0) * c;
    const g = dtSolve - (chiSq * chi * s) / sqrtMu;
    const fDot = ((sqrtMu * chi) / (r * r0)) * (z * s - 1);
    const gDot = 1 - (chiSq / r) * c;

    const p = state.position;
    const v = state.velocity;
    return {
      converged: true,
      state: {
        position: eci(
          V.vec3(metres(f * p.x + g * v.x), metres(f * p.y + g * v.y), metres(f * p.z + g * v.z)),
        ),
        velocity: eci(
          V.vec3(
            metresPerSec(fDot * p.x + gDot * v.x),
            metresPerSec(fDot * p.y + gDot * v.y),
            metresPerSec(fDot * p.z + gDot * v.z),
          ),
        ),
      },
      universalAnomaly: chi,
      wholeRevolutions,
      iterations,
      method,
    };
  };

  const chi0 = startingValue(state, dtSolve, mu, r0, alpha, alphaR0, rDotV);

  let chi = chi0;
  for (let i = 1; i <= maxIterations; i++) {
    const chiSq = chi * chi;
    const z = alpha * chiSq;
    const c = stumpffC(z);
    const s = stumpffS(z);

    // dF/dchi is the radius at chi, which is positive on every orbit this module
    // accepts. A non-positive value means the iterate has wandered somewhere the
    // formulation does not describe, so hand over rather than take the step.
    const derivative = sigma0 * chi * (1 - z * s) + oneMinusAlphaR0 * chiSq * c + r0;
    if (!(derivative > 0)) break;

    const step =
      (sigma0 * chiSq * c + oneMinusAlphaR0 * chiSq * chi * s + r0 * chi - sqrtMu * dtSolve) /
      derivative;
    chi -= step;
    if (!Number.isFinite(chi)) break;
    if (Math.abs(step) <= tol * Math.abs(chi)) {
      return lagrange(chi, i, 'newton');
    }
  }

  // Newton did not settle. F is strictly increasing and F(0) has the sign of -dt,
  // so the root lies on the dt side of zero and doubling a half-width from any
  // finite start is guaranteed to straddle it.
  const side = Math.sign(dtSolve);
  const startFromZero = -sqrtMu * dtSolve;
  let width = Number.isFinite(chi0) && chi0 !== 0 ? Math.abs(chi0) : Math.sqrt(r0);
  let growth = 0;
  while (
    growth < MAX_BRACKET_GROWTH &&
    Math.sign(residual(side * width)) === Math.sign(startFromZero)
  ) {
    width *= 2;
    growth += 1;
  }

  // Brent's tolerance is an absolute bracket width and chi has no natural scale, so
  // it is scaled to where the bracket actually sits. A fixed 1e-14 is far below one
  // ulp of chi at LEO and the search would burn its whole budget failing to reach it.
  const fallback = brent(residual, 0, side * width, {
    tolerance: tol * width,
    maxIterations: 200,
  });
  const iterations = maxIterations + growth + fallback.iterations;
  if (fallback.converged) {
    return lagrange(fallback.root, iterations, 'bracketed');
  }
  // `F` is monotone and unbounded, so a bracket that does not straddle the root
  // cannot mean the root is elsewhere -- it means `F` stopped being finite, which
  // is a statement about the inputs rather than about the search.
  return {
    converged: false,
    reason: fallback.reason === 'not-bracketed' ? 'out-of-domain' : 'max-iterations',
    best: fallback.best,
    iterations,
  };
};

/**
 * Starting value for Newton, per conic class. Vallado Algorithm 8, with the
 * parabolic form given the widened band `BARKER_STARTER_BAND` documents.
 *
 * The elliptic form is worth noting because it is not a heuristic: `chi =
 * sqrt(a) dE`, and for a circular orbit `dE = n dt`, so `chi = sqrt(mu) alpha dt`
 * is *exact* — and every v1.0 contract is close to circular, so the hot path
 * starts on the answer.
 */
const startingValue = (
  state: State,
  dt: number,
  mu: number,
  r0: number,
  alpha: number,
  alphaR0: number,
  rDotV: number,
): number => {
  if (alphaR0 > BARKER_STARTER_BAND) {
    return Math.sqrt(mu) * alpha * dt;
  }

  if (alphaR0 < -BARKER_STARTER_BAND) {
    // Hyperbolic: invert the asymptotic form, where e sinh H dominates the
    // hyperbolic Kepler equation and the logarithm undoes it.
    const a = 1 / alpha;
    const side = Math.sign(dt);
    const guess =
      side *
      Math.sqrt(-a) *
      Math.log((-2 * mu * alpha * dt) / (rDotV + side * Math.sqrt(-mu * a) * (1 - alphaR0)));
    return Number.isFinite(guess) ? guess : Math.sign(dt) * Math.sqrt(r0);
  }

  // Near-parabolic: Barker's equation has a closed form, so the starting value can
  // be the answer to the parabolic problem rather than a guess at it.
  const h = V.norm(V.cross(state.position, state.velocity));
  const p = (h * h) / mu;
  const cot = 3 * Math.sqrt(mu / (p * p * p)) * dt;
  const w = Math.atan(Math.cbrt(Math.tan(0.5 * (Math.PI / 2 - Math.atan(cot)))));
  const guess = (2 * Math.sqrt(p)) / Math.tan(2 * w);
  return Number.isFinite(guess) ? guess : Math.sign(dt) * Math.sqrt(r0);
};
