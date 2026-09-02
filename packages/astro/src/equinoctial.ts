/**
 * Equinoctial orbital elements — the non-singular element set.
 *
 * `(p, f, g, h, k, L)`. The classical set degenerates at `e = 0`, where the
 * periapsis direction does not exist, and at `sin i = 0`, where the node line does
 * not exist. Both are the **common case** in this game rather than an edge case:
 * every v1.0 contract is equatorial-equivalent. `elements.ts` copes by detecting
 * each case and folding the meaningless angle into a surviving one, which makes the
 * round trip close but leaves a caller reading `argp` a value that carries no
 * information. This set has no such case to detect. Every element is defined,
 * continuously, everywhere the chart is valid.
 *
 * ```
 * p = semi-latus rectum          f = e cos(argp + I raan)   g = e sin(argp + I raan)
 * L = I raan + argp + nu         h = tan(i/2)^I cos raan    k = tan(i/2)^I sin raan
 * ```
 *
 * The size element is `p`, matching `OrbitShape` and for the same reason: `a` is
 * infinite at `e = 1` and FR-002 asks for the parabolic case.
 *
 * ## What this set actually buys, and what it does not
 *
 * It is worth being precise, because the obvious claim is the wrong one.
 *
 * It does **not** recover the eccentricity *magnitude* any more accurately. `e` at
 * `1e-10` carries about `5e-16` of absolute error whichever way it is computed —
 * from this set, from the eccentricity vector as `elements.ts` computes it, or from
 * `(v x h)/mu - rhat`. All three were measured and all three sit on the same floor,
 * because that floor is the float64 representation of the *state*, not the algebra.
 * One ulp of a position component is already a perturbation of that size in `e`.
 *
 * What it buys is the **periapsis direction**, and there the difference is not
 * marginal. `argp` is an angle to a direction whose length is `e`, so its error
 * scales as `5e-16 / e`, losing a digit for every decade `e` falls. Measured
 * against `elementsFromState`, over a full revolution at `i = 0.4`:
 *
 * | e | classical `argp`, absolute error | equinoctial `(f, g)`, absolute error |
 * | --- | --- | --- |
 * | 1e-4 | 5.4e-12 rad | 7.4e-16 |
 * | 1e-6 | 4.4e-10 rad | 7.5e-16 |
 * | 1e-7 | 4.8e-9 rad | 6.9e-16 |
 * | 2e-8 | 1.7e-8 rad | 6.8e-16 |
 * | below 1e-8 | **not returned at all** | 6.5e-16 |
 *
 * The last row is the sharper point. Below the `1e-8` threshold `elements.ts` stops
 * reporting a degraded angle and starts reporting none: the circular convention
 * sets `argp = 0` and tags the result `'circular'`, so the zero is a convention
 * rather than a measurement, and the direction is gone rather than merely imprecise.
 * `f` and `g` are Cartesian components of that same direction scaled by `e`, so
 * they stay flat at the representation floor across the whole range — there is no
 * threshold here to cross. This is why `docs/PHYSICS.md` says elements feeding logic use this
 * set: not because `e` is better here, but because anything that consumes a
 * periapsis direction, interpolates elements, or steps a solver across `e = 0` sees
 * a continuous function instead of a discontinuity. `equinoctial.test.ts` measures
 * both columns rather than asserting the claim.
 *
 * ## Retrograde orbits, and why there are two charts
 *
 * `tan(i/2)` diverges at `i = pi`, so a single chart cannot cover the whole sphere
 * of orientations — the same reason a single map projection cannot. The standard
 * answer is the **retrograde factor** `I = +1 | -1`, giving a second chart built on
 * `cot(i/2)` that is regular at `i = pi` and singular at `i = 0` instead. This
 * module carries `I` on the element set and supports both, because rejecting
 * retrograde orbits would make this set unable to represent orbits the classical
 * set already handles and already tests — Curtis Example 4.3 is retrograde.
 *
 * The chart is chosen by the sign of the angular momentum's z component, which
 * switches at `i = pi/2`. **That is not a tolerance branch near a singularity.** It
 * is a switch made as far from both singularities as it is possible to get, where
 * `s^2 = 2` in both charts and the two agree to round-off. The denominator
 * `1 + I w_z` this module divides by is therefore always in `[1, 2]` — it cannot
 * approach zero, at any inclination, in either chart. That is the whole design.
 *
 * At `i = pi/2` exactly, `w_z` is zero in exact arithmetic, so its computed sign is
 * round-off and a state converted, rebuilt and converted again can come back in the
 * other chart. That is worth knowing and is not a defect: both charts are equally
 * well conditioned there and describe the same orbit, which `equinoctial.test.ts`
 * asserts rather than assumes. It does not affect determinism either — this is a
 * pure function of the state, so the same state always yields the same chart; what
 * is not guaranteed is that a *round trip* returns to the chart it started in.
 *
 * Converting *to* the classical set does reintroduce the classical set's
 * degeneracies, because they are properties of that set rather than of the
 * conversion. `classicalFromEquinoctial` therefore applies exactly the conventions
 * `elements.ts` documents, and imports its thresholds rather than restating them.
 *
 * ## Sources
 *
 * The element definitions and the retrograde factor follow Walker, M.J.H.,
 * Ireland, B., and Owens, J., "A set of modified equinoctial orbit elements",
 * *Celestial Mechanics* 36 (1985), 409-419. The basis vectors below were
 * **derived** from the classical 3-1-3 rotation that `frames.ts` already tests,
 * rather than transcribed, because published forms of the retrograde case differ in
 * their sign and index conventions and a transcription error would be invisible
 * until a retrograde orbit appeared. `equinoctial.test.ts` pins the derivation by
 * cross-checking against `elements.ts` over a grid.
 */
