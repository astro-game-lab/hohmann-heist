/**
 * Three-dimensional vectors.
 *
 * Immutable readonly objects with free functions, not classes with methods.
 * Allocation is not a concern at this layer: propagation is analytic, so
 * evaluating a timeline is a handful of Kepler solves rather than thousands of
 * vector operations, and the frame budget has ample headroom.
 *
 * `Vec3` is generic over its element type so that `Vec3<Metres>` and
 * `Vec3<MetresPerSec>` are distinct to the compiler. Combined with naming the
 * frame in the variable (`r_eci_m`), that closes most of the gap that unit and
 * frame confusion would otherwise leave open.
 */
import type { Radians } from './brand.js';
import { radians } from './brand.js';

/** A 3-vector whose components share a unit. */
export interface Vec3<T extends number = number> {
  readonly x: T;
  readonly y: T;
  readonly z: T;
}

/** Construct a vector from components. */
export const vec3 = <T extends number>(x: T, y: T, z: T): Vec3<T> => ({ x, y, z });

/** The zero vector. */
export const ZERO: Vec3 = Object.freeze({ x: 0, y: 0, z: 0 });

/** Componentwise sum. */
export const add = <T extends number>(a: Vec3<T>, b: Vec3<T>): Vec3<T> =>
  ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }) as Vec3<T>;

/** Componentwise difference, `a - b`. */
export const sub = <T extends number>(a: Vec3<T>, b: Vec3<T>): Vec3<T> =>
  ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }) as Vec3<T>;

/** Multiply every component by a scalar. The unit is unchanged. */
export const scale = <T extends number>(v: Vec3<T>, s: number): Vec3<T> =>
  ({ x: v.x * s, y: v.y * s, z: v.z * s }) as Vec3<T>;

/** Negate. */
export const negate = <T extends number>(v: Vec3<T>): Vec3<T> => scale(v, -1);

/**
 * Dot product.
 *
 * Takes vectors of any units, because combining different ones is meaningful — the
 * flight-path angle comes from `r · v`, which mixes metres with metres per second.
 * The result's unit is the product of the inputs', which this package does not
 * model, so it is returned plain.
 */
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

/**
 * Cross product.
 *
 * Mixed units for the same reason as `dot`: specific angular momentum is `r x v`,
 * in m² s⁻¹. The product unit is not modelled, so the result is plain.
 */
export const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

/** Squared magnitude. Cheaper than `norm` and enough for comparisons. */
export const normSq = <T extends number>(v: Vec3<T>): number => v.x * v.x + v.y * v.y + v.z * v.z;

/** Magnitude, in the same unit as the components. */
export const norm = <T extends number>(v: Vec3<T>): T => Math.hypot(v.x, v.y, v.z) as T;

/** Distance between two points, in the same unit as the components. */
export const distance = <T extends number>(a: Vec3<T>, b: Vec3<T>): T => norm(sub(a, b));

/**
 * Unit vector in the same direction. Dimensionless, hence `Vec3<number>`.
 *
 * Throws on the zero vector rather than returning `NaN` components that would
 * travel silently into a trajectory.
 */
export const normalize = <T extends number>(v: Vec3<T>): Vec3 => {
  const m = Math.hypot(v.x, v.y, v.z);
  if (m === 0) throw new RangeError('cannot normalize the zero vector');
  return { x: v.x / m, y: v.y / m, z: v.z / m };
};

/**
 * Angle between two vectors, in `[0, π]`.
 *
 * Uses `atan2(|a × b|, a · b)` rather than `acos(a · b / |a||b|)`. The `acos` form
 * loses precision catastrophically for nearly-parallel vectors — the derivative of
 * `acos` is unbounded at ±1 — and that is exactly the case that matters when
 * comparing orbit normals or checking alignment. `Math.acos` is banned by lint
 * (NFR-006); this is the function that exists so nobody needs it.
 */
export const angleBetween = (a: Vec3, b: Vec3): Radians =>
  radians(Math.atan2(norm(cross(a, b)), dot(a, b)));

/** Linear interpolation, `t = 0` giving `a` and `t = 1` giving `b`. */
export const lerp = <T extends number>(a: Vec3<T>, b: Vec3<T>, t: number): Vec3<T> =>
  add(a, scale(sub(b, a), t));

/** Exact componentwise equality. For floating-point comparison use `approxEquals`. */
export const equals = <T extends number>(a: Vec3<T>, b: Vec3<T>): boolean =>
  a.x === b.x && a.y === b.y && a.z === b.z;

/** Componentwise equality within an absolute tolerance. */
export const approxEquals = <T extends number>(a: Vec3<T>, b: Vec3<T>, tol: number): boolean =>
  Math.abs(a.x - b.x) <= tol && Math.abs(a.y - b.y) <= tol && Math.abs(a.z - b.z) <= tol;

/** True when every component is finite. */
export const isFinite_ = <T extends number>(v: Vec3<T>): boolean =>
  Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

/** As a plain array, row order `[x, y, z]`. */
export const toArray = <T extends number>(v: Vec3<T>): [number, number, number] => [v.x, v.y, v.z];

/** From a plain array, `[x, y, z]`. */
export const fromArray = <T extends number>(a: readonly [T, T, T]): Vec3<T> => ({
  x: a[0],
  y: a[1],
  z: a[2],
});
