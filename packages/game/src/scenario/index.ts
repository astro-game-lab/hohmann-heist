/**
 * The scenario format — FR-201, FR-202, and §11.5.
 *
 * `scenario-1.schema.json` is the source of truth. The TypeScript types and the
 * validator beside it are **generated** from it by `tools/schema/generate.mjs` and
 * committed; `pnpm schema:check` fails CI if either has drifted. Nothing here is
 * hand-written twice.
 */
export type { SchemaError, ScenarioError } from './errors.js';
export { childPointer, pointer, toScenarioError, toScenarioErrors } from './errors.js';

export type { LoadedObjective, LoadedScenario, LoadedTarget, LoadResult } from './load.js';
export { isProximityObjective } from './load.js';
export { SCENARIO_VERSION, loadScenario, parseScenario } from './load.js';

export type {
  Assist,
  Constraint,
  Objective as ScenarioObjective,
  OrbitGoal,
  Par,
  Scenario,
  StateSpec,
  Target,
} from './types.generated.js';