import type { Metres, MetresPerSec, Radians, Vec3 } from '@hh/math';
import { metres, metresPerSec, normalize, radians, V } from '@hh/math';

import type { ClassicalElements, OrbitShape, State } from './elements.js';
import { CIRCULAR_TOLERANCE, EQUATORIAL_TOLERANCE } from './elements.js';
import type { EciVector } from './frames.js';
import { eci } from './frames.js';

/**
 * The equinoctial element set.
 *
 * `f`, `g`, `h` and `k` are dimensionless and unbranded: they are components of
 * direction-like quantities, not lengths, and inventing a brand for them would be
 * ceremony without a payoff.
 */
export interface EquinoctialElements {
  /** Semi-latus rectum `p`, strictly positive. Finite for every conic. */
  readonly semiLatusRectum: Metres;
  /** `e cos(argp + I raan)`. With `g`, the eccentricity vector in the orbital plane. */
  readonly f: number;
  /** `e sin(argp + I raan)`. */
  readonly g: number;
  /** `tan(i/2)^I cos raan`. With `k`, the orbital plane's orientation. */
  readonly h: number;
  /** `tan(i/2)^I sin raan`. */
  readonly k: number;
  /** True longitude `L = I raan + argp + nu`, in `[0, 2pi)`. */
  readonly trueLongitude: Radians;
  /**
   * Which chart this set is expressed in: `false` is `I = +1`, regular at `i = 0`
   * and singular at `i = pi`; `true` is `I = -1`, the other way round.
   *
   * Carried on the value rather than inferred, because every formula here needs it
   * and a set whose chart had to be guessed from its own contents would be exactly
   * the kind of implicit convention this package exists to avoid.
   */
  readonly retrograde: boolean;
}

/** The retrograde factor `I` for a set. */
const factor = (elements: EquinoctialElements): number => (elements.retrograde ? -1 : 1);

