/**
 * Kepler's equation.
 *
 * Given a mean anomaly and an eccentricity, recover the eccentric (or hyperbolic)
 * anomaly. There is no closed form, so this is Newton's method with a bracketed
 * fallback — and the fallback is a **tested path**, not decoration: Newton stalls
 * for eccentricities near 1 with a mean anomaly near zero, which is exactly the
 * regime the more interesting transfers live in.
 *
 * Non-convergence is a return value, never an exception and never a plausible wrong
 * answer, for the same reason it is in `@hh/math/root`: a quietly wrong anomaly
 * becomes a wrong position, and a wrong position becomes a trajectory that misses
 * by kilometres with nothing pointing back at the cause.
 */
import type { Radians } from '@hh/math';
import { brent, normalize, radians, TAU } from '@hh/math';

/** How the answer was reached. Useful in tests, and when diagnosing a slow solve. */
export type KeplerMethod = 'newton' | 'bracketed';

/** What a Kepler solve returns. */
export type KeplerResult =
  | {
      readonly converged: true;
      readonly anomaly: Radians;
      readonly iterations: number;
      readonly method: KeplerMethod;
    }
  | {
      readonly converged: false;
      readonly reason: 'max-iterations' | 'out-of-domain';
      readonly best: number;
      readonly iterations: number;
    };

/** Tuning for a Kepler solve. */
export interface KeplerOptions {
  /** Absolute tolerance on the anomaly, in radians. Default 1e-13. */
  readonly tolerance?: number;
  /** Newton iteration cap before falling back to bracketing. Default 20. */
  readonly maxIterations?: number;
}

const DEFAULT_TOLERANCE = 1e-13;
const DEFAULT_MAX_ITERATIONS = 20;

/**
 * Solve `M = E − e·sin E` for the eccentric anomaly, for `0 ≤ e < 1`.
 *
 * The starter is `E₀ = M + e·sin M` for moderate eccentricity, which is accurate
 * enough that Newton converges in a handful of steps. Above `e = 0.8` it switches
 * to `E₀ = π`: near-parabolic ellipses have a very flat `dM/dE` close to periapsis,
 * and the naive starter can throw Newton across the orbit.
 *
 * When Newton fails to converge within its cap, Brent takes over on `[0, 2π]`,
 * where the function is monotonic and a root is guaranteed.
 */
export const solveKeplerElliptic = (
  meanAnomaly: number,
  eccentricity: number,
  options: KeplerOptions = {},
): KeplerResult => {
  const tol = options.tolerance ?? DEFAULT_TOLERANCE;
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;

  if (!(eccentricity >= 0 && eccentricity < 1)) {
    return { converged: false, reason: 'out-of-domain', best: Number.NaN, iterations: 0 };
  }

  const m = normalize(meanAnomaly);
  if (eccentricity === 0) {
    return { converged: true, anomaly: m, iterations: 0, method: 'newton' };
  }

  const f = (e_: number): number => e_ - eccentricity * Math.sin(e_) - m;

  let anomaly = eccentricity > 0.8 ? Math.PI : m + eccentricity * Math.sin(m);
  for (let i = 1; i <= maxIterations; i++) {
    const denominator = 1 - eccentricity * Math.cos(anomaly);
    // dM/dE vanishes only at e = 1, which is out of domain, but guard anyway
    // rather than produce an infinite step.
    if (denominator === 0) break;
    const step = f(anomaly) / denominator;
    anomaly -= step;
    if (Math.abs(step) < tol) {
      return { converged: true, anomaly: normalize(anomaly), iterations: i, method: 'newton' };
    }
  }

  // Newton did not settle. The function is monotonic on [0, 2pi] and f(0) <= 0 <=
  // f(2pi), so a bracketed search cannot fail.
  const fallback = brent(f, 0, TAU, { tolerance: tol, maxIterations: 200 });
  if (fallback.converged) {
    return {
      converged: true,
      anomaly: normalize(fallback.root),
      iterations: maxIterations + fallback.iterations,
      method: 'bracketed',
    };
  }
  return {
    converged: false,
    reason: 'max-iterations',
    best: fallback.best,
    iterations: maxIterations + fallback.iterations,
  };
};

/**
 * Solve `M = e·sinh H − H` for the hyperbolic anomaly, for `e > 1`.
 *
 * The starter follows the standard asymptotic form: for large `|M|` the equation is
 * dominated by the exponential, so `H₀ ≈ ln(2|M|/e + 1.8)` lands close. For small
 * `|M|` a linear starter is better conditioned.
 *
 * Unlike the elliptic case there is no natural bracket, so one is grown by doubling
 * until the sign changes — which terminates quickly because `sinh` grows so fast.
 */
export const solveKeplerHyperbolic = (
  meanAnomaly: number,
  eccentricity: number,
  options: KeplerOptions = {},
): KeplerResult => {
  const tol = options.tolerance ?? DEFAULT_TOLERANCE;
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;

  if (!(eccentricity > 1)) {
    return { converged: false, reason: 'out-of-domain', best: Number.NaN, iterations: 0 };
  }
  if (meanAnomaly === 0) {
    return { converged: true, anomaly: radians(0), iterations: 0, method: 'newton' };
  }

  const f = (h: number): number => eccentricity * Math.sinh(h) - h - meanAnomaly;

  const magnitude = Math.abs(meanAnomaly);
  let anomaly =
    magnitude > 6 * eccentricity
      ? Math.sign(meanAnomaly) * Math.log((2 * magnitude) / eccentricity + 1.8)
      : meanAnomaly / (eccentricity - 1);

  for (let i = 1; i <= maxIterations; i++) {
    const denominator = eccentricity * Math.cosh(anomaly) - 1;
    if (denominator === 0) break;
    const step = f(anomaly) / denominator;
    anomaly -= step;
    if (!Number.isFinite(anomaly)) break;
    if (Math.abs(step) < tol) {
      // Hyperbolic anomaly is not periodic, so it is NOT normalised to [0, 2pi).
      return { converged: true, anomaly: anomaly as Radians, iterations: i, method: 'newton' };
    }
  }

  // Grow a bracket. f is strictly increasing in h for e > 1, so doubling the
  // half-width from a finite start is guaranteed to straddle the root.
  let width = 1;
  while (width < 1e6 && Math.sign(f(-width)) === Math.sign(f(width))) width *= 2;
  const fallback = brent(f, -width, width, { tolerance: tol, maxIterations: 200 });
  if (fallback.converged) {
    return {
      converged: true,
      anomaly: fallback.root as Radians,
      iterations: maxIterations + fallback.iterations,
      method: 'bracketed',
    };
  }
  return {
    converged: false,
    reason: 'max-iterations',
    best: fallback.best,
    iterations: maxIterations + fallback.iterations,
  };
};

/**
 * Barker's equation: the parabolic case, `e = 1`, solved in closed form.
 *
 * `M_p = D + D³/3` where `D = tan(ν/2)`. That depressed cubic has one real root,
 * and Cardano gives it directly — no iteration, and no convergence to report.
 *
 * Returns the true anomaly, since the parabolic orbit has no eccentric anomaly.
 */
export const solveBarker = (parabolicMeanAnomaly: number): Radians => {
  const w = 1.5 * parabolicMeanAnomaly;
  const y = Math.cbrt(w + Math.sqrt(w * w + 1));
  const d = y - 1 / y;
  return radians(normalize(2 * Math.atan(d)));
};
