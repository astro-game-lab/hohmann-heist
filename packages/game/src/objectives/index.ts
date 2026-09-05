/**
 * Objective evaluation — §6.4 and FR-106.
 *
 * All five of §6.4's objective types: `reach_orbit`, `intercept`, `rendezvous`,
 * `soft_rendezvous` and `station`.
 *
 * They fall into three shapes rather than one, which is why they are three modules and
 * not a switch. `reach_orbit` compares element sets against a goal orbit. The three
 * proximity kinds search for a minimum of the separation between two bodies and differ
 * only in the tolerances applied afterwards. `station` has no second body at all: it asks
 * where the ship sits in the rotating frame and how fast it is sliding through it.
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
  STATION_MAX_DRIFT_RAD_PER_SEC,
  STATION_MAX_OFFSET_RAD,
} from './tolerances.js';

export type { StationAchieved, StationEvaluation, StationGoal } from './station.js';
export {
  defaultStationGoal,
  evaluateStation,
  slotTraverseSeconds,
  stationDrift,
} from './station.js';

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
import type { StationEvaluation } from './station.js';

/** What any objective evaluation returns. Narrow on `kind`. */
export type ObjectiveEvaluation = ReachOrbitEvaluation | ProximityEvaluation | StationEvaluation;

/**
 * Whether an evaluation is one of the three proximity kinds — an encounter with a second
 * body, and so something with a range, a relative speed and an epoch.
 *
 * A named predicate rather than `kind !== 'reach_orbit'` at each call site. That test was
 * true of the union when it had two members and silently became wrong when `station`
 * joined it: a station run has no closest approach, and reading `achieved.rangeM` off one
 * would have been `undefined` flowing into a flight-log entry. The compiler caught it
 * here; a predicate is what stops the next member of the union having to be caught at all.
 */
export const isProximityEvaluation = (
  evaluation: ObjectiveEvaluation,
): evaluation is ProximityEvaluation =>
  evaluation.kind === 'intercept' ||
  evaluation.kind === 'rendezvous' ||
  evaluation.kind === 'soft_rendezvous';
