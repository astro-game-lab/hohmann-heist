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

export type { ConicClock, ConicGeometry, EpochInterval, EventOptions } from './events.js';
export { DEFAULT_MAX_ITERATIONS, DEFAULT_TOLERANCE_SECONDS } from './events.js';

export type { ApsisEvent, ApsisKind } from './apsis.js';
export { APSIS_ECCENTRICITY_FLOOR, findApsisCrossings } from './apsis.js';

export type { RevolutionEvent } from './revolution.js';
export { findRevolutions } from './revolution.js';

export type { ShellCrossing, ShellCrossingDirection } from './shell.js';
export { SHELL_CIRCULAR_FLOOR, findShellCrossings, findShellIntervals } from './shell.js';

export type { ApproachBoundary, CloseApproach } from './approach.js';
export {
  DEFAULT_APPROACH_SAMPLES_PER_REVOLUTION,
  findCloseApproaches,
  findClosestApproach,
} from './approach.js';

export type { GroundStation } from './station.js';
export {
  DEFAULT_STATION_SAMPLES_PER_REVOLUTION,
  elevationOf,
  findVisibilityIntervals,
  stationPositionAt,
} from './station.js';

export { DEFAULT_UMBRA_SAMPLES_PER_REVOLUTION, findUmbraIntervals } from './umbra.js';