/**
 * The equinoctial basis `(fHat, gHat, wHat)` in inertial components.
 *
 * `wHat` is the unit angular momentum; `fHat` and `gHat` span the orbital plane,
 * with `L` measured from `fHat`. Derived from `Rz(raan) Rx(i) Rz(-raan)` applied to
 * the inertial axes, then re-expressed in `h` and `k`; the retrograde case differs
 * from the direct one in exactly one place, the sign of `fHat`'s z component.
 *
 * `s2 = 1 + h^2 + k^2` is `2 / (1 + I cos i)`, which is bounded in `[1, 2]` for
 * whichever chart is in use. Nothing here can divide by a small number.
 */
const basis = (
  h: number,
  k: number,
  retrogradeFactor: number,
): { fHat: Vec3; gHat: Vec3; wHat: Vec3 } => {
  const s2 = 1 + h * h + k * k;
  const fHat: Vec3 = {
    x: (1 + h * h - k * k) / s2,
    y: (2 * h * k) / s2,
    z: (-2 * retrogradeFactor * k) / s2,
  };
  const wHat: Vec3 = {
    x: (2 * k) / s2,
    y: (-2 * h) / s2,
    z: (retrogradeFactor * (1 - h * h - k * k)) / s2,
  };
  // Right-handed by construction, which is cheaper to be sure of than a fourth
  // closed form would be.
  return { fHat, gHat: V.cross(wHat, fHat), wHat };
};

/**
 * Equinoctial elements from an inertial state.
 *
 * No branch, no tolerance, and no element that can come back undefined. The chart
 * is selected from the sign of `h_z`, which is a decision made at `i = pi/2` where
 * both charts are equally well conditioned.
 *
 * @param mu Gravitational parameter of the central body, in m^3 s^-2. Explicit for
 * the same reason as in `elements.ts`: the core assumes nothing about which body it
 * is orbiting.
 *
 * @throws RangeError when angular momentum is zero. The orbit is rectilinear, the
 * orbital plane is undefined, and there are no elements to return — the same
 * contract `elementsFromState` and `eciToRtnMatrix` already hold to.
 */
export const equinoctialFromState = (
  position: EciVector<Metres>,
  velocity: EciVector<MetresPerSec>,
  mu: number,
): EquinoctialElements => {
  const angularMomentum = V.cross(position, velocity);
  const hMag = V.norm(angularMomentum);
  if (hMag === 0) {
    throw new RangeError(
      'equinoctial elements are undefined for a rectilinear orbit: position and velocity are parallel',
    );
  }

  const wHat = V.normalize(angularMomentum);
  const retrogradeFactor = wHat.z < 0 ? -1 : 1;

  // 2 / s^2, and never smaller than 1: the chart was chosen so that I * w_z >= 0.
  const denominator = 1 + retrogradeFactor * wHat.z;
  const h = -wHat.y / denominator;
  const k = wHat.x / denominator;

  const { fHat, gHat } = basis(h, k, retrogradeFactor);

  // Eccentricity vector, componentwise because the expression mixes metres with
  // metres per second and the branded vector helpers deliberately refuse to. Same
  // form as `elements.ts`; see the module docstring for why no formulation of this
  // does better at low e.
  const rMag = V.norm(position);
  const vSq = V.normSq(velocity);
  const rDotV = V.dot(position, velocity);
  const scale = vSq - mu / rMag;
  const eVec: Vec3 = {
    x: (scale * position.x - rDotV * velocity.x) / mu,
    y: (scale * position.y - rDotV * velocity.y) / mu,
    z: (scale * position.z - rDotV * velocity.z) / mu,
  };

  return {
    semiLatusRectum: metres((hMag * hMag) / mu),
    f: V.dot(eVec, fHat),
    g: V.dot(eVec, gHat),
    h,
    k,
    trueLongitude: normalize(Math.atan2(V.dot(position, gHat), V.dot(position, fHat))),
    retrograde: retrogradeFactor < 0,
  };
};

