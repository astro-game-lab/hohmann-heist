/**
 * The three trajectory styles, and the equal-time dots that carry the physics — §9.3, #108.
 *
 * §9.3's vocabulary is three lines with three treatments:
 *
 * | Element | Treatment |
 * | --- | --- |
 * | Current orbit | Solid, heavy, `--accent` |
 * | Planned trajectory | **Dotted**, medium, `--plan` |
 * | Target orbit | Dashed, medium, `--target` |
 *
 * Two of those are dash patterns on a polyline. The third is not, and the difference is
 * the entire point of this module.
 *
 * ## Why the dotted one cannot be a dash pattern
 *
 * §9.3: *"Dots are spaced by **equal time**, not equal distance — so their density shows
 * the speed, dense at apoapsis and sparse at periapsis. A free, correct, and beautiful
 * piece of physics intuition."*
 *
 * `setLineDash` spaces marks by **arc length**. It has no other option: it walks the path
 * measuring distance, and it knows nothing about the body that traverses it. Drawing the
 * planned trajectory with a dash array therefore produces dots that are evenly spaced in
 * *space* — which is not merely a different look, it is the exact opposite of the
 * information §9.3 wants. Equal-distance dots say "speed is constant everywhere", which
 * is false for every orbit with any eccentricity at all, and false in a way this game
 * exists to teach.
 *
 * So the planned trajectory is drawn as **positioned marks**: the orbit is sampled at
 * equal intervals of time, and a small disc goes at each sample. That is why this module
 * needs `mu` and a Kepler solve where `tessellate.ts` needs neither.
 *
 * #108 asks for the spacing to be asserted by a test precisely because a reimplementation
 * that reached for `setLineDash` would look almost right and be silently wrong, and
 * nothing else in the codebase would notice. `trajectory.test.ts` measures the ratio of
 * dot spacing at periapsis to spacing at apoapsis and checks it against `(1+e)/(1-e)`,
 * which is `v_p / v_a` from the vis-viva equation — the physical statement the visual is
 * making.
 *
 * ## Sampling in time, not in anomaly
 *
 * The sampler steps **mean anomaly** uniformly, which is the same thing as stepping time
 * uniformly: `M = M₀ + n·Δt` exactly, by definition of the mean motion. Each step then
 * costs one Kepler solve to recover the eccentric anomaly and one rotation into the
 * inertial frame.
 *
 * That is deliberately the opposite choice from `tessellate.ts`, which samples in
 * *eccentric* anomaly because it is drawing the path and wants vertices distributed
 * evenly along the arc. Here the uneven distribution **is** the output. The two modules
 * want opposite things from the same conic, and both are right.
 *
 * ## What this module does not do
 *
 * It does not style anything — `style.ts` holds the slots and the caller holds the
 * palette. It does not project: it returns inertial positions, and the camera turns them
 * into pixels, so the sampling is independent of zoom and the result can be cached.
 */
import type { OrbitShape } from '@hh/astro';
import {
  meanFromEccentric,
  eccentricFromTrue,
  perifocalToInertialMatrix,
  pqw,
  pqwToEci,
  solveKeplerElliptic,
} from '@hh/astro';
import type { EciVector } from '@hh/astro';
import type { Metres } from '@hh/math';
import { V, metres } from '@hh/math';

/**
 * Seconds between dots on the planned trajectory, as a fraction of the orbital period.
 *
 * Expressed as a fraction rather than an absolute interval because the plan spans orbits
 * from a 90-minute LEO to a 24-hour GEO transfer, and a fixed 30 s interval would give
 * 180 dots on one and 2 880 on the other. A fraction gives the same *count* on every
 * orbit, which is what makes the density readable as speed rather than as period.
 */
export const DEFAULT_DOTS_PER_REVOLUTION = 96;

/** Hard cap on dots per arc, so a long plan cannot blow the frame budget. */
export const MAX_DOTS = 256;

/**
 * A function from "seconds from the arc's start" to an inertial position.
 *
 * Built once per arc and then called per sample, so the element-dependent work — the
 * semi-axes, the mean motion, the starting mean anomaly, the perifocal-to-inertial
 * rotation — happens once rather than per point.
 *
 * Shared rather than private because two callers want exactly this and want it to agree.
 * The planned trajectory's dots step forward from the arc's start (#108) and a marker's
 * trail steps *backward* from the scrub epoch (#109); if they sampled by different routes
 * the trail could disagree with the dots it lies under, which is the sort of discrepancy
 * that reads as a physics bug and is a plumbing one.
 *
 * Negative offsets are fine and meaningful: mean anomaly runs backwards just as happily.
 *
 * @returns `undefined` for a sample whose Kepler solve did not converge. Non-convergence
 * is a return value here as everywhere in this repo — a mark placed at a wrong or `NaN`
 * position is worse than a mark that is missing.
 */
export type KeplerianSampler = (offsetSeconds: number) => EciVector<Metres> | undefined;

/**
 * Build a sampler for an elliptical arc.
 *
 * @throws RangeError when the orbit is not elliptic or `mu` is not finite and positive.
 */
