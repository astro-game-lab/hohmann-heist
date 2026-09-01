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

/** Package identity. Placeholder until this package holds real code. */
export const PACKAGE = '@hh/math' as const;
