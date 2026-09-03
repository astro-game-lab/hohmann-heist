/**
 * Objective evaluation — §6.4 and FR-106.
 *
 * Four of §6.4's five objective types: `reach_orbit`, `intercept`, `rendezvous` and
 * `soft_rendezvous`. **`station` is deliberately absent** — it is a mean-longitude and
 * drift-rate condition on a geostationary slot, it is first used by contract 07, and it
 * shares no machinery with the four here.
 *
 * Every tolerance these evaluators apply is a gameplay departure and lives in
 * `./tolerances.ts`, which carries the reasoning and the DEP-xx identifiers.
 */
export type { OrbitTolerance } from './tolerances.js';
export {
  ALTITUDE_FLOOR_M,
  COMOVING_REL_SPEED_MPS,
  INTERCEPT_MAX_RANGE_M,
  REACH_ORBIT_TOLERANCE,
  RENDEZVOUS_MAX_RANGE_M,
  RENDEZVOUS_MAX_REL_SPEED_MPS,
  SOFT_RENDEZVOUS_MAX_REL_SPEED_MPS,
} from './tolerances.js';

export type {
  ComparedElement,
  ElementComparison,
  ReachOrbitAchieved,
  ReachOrbitEvaluation,
  SkipReason,
} from './reach-orbit.js';
export { evaluateReachOrbit } from './reach-orbit.js';

export type {
  ProximityAchieved,
  ProximityCandidate,
  ProximityEvaluation,
  ProximityKind,
  ProximityTolerance,
} from './proximity.js';
export { evaluateProximity, targetArc, toleranceFor } from './proximity.js';

import type { ReachOrbitEvaluation } from './reach-orbit.js';
import type { ProximityEvaluation } from './proximity.js';

/** What any objective evaluation returns. Narrow on `kind`. */
export type ObjectiveEvaluation = ReachOrbitEvaluation | ProximityEvaluation;
