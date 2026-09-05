/**
 * Evaluating a contract — the one definition of what a solution *costs* and when it
 * *arrives*, shared by the solver and by the tests that check the solver.
 *
 * §6.7 defines par as two numbers: `par_dv`, "the delta-v of the reference optimal
 * solution", and `par_time`, "the mission elapsed time of that same solution". §13.4 then
 * asserts a stored replay against both to ±0.5%. Those two statements are only about the
 * same thing if the harness that writes the numbers and the suite that checks them agree
 * exactly on how they are measured — so they are measured here, once, and both import it.
 * `tools/goldens` is arranged the same way and says why: the cheapest guarantee that a
 * writer and a comparator agree is for them to be the same code.
 *
 * ## What the two numbers mean, precisely
 *
 * - **Δv** is `totalDeltaV` from `@hh/game` — the sum of the burn magnitudes, the same
 *   quantity the budget constraint caps (DEP-02). Not an integral of thrust, because
 *   there is no thrust: DEP-01 makes every burn instantaneous.
 * - **Time** is the mission elapsed time at which the *objective is met*, not the epoch
 *   of the last burn and not the horizon. For a proximity objective that is the first
 *   close approach inside tolerance; for `reach_orbit` it is the start of the final arc,
 *   which is when the ship is on the goal orbit and stays there. Both come from the
 *   evaluator's own `atEpoch`, so neither is re-derived here.
 *
 * ## Nothing in this module knows about any particular contract
 *
 * It takes a `LoadedScenario` and a `Plan` and reports what happened. The strategy that
 * *invents* a plan is `tools/pars/solve.ts`, and it is per objective kind rather than per
 * contract, for the reason `packages/game/src/scenario/load.ts` gives at length: the
 * moment a contract needs a special case in code, contracts stop being data.
 */
import { metAt } from '@hh/astro';
import type { Legality, LoadResult, LoadedScenario, ObjectiveEvaluation } from '@hh/game';
import {
  evaluateLegality,
  evaluateProximity,
  evaluateReachOrbit,
  evaluateStation,
  isProximityEvaluation,
  parseScenario,
  targetArc,
  totalDeltaV,
} from '@hh/game';
import type { Plan, ReplayV1, Timeline, TimelineResult } from '@hh/sim';
import { buildTimeline, canonicalJson, parseReplay, planFromReplay, replayFromPlan } from '@hh/sim';
import { createCatalogue } from '@hh/ui';

import type { ContractFile } from './scenarios.js';

/**
 * Engine major version stamped into a reference replay (§11.6's `e`, §14.4).
 *
 * A build-level fact rather than a simulation one, which is why `@hh/sim` takes it as a
 * parameter instead of owning it. It has no home in shipped code yet — the debrief and
 * the leaderboard are the first things that need one, and both arrive with the replay
 * codec (#148, M6). It lives here until then, and §14.4's rule applies to it from now:
 * it increments only when a physics result changes in a way that could alter an outcome,
 * and that increment requires a `docs/PHYSICS.md` update in the same pull request.
 */
export const ENGINE_MAJOR = 1;

/** Resolves a loader error's catalogue key to a sentence, so a failure reads. */
const catalogue = createCatalogue();

/** Validate and interpret one file. Thin, so the caller can assert on the failure. */
export const loadContract = (file: ContractFile): LoadResult => parseScenario(file.document);

/** Every loader error as one message, each with its JSON pointer. */
export const describeErrors = (result: Extract<LoadResult, { ok: false }>): string =>
  result.errors
    .map((error) => `  ${error.path}: ${catalogue.resolveMessage(error.message)}`)
    .join('\n');

/**
 * Load, or throw with every field-level error at once.
 *
 * For callers that cannot proceed without a scenario — the solver, chiefly. The content
 * suite does not use this: an invalid document is one of its seven checks, and a check
 * that throws before it can report is not a check.
 */
export const requireContract = (file: ContractFile): LoadedScenario => {
  const result = loadContract(file);
  if (!result.ok) {
    throw new Error(`${file.relativePath} is not a valid scenario:\n${describeErrors(result)}`);
  }
  return result.scenario;
};

/** Evaluate a plan against a contract, in exactly the shape `buildTimeline` wants. */
export const timelineFor = (scenario: LoadedScenario, plan: Plan): TimelineResult =>
  buildTimeline({
    startEpoch: scenario.startEpoch,
    initialState: scenario.ship.state,
    plan,
    horizon: scenario.horizon,
    mu: scenario.mu,
  });

/** The objective evaluation for whichever kind this contract carries. */
export const evaluateObjective = (
  scenario: LoadedScenario,
  timeline: Timeline,
): ObjectiveEvaluation => {
  const objective = scenario.objective;
  if (objective.kind === 'reach_orbit') {
    return evaluateReachOrbit(timeline, objective.goal, objective.tolerance);
  }
  // `station` names no target — it is a condition on the ship alone (#77, §6.4).
  if (objective.kind === 'station') {
    return evaluateStation(timeline, objective.goal);
  }
  const target = scenario.targets.find((candidate) => candidate.id === objective.targetId);
  if (target === undefined) {
    // The loader rejects an objective naming a target the scenario does not define, so
    // this is unreachable through `requireContract`. Checked rather than asserted away:
    // `noUncheckedIndexedAccess` makes the narrowing explicit either way, and a thrown
    // message beats a `find` result used as though it could not be `undefined`.
    throw new Error(
      `${scenario.id}: objective names target "${objective.targetId}", which the scenario ` +
        'does not define. The loader should have refused this document.',
    );
  }
  return evaluateProximity(
    timeline,
    targetArc(target.state, scenario.startEpoch, scenario.horizon, scenario.mu),
    objective.kind,
    {},
    objective.tolerance,
  );
};

