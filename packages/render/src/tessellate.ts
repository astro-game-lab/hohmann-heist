/**
 * Orbit tessellation: a conic turned into a polyline that is smooth at the current
 * zoom and cheap enough to redo while a node is being dragged.
 *
 * §9.3 fixes three things, and each one is answering a specific way of getting this
 * wrong.
 *
 * ## Sample in eccentric anomaly, not true anomaly and not time
 *
 * Uniform steps in **true anomaly** put vertices where the angle is, not where the arc
 * is. `ds/dnu = r` at each apse, so a degree of true anomaly at apoapsis covers
 * `(1+e)/(1-e)` times the arc it covers at periapsis — 19 times at `e = 0.9`, 199 at
 * `e = 0.99` — and the polyline is visibly faceted at apoapsis while spending vertices
 * it does not need near periapsis. Uniform steps in **time** fail at the other end:
 * Kepler's second law crowds the samples into apoapsis, where the body is slow, and
 * leaves periapsis — the part with all the curvature — nearly bare.
 *
 * **Eccentric anomaly** is the parameter that fixes it. `ds/dE = a·sqrt(1 - e²cos²E)`
 * varies only between `b` and `a`, so the ratio is `a/b = 1/sqrt(1-e²)`: 2.29 at
 * `e = 0.9` against true anomaly's 19, and 7.09 at `e = 0.99` against 199. Both bounds
 * are asserted in `tessellate.test.ts`.
 *
 * ## The parameter is chosen per conic class
 *
 * `E` is meaningless for an open orbit, so:
 *
 * | Class | Parameter | Position |
 * | --- | --- | --- |
 * | `e < 1 - band` | eccentric anomaly `E` | `x = a(cos E - e)`, `y = b sin E` |
 * | `\|e - 1\| <= band` | Barker's `D = tan(nu/2)` | see `sampleBarker` |
 * | `e > 1 + band` | hyperbolic anomaly `H` | `x = a(cosh H - e)`, `y = -a·sqrt(e²-1)·sinh H` |
 *
 * The near-parabolic form is worth a note: it is **exact for every conic**, not an
 * approximation valid near `e = 1`. Substituting the half-angle identities into
 * `r = p / (1 + e cos nu)` gives `r = p(1 + D²) / ((1+e) + (1-e)D²)`, which contains no
 * trigonometry, no `a`, and no subtraction of nearly-equal quantities as `e -> 1`. It is
 * used only inside the band because *outside* it `E` and `H` distribute vertices better
 * — `D` cannot even reach `nu = pi`. What makes it the right choice inside the band is
 * that `a = p/(1-e²)` is where an elliptic parameterisation actually falls over.
 *
 * ## Adaptive subdivision against screen-space curvature
 *
 * The seed sampling is uniform in the parameter; refinement then bisects any segment
 * whose **sagitta** — the distance from the curve at the segment's parameter midpoint
 * to the midpoint of the chord that currently stands in for it — exceeds 0.5 px on
 * screen (§9.3). The sagitta is exactly the error the polyline is committing, so this
 * measures the thing that matters rather than a proxy for it, and it converges
 * quadratically: one bisection cuts the error by about four.
 *
 * Two implementation notes that are load-bearing rather than incidental:
 *
 * - **Refinement runs in the perifocal plane, and the rotation into the inertial frame
 *   happens once at the end.** A rotation is an isometry, so perifocal distances *are*
 *   world distances and the sagitta test is unaffected. That removes a 3x3 multiply
 *   from the inner loop, which is most of what buys §11.9's 0.5 ms.
 * - **The sagitta is measured in world metres and scaled by pixels-per-metre, not
 *   measured after projection.** An orthographic projection can only shorten a
 *   distance, so this over-estimates the on-screen error for an orbit seen at an angle
 *   and never under-estimates it. The refinement is therefore conservative, and — the
 *   real reason — it does not depend on the camera's view basis, so a cached
 *   tessellation stays valid when the camera rotates and the cache key does not have to
 *   carry the basis.
 *
 * ## What this module does not do
 *
 * It draws the *path* of a conic, not a segment between two epochs, so it takes no
 * epoch and no true anomaly — dragging a node along an unchanged orbit does not
 * invalidate anything here. Styling belongs to the caller (§9.3's solid/dashed/dotted
 * vocabulary is `@hh/ui`'s palette applied by the planner), and the equal-time dot
 * spacing of a planned trajectory is a different sampling problem, in time, that
 * belongs with the trajectory work rather than here.
 */
