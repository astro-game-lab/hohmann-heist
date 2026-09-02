/**
 * Classical orbital elements, and the conversion to and from a Cartesian state.
 *
 * **The size element is the semi-latus rectum `p`, not the semi-major axis `a`.**
 * FR-002 asks for elliptic, parabolic *and* hyperbolic orbits, and `a` is infinite
 * at `e = 1`, so an element set built on it has a hole in the middle of its stated
 * domain. `p` is finite and positive for every conic. It is also better
 * conditioned: `p = |h|^2 / mu` is a ratio of well-scaled quantities, whereas
 * `a = 1 / (2/r - v^2/mu)` differences two nearly-equal numbers and loses
 * precision exactly where the orbit is nearly parabolic. `a` is still available,
 * as a derived accessor that reports `Infinity` at `e = 1` rather than pretending.
 *
 * Every quadrant comes from `atan2`. `Math.acos` is banned by lint (NFR-006), and
 * the half-angle and dot-product forms that textbooks use need a sign test to
 * recover the quadrant they threw away — the kind of thing that works until the
 * day it does not.
 *
 * ## The degenerate cases
 *
 * Circular and equatorial orbits are the **common case** in this game, not an edge
 * case: every v1.0 contract is equatorial-equivalent. At `e = 0` the periapsis
 * direction does not exist, so `argp` is meaningless; at `sin i = 0` the node line
 * does not exist, so `raan` is meaningless. Returning `NaN` would let that travel
 * silently into a trajectory, and picking a value without saying so would let a
 * caller read meaning into noise.
 *
 * So this module applies the standard conventions and **reports which one it
 * applied** on `degeneracy`:
 *
 * | Case | Convention |
 * | --- | --- |
 * | `e < 1e-8`, `sin i >= 1e-8` | `argp = 0`; `trueAnomaly` carries the argument of latitude |
 * | `e >= 1e-8`, `sin i < 1e-8` | `raan = 0`; `argp` carries the longitude of periapsis |
 * | both | `raan = argp = 0`; `trueAnomaly` carries the true longitude |
 *
 * Chosen so the round trip closes exactly rather than approximately: the suppressed
 * angle is folded into the one that survives, so `stateFromElements` reconstructs
 * the state it came from.
 *
 * Note the equatorial test is on **`sin i`**, which catches retrograde equatorial
 * orbits (`i` near pi) as well as prograde ones. `docs/PHYSICS.md` used to say
 * `i < 1e-8`; the node vector vanishes at both ends, and the weaker test would have
 * handed back a `raan` derived from the direction of a zero-length vector.
 *
 * What this module does **not** do is fix the underlying conditioning. The
 * eccentricity vector suffers catastrophic cancellation as `e -> 0`, so a small `e`
 * carries real absolute error however it is computed. The round trip still closes,
 * because both directions share the convention, but `e` itself is not trustworthy
 * to full precision down there. The equinoctial set (#47) is the answer to that,
 * and is why `docs/PHYSICS.md` says elements feeding logic use it internally.
 *
 * Validated against Curtis, *Orbital Mechanics for Engineering Students*, 4th ed.
 * (Elsevier, 2020) — Algorithm 4.2 (Example 4.3) and Algorithm 4.5 (Example 4.7).
 * See `elements.test.ts`.
 */
import type { Metres, MetresPerSec, Radians, Vec3 } from '@hh/math';
import { metres, metresPerSec, normalize, radians, V } from '@hh/math';

import type { EciVector } from './frames.js';
import { perifocalToInertialMatrix, pqw, pqwToEci } from './frames.js';

/**
 * Below this eccentricity the periapsis direction is treated as undefined.
 * From `docs/PHYSICS.md`, which states the threshold as a contract.
 *
 * Exported because `equinoctial.ts` has to apply the same conventions when it
 * converts back to this element set, and a threshold stated twice is a threshold
 * that will eventually disagree with itself.
 */
export const CIRCULAR_TOLERANCE = 1e-8;

