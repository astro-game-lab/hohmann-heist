/**
 * Scalar root finders.
 *
 * These sit underneath the Kepler solver's fallback path and every event finder
 * in the simulation, so a quietly wrong root here would surface as a wrong
 * trajectory hours of game time later, with nothing pointing back to the cause.
 *
 * **Non-convergence is a return value, not an exception, and never a plausible
 * wrong answer.** Callers must handle it. That is the whole point of the typed
 * result below.
 */

/** What a root finder returns. */
export type RootResult =
  | { readonly converged: true; readonly root: number; readonly iterations: number }
  | {
      readonly converged: false;
      readonly reason: 'not-bracketed' | 'max-iterations';
      /** Best estimate so far. Useful for diagnostics; not a root. */
      readonly best: number;
      readonly iterations: number;
    };

/** Tuning for a root finder. */
export interface RootOptions {
  /** Absolute tolerance on the bracket width. Default 1e-12. */
  readonly tolerance?: number;
  /** Hard iteration cap. Default 100. */
  readonly maxIterations?: number;
}

const DEFAULT_TOLERANCE = 1e-12;
const DEFAULT_MAX_ITERATIONS = 100;

/**
 * True when `a` and `b` lie on opposite sides of zero.
 *
 * Compares signs directly rather than testing `a * b < 0`. The product form is the
 * conventional idiom and it is subtly wrong: when one operand is very small the
 * product underflows to zero, the test reads false, and the search discards the
 * half of the bracket containing the root — converging confidently on an endpoint
 * that is not a root at all. A property test found exactly that, with
 * `f(mid) = -5e-324`. The product can also overflow to infinity for large values.
 */
const straddlesZero = (a: number, b: number): boolean => (a < 0 && b > 0) || (a > 0 && b < 0);

/**
 * Bisection on `[a, b]`.
 *
 * Slow — one bit per iteration — but it cannot fail to converge on a continuous
 * function whose endpoints straddle a root. It is the guaranteed fallback when
 * something cleverer misbehaves.
 */
export const bisect = (
  f: (x: number) => number,
  a: number,
  b: number,
  options: RootOptions = {},
): RootResult => {
  const tol = options.tolerance ?? DEFAULT_TOLERANCE;
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;

  // Normalise the bracket so lo < hi. Without this, a caller passing (2, 0)
  // makes `hi - lo` negative, the width test `(hi - lo) / 2 < tol` is satisfied
  // immediately, and the function returns the first midpoint as though it had
  // converged -- a confidently wrong root, which is the one outcome this module
  // exists to make impossible.
  let lo = Math.min(a, b);
  let hi = Math.max(a, b);
  let flo = f(lo);
  const fhi = f(hi);

  if (flo === 0) return { converged: true, root: lo, iterations: 0 };
  if (fhi === 0) return { converged: true, root: hi, iterations: 0 };
  if (!straddlesZero(flo, fhi)) {
    return { converged: false, reason: 'not-bracketed', best: lo, iterations: 0 };
  }

  for (let i = 1; i <= maxIterations; i++) {
    const mid = lo + (hi - lo) / 2;
    const fmid = f(mid);
    if (fmid === 0 || (hi - lo) / 2 < tol) {
      return { converged: true, root: mid, iterations: i };
    }
    if (straddlesZero(flo, fmid)) {
      hi = mid;
    } else {
      lo = mid;
      flo = fmid;
    }
  }
  return {
    converged: false,
    reason: 'max-iterations',
    best: lo + (hi - lo) / 2,
    iterations: maxIterations,
  };
};

/**
 * Brent's method on `[a, b]`.
 *
 * Combines bisection, the secant method and inverse quadratic interpolation,
 * keeping bisection's guarantee while usually converging superlinearly. This is
 * the default choice; `bisect` exists for when a caller wants the guarantee with
 * no cleverness at all.
 *
 * Follows the formulation in Brent, *Algorithms for Minimization without
 * Derivatives* (1973), ch. 4, as presented in Press et al., *Numerical Recipes*.
 */
export const brent = (
  f: (x: number) => number,
  a: number,
  b: number,
  options: RootOptions = {},
): RootResult => {
  const tol = options.tolerance ?? DEFAULT_TOLERANCE;
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;

  // Same normalisation as `bisect`, for the same reason. Brent's own width test
  // is already absolute, but starting from a known ordering keeps the invariant
  // explicit rather than incidental.
  let lo = Math.min(a, b);
  let hi = Math.max(a, b);
  let flo = f(lo);
  let fhi = f(hi);

  if (flo === 0) return { converged: true, root: lo, iterations: 0 };
  if (fhi === 0) return { converged: true, root: hi, iterations: 0 };
  if (!straddlesZero(flo, fhi)) {
    return { converged: false, reason: 'not-bracketed', best: lo, iterations: 0 };
  }

  // Keep `hi` as the better estimate.
  if (Math.abs(flo) < Math.abs(fhi)) {
    [lo, hi] = [hi, lo];
    [flo, fhi] = [fhi, flo];
  }

  let c = lo;
  let fc = flo;
  let usedBisection = true;
  let d = 0;

  for (let i = 1; i <= maxIterations; i++) {
    let s: number;
    if (flo !== fc && fhi !== fc) {
      // Inverse quadratic interpolation.
      s =
        (lo * fhi * fc) / ((flo - fhi) * (flo - fc)) +
        (hi * flo * fc) / ((fhi - flo) * (fhi - fc)) +
        (c * flo * fhi) / ((fc - flo) * (fc - fhi));
    } else {
      // Secant.
      s = hi - (fhi * (hi - lo)) / (fhi - flo);
    }

    const lower = (3 * lo + hi) / 4;
    const outside = !((s > lower && s < hi) || (s < lower && s > hi));
    const slow =
      (usedBisection && Math.abs(s - hi) >= Math.abs(hi - c) / 2) ||
      (!usedBisection && Math.abs(s - hi) >= Math.abs(c - d) / 2) ||
      (usedBisection && Math.abs(hi - c) < tol) ||
      (!usedBisection && Math.abs(c - d) < tol);

    if (outside || slow) {
      s = (lo + hi) / 2;
      usedBisection = true;
    } else {
      usedBisection = false;
    }

    const fs = f(s);
    d = c;
    c = hi;
    fc = fhi;

    if (straddlesZero(flo, fs)) {
      hi = s;
      fhi = fs;
    } else {
      lo = s;
      flo = fs;
    }

    if (Math.abs(flo) < Math.abs(fhi)) {
      [lo, hi] = [hi, lo];
      [flo, fhi] = [fhi, flo];
    }

    if (fs === 0 || Math.abs(hi - lo) < tol) {
      return { converged: true, root: hi, iterations: i };
    }
  }

  return { converged: false, reason: 'max-iterations', best: hi, iterations: maxIterations };
};