import type { OrbitShape } from '@hh/astro';
import { perifocalToInertialMatrix, pqw, pqwToEci } from '@hh/astro';
import type { Metres } from '@hh/math';
import type { EciVector } from '@hh/astro';
import { V, metres } from '@hh/math';

/** §9.3: refine wherever screen-space curvature exceeds 0.5 px. */
export const TOLERANCE_PX = 0.5;

/** §9.3 and NFR-011: at most 512 vertices per orbit. */
export const MAX_VERTICES = 512;

/**
 * `|e - 1|` within which the eccentricity is treated as near-parabolic.
 *
 * At the edge of the band `a = p/(1-e²)` is about 500 p and the periapsis expression
 * `a(cos E - e)` cancels about three significant digits — comfortable in float64.
 * Inside it, that cancellation grows without bound, which is what the band exists to
 * keep away from.
 */
export const NEAR_PARABOLIC_BAND = 1e-3;

/**
 * Seed samples before refinement.
 *
 * Enough that the first sagitta test measures a real chord rather than a straight line
 * across half the orbit — a 4-segment seed on a circle has a sagitta test that passes
 * for the wrong reason at low zoom — and few enough that a nearly-straight arc costs
 * almost nothing.
 */
const SEED_SEGMENTS_CLOSED = 16;
const SEED_SEGMENTS_OPEN = 8;

/** Which parameterisation was used, which is a function of eccentricity alone. */
export type ConicClass = 'elliptic' | 'near-parabolic' | 'hyperbolic';

/** What to tessellate, and how finely. */
export interface TessellationRequest {
  /**
   * The orbit. `trueAnomaly` is **ignored** — this draws the whole path, so where the
   * body currently sits on it changes nothing and must not enter the cache key.
   */
  readonly elements: OrbitShape;
  /** CSS pixels per metre, from the camera. Drives refinement and buckets the cache. */
  readonly scale: number;
  /**
   * Largest radius worth drawing, in metres.
   *
   * An open orbit reaches infinity and a near-parabolic ellipse may as well, so the arc
   * is clipped to the radius beyond which nothing is on screen. A closed ellipse whose
   * apoapsis is inside this radius is drawn whole and ignores it.
   */
  readonly maxRadius: number;
  /** Screen-space tolerance in CSS pixels. Defaults to §9.3's 0.5. */
  readonly tolerancePx?: number;
  /** Hard vertex cap. Defaults to §9.3's 512. */
  readonly maxVertices?: number;
}

/** A conic as a polyline. */
export interface Tessellation {
  /** Inertial positions in metres, ordered along the arc. */
  readonly points: readonly EciVector<Metres>[];
  /** Which parameterisation produced them. */
  readonly conic: ConicClass;
  /** Whether the last point joins back to the first — a complete ellipse. */
  readonly closed: boolean;
  /**
   * `true` when the vertex cap stopped refinement before the tolerance was met.
   *
   * Reported rather than swallowed: a capped tessellation is visibly faceted, and a
   * caller that sees this on an ordinary orbit is looking at a bug — most likely a
   * scale or a `maxRadius` that does not mean what it was thought to mean.
   */
  readonly capped: boolean;
}

/** A point in the perifocal plane. Mutated in place to keep the inner loop allocation-free. */
interface PlanarPoint {
  x: number;
  y: number;
}

/** Writes the perifocal position at parameter `t`. */
type PlanarSampler = (t: number, out: PlanarPoint) => void;

