/**
 * `@hh/game` — rules, scenarios, objectives, scoring — and every deliberate departure from the physics.
 *
 * **Layer: above the core.** May depend on the core packages; the core may never depend on
 * this one. Dependencies point one way: render → game → sim.
 *
 * See `docs/PRODUCT.md` §11.1 (architecture and the layering rule) and §11.2
 * (package responsibilities).
 *
 * ## What is here
 *
 * The evaluation surface: given a timeline and a contract, what did the player achieve,
 * what rules did they break, and may they commit. Everything in it is a pure function —
 * no DOM, no clock, no randomness — so the whole package runs under Node in tests and
 * would run unchanged in a Worker.
 *
 * It also holds the **message keys** every rule emits. This package never builds a
 * sentence: it returns a catalogue key and its parameters, and `@hh/ui` turns that into
 * text (FR-910). That is why nothing here imports `@hh/ui`, and why the two key sets
 * are cross-checked by the compiler rather than by hope.
 */

/** Package identity. */
export const PACKAGE = '@hh/game' as const;

export type {
  AboveCoreDeparture,
  CoreDeparture,
  Departure,
  DepartureId,
  DepartureStatus,
  DepartureVisibility,
} from './departures.js';
export {
  ABOVE_CORE_PREFIXES,
  CORE_PREFIXES,
  DEPARTURES,
  departureById,
  isAboveCore,
  isCore,
  playerVisibleDepartures,
} from './departures.js';

export type {
  GameMessage,
  GameMessageKey,
  GameMessageOf,
  GameMessageParams,
  MessageParams,
  MessageParamValue,
} from './messages.js';
export { NO_PARAMS, gameMessage } from './messages.js';

export type { AssistEffect, AssistId, AssistSpec, AssistState, MedalCap } from './assists.js';
export {
  ASSISTS,
  ASSIST_IDS,
  blindModifier,
  cappingAssists,
  cleanEligible,
  decodeAssists,
  defaultAssistState,
  encodeAssists,
  medalCap,
  restrictToAllowed,
} from './assists.js';

export * from './objectives/index.js';
export * from './constraints/index.js';

export type { FlightLogEntry, FlightLogInput, FlightLogKind } from './flight-log.js';
export { buildFlightLog } from './flight-log.js';

export type {
  Medal,
  Outcome,
  OutcomeFailure,
  OutcomeInput,
  ParDelta,
  ParValues,
} from './outcome.js';
export {
  SCORE_DELTA_V_QUANTUM_MPS,
  SCORE_TIME_QUANTUM_S,
  evaluateOutcome,
  toScoreDeltaV,
  toScoreTime,
} from './outcome.js';

export type {
  Legality,
  LegalityCode,
  LegalityConstraints,
  LegalityReason,
  LegalityRules,
} from './legality.js';
export { evaluateLegality } from './legality.js';

export type { PlanEdit } from './plan-edits.js';
export { addNode, componentsOf, deleteNode, moveNode, setNodeDeltaV } from './plan-edits.js';

export type { SnapResult } from './snap.js';
export { SNAP_WINDOW_SECONDS, snapToApsis, snapToApsisOnArc, snapToNamedApsis } from './snap.js';

export * from './scenario/index.js';
