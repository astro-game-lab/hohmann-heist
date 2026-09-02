/**
 * Angle handling.
 *
 * This repository normalises to `[0, 2π)`, everywhere, without exception. Every
 * function here that returns an angle returns it normalised, and every function
 * that consumes one accepts any real value.
 */
import type { Radians } from './brand.js';
import { radians } from './brand.js';

/** A full turn, 2π. */
export const TAU = 2 * Math.PI;

/** Degrees per radian. Conversion belongs at the UI and file-format boundary. */
const DEG_PER_RAD = 180 / Math.PI;

/**
 * Normalise an angle to `[0, 2π)`.
 *
 * The naive `((x % TAU) + TAU) % TAU` has a well-known trap: for a very small
 * negative `x`, `x % TAU` is a small negative number, and adding `TAU` rounds to
 * exactly `TAU` — landing outside the half-open interval the function promises.
 * The explicit guard below is why that cannot happen here.
 */
export const normalize = (angle: number): Radians => {
  const r = angle % TAU;
  if (r >= 0) return radians(r);
  const shifted = r + TAU;
  // Guard the rounding case described above.
  return radians(shifted < TAU ? shifted : 0);
};

/**
 * Signed shortest separation from `a` to `b`, in `(-π, π]`.
 *
 * Positive means `b` is counter-clockwise of `a`.
 */
export const angularDifference = (a: number, b: number): Radians => {
  const d = normalize(b - a);
  return radians(d > Math.PI ? d - TAU : d);
};

/** Convert degrees to radians. Boundary use only. */
export const fromDegrees = (deg: number): Radians => normalize(deg / DEG_PER_RAD);

/** Convert radians to degrees, in `[0, 360)`. Boundary use only. */
export const toDegrees = (rad: Radians): number => normalize(rad) * DEG_PER_RAD;
