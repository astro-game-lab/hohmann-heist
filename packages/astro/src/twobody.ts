/**
 * Closed-form two-body relations, and the impulsive transfers built from them.
 *
 * Everything here has an exact algebraic answer — no iteration, no convergence to
 * report. These are the relations `docs/PHYSICS.md` lists as Tier 1, and they exist
 * as code rather than only as assertions because a test that recomputes
 * `2 pi sqrt(a^3/mu)` and compares it to `2 pi sqrt(a^3/mu)` checks nothing. With
 * them here, `twobody.test.ts` can check each one against an independent route: a
 * state built by the element machinery, a physical identity, or a published value
 * that does not come from our constants at all.
 *
 * They are also what the game needs to quote a par: `docs/PRODUCT.md` section 6.7
 * scores against the best known Δv, and for the transfer contracts of Act I that
 * number is a Hohmann Δv.
 *
 * ## What is a transfer here, and what is not
 *
 * A transfer in this module is a **geometry**, not a plan: two or three impulses,
 * their magnitudes, and the time between them. It knows nothing about when the burn
 * happens, which spacecraft does it, whether the budget allows it, or what the
 * player is scored on — all of which live above `@hh/sim`. Nothing here is a
 * gameplay departure and nothing here may become one; the DEP-xx table in
 * `docs/PHYSICS.md` names the layer each departure belongs to and it is never this
 * one.
 *
 * The transfers are **coplanar and circular-to-circular**, which is the case Act I
 * teaches and the case both published thresholds below are stated for. A general
 * transfer between arbitrary states is Lambert's problem; see `lambert.ts`.
 *
 * ## Sign and domain conventions
 *
 * Burn magnitudes are returned as non-negative scalars, because a magnitude is what
 * a Δv budget is spent in and the direction is a property of the maneuver rather
 * than of the transfer geometry. Callers that need the vector build it in RTN
 * through `frames.ts`.
 *
 * Radii must be finite and strictly positive. `r2 = r1` is allowed and returns a
 * zero-Δv transfer, which is the correct answer and keeps the ratio sweeps in
 * `twobody.test.ts` free of a special case at the left edge.
 */
import type { Metres, MetresPerSec, Seconds } from '@hh/math';
import { metresPerSec, seconds } from '@hh/math';

/** Reject a radius that is not a radius, with the offending value in the message. */
const requireRadius = (value: number, name: string): void => {
  if (!(value > 0) || !Number.isFinite(value)) {
    throw new RangeError(`${name} must be finite and positive, got ${String(value)}`);
  }
};

/**
 * Orbital period, `T = 2 pi sqrt(a^3 / mu)`.
 *
 * Kepler's third law. Defined only for a closed orbit: `a` is infinite for a
 * parabola and negative for a hyperbola, neither of which has a period.
 *
 * @throws RangeError for a non-positive or non-finite semi-major axis. An open
 * trajectory has no period, and the formula would return `NaN` for a hyperbola —
 * a silent one, since `NaN` compares false against every bound a caller might test.
 */
export const period = (semiMajorAxis: Metres, mu: number): Seconds => {
  if (!(semiMajorAxis > 0) || !Number.isFinite(semiMajorAxis)) {
    throw new RangeError(
      `an orbit with a = ${String(semiMajorAxis)} m is not closed and has no period`,
    );
  }
  return seconds(2 * Math.PI * Math.sqrt(semiMajorAxis ** 3 / mu));
};

/**
 * Mean motion, `n = sqrt(mu / a^3)`, in rad s^-1.
 *
 * The same relation as `period`, in the form phasing arithmetic wants. Kept as its
 * own function rather than as `TAU / period(...)` so that a caller reasoning about
 * angular rates does not round-trip through a period it does not need.
 */
export const meanMotion = (semiMajorAxis: Metres, mu: number): number => {
  if (!(semiMajorAxis > 0) || !Number.isFinite(semiMajorAxis)) {
    throw new RangeError(`an orbit with a = ${String(semiMajorAxis)} m has no mean motion`);
  }
  return Math.sqrt(mu / semiMajorAxis ** 3);
};

/**
 * Speed at a radius on a given orbit, from vis-viva: `v^2 = mu (2/r - 1/a)`.
 *
 * Valid for every conic, including the hyperbolic case where `a` is negative and
 * the parabolic case where it is `Infinity` and the second term vanishes.
 *
 * @throws RangeError when `2/r - 1/a` is negative, which means the radius lies
 * outside the orbit — beyond apoapsis, or inside a hyperbola's periapsis. There is
 * no speed to report there because there is no trajectory there, and returning
 * `NaN` would let that travel.
 */