/**
 * Inertial state from equinoctial elements.
 *
 * In the equinoctial frame the state is two lines, exactly as it is in the
 * perifocal frame for the classical set:
 *
 * ```
 * r = p / (1 + f cos L + g sin L)   r_eq = r (cos L, sin L, 0)
 *                                   v_eq = sqrt(mu/p) (-(sin L + g), cos L + f, 0)
 * ```
 *
 * The velocity form follows from rotating the perifocal `sqrt(mu/p)(-sin nu,
 * e + cos nu, 0)` through the longitude of periapsis and collecting `e cos` and
 * `e sin` into `f` and `g`.
 *
 * @throws RangeError when `p` is not finite and positive, or when `L` lies outside
 * the asymptotes of an open orbit. The second is the case worth naming: for
 * `e >= 1` there is a limiting longitude past which the trajectory does not exist,
 * and `1 + f cos L + g sin L` passes through zero there. Evaluating anyway yields
 * an infinite or negative radius, which is not a position.
 */
export const stateFromEquinoctial = (elements: EquinoctialElements, mu: number): State => {
  const { semiLatusRectum, f, g, h, k, trueLongitude } = elements;

  if (!(semiLatusRectum > 0) || !Number.isFinite(semiLatusRectum)) {
    throw new RangeError(
      `semi-latus rectum must be finite and positive, got ${String(semiLatusRectum)}`,
    );
  }

  const cosL = Math.cos(trueLongitude);
  const sinL = Math.sin(trueLongitude);

  const w = 1 + f * cosL + g * sinL;
  if (!(w > 0)) {
    throw new RangeError(
      `true longitude ${String(trueLongitude)} rad is outside the asymptotes of an orbit with ` +
        `f = ${String(f)}, g = ${String(g)}`,
    );
  }

  const { fHat, gHat } = basis(h, k, factor(elements));
  const r = semiLatusRectum / w;
  const speedScale = Math.sqrt(mu / semiLatusRectum);

  const rf = r * cosL;
  const rg = r * sinL;
  const vf = -speedScale * (sinL + g);
  const vg = speedScale * (cosL + f);

  return {
    position: eci(
      V.vec3(
        metres(rf * fHat.x + rg * gHat.x),
        metres(rf * fHat.y + rg * gHat.y),
        metres(rf * fHat.z + rg * gHat.z),
      ),
    ),
    velocity: eci(
      V.vec3(
        metresPerSec(vf * fHat.x + vg * gHat.x),
        metresPerSec(vf * fHat.y + vg * gHat.y),
        metresPerSec(vf * fHat.z + vg * gHat.z),
      ),
    ),
  };
};

/**
 * Equinoctial elements from a classical orbit shape.
 *
 * The chart follows `cos i`, matching the rule `equinoctialFromState` applies to
 * `h_z`, so the two entry points agree on which chart an orbit belongs to.
 *
 * `cot(i/2)` is computed as `cos(i/2) / sin(i/2)` rather than as `1 / tan(i/2)`.
 * The reciprocal form goes through `tan(pi/2)`, which in float64 is 1.633e16 rather
 * than infinity, so the result would be a small non-zero number where zero is the
 * right answer — a retrograde equatorial orbit would come back with a `raan` that
 * had survived when it should have vanished.
 */
export const equinoctialFromClassical = (elements: OrbitShape): EquinoctialElements => {
  const { semiLatusRectum, eccentricity, inclination, raan, argp, trueAnomaly } = elements;

  const retrogradeFactor = Math.cos(inclination) < 0 ? -1 : 1;
  const half = inclination / 2;
  const tangent =
    retrogradeFactor > 0 ? Math.sin(half) / Math.cos(half) : Math.cos(half) / Math.sin(half);

  // Longitude of periapsis, the angle f and g decompose.
  const longitudeOfPeriapsis = argp + retrogradeFactor * raan;

  return {
    semiLatusRectum,
    f: eccentricity * Math.cos(longitudeOfPeriapsis),
    g: eccentricity * Math.sin(longitudeOfPeriapsis),
    h: tangent * Math.cos(raan),
    k: tangent * Math.sin(raan),
    trueLongitude: normalize(longitudeOfPeriapsis + trueAnomaly),
    retrograde: retrogradeFactor < 0,
  };
};

