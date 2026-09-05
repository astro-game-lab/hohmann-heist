/**
 * Turning a plan into everything the planner draws — FR-104, NFR-011, §6.4, §6.5.
 *
 * Every region of §8.3.4 is a view of one evaluation: the HUD's Δv bar and the timeline's
 * bands are `Legality`'s constraints, the closest-approach block is the objective's, and
 * the orbit view is the timeline itself. Computing them separately per region would mean
 * four passes over the same arcs and four chances for them to disagree about which plan
 * they were looking at, so they are produced together, once per plan change.
 *
 * ## Two paths, and the reason there are two
 *
 * NFR-011 gives a drag frame 16.7 ms, and §11.9 budgets 8 ms of it to the geometry
 * pipeline. A full evaluation does not fit: the proximity search walks every arc looking
 * for stationary points of the separation, which is the most expensive thing in the
 * frame and is *also* the thing whose answer barely moves while a node is being dragged.
 *
 * So a drag takes {@link evaluateDrag} — incremental timeline, constraints, no objective —
 * and the release takes {@link evaluatePlan}. This is not an optimisation invented here:
 * `evaluateLegality`'s `objective` parameter is nullable precisely for this case, and its
 * docstring says so — *"during a drag, where the cheap checks matter and `L6` can wait
 * for the frame to settle"*. `null` produces no `L6`, which is correct rather than
 * convenient: "not evaluated" is not "not met".
 *
 * The incremental half is `withPlan`, which recomputes arcs *k…n* and carries the rest by
 * reference (FR-104). It is what `sim/timeline/drag-reevaluate-8-nodes` and
 * `sim+render/frame/drag` already measure against the committed baseline, so the drag
 * path in this file is the path those benchmarks describe — and keeping it that way is
 * why the drag branch calls `withPlan` rather than rebuilding and trusting it to be fast.
 *
 * ## A plan that produces no timeline is a state, not an error
 *
 * `buildTimeline` returns rather than throws for a burn that leaves position and velocity
 * parallel and for a propagation that does not converge, and `evaluateLegality` has a
 * non-evaluable arm for exactly that. Nothing here turns either into an exception: the
 * planner has to keep rendering, and what it renders is the reason. The one thing that
 * *does* throw is a node outside the horizon, which is a caller bug rather than a plan a
 * player can author — the timeline's own epochs bound every edit this app makes.
 */
import type { LoadedScenario } from '@hh/game';
import {
  evaluateLegality,
  evaluateProximity,
  evaluateReachOrbit,
  evaluateStation,
  targetArc,
  type Legality,
  type ObjectiveEvaluation,
} from '@hh/game';
import type { Plan, Timeline, TimelineResult } from '@hh/sim';
import { buildTimeline, withPlan } from '@hh/sim';

/** One plan, judged. Every region reads from this and none of them re-derives it. */
export interface Evaluation {
  /** The raw result, so a caller can tell "no trajectory" from "an illegal one". */
  readonly result: TimelineResult;
  /** The timeline, or `null` when the plan produced none. */
  readonly timeline: Timeline | null;
  /** `null` on the drag path, and for a scenario whose objective this build cannot judge. */
  readonly objective: ObjectiveEvaluation | null;
  readonly legality: Legality;
}

/**
 * Evaluate the objective the scenario names.
 *
 * `station` is deliberately unreachable — `@hh/game` does not implement it and
 * `LoadedObjective` cannot carry it — so this is total over what a loaded scenario can
 * actually hold, and there is no default arm quietly returning `null` for an objective
 * that was simply forgotten.
 */
const judgeObjective = (
  scenario: LoadedScenario,
  timeline: Timeline,
): ObjectiveEvaluation | null => {
  const { objective } = scenario;
  if (objective.kind === 'reach_orbit') {
    return evaluateReachOrbit(timeline, objective.goal, objective.tolerance);
  }

  // `station` has no second body to be near: it asks where the ship sits in the rotating
  // frame and how fast it is sliding through the slot (#77, §6.4).
  if (objective.kind === 'station') {
    return evaluateStation(timeline, objective.goal);
  }

  const target = scenario.targets.find((candidate) => candidate.id === objective.targetId);
  // A missing target is a scenario the loader should have refused, so this is not a case
  // to render — but returning `null` beats throwing inside a frame, and `null` already
  // means "not evaluated" everywhere downstream.
  if (target === undefined) return null;

  return evaluateProximity(
    timeline,
    targetArc(target.state, scenario.startEpoch, scenario.horizon, scenario.mu),
    objective.kind,
    {},
    objective.tolerance,
  );
};

/** Build a timeline for `plan` from scratch. The entry path, and the path after a reset. */
export const buildFor = (scenario: LoadedScenario, plan: Plan): TimelineResult =>
  buildTimeline({
    startEpoch: scenario.startEpoch,
    initialState: scenario.ship.state,
    plan,
    horizon: scenario.horizon,
    mu: scenario.mu,
  });

/** Assemble an {@link Evaluation} from a result that has already been computed. */
const judge = (
  scenario: LoadedScenario,
  result: TimelineResult,
  withObjective: boolean,
): Evaluation => {
  if (!result.ok) {
    return {
      result,
      timeline: null,
      objective: null,
      legality: evaluateLegality(result, scenario.rules),
    };
  }

  const objective = withObjective ? judgeObjective(scenario, result.timeline) : null;
  return {
    result,
    timeline: result.timeline,
    objective,
    legality: evaluateLegality(result, scenario.rules, objective),
  };
};

/**
 * The full evaluation: timeline, objective, legality.
 *
 * What every settled state uses — entering the planner, releasing a drag, closing the
 * node editor, deleting a node. `previous` lets it take the incremental path when there
 * is a timeline to edit from; the answer is identical either way, because `withPlan` runs
 * the same fold over the same inputs as a rebuild.
 */
export const evaluatePlan = (
  scenario: LoadedScenario,
  plan: Plan,
  previous: Timeline | null = null,
): Evaluation =>
  judge(scenario, previous === null ? buildFor(scenario, plan) : withPlan(previous, plan), true);

/**
 * The drag evaluation: incremental timeline and constraints, no objective.
 *
 * See the docstring for why the objective is skipped rather than merely deferred. The
 * closest-approach block keeps showing its last settled value while a drag is in flight,
 * which is honest — it is labelled with the epoch it was computed for — and is what keeps
 * the frame inside NFR-011's budget for an 8-node plan.
 */
export const evaluateDrag = (
  scenario: LoadedScenario,
  plan: Plan,
  previous: Timeline,
): Evaluation => judge(scenario, withPlan(previous, plan), false);
