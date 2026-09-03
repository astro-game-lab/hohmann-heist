/**
 * The vocabulary the five FR-008 event finders share.
 *
 * #60 to #64 ask for five searches over a bounded interval: apsis crossings,
 * closest approach, altitude-shell crossings, ground-station visibility, and
 * umbra. They ship together because the *interesting* part of each is the same
 * three decisions — what an interval endpoint means, what tolerance a returned
 * epoch carries, and what happens to an event the search cannot resolve — and five
 * finders written apart would answer them five ways. This module answers them
 * once.
 *
 * ## The endpoint rule: `[start, end)`
 *
 * **An event exactly at `start` is reported; one exactly at `end` is not.**
 *
 * The half-open choice is not arbitrary. FR-102 builds a timeline out of arcs that
 * abut — arc *k* ends at the epoch arc *k+1* begins — and the natural way to search
 * a plan is to search each arc's span and concatenate. Under a closed rule a
 * periapsis that lands exactly on an impulse epoch would be reported twice, once by
 * each neighbour, and a caller would have to de-duplicate on a floating-point
 * comparison. Under this rule concatenation reports every event exactly once, and
 * no caller needs a tolerance to notice.
 *
 * **Intervals are clipped, not dropped.** A pass already in progress at `start`, or
 * still in progress at `end`, is returned with its epoch set to the bound and the
 * corresponding `clippedStart` / `clippedEnd` flag set. The flag is the point: an
 * interval that begins at `start` because the search began there is a different
 * fact from one that begins at `start` because the spacecraft rose there, and a
 * caller stitching two spans together needs to be able to tell them apart. This is
 * why a clipped bound does not contradict the half-open rule — the bound is a
 * *clip*, not an event, and the event it stands in for is outside the interval.
 *
 * ## Two search strategies, and why the choice is per-finder
 *
 * **Where the condition depends only on where the spacecraft is on its conic, the
 * search runs in true anomaly and is closed-form.** Apsis crossings (#60) and
 * altitude-shell crossings (#62) are solved algebraically for the anomaly and
 * converted to epochs through Kepler's equation in the direction that needs no
 * solver at all. Umbra (#64) samples in anomaly and root-finds there. Sampling in
 * anomaly rather than in time is what makes an eclipse near periapsis — short in
 * seconds, ordinary in anomaly — no harder to find than one near apoapsis.
 *
 * **Where it does not, the search runs in time.** Closest approach (#61) involves a
 * second, independently propagated body; ground-station visibility (#63) involves a
 * rotating station. Neither is a function of one conic's anomaly, so both sample
 * epochs and refine with Brent.
 *
 * ## What a sampled search can miss, stated plainly
 *
 * A bracketed search finds a feature only if the sample grid straddles it. No
 * finite sampling can guarantee every root of an arbitrary continuous function, and
 * a docstring claiming otherwise would be worth less than one that says where the
 * floor is. So: **each finder resolves a feature spanning at least one sample step,
 * and `samplesPerRevolution` is the knob.** Each finder's default is chosen for the
 * shortest feature its geometry actually produces and says so where it is defined —
 * a ground-station pass is a small fraction of a revolution and a LEO eclipse is a
 * large one, so one number for both would be wrong for one of them.
 *
 * The two closed-form finders have no such floor. That is the reason to prefer the
 * closed form wherever it exists, rather than a nicety.
 */
import type { Arc } from './arc.js';

import type { Epoch, EciVector, OrbitShape, State } from '@hh/astro';
import {
  eccentricFromTrue,
  eci,
  epoch,
  hyperbolicFromTrue,
  meanFromEccentric,
  meanFromHyperbolic,
  perifocalToInertialMatrix,
  semiMajorAxis,
} from '@hh/astro';
import type { Metres } from '@hh/math';
import { brent, M, metres, TAU, V } from '@hh/math';

import { stateAt } from './arc.js';

/**
 * Tuning shared by every finder.
 *
 * One options shape rather than five, so a caller tightening a tolerance does not
 * have to learn which finder spells it which way.
 */
