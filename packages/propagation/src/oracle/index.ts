/**
 * `@hh/propagation/oracle` — the numerical validation oracle.
 *
 * **Not part of `@hh/propagation`'s public surface, and deliberately so.** FR-009
 * forbids advancing game state with a numerical integrator, so this is reachable
 * only through this subpath and `.dependency-cruiser.cjs` rejects any import of it
 * from a file that is not a test. See `dop853.ts` for why.
 */
export type { IntegrationOptions, IntegrationResult } from './dop853.js';
export { TABLEAU, integrate } from './dop853.js';