/**
 * Classical elements from an equinoctial set.
 *
 * This direction reintroduces the classical set's degeneracies, because they belong
 * to that set rather than to the conversion: at `e = 0` there is still no periapsis
 * to point at, whatever `f` and `g` were. So it applies the conventions
 * `elements.ts` documents, using that module's thresholds, and reports which one it
 * applied on `degeneracy` — a caller round-tripping through here gets the same
 * answer `elementsFromState` would have given.
 *
 * Inclination comes from `atan2` against 1 rather than from `atan` of a ratio, so
 * the retrograde chart's `i = 2 atan2(1, cot(i/2))` needs no division and stays
 * exact at `cot(i/2) = 0`.
 */
export const classicalFromEquinoctial = (elements: EquinoctialElements): ClassicalElements => {
  const { semiLatusRectum, f, g, h, k, trueLongitude } = elements;
  const retrogradeFactor = factor(elements);

  const eccentricity = Math.hypot(f, g);
  const tangent = Math.hypot(h, k);
  const inclination = radians(
    retrogradeFactor > 0 ? 2 * Math.atan2(tangent, 1) : 2 * Math.atan2(1, tangent),
  );

  const circular = eccentricity < CIRCULAR_TOLERANCE;
  const equatorial = Math.sin(inclination) < EQUATORIAL_TOLERANCE;

  // Both angles are recovered as raw reals first, then normalised once, so the
  // differences below are taken before any wrap can turn a small negative into a
  // number near 2pi.
  const rawRaan = Math.atan2(k, h);
  const longitudeOfPeriapsis = Math.atan2(g, f);

  if (circular && equatorial) {
    return {
      semiLatusRectum,
      eccentricity,
      inclination,
      raan: radians(0),
      argp: radians(0),
      trueAnomaly: normalize(trueLongitude),
      degeneracy: 'circular-equatorial',
    };
  }

  if (circular) {
    // Periapsis does not exist; the surviving angle is the argument of latitude,
    // measured from the node.
    return {
      semiLatusRectum,
      eccentricity,
      inclination,
      raan: normalize(rawRaan),
      argp: radians(0),
      trueAnomaly: normalize(trueLongitude - retrogradeFactor * rawRaan),
      degeneracy: 'circular',
    };
  }

  if (equatorial) {
    // The node does not exist; the surviving angle is the longitude of periapsis.
    return {
      semiLatusRectum,
      eccentricity,
      inclination,
      raan: radians(0),
      argp: normalize(longitudeOfPeriapsis),
      trueAnomaly: normalize(trueLongitude - longitudeOfPeriapsis),
      degeneracy: 'equatorial',
    };
  }

  return {
    semiLatusRectum,
    eccentricity,
    inclination,
    raan: normalize(rawRaan),
    argp: normalize(longitudeOfPeriapsis - retrogradeFactor * rawRaan),
    trueAnomaly: normalize(trueLongitude - longitudeOfPeriapsis),
    degeneracy: 'none',
  };
};

/**
 * Eccentricity, `hypot(f, g)`.
 *
 * Derived rather than stored, and worth reading the module docstring before
 * trusting it far below `1e-8`: this is no more accurate than the classical route,
 * and neither is any other formulation.
 */
export const eccentricity = (elements: EquinoctialElements): number =>
  Math.hypot(elements.f, elements.g);

/** Inclination, in `[0, pi]`. Derived from `h` and `k` and the chart in use. */
export const inclination = (elements: EquinoctialElements): Radians => {
  const tangent = Math.hypot(elements.h, elements.k);
  return radians(elements.retrograde ? 2 * Math.atan2(1, tangent) : 2 * Math.atan2(tangent, 1));
};