export interface EventOptions {
  /**
   * Absolute tolerance on a returned epoch, in seconds. Default 1e-6.
   *
   * Absolute rather than relative because the quantity being solved for *is* an
   * epoch, and a relative tolerance on seconds-past-J2000 would mean something
   * different in 2000 than in 2030. At LEO 1e-6 s is 7.7 mm of along-track motion,
   * which is four orders of magnitude below DEP-03's 100 m rendezvous tolerance and
   * below anything the game resolves.
   *
   * Note what this bounds: the *epoch* of the event, not the quantity that defines
   * it. Near a tangential crossing the two are related by a derivative that goes to
   * zero, so a well-converged epoch can still sit far from where the geometry says
   * it should. See the conditioning note in `docs/PHYSICS.md`.
   */
  readonly toleranceSeconds?: number;
  /**
   * Sample points per revolution when bracketing. Default is per-finder.
   *
   * Raising it costs propagation calls linearly and lowers the shortest feature the
   * search can find, in proportion. It has no effect on the accuracy of a feature
   * that is found — that is `toleranceSeconds`.
   */
  readonly samplesPerRevolution?: number;
  /** Iteration cap for each root refinement. Default 100, as `@hh/math`'s. */
  readonly maxIterations?: number;
}

/** The default tolerance on a returned epoch, in seconds. */
export const DEFAULT_TOLERANCE_SECONDS = 1e-6;

/** The default iteration cap for one root refinement. */
export const DEFAULT_MAX_ITERATIONS = 100;

/**
 * A span during which some condition held.
 *
 * `clippedStart` and `clippedEnd` record that the bound is the search interval's,
 * not the condition's — the condition was already true when the search began, or
 * was still true when it ended. See the endpoint rule in the module docstring.
 */
export interface EpochInterval {
  readonly start: Epoch;
  readonly end: Epoch;
  /** The condition already held at the search interval's start. */
  readonly clippedStart: boolean;
  /** The condition still held at the search interval's end. */
  readonly clippedEnd: boolean;
}

/**
 * Validate a search interval.
 *
 * A zero-length interval is legal and finds nothing — `[t, t)` is empty, which
 * falls out of the endpoint rule rather than needing a special case. A reversed one
 * is not: it is a caller error that would otherwise return an empty result and look
 * like "no events", which is the wrong answer rather than an error.
 *
 * @throws RangeError when either bound is not finite, or when `end` precedes
 * `start`.
 */
export const requireSearchInterval = (start: Epoch, end: Epoch): void => {
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new RangeError(
      `search interval bounds must be finite, got [${String(start)}, ${String(end)}]`,
    );
  }
  if (end < start) {
    throw new RangeError(
      `search interval ends before it starts: [${String(start)}, ${String(end)}]`,
    );
  }
};

/** The half-open rule, in one place so that five finders cannot disagree about it. */
export const withinSearch = (t: number, start: Epoch, end: Epoch): boolean => t >= start && t < end;

/**
 * How many sample intervals to lay across a span.
 *
 * At least one, so a span shorter than a single step is still bracketed end to end
 * rather than skipped.
 */
export const sampleCount = (span: number, step: number): number =>
  Math.max(1, Math.ceil(span / step));

/**
 * The `i`-th of `count` uniformly spaced points across `[lo, hi]`.
 *
 * Computed as `lo + (hi - lo) * i / count` rather than by adding a step repeatedly.
 * Accumulation would make the sample epochs depend on the arithmetic order and let
 * round-off drift into the last sample, which §11.4 forbids; this form hits both
 * endpoints exactly and gives the same value for the same `i` however it is reached.
 */
export const sampleAt = (lo: number, hi: number, i: number, count: number): number =>
  lo + ((hi - lo) * i) / count;

/**
 * Refine a bracketed root of `f` with Brent's method.
 *
 * Returns `undefined` rather than a number when the bracket does not straddle a
 * root or the iteration cap is reached — the `RootResult` convention from
 * `@hh/math`, carried through: a non-converged search reports nothing, never a
 * plausible wrong epoch. A finder that dropped a `best` estimate into its results
 * would be handing back an event that is not there.
 */
export const refineRoot = (
  f: (t: number) => number,
  lo: number,
  hi: number,
  options: EventOptions = {},
): number | undefined => {
  const result = brent(f, lo, hi, {
    tolerance: options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS,
    maxIterations: options.maxIterations ?? DEFAULT_MAX_ITERATIONS,
  });
  return result.converged ? result.root : undefined;
};

/**
 * The state on `arc` at `t`, or a thrown error.
 *
 * The propagator reports non-convergence as a return value rather than throwing,
 * and that is the right contract *there*: a caller asking for one state can decide
 * what to do without one. An event finder cannot. It has no partial answer to give
 * — a search that quietly skipped the samples it could not evaluate would report
 * "no events" for a reason that has nothing to do with whether there are any — so
 * the failure is raised rather than absorbed.
 *
 * In practice this is unreachable for a well-formed arc: `F(chi)` is strictly
 * increasing and unbounded, so the bracketed fallback cannot fail to find its one
 * root. It is here so that if it ever does, the message says where.
 *
 * @throws RangeError when the propagation does not converge.
 */