export const keplerianSampler = (elements: OrbitShape, mu: number): KeplerianSampler => {
  const { semiLatusRectum, eccentricity: e, inclination, raan, argp, trueAnomaly } = elements;
  const p = semiLatusRectum as number;

  if (!(e >= 0 && e < 1)) {
    throw new RangeError(`a Keplerian sampler needs an elliptic orbit, got e = ${String(e)}`);
  }
  if (!(p > 0) || !Number.isFinite(p)) {
    throw new RangeError(`semi-latus rectum must be finite and positive, got ${String(p)}`);
  }
  if (!(mu > 0) || !Number.isFinite(mu)) {
    throw new RangeError(`mu must be finite and positive, got ${String(mu)}`);
  }

  const a = p / (1 - e * e);
  const b = a * Math.sqrt(1 - e * e);
  const n = Math.sqrt(mu / (a * a * a));
  const startMean = meanFromEccentric(eccentricFromTrue(trueAnomaly, e), e);
  const toInertial = perifocalToInertialMatrix(raan, inclination, argp);

  return (offsetSeconds) => {
    const solved = solveKeplerElliptic(startMean + n * offsetSeconds, e);
    if (!solved.converged) return undefined;
    const eccentric = solved.anomaly;
    return pqwToEci(
      toInertial,
      pqw(
        V.vec3(metres(a * (Math.cos(eccentric) - e)), metres(b * Math.sin(eccentric)), metres(0)),
      ),
    );
  };
};

/** The orbital period of an elliptical arc, in seconds. */
export const periodOfArc = (elements: OrbitShape, mu: number): number => {
  const a = (elements.semiLatusRectum as number) / (1 - elements.eccentricity ** 2);
  return 2 * Math.PI * Math.sqrt((a * a * a) / mu);
};

export interface EqualTimeDotsRequest {
  /** The arc's conic. `trueAnomaly` is the *start* of the arc. */
  readonly elements: OrbitShape;
  /** Gravitational parameter, m³/s². */
  readonly mu: number;
  /**
   * How far along the arc to sample, in seconds from the arc's start.
   *
   * The arc's duration, in other words — a plan's arc runs from one impulse to the next,
   * and the dots should stop where the arc does rather than running round the whole
   * conic.
   */
  readonly durationSeconds: number;
  /** Dots per full revolution. Defaults to {@link DEFAULT_DOTS_PER_REVOLUTION}. */
  readonly dotsPerRevolution?: number;
  /** Hard cap. Defaults to {@link MAX_DOTS}. */
  readonly maxDots?: number;
}

/** Equal-time samples along one arc. */
export interface EqualTimeDots {
  /** Inertial positions, in order of increasing time. */
  readonly points: readonly EciVector<Metres>[];
  /** The interval actually used between dots, in seconds. */
  readonly intervalSeconds: number;
  /** `true` when the cap stopped sampling before the arc's end. */
  readonly capped: boolean;
}

/**
 * Sample an elliptical arc at equal intervals of time.
 *
 * Elliptic only. An open arc has no period to divide, and §6.4's `L4` makes a hyperbolic
 * trajectory illegal anyway, so a plan that produces one has a bigger problem than its
 * dot spacing — the caller falls back to `DASH_PLANNED_FALLBACK` rather than this.
 *
 * @throws RangeError when the orbit is not elliptic, or when `mu` or the duration is not
 * finite and positive. A silently empty result would draw as a missing trajectory, which
 * looks like a rendering bug rather than the input error it is.
 */
export const equalTimeDots = (request: EqualTimeDotsRequest): EqualTimeDots => {
  const { semiLatusRectum, eccentricity: e } = request.elements;
  const p = semiLatusRectum as number;

  if (!(e >= 0 && e < 1)) {
    throw new RangeError(`equal-time dots need an elliptic orbit, got e = ${String(e)}`);
  }
  if (!(p > 0) || !Number.isFinite(p)) {
    throw new RangeError(`semi-latus rectum must be finite and positive, got ${String(p)}`);
  }
  if (!(request.mu > 0) || !Number.isFinite(request.mu)) {
    throw new RangeError(`mu must be finite and positive, got ${String(request.mu)}`);
  }
  if (!(request.durationSeconds > 0) || !Number.isFinite(request.durationSeconds)) {
    throw new RangeError(
      `duration must be finite and positive, got ${String(request.durationSeconds)}`,
    );
  }

  // Stepping mean anomaly by `n dt` is stepping time by `dt` exactly, which is what the
  // sampler does — so the dots are equal-time by construction rather than by correction.
  const periodSeconds = periodOfArc(request.elements, request.mu);

  const perRevolution = request.dotsPerRevolution ?? DEFAULT_DOTS_PER_REVOLUTION;
  const maxDots = request.maxDots ?? MAX_DOTS;
  const intervalSeconds = periodSeconds / perRevolution;

  const wanted = Math.floor(request.durationSeconds / intervalSeconds) + 1;
  const count = Math.min(wanted, maxDots);
  const capped = wanted > maxDots;

  const sample = keplerianSampler(request.elements, request.mu);
  const points: EciVector<Metres>[] = [];
  for (let i = 0; i < count; i++) {
    const point = sample(i * intervalSeconds);
    // A dot that cannot be placed is skipped rather than drawn at a wrong or `NaN`
    // position, which would put a mark on screen that means nothing.
    if (point !== undefined) points.push(point);
  }

  return { points, intervalSeconds, capped };
};
