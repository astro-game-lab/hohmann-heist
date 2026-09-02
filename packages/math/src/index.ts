/**
 * `@hh/math` — vectors, matrices, angles, root finders, and the seeded PRNG.
 *
 * **Layer: core.** Must not import from `@hh/game`, `@hh/render`, `@hh/ui`, or `apps/*`,
 * and must not reference `document`, `window`, `Date.now`, `performance.now`,
 * `Math.random`, `fetch`, or `process`. It runs unchanged under Node, a browser, and a
 * Cloudflare Worker.
 *
 * See `docs/PRODUCT.md` §11.1 (architecture and the layering rule) and §11.2
 * (package responsibilities).
 */

/** Package identity. */
export const PACKAGE = '@hh/math' as const;

export type { Brand, Kilograms, Metres, MetresPerSec, Radians, Seconds } from './brand.js';
export { kilograms, metres, metresPerSec, radians, seconds, unbrand } from './brand.js';

export type { Vec3 } from './vec3.js';
export * as V from './vec3.js';

export type { Mat3 } from './mat3.js';
export * as M from './mat3.js';

export { angularDifference, fromDegrees, normalize, TAU, toDegrees } from './angle.js';

export type { RootOptions, RootResult } from './root.js';
export { bisect, brent } from './root.js';

export type { Rng } from './rng.js';
export { cloneRng, createRng, nextFloat, nextInt, nextRange, nextUint32 } from './rng.js';