/** What a plan achieved, in the terms par is stated in. */
export interface ContractOutcome {
  readonly timeline: Timeline;
  readonly objective: ObjectiveEvaluation;
  /** Whether the objective was met at all. */
  readonly met: boolean;
  /** Sum of burn magnitudes, m/s. `par.dv_mps`'s quantity. */
  readonly dvMps: number;
  /** MET at which the objective was met, seconds; `null` when it was not. */
  readonly metSeconds: number | null;
  readonly burns: number;
  readonly legality: Legality;
  /**
   * Closest separation achieved, metres — a proximity objective only, `null` otherwise.
   * Reported so a derivation can state how much room the reference solution has against
   * its tolerance rather than only that it fits.
   */
  readonly closestRangeM: number | null;
}

/** Evaluate a plan the way the game does, and report it in par's terms. */
export const outcomeFor = (scenario: LoadedScenario, plan: Plan): ContractOutcome | null => {
  const result = timelineFor(scenario, plan);
  // A plan the engine cannot evaluate is not a candidate. `null` rather than a throw:
  // the solver walks a grid, and a grid point that produces a rectilinear or
  // non-convergent trajectory is an ordinary thing to skip, not an error to report.
  if (!result.ok) return null;

  const { timeline } = result;
  const objective = evaluateObjective(scenario, timeline);
  return {
    timeline,
    objective,
    met: objective.met,
    dvMps: totalDeltaV(timeline),
    // `reach_orbit` always carries an `atEpoch` — the final arc's start — whether or not
    // the goal was reached, so meeting the objective is checked before reading it. Par
    // is the time of a *solution*; an unmet objective has no arrival time to state.
    metSeconds:
      !objective.met || objective.atEpoch === null
        ? null
        : metAt(scenario.startEpoch, objective.atEpoch),
    burns: plan.nodes.length,
    legality: evaluateLegality(result, scenario.rules, objective),
    // Only a proximity objective has a closest approach. `reach_orbit` and `station`
    // report `null` rather than a number that would mean nothing (#77).
    closestRangeM: isProximityEvaluation(objective) ? objective.achieved.rangeM : null,
  };
};

/**
 * Whether an outcome is something a contract may publish as its par.
 *
 * Both halves matter. The objective has to be met, or it is not a solution; and commit
 * has to be allowed, or it is a solution the game would refuse to let a player run. `L6`
 * — objective not met — is a *warning* and never blocks commit, which is why the two are
 * asserted separately rather than through `commitAllowed` alone.
 */
export const isReferenceSolution = (outcome: ContractOutcome): boolean =>
  outcome.met && outcome.legality.commitAllowed;

/** The claim §11.6 stores in a replay: Δv in tenths of m/s, time in whole seconds. */
export const claimFor = (
  outcome: ContractOutcome,
): { readonly dv: number; readonly t: number } => ({
  dv: Math.round(outcome.dvMps * 10),
  t: Math.round(outcome.metSeconds ?? 0),
});

/**
 * A plan as the string a scenario's `par.referenceReplay` stores.
 *
 * **Canonical JSON, not §11.6's `base64url(deflateRaw(...))` code.** The compressed form
 * is the replay *codec*, which is #148 in M6; what exists today is `canonicalJson`, and
 * it is exactly the bytes that codec will compress. Storing them uncompressed means the
 * field is readable by `@hh/sim` in the browser right now, with no new code and no
 * `CompressionStream` dependency, and the file grows by a few hundred bytes against
 * §8.3.3's 8 kB budget. When #148 lands this becomes the compressed code and
 * {@link planForReplay} learns to accept both.
 */
export const replayTextFor = (scenario: LoadedScenario, outcome: ContractOutcome): string =>
  canonicalJson(
    replayFromPlan(outcome.timeline.plan, {
      scenarioId: scenario.id,
      engineMajor: ENGINE_MAJOR,
      startEpoch: scenario.startEpoch,
      // No assists. A solver does not use snapping or a targeting computer, and a
      // reference solution recorded as though it had would misreport what beating par
      // requires on the Clean board (§6.7).
      assists: 0,
      claim: claimFor(outcome),
    }),
  );

/** A stored replay, parsed. Throws with the codec's own message on a corrupt one. */
export const parseStoredReplay = (text: string): ReplayV1 => parseReplay(text);

/** The plan a stored replay describes, rebuilt against this contract's start epoch. */
export const planForReplay = (scenario: LoadedScenario, replay: ReplayV1): Plan =>
  planFromReplay(replay, scenario.startEpoch);
