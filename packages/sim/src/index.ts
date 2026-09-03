/**
 * `@hh/sim` — plan, timeline, world state, and deterministic evaluation.
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
export const PACKAGE = '@hh/sim' as const;

export {
  DELTA_V_COUNTS_PER_MPS,
  DELTA_V_QUANTUM_MPS,
  EPOCH_QUANTUM_S,
  EPOCH_TICKS_PER_SECOND,
  fromDeltaVCounts,
  fromEpochTicks,
  toDeltaVCounts,
  toEpochTicks,
} from './quantise.js';

export type { DeltaVCounts, ManeuverNode, ManeuverNodeSpec, Plan } from './plan.js';
export {
  createManeuverNode,
  createPlan,
  EMPTY_PLAN,
  maneuverNodeFromCounts,
  MINIMUM_NODE_SPACING_S,
  MINIMUM_NODE_SPACING_TICKS,
} from './plan.js';

export { applyImpulse } from './maneuver.js';

export type { ReplayClaim, ReplayContext, ReplayNode, ReplayV1 } from './replay.js';
export {
  canonicalJson,
  parseReplay,
  planFromReplay,
  replayFromPlan,
  REPLAY_SCHEMA_VERSION,
} from './replay.js';
