/**
 * `@hh/astro` — constants, time, frames, orbital elements, Kepler and Lambert solvers.
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
export const PACKAGE = '@hh/astro' as const;

export { AU, J2_EARTH, MU_EARTH, OMEGA_EARTH, R_EARTH_EQ, R_GEO } from './constants.js';
