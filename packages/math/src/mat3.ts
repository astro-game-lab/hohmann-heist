/**
 * Three-by-three matrices, row-major.
 *
 * Carries what orbital element conversion actually needs. The perifocal-to-ECI
 * transform is a 3-1-3 Euler sequence — `Rz(Ω) Rx(i) Rz(ω)` — so the three axis
 * rotations plus multiplication are the whole requirement. There is no general
 * inverse here: every matrix this package produces is a rotation, and the inverse
 * of a rotation is its transpose.
 */
import type { Radians } from './brand.js';
import type { Vec3 } from './vec3.js';

/** Row-major 3×3 matrix: `[m00, m01, m02, m10, m11, m12, m20, m21, m22]`. */
export type Mat3 = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

/** The identity matrix. */
export const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

/** Matrix product, `a · b`. */
export const multiply = (a: Mat3, b: Mat3): Mat3 => [
  a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
  a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
  a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
  a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
  a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
  a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
  a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
  a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
  a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
];

/** Transpose. For a rotation this is also the inverse. */
export const transpose = (m: Mat3): Mat3 => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];

/** Apply the matrix to a vector. The vector's unit is preserved. */
export const apply = <T extends number>(m: Mat3, v: Vec3<T>): Vec3<T> =>
  ({
    x: m[0] * v.x + m[1] * v.y + m[2] * v.z,
    y: m[3] * v.x + m[4] * v.y + m[5] * v.z,
    z: m[6] * v.x + m[7] * v.y + m[8] * v.z,
  }) as Vec3<T>;

/** Determinant. Should be 1 for any rotation this package produces. */
export const determinant = (m: Mat3): number =>
  m[0] * (m[4] * m[8] - m[5] * m[7]) -
  m[1] * (m[3] * m[8] - m[5] * m[6]) +
  m[2] * (m[3] * m[7] - m[4] * m[6]);

/** Right-handed rotation of `angle` about the x-axis. */
export const rotationX = (angle: Radians): Mat3 => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [1, 0, 0, 0, c, -s, 0, s, c];
};

/** Right-handed rotation of `angle` about the y-axis. */
export const rotationY = (angle: Radians): Mat3 => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
};

/** Right-handed rotation of `angle` about the z-axis. */
export const rotationZ = (angle: Radians): Mat3 => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
};

/** Componentwise equality within an absolute tolerance. */
export const approxEquals = (a: Mat3, b: Mat3, tol: number): boolean =>
  a.every((v, i) => Math.abs(v - (b[i] ?? Number.NaN)) <= tol);