/**
 * One evaluated sample: the parameter and the perifocal position it produced.
 *
 * Kept together, and iterated with `for...of` rather than by index, so the refinement
 * never has to reach for an element the compiler cannot prove is there. Three parallel
 * arrays were faster to write and are the reason the first draft of this loop needed a
 * non-null assertion on every line.
 */
interface Sample {
  readonly t: number;
  readonly x: number;
  readonly y: number;
}

/** `acos`-free: the angle in `[0, pi]` whose cosine is `c`. See NFR-006. */
const angleFromCosine = (c: number): number => {
  const clamped = Math.min(Math.max(c, -1), 1);
  return Math.atan2(Math.sqrt(Math.max(0, 1 - clamped * clamped)), clamped);
};

/** Classify by eccentricity alone. */
export const conicClassOf = (eccentricity: number): ConicClass => {
  if (Math.abs(eccentricity - 1) <= NEAR_PARABOLIC_BAND) return 'near-parabolic';
  return eccentricity < 1 ? 'elliptic' : 'hyperbolic';
};

const ellipticSampler = (p: number, e: number): PlanarSampler => {
  const a = p / (1 - e * e);
  const b = a * Math.sqrt(1 - e * e);
  return (E, out) => {
    out.x = a * (Math.cos(E) - e);
    out.y = b * Math.sin(E);
  };
};

const hyperbolicSampler = (p: number, e: number): PlanarSampler => {
  // Negative for e > 1, which is what makes `a(cosh H - e)` come out positive at
  // periapsis; `-a` is the magnitude the semi-minor axis is built from.
  const a = p / (1 - e * e);
  const b = -a * Math.sqrt(e * e - 1);
  return (H, out) => {
    out.x = a * (Math.cosh(H) - e);
    out.y = b * Math.sinh(H);
  };
};

/**
 * Barker's `D = tan(nu/2)`, through the conic equation with no trigonometry.
 *
 * `r = p(1 + D²) / ((1+e) + (1-e)D²)`, and `x = r cos nu`, `y = r sin nu` reduce to the
 * two expressions below via `cos nu = (1-D²)/(1+D²)` and `sin nu = 2D/(1+D²)`. Exact for
 * every conic; see the module docstring for why it is used only near `e = 1`.
 */
const barkerSampler = (p: number, e: number): PlanarSampler => {
  const onePlusE = 1 + e;
  const oneMinusE = 1 - e;
  return (D, out) => {
    const denominator = onePlusE + oneMinusE * D * D;
    out.x = (p * (1 - D * D)) / denominator;
    out.y = (2 * p * D) / denominator;
  };
};

/** The parameter range to sample, and whether the arc closes. */
interface ParameterSpan {
  readonly from: number;
  readonly to: number;
  readonly closed: boolean;
}

const spanFor = (conic: ConicClass, p: number, e: number, maxRadius: number): ParameterSpan => {
  if (conic === 'elliptic') {
    const a = p / (1 - e * e);
    const apoapsis = p / (1 - e);
    if (apoapsis <= maxRadius) return { from: 0, to: 2 * Math.PI, closed: true };
    // r = a(1 - e cos E) inverted, with atan2 rather than acos (NFR-006).
    const E = angleFromCosine((1 - maxRadius / a) / e);
    return { from: -E, to: E, closed: false };
  }

  if (conic === 'hyperbolic') {
    const a = p / (1 - e * e);
    // r = |a|(e cosh H - 1).
    const coshH = (maxRadius / Math.abs(a) + 1) / e;
    const H = Math.acosh(Math.max(1, coshH));
    return { from: -H, to: H, closed: false };
  }

  // Near-parabolic: r = p(1 + D²)/((1+e) + (1-e)D²) inverted for D.
  const numerator = p - maxRadius * (1 + e);
  const denominator = maxRadius * (1 - e) - p;
  const squared = denominator === 0 ? 0 : numerator / denominator;
  const D = Math.sqrt(Math.max(0, squared));
  return { from: -D, to: D, closed: false };
};

