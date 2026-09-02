/**
 * `@hh/propagation` — Keplerian arc propagation, event finding, and the DOP853 test oracle.
 *
 * **Layer: core.** Must not import from `@hh/game`, `@hh/render`, `@hh/ui`, or `apps/*`,
 * and must not reference `document`, `window`, `Date.now`, `performance.now`,
 * `Math.random`, `fetch`, or `process`. It runs unchanged under Node, a browser, and a
 * Cloudflare Worker.
 *
 * See `docs/PRODUCT.md` §11.1 (architecture and the layering rule) and §11.2
 * (package responsibilities).
 *
 * **The DOP853 oracle is deliberately absent from this barrel.** FR-009 permits a
 * numerical integrator to exist and forbids using it to advance game state, so it
 * lives behind the `@hh/propagation/oracle` subpath and `.dependency-cruiser.cjs`
 * fails the build on any import of it from a file that is not a test. Importing it
 * here would hand every consumer of this package the one thing the requirement
 * exists to keep away from them.
 */

/** Package identity. */
export const PACKAGE = '@hh/propagation' as const;

export type { PropagationMethod, PropagationOptions, PropagationResult } from './universal.js';
export { propagate } from './universal.js';

export type { Arc, ArcSpec } from './arc.js';
export {
  containsEpoch,
  createArc,
  duration,
  stateAt,
  withEndEpoch,
  withStartEpoch,
  withState,
} from './arc.js';