export const visVivaSpeed = (radius: Metres, semiMajorAxis: Metres, mu: number): MetresPerSec => {
  requireRadius(radius, 'radius');
  const vSq = mu * (2 / radius - 1 / semiMajorAxis);
  if (!(vSq >= 0)) {
    throw new RangeError(
      `radius ${String(radius)} m lies outside an orbit with a = ${String(semiMajorAxis)} m`,
    );
  }
  return metresPerSec(Math.sqrt(vSq));
};

/** Speed on a circular orbit, `v = sqrt(mu / r)`. Vis-viva with `a = r`. */
export const circularSpeed = (radius: Metres, mu: number): MetresPerSec => {
  requireRadius(radius, 'radius');
  return metresPerSec(Math.sqrt(mu / radius));
};

/** Escape speed at a radius, `v = sqrt(2 mu / r)`. Vis-viva with `a = Infinity`. */
export const escapeSpeed = (radius: Metres, mu: number): MetresPerSec => {
  requireRadius(radius, 'radius');
  return metresPerSec(Math.sqrt((2 * mu) / radius));
};

/**
 * Specific orbital energy, `eps = v^2/2 - mu/r`, in J kg^-1.
 *
 * Its sign is the orbit class: negative is elliptic, zero parabolic, positive
 * hyperbolic. That is the cheapest classification available and it is what
 * `twobody.test.ts` asserts, one case per class.
 *
 * **This expression cancels catastrophically near escape**, where the two terms are
 * nearly equal and opposite, so the sign is not trustworthy for a trajectory within
 * round-off of parabolic. `docs/PHYSICS.md` records the same caution. Anything
 * needing to distinguish e = 1 from e = 1 +/- 1e-15 should ask the element set,
 * where `p` is well conditioned, rather than this.
 */
export const specificEnergy = (radius: Metres, speed: MetresPerSec, mu: number): number => {
  requireRadius(radius, 'radius');
  return (speed * speed) / 2 - mu / radius;
};

/** A two-impulse transfer between coplanar circular orbits. */
export interface HohmannTransfer {
  /** Magnitude of the burn that leaves the inner orbit, in m/s. */
  readonly firstBurn: MetresPerSec;
  /** Magnitude of the burn that circularises at the outer orbit, in m/s. */
  readonly secondBurn: MetresPerSec;
  /** Sum of the two, in m/s. What a Δv budget is charged. */
  readonly totalDeltaV: MetresPerSec;
  /** Half the period of the transfer ellipse, in s. */
  readonly timeOfFlight: Seconds;
  /** Semi-major axis of the transfer ellipse, in m. */
  readonly transferSemiMajorAxis: Metres;
}

/**
 * The Hohmann transfer between coplanar circular orbits of radius `r1` and `r2`.
 *
 * Two impulses on an ellipse tangent to both orbits, which is the minimum-Δv
 * two-impulse transfer for ratios below about 11.94 — see `biEllipticTransfer` for
 * what happens above that, and `twobody.test.ts` for the threshold measured rather
 * than asserted from memory.
 *
 * ```
 * a_t  = (r1 + r2) / 2
 * dv1  = |v_peri(a_t) - v_circ(r1)|      dv2 = |v_circ(r2) - v_apo(a_t)|
 * TOF  = pi sqrt(a_t^3 / mu)
 * ```
 *
 * Works in both directions: `r2 < r1` is a transfer inward, where both burns are
 * retrograde and the magnitudes come out the same as the outward case with the
 * radii swapped. That symmetry is asserted, because it is the sort of thing an
 * absolute value can hide.
 */
export const hohmannTransfer = (r1: Metres, r2: Metres, mu: number): HohmannTransfer => {
  requireRadius(r1, 'r1');
  requireRadius(r2, 'r2');

  const transferSemiMajorAxis = ((r1 + r2) / 2) as Metres;
  const firstBurn = Math.abs(visVivaSpeed(r1, transferSemiMajorAxis, mu) - circularSpeed(r1, mu));
  const secondBurn = Math.abs(circularSpeed(r2, mu) - visVivaSpeed(r2, transferSemiMajorAxis, mu));

  return {
    firstBurn: metresPerSec(firstBurn),
    secondBurn: metresPerSec(secondBurn),
    totalDeltaV: metresPerSec(firstBurn + secondBurn),
    timeOfFlight: seconds(Math.PI * Math.sqrt(transferSemiMajorAxis ** 3 / mu)),
    transferSemiMajorAxis,
  };
};