/** Below this `sin i` the node line is treated as undefined. See the note above. */
export const EQUATORIAL_TOLERANCE = 1e-8;

/** Which angular elements were suppressed, and what the survivors mean. */
export type Degeneracy =
  /** Both `raan` and `argp` are meaningful. */
  | 'none'
  /** `e` is below tolerance: `argp = 0`, and `trueAnomaly` is the argument of latitude. */
  | 'circular'
  /** `sin i` is below tolerance: `raan = 0`, and `argp` is the longitude of periapsis. */
  | 'equatorial'
  /** Both: `raan = argp = 0`, and `trueAnomaly` is the true longitude. */
  | 'circular-equatorial';

/**
 * The six numbers that determine a state, without the interpretation.
 *
 * `stateFromElements` needs exactly these, which is why it takes this rather than a
 * full `ClassicalElements` — a caller building an orbit by hand should not have to
 * invent a `degeneracy` tag for it.
 */
export interface OrbitShape {
  /** Semi-latus rectum `p`, strictly positive. Finite for every conic. */
  readonly semiLatusRectum: Metres;
  /** Eccentricity `e`. Zero is circular, one parabolic, above one hyperbolic. */
  readonly eccentricity: number;
  /** Inclination `i`, in `[0, pi]`. */
  readonly inclination: Radians;
  /** Right ascension of the ascending node, in `[0, 2pi)`. */
  readonly raan: Radians;
  /** Argument of periapsis, in `[0, 2pi)`. */
  readonly argp: Radians;
  /** True anomaly at this instant, in `[0, 2pi)`. */
  readonly trueAnomaly: Radians;
}

/** An orbit shape, plus which degenerate convention produced it. */
export interface ClassicalElements extends OrbitShape {
  /** Which angular elements are meaningful. See the module docstring. */
  readonly degeneracy: Degeneracy;
}

/** A Cartesian state in the inertial frame. */
export interface State {
  readonly position: EciVector<Metres>;
  readonly velocity: EciVector<MetresPerSec>;
}

/**
 * Angle from `reference` to `target`, measured about `normal`, in `[0, 2pi)`.
 *
 * The `atan2` form of "the angle between two vectors in a plane": the tangent
 * component comes from projecting onto `normal x reference`, which is the
 * reference direction rotated a quarter turn the way `normal` says is positive.
 * That is what carries the quadrant, and it is why the sign works out for
 * retrograde orbits without a special case — `normal` flips, so the quarter turn
 * flips with it.
 *
 * `normal` is normalised first, and that is load-bearing rather than tidiness:
 * `atan2` compares its two arguments, and only the tangent one picks up a factor
 * of `|normal|` from the cross product. Passing the raw angular-momentum vector
 * would scale one argument by ~1e11 and return an angle of very nearly pi/2 for
 * every input.
 *
 * Assumes `reference` is perpendicular to `normal`, which holds at every call site
 * here — the node vector, the eccentricity vector and the position all lie in the
 * orbital plane, and the equatorial branches pass the x-axis only when the orbit
 * is equatorial.
 */
const angleAbout = (reference: Vec3, target: Vec3, normal: Vec3): Radians => {
  const unitNormal = V.normalize(normal);
  return normalize(
    Math.atan2(V.dot(target, V.cross(unitNormal, reference)), V.dot(target, reference)),
  );
};

/** The inertial x-axis, the reference direction when the node line is undefined. */
const X_AXIS: Vec3 = { x: 1, y: 0, z: 0 };

/**
 * Classical elements from an inertial state.
 *
 * Curtis Algorithm 4.2, with the quadrant logic replaced by `atan2` throughout and
 * the true anomaly taken from a form that does not need the eccentricity vector at
 * all (see below).
 *
 * @param mu Gravitational parameter of the central body, in m^3 s^-2. Explicit
 * rather than defaulted to Earth's: the core carries no assumption about which body
 * it is orbiting, and a test that cites a textbook has to use the textbook's value.
 *
 * @throws RangeError when angular momentum is zero. The orbit is then rectilinear,
 * the orbital plane is undefined, and there are no elements to return. Rejected at
 * construction per `docs/PHYSICS.md` rather than returning a state full of `NaN`.
 */