export const requireStateAt = (arc: Arc, t: number): State => {
  const result = stateAt(arc, epoch(t));
  if (!result.converged) {
    throw new RangeError(
      `propagation did not converge at epoch ${String(t)} (${result.reason}); ` +
        'the event search has no state to evaluate there',
    );
  }
  return result.state;
};

/**
 * The sample step for a time-domain search, in seconds.
 *
 * Set by the orbit's own timescale rather than by a wall-clock interval, so the
 * grid is as dense at GEO as at LEO in the terms that matter — a fixed number of
 * looks per revolution. Where no orbit involved is closed there is no such
 * timescale, and the span itself is divided instead.
 */
export const timeGridStep = (
  periods: readonly number[],
  span: number,
  samplesPerRevolution: number,
): number => {
  const shortest = Math.min(...periods);
  return (Number.isFinite(shortest) ? shortest : span) / samplesPerRevolution;
};

// ── The conic clock ────────────────────────────────────────────────────────────

/**
 * The map between true anomaly and epoch on one arc's conic, in both directions
 * that need no solver.
 *
 * Three of the five finders need "the epoch at which this orbit reaches true
 * anomaly ν". That is Kepler's equation in the easy direction — ν → E → M → t for
 * an ellipse, ν → H → M → t for a hyperbola, Barker's cubic for a parabola — and it
 * is exact to round-off, with no iteration and nothing to fail to converge. It is
 * built once per search rather than per sample because the trigonometry that
 * defines the conic does not change along it.
 *
 * The `revolution` index exists because the inverse is many-valued on a closed
 * orbit: ν = 0 happens once per period, forever. Revolution 0 is the one containing
 * the arc's own start epoch, so `epochAt(nu, 0)` is the passage in the arc's
 * "current" orbit and the index counts periapsis passages from there.
 */
export interface ConicClock {
  readonly eccentricity: number;
  /** Orbital period in seconds, or `Infinity` on an open orbit. */
  readonly period: number;
  /**
   * Epoch of the periapsis passage that opens revolution 0 — the last one at or
   * before the arc's start epoch on a closed orbit, and the single one on an open
   * orbit, where it may be after the start epoch if the arc is still inbound.
   */
  readonly periapsisEpoch: Epoch;
  /**
   * Seconds from periapsis to true anomaly `nu`.
   *
   * In `[0, period)` on a closed orbit and signed on an open one, where periapsis
   * is passed once and everything before it is negative. `NaN` for a `nu` outside
   * an open orbit's asymptotes, which is not a place on the trajectory.
   */
  timeSincePeriapsis(nu: number): number;
  /** Epoch at true anomaly `nu` on the given revolution. */
  epochAt(nu: number, revolution: number): Epoch;
}

/** Below this eccentricity a conic is treated as parabolic by the clock. */
const PARABOLIC_BAND = 1e-12;

/**
 * Build the anomaly ↔ epoch map for an arc.
 *
 * The parabolic band is narrow on purpose. Unlike the propagator, which absorbs all
 * three conic classes into one universal-variable expression, the closed-form time
 * *is* three formulae — `a` appears in two of them and is infinite at `e = 1`. The
 * band is the width within which the parabolic form is the better-conditioned one,
 * and outside it the elliptic and hyperbolic forms are used down to their own
 * limits rather than being approximated away.
 */