/**
 * Tessellate one conic.
 *
 * @throws RangeError when the semi-latus rectum is not finite and positive, when the
 * eccentricity is negative, or when the scale is not finite and positive — each of
 * which would otherwise produce a polyline of `NaN`s that draws as nothing at all.
 */
export const tessellate = (request: TessellationRequest): Tessellation => {
  const { semiLatusRectum, eccentricity, inclination, raan, argp } = request.elements;
  const p = semiLatusRectum as number;
  const e = eccentricity;

  if (!(p > 0) || !Number.isFinite(p)) {
    throw new RangeError(`semi-latus rectum must be finite and positive, got ${String(p)}`);
  }
  if (!(e >= 0) || !Number.isFinite(e)) {
    throw new RangeError(`eccentricity must be finite and non-negative, got ${String(e)}`);
  }
  if (!(request.scale > 0) || !Number.isFinite(request.scale)) {
    throw new RangeError(`scale must be finite and positive, got ${String(request.scale)}`);
  }
  if (!(request.maxRadius > 0) || !Number.isFinite(request.maxRadius)) {
    throw new RangeError(`maxRadius must be finite and positive, got ${String(request.maxRadius)}`);
  }

  const tolerancePx = request.tolerancePx ?? TOLERANCE_PX;
  const maxVertices = request.maxVertices ?? MAX_VERTICES;
  const conic = conicClassOf(e);
  const span = spanFor(conic, p, e, request.maxRadius);

  const sample: PlanarSampler =
    conic === 'elliptic'
      ? ellipticSampler(p, e)
      : conic === 'hyperbolic'
        ? hyperbolicSampler(p, e)
        : barkerSampler(p, e);

  // The sagitta test compares world metres, so convert the pixel tolerance once.
  const toleranceMetres = tolerancePx / request.scale;

  const seedSegments = span.closed ? SEED_SEGMENTS_CLOSED : SEED_SEGMENTS_OPEN;
  const scratch: PlanarPoint = { x: 0, y: 0 };
  const sampleAt = (t: number): Sample => {
    sample(t, scratch);
    return { t, x: scratch.x, y: scratch.y };
  };

  let samples: Sample[] = [];
  for (let i = 0; i <= seedSegments; i++) {
    samples.push(sampleAt(span.from + ((span.to - span.from) * i) / seedSegments));
  }

  let capped = false;
  // Each pass bisects every segment still outside tolerance, so the sagitta falls by
  // about four per pass. The bound is a guard against a pathological input rather than
  // a working limit: the vertex cap is what normally stops this.
  for (let pass = 0; pass < 16; pass++) {
    if (samples.length >= maxVertices) {
      capped = true;
      break;
    }

    const next: Sample[] = [];
    let previous: Sample | undefined;
    let split = false;

    for (const current of samples) {
      if (previous !== undefined) {
        if (next.length < maxVertices) {
          const midpoint = sampleAt((previous.t + current.t) / 2);
          const sagitta = Math.hypot(
            midpoint.x - (previous.x + current.x) / 2,
            midpoint.y - (previous.y + current.y) / 2,
          );
          if (sagitta > toleranceMetres) {
            next.push(midpoint);
            split = true;
          }
        } else {
          capped = true;
        }
      }

      next.push(current);
      previous = current;
    }

    samples = next;
    if (!split) break;
  }

  // A closed ellipse's final sample is its first one again; the polyline carries the
  // `closed` flag instead, so the duplicate is dropped. Refinement of the last segment
  // is kept — those vertices sit between the second-to-last point and the first.
  if (span.closed) samples.pop();

  const toInertial = perifocalToInertialMatrix(raan, inclination, argp);
  const points = samples.map((s) =>
    pqwToEci(toInertial, pqw(V.vec3(metres(s.x), metres(s.y), metres(0)))),
  );

  return { points, conic, closed: span.closed, capped };
};