export const elementsFromState = (
  position: EciVector<Metres>,
  velocity: EciVector<MetresPerSec>,
  mu: number,
): ClassicalElements => {
  const rMag = V.norm(position);
  const vSq = V.normSq(velocity);
  const rDotV = V.dot(position, velocity);

  const h = V.cross(position, velocity);
  const hMag = V.norm(h);
  if (hMag === 0) {
    throw new RangeError(
      'orbital elements are undefined for a rectilinear orbit: position and velocity are parallel',
    );
  }

  const semiLatusRectum = (hMag * hMag) / mu;

  // Eccentricity vector. Written componentwise because the expression mixes metres
  // with metres per second, and the branded vector helpers deliberately refuse to.
  const scale = vSq - mu / rMag;
  const eVec: Vec3 = {
    x: (scale * position.x - rDotV * velocity.x) / mu,
    y: (scale * position.y - rDotV * velocity.y) / mu,
    z: (scale * position.z - rDotV * velocity.z) / mu,
  };
  const eccentricity = Math.hypot(eVec.x, eVec.y, eVec.z);

  // Node vector, zHat x h. Its z component is identically zero, so its magnitude is
  // a two-argument hypot and |n| / |h| is sin(i) exactly.
  const node: Vec3 = { x: -h.y, y: h.x, z: 0 };
  const nodeMag = Math.hypot(node.x, node.y);

  // atan2 against the in-plane magnitude puts inclination in [0, pi] directly, and
  // stays accurate near 0 and pi where acos(hz/h) would not.
  const inclination = radians(Math.atan2(nodeMag, h.z));

  const circular = eccentricity < CIRCULAR_TOLERANCE;
  const equatorial = nodeMag / hMag < EQUATORIAL_TOLERANCE;

  // True anomaly from r = p / (1 + e cos v) and rdot = (mu/h) e sin v, both
  // multiplied through by mu * r * e so the common positive factor cancels in the
  // ratio. This needs no eccentricity vector, which matters because that vector's
  // *direction* is the first casualty of cancellation at low e. It degenerates only
  // when e is genuinely zero, which is the branch below.
  const trueAnomalyFromPeriapsis = normalize(Math.atan2(hMag * rDotV, hMag * hMag - mu * rMag));

  if (circular && equatorial) {
    return {
      semiLatusRectum: metres(semiLatusRectum),
      eccentricity,
      inclination,
      raan: radians(0),
      argp: radians(0),
      // True longitude: from the inertial x-axis, since neither node nor periapsis exists.
      trueAnomaly: angleAbout(X_AXIS, position, h),
      degeneracy: 'circular-equatorial',
    };
  }

  if (circular) {
    return {
      semiLatusRectum: metres(semiLatusRectum),
      eccentricity,
      inclination,
      raan: normalize(Math.atan2(node.y, node.x)),
      argp: radians(0),
      // Argument of latitude: from the ascending node, since periapsis does not exist.
      trueAnomaly: angleAbout(node, position, h),
      degeneracy: 'circular',
    };
  }

  if (equatorial) {
    return {
      semiLatusRectum: metres(semiLatusRectum),
      eccentricity,
      inclination,
      raan: radians(0),
      // Longitude of periapsis: from the inertial x-axis, since the node does not exist.
      argp: angleAbout(X_AXIS, eVec, h),
      trueAnomaly: trueAnomalyFromPeriapsis,
      degeneracy: 'equatorial',
    };
  }

  return {
    semiLatusRectum: metres(semiLatusRectum),
    eccentricity,
    inclination,
    raan: normalize(Math.atan2(node.y, node.x)),
    argp: angleAbout(node, eVec, h),
    trueAnomaly: trueAnomalyFromPeriapsis,
    degeneracy: 'none',
  };
};