/** A three-impulse transfer between coplanar circular orbits, via an intermediate apoapsis. */
export interface BiEllipticTransfer {
  /** Magnitude of the burn that raises apoapsis to `rIntermediate`, in m/s. */
  readonly firstBurn: MetresPerSec;
  /** Magnitude of the burn at `rIntermediate` that raises periapsis to `r2`, in m/s. */
  readonly secondBurn: MetresPerSec;
  /** Magnitude of the burn that circularises at `r2`, in m/s. */
  readonly thirdBurn: MetresPerSec;
  /** Sum of the three, in m/s. */
  readonly totalDeltaV: MetresPerSec;
  /** Half the first ellipse plus half the second, in s. */
  readonly timeOfFlight: Seconds;
}

/**
 * The bi-elliptic transfer between coplanar circular orbits, via `rIntermediate`.
 *
 * Three impulses: raise apoapsis far out, raise periapsis to the target radius
 * while up there where it is cheap, then circularise on the way back in. It beats
 * the Hohmann transfer for large radius ratios, and the reason is that the
 * plane-change-free version of the same idea still applies — a velocity change made
 * where the orbital speed is low costs less.
 *
 * `rIntermediate` is the caller's choice and is not optimised here. The trade is
 * the point: `docs/PRODUCT.md` Appendix A's C11 contract saves 80.9 m/s and pays
 * 16.2 extra days for it, and the player is meant to feel that.
 *
 * At `rIntermediate = r2` the Δv is exactly the Hohmann Δv: the second ellipse
 * collapses onto the target circle, so the first two burns are the Hohmann pair and
 * the **third** burn is the one that vanishes. `twobody.test.ts` uses that as one of
 * the checks that the two functions agree.
 *
 * The *time of flight* does not collapse with it. Half of the second "ellipse" is
 * still half a revolution of the target circle, so the degenerate case is charged
 * half a period of `r2` more than the equivalent Hohmann transfer, before a burn
 * that costs nothing. That is left as it is rather than special-cased: a branch at
 * `rIntermediate = r2` would introduce a discontinuity at a boundary no real
 * transfer sits on, since every bi-elliptic worth flying has `r_b > r2`.
 *
 * @throws RangeError when `rIntermediate` is smaller than either radius. The
 * intermediate point is an apoapsis, so a value inside either circular orbit does
 * not describe this maneuver, and the formula would quietly return the Δv of a
 * different one.
 */
export const biEllipticTransfer = (
  r1: Metres,
  r2: Metres,
  rIntermediate: Metres,
  mu: number,
): BiEllipticTransfer => {
  requireRadius(r1, 'r1');
  requireRadius(r2, 'r2');
  requireRadius(rIntermediate, 'rIntermediate');
  if (rIntermediate < r1 || rIntermediate < r2) {
    throw new RangeError(
      `the intermediate radius is an apoapsis and must be at least as large as both circular ` +
        `radii, got ${String(rIntermediate)} m against ${String(r1)} m and ${String(r2)} m`,
    );
  }

  const firstEllipse = ((r1 + rIntermediate) / 2) as Metres;
  const secondEllipse = ((r2 + rIntermediate) / 2) as Metres;

  const firstBurn = Math.abs(visVivaSpeed(r1, firstEllipse, mu) - circularSpeed(r1, mu));
  const secondBurn = Math.abs(
    visVivaSpeed(rIntermediate, secondEllipse, mu) - visVivaSpeed(rIntermediate, firstEllipse, mu),
  );
  const thirdBurn = Math.abs(circularSpeed(r2, mu) - visVivaSpeed(r2, secondEllipse, mu));

  return {
    firstBurn: metresPerSec(firstBurn),
    secondBurn: metresPerSec(secondBurn),
    thirdBurn: metresPerSec(thirdBurn),
    totalDeltaV: metresPerSec(firstBurn + secondBurn + thirdBurn),
    timeOfFlight: seconds(
      Math.PI * (Math.sqrt(firstEllipse ** 3 / mu) + Math.sqrt(secondEllipse ** 3 / mu)),
    ),
  };
};