export const conicClock = (arc: Arc): ConicClock => {
  const elements = arc.elements;
  const e = elements.eccentricity;
  const { mu } = arc;

  const parabolic = Math.abs(e - 1) < PARABOLIC_BAND;
  const a = parabolic ? Number.POSITIVE_INFINITY : semiMajorAxis(elements);
  // Mean motion, in rad/s for a conic that has one. On a hyperbola `a` is negative
  // and the same relation holds on `|a|`; on a parabola there is no mean motion and
  // the Barker branch below never asks for it.
  const n = parabolic ? Number.NaN : Math.sqrt(mu / Math.abs(a) ** 3);
  const period = e < 1 && !parabolic ? TAU / n : Number.POSITIVE_INFINITY;

  // Barker's constant: t - t_p = (1/2) sqrt(p^3 / mu) (D + D^3/3), D = tan(nu/2).
  // Curtis, 4th ed., eq. 3.30. Evaluated once; the cubic itself is per call.
  const barkerScale = 0.5 * Math.sqrt(elements.semiLatusRectum ** 3 / mu);

  const timeSincePeriapsis = (nu: number): number => {
    if (parabolic) {
      const d = Math.tan(nu / 2);
      return barkerScale * (d + (d * d * d) / 3);
    }
    if (e < 1) {
      // `meanFromEccentric` normalises to [0, 2pi), which is exactly the branch
      // wanted here: the time is measured within one revolution and the revolution
      // index carries the rest.
      return meanFromEccentric(eccentricFromTrue(nu, e), e) / n;
    }
    return meanFromHyperbolic(hyperbolicFromTrue(nu, e), e) / n;
  };

  const periapsisEpoch = epoch(arc.startEpoch - timeSincePeriapsis(elements.trueAnomaly));

  return {
    eccentricity: e,
    period,
    periapsisEpoch,
    timeSincePeriapsis,
    epochAt: (nu, revolution) => {
      const base = periapsisEpoch + timeSincePeriapsis(nu);
      // `revolution * period` is `0 * Infinity` on an open orbit, which is `NaN`
      // rather than the zero the arithmetic means. An open orbit has one pass and
      // only revolution 0 is ever asked for, so the guard is exact rather than a
      // fudge -- and any other revolution index on an open orbit is a caller error
      // that should produce a non-finite epoch rather than a plausible one.
      return epoch(revolution === 0 ? base : base + revolution * period);
    },
  };
};

/**
 * Revolution indices whose periapsis-to-periapsis span overlaps `[start, end)`.
 *
 * Returns an empty range — `last < first` — for an empty search interval, and the
 * single index 0 on an open orbit, which has one pass and no revolutions to count.
 *
 * The `ceil` on the upper bound rather than a `floor` is the half-open rule again:
 * a search interval ending exactly on a periapsis passage does not reach into the
 * revolution that passage opens, because that revolution's first instant is `end`
 * and `end` is excluded.
 */
export const revolutionRange = (
  clock: ConicClock,
  start: Epoch,
  end: Epoch,
): { readonly first: number; readonly last: number } => {
  if (!Number.isFinite(clock.period)) return { first: 0, last: end > start ? 0 : -1 };
  if (end <= start) return { first: 0, last: -1 };
  const first = Math.floor((start - clock.periapsisEpoch) / clock.period);
  const last = Math.ceil((end - clock.periapsisEpoch) / clock.period) - 1;
  return { first, last };
};

// ── Conic geometry ─────────────────────────────────────────────────────────────

/**
 * Position on an arc's conic as a function of true anomaly, in the inertial frame.
 *
 * The perifocal basis is built once and the position is then two multiplies and an
 * add, rather than a fresh 3-1-3 rotation per sample. That matters: the umbra
 * search evaluates this tens of times per revolution and the rotation is the
 * expensive part.
 *
 * This is the same geometry `stateFromElements` produces, restricted to position
 * and with the velocity it does not need left uncomputed. It goes through the arc's
 * cached elements, so it agrees with the state the arc was built from — including
 * under the degenerate conventions, where the suppressed angle is folded into the
 * survivor and the round trip closes exactly.
 */
export interface ConicGeometry {
  readonly semiLatusRectum: number;
  readonly eccentricity: number;
  /** Radius at true anomaly `nu`, in metres. */
  radiusAt(nu: number): number;
  /** Inertial position at true anomaly `nu`. */
  positionAt(nu: number): EciVector<Metres>;
}

/** Build the anomaly → position map for an arc. */
export const conicGeometry = (arc: Arc): ConicGeometry => {
  const elements: OrbitShape = arc.elements;
  const p = elements.semiLatusRectum;
  const e = elements.eccentricity;

  const toInertial = perifocalToInertialMatrix(elements.raan, elements.inclination, elements.argp);
  // The perifocal axes as inertial vectors: the first two columns of the rotation.
  const pHat = M.apply(toInertial, V.vec3(1, 0, 0));
  const qHat = M.apply(toInertial, V.vec3(0, 1, 0));

  const radiusAt = (nu: number): number => p / (1 + e * Math.cos(nu));

  return {
    semiLatusRectum: p,
    eccentricity: e,
    radiusAt,
    positionAt: (nu) => {
      const r = radiusAt(nu);
      const c = r * Math.cos(nu);
      const s = r * Math.sin(nu);
      return eci(
        V.vec3(
          metres(pHat.x * c + qHat.x * s),
          metres(pHat.y * c + qHat.y * s),
          metres(pHat.z * c + qHat.z * s),
        ),
      );
    },
  };
};