/**
 * Inertial state from classical elements.
 *
 * Curtis Algorithm 4.5: build the state in the perifocal frame, where it is two
 * lines, then rotate it into the inertial frame with the 3-1-3 sequence that
 * `frames.ts` already owns and tests.
 *
 * ```
 * r = p / (1 + e cos v)      r_pqw = r (cos v, sin v, 0)
 *                            v_pqw = sqrt(mu/p) (-sin v, e + cos v, 0)
 * ```
 *
 * @throws RangeError when `p` is not finite and positive, when `e` is negative, or
 * when the true anomaly lies outside the asymptotes of an open orbit. That last one
 * is the case worth naming: for `e >= 1` there is a limiting true anomaly beyond
 * which the trajectory does not exist, and `1 + e cos v` passes through zero there.
 * Evaluating anyway yields an infinite or negative radius, which is not a position.
 */
export const stateFromElements = (elements: OrbitShape, mu: number): State => {
  const { semiLatusRectum, eccentricity, inclination, raan, argp, trueAnomaly } = elements;

  if (!(semiLatusRectum > 0) || !Number.isFinite(semiLatusRectum)) {
    throw new RangeError(
      `semi-latus rectum must be finite and positive, got ${String(semiLatusRectum)}`,
    );
  }
  if (!(eccentricity >= 0)) {
    throw new RangeError(`eccentricity must be non-negative, got ${String(eccentricity)}`);
  }

  const denominator = 1 + eccentricity * Math.cos(trueAnomaly);
  if (denominator <= 0) {
    throw new RangeError(
      `true anomaly ${String(trueAnomaly)} rad is outside the asymptotes of an orbit with e = ${String(eccentricity)}`,
    );
  }

  const r = semiLatusRectum / denominator;
  const speedScale = Math.sqrt(mu / semiLatusRectum);

  const positionPqw = pqw(
    V.vec3(metres(r * Math.cos(trueAnomaly)), metres(r * Math.sin(trueAnomaly)), metres(0)),
  );
  const velocityPqw = pqw(
    V.vec3(
      metresPerSec(speedScale * -Math.sin(trueAnomaly)),
      metresPerSec(speedScale * (eccentricity + Math.cos(trueAnomaly))),
      metresPerSec(0),
    ),
  );

  const toInertial = perifocalToInertialMatrix(raan, inclination, argp);
  return {
    position: pqwToEci(toInertial, positionPqw),
    velocity: pqwToEci(toInertial, velocityPqw),
  };
};

/**
 * Semi-major axis, `p / (1 - e^2)`.
 *
 * `Infinity` for a parabola and negative for a hyperbola, both of which are the
 * conventional answers rather than error cases. This is a derived quantity here
 * precisely so those two can be reported honestly instead of stored.
 */
export const semiMajorAxis = (elements: OrbitShape): Metres =>
  metres(elements.semiLatusRectum / (1 - elements.eccentricity * elements.eccentricity));

/** Periapsis radius, `p / (1 + e)`. Defined for every conic. */
export const periapsisRadius = (elements: OrbitShape): Metres =>
  metres(elements.semiLatusRectum / (1 + elements.eccentricity));

/**
 * Apoapsis radius, `p / (1 - e)`.
 *
 * @throws RangeError for `e >= 1`. An open orbit has no apoapsis, and the formula
 * would return a negative number for a hyperbola — a plausible-looking radius that
 * is not one.
 */
export const apoapsisRadius = (elements: OrbitShape): Metres => {
  if (elements.eccentricity >= 1) {
    throw new RangeError(`an orbit with e = ${String(elements.eccentricity)} has no apoapsis`);
  }
  return metres(elements.semiLatusRectum / (1 - elements.eccentricity));
};

/**
 * Specific angular momentum, `sqrt(mu p)`, in m^2 s^-1.
 *
 * Returned plain: the unit is not one the brand set models, and inventing a brand
 * for a quantity that appears in two places would be ceremony without a payoff.
 */
export const specificAngularMomentum = (elements: OrbitShape, mu: number): number =>
  Math.sqrt(mu * elements.semiLatusRectum);
