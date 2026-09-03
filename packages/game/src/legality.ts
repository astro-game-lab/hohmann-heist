/**
 * Plan legality — FR-108 and §6.4.
 *
 * | Code | Condition | Blocks commit |
 * | --- | --- | --- |
 * | `L1` | `Σ∣Δv∣` > budget | yes |
 * | `L2` | any trajectory point below the altitude floor | yes |
 * | `L3` | the plan extends past the deadline | yes |
 * | `L4` | any arc is open — hyperbolic, parabolic, or escaping | yes |
 * | `L5` | two nodes within the minimum spacing | yes |
 * | `L6` | the objective is not met anywhere in the timeline | **no** |
 *
 * ## `L6` is a warning, and that is a design decision rather than an oversight
 *
 * §6.4: *"Committing a plan you know will fail is a legitimate way to learn, and the
 * debrief for a near-miss is one of the best teaching moments the game has."* So `L6`
 * is reported, shown, and never allowed to disable *Commit*. `legality.test.ts` asserts
 * it directly rather than leaving it to be inferred from the absence of a branch,
 * because a `blocking: true` typo here would quietly remove the most important thing
 * the failure loop does.
 *
 * ## All failures at once
 *
 * Every applicable rule is evaluated on every call and every failure is returned
 * together. Reporting the first one and stopping would make a player fix five problems
 * in five commits, discovering each only after solving the last — which is the exact
 * shape of the feedback loop §6.5 exists to prevent.
 *
 * ## Reasons are keys, not sentences
 *
 * Each reason carries a `GameMessage`: a catalogue key and its parameters (FR-910,
 * NFR-028). "Over budget by 24 m/s" is `legality.l1.overBudget` with `excessMps: 24`,
 * and the wording — and the number formatting, and the word order — belong to the
 * catalogue in `@hh/ui`. Every reason carries its epoch where it has one, so `L2` can
 * be quoted as *"at T+02:14"* without the caller hunting for the interval it came from.
 *
 * ## `L5` cannot be reached through `createPlan`, and is checked anyway
 *
 * `@hh/sim`'s `createPlan` already refuses nodes closer than `MINIMUM_NODE_SPACING_S`,
 * throwing rather than returning — so a `Plan` **value** cannot violate `L5`, and this
 * check cannot fire for a plan built the ordinary way.
 *
 * It stays for two reasons. Legality's contract is over the plan as data, and a plan
 * arriving from a replay code, a scenario's reference solution, or a future editor is
 * data before it is a `Plan`; a rule that exists only in a constructor is a rule that
 * is missing wherever the constructor is not. And §6.4 lists `L5` as a legality reason
 * with a player-facing message — *"Merge these burns"* — which is a statement that the
 * planner is expected to *show* this, not crash on it. The test builds the illegal plan
 * by assembling the node array directly, which is the only way to reach it, and that is
 * itself the evidence for the claim in this paragraph.
 *
 * ## A plan with no timeline is not "illegal"
 *
 * `buildTimeline` returns rather than throws for two data-dependent failures: a burn
 * that leaves position and velocity parallel, and a propagation that does not converge.
 * Neither produces a trajectory, so there is nothing for `L1`–`L6` to be evaluated
 * against, and answering "illegal, reason L4" would be inventing a verdict.
 * {@link Legality} therefore has a non-evaluable case with its own message. *Commit* is
 * disabled, as it must be — but the reason says what actually happened.
 */
import type { Epoch } from '@hh/astro';
import { metAt } from '@hh/astro';
import type { Plan, Timeline, TimelineFailure, TimelineResult } from '@hh/sim';
import { MINIMUM_NODE_SPACING_S } from '@hh/sim';

import type {
  AltitudeFloorEvaluation,
  BudgetEvaluation,
  ConstraintViolation,
  DeadlineEvaluation,
} from './constraints/index.js';
import { evaluateAltitudeFloor, evaluateBudget, evaluateDeadline } from './constraints/index.js';
import type { GameMessage } from './messages.js';
import { NO_PARAMS, gameMessage } from './messages.js';
import type { ObjectiveEvaluation } from './objectives/index.js';

/** §6.4's legality codes. */
export type LegalityCode = 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6';

/** One reason a plan is illegal, or — for `L6` — merely unwise. */
export interface LegalityReason {
  readonly code: LegalityCode;
  /** Whether this reason disables *Commit*. `false` for `L6` and nothing else. */
  readonly blocking: boolean;
  /** A catalogue key and its parameters. Never a constructed string. */
  readonly message: GameMessage;
  /** Where on the timeline this happened, or `null` when the reason has no epoch. */
  readonly epoch: Epoch | null;
  /** Spans to shade on the timeline. Empty for reasons that are not intervals. */
  readonly intervals: readonly ConstraintViolation[];
}

/** The contract's numbers, as legality needs them. */
export interface LegalityRules {
  /** Cap on `Σ∣Δv∣`, in metres per second. */
  readonly budgetMps: number;
  /** Cap on mission elapsed time, in seconds. */
  readonly deadlineSeconds: number;
  /** Altitude floor in metres. Defaults to DEP-08's 100 km. */
  readonly floorAltitudeM?: number;
}

/** The constraint evaluations legality ran, so a caller need not repeat them. */
export interface LegalityConstraints {
  readonly budget: BudgetEvaluation;
  readonly deadline: DeadlineEvaluation;
  readonly altitudeFloor: AltitudeFloorEvaluation;
}

export type Legality =
  | {
      /** There is a trajectory, and it was judged. */
      readonly evaluable: true;
      readonly commitAllowed: boolean;
      readonly reasons: readonly LegalityReason[];
      readonly constraints: LegalityConstraints;
    }
  | {
      /** The plan produced no trajectory, so there was nothing to judge. */
      readonly evaluable: false;
      readonly commitAllowed: false;
      readonly reason: GameMessage;
      readonly failure: TimelineFailure;
    };

/** `L1` — over budget. */
const checkBudget = (budget: BudgetEvaluation): LegalityReason | null => {
  if (budget.violations.length === 0) return null;
  return {
    code: 'L1',
    blocking: true,
    message: gameMessage('legality.l1.overBudget', {
      usedMps: budget.usedMps,
      budgetMps: budget.budgetMps,
      excessMps: budget.usedMps - budget.budgetMps,
    }),
    epoch: budget.violations[0]?.start ?? null,
    intervals: budget.violations,
  };
};

/** `L2` — below the altitude floor. */
const checkAltitudeFloor = (
  floor: AltitudeFloorEvaluation,
  startEpoch: Epoch,
): LegalityReason | null => {
  const first = floor.violations[0];
  if (first === undefined) return null;
  return {
    code: 'L2',
    blocking: true,
    message: gameMessage('legality.l2.belowAltitudeFloor', {
      floorAltitudeM: floor.floorAltitudeM,
      metSeconds: metAt(startEpoch, first.start),
      intervalCount: floor.violations.length,
    }),
    epoch: first.start,
    intervals: floor.violations,
  };
};

/** `L3` — past the deadline. */
const checkDeadline = (deadline: DeadlineEvaluation): LegalityReason | null => {
  const first = deadline.violations[0];
  if (first === undefined || deadline.lastBurnMetSeconds === null) return null;
  return {
    code: 'L3',
    blocking: true,
    message: gameMessage('legality.l3.pastDeadline', {
      metSeconds: deadline.lastBurnMetSeconds,
      deadlineSeconds: deadline.deadlineSeconds,
      overSeconds: deadline.overrunSeconds,
    }),
    epoch: first.start,
    intervals: deadline.violations,
  };
};

/**
 * `L4` — an arc that is not a closed orbit.
 *
 * The test is on eccentricity rather than on energy or on apoapsis radius. All three
 * say the same thing about the same conic, and `e` is the one the element set carries
 * directly: `@hh/propagation`'s arcs cache their elements, so this costs a comparison
 * rather than another `√(μ/…)`. `e ≥ 1` covers the parabolic case as well as the
 * hyperbolic one, which matters because a parabolic arc has an infinite `a` and would
 * pass a naive apoapsis test by arithmetic accident.
 *
 * Only the first open arc is reported. Once the spacecraft is on an escape trajectory
 * every arc after it is open too, and five identical reasons is not five problems.
 */
const checkOpenArcs = (timeline: Timeline): LegalityReason | null => {
  const index = timeline.arcs.findIndex((arc) => arc.elements.eccentricity >= 1);
  const arc = index === -1 ? undefined : timeline.arcs[index];
  if (arc === undefined) return null;
  return {
    code: 'L4',
    blocking: true,
    message: gameMessage('legality.l4.escapes', {
      arcIndex: index,
      eccentricity: arc.elements.eccentricity,
      metSeconds: metAt(timeline.startEpoch, arc.startEpoch),
    }),
    epoch: arc.startEpoch,
    intervals: [],
  };
};

/** `L5` — nodes closer together than the minimum spacing. See the module docstring. */
const checkNodeSpacing = (plan: Plan): LegalityReason | null => {
  for (let i = 1; i < plan.nodes.length; i++) {
    const previous = plan.nodes[i - 1];
    const current = plan.nodes[i];
    if (previous === undefined || current === undefined) continue;
    const gap = current.epoch - previous.epoch;
    if (gap >= MINIMUM_NODE_SPACING_S) continue;
    return {
      code: 'L5',
      blocking: true,
      message: gameMessage('legality.l5.nodesTooClose', {
        firstIndex: i - 1,
        secondIndex: i,
        gapSeconds: gap,
        minimumSeconds: MINIMUM_NODE_SPACING_S,
      }),
      epoch: previous.epoch,
      intervals: [],
    };
  }
  return null;
};

/** `L6` — objective not met. A warning: never blocking. See the module docstring. */
const checkObjective = (objective: ObjectiveEvaluation | null): LegalityReason | null => {
  if (objective === null || objective.met) return null;
  return {
    code: 'L6',
    blocking: false,
    message: gameMessage('legality.l6.objectiveNotMet', NO_PARAMS),
    epoch: null,
    intervals: [],
  };
};

/** The message for a plan that produced no timeline at all. */
const failureMessage = (failure: TimelineFailure): GameMessage =>
  failure.reason === 'rectilinear'
    ? gameMessage('legality.plan.rectilinear', { nodeIndex: failure.nodeIndex })
    : gameMessage('legality.plan.nonConvergent', { nodeIndex: failure.nodeIndex });

/**
 * Compute a plan's legality.
 *
 * A deterministic pure function of the timeline, the rules and the objective evaluation
 * (§11.4): no clock, no randomness, no ambient state. Called on every plan change, not
 * only at commit — §6.5 requires the player to see a constraint before failing it.
 *
 * `objective` is nullable so that legality can be computed for a scenario whose
 * objective has not been evaluated yet — during a drag, where the cheap checks matter
 * and `L6` can wait for the frame to settle. A `null` objective produces no `L6`, which
 * is correct: "not evaluated" is not "not met".
 */
export const evaluateLegality = (
  result: TimelineResult,
  rules: LegalityRules,
  objective: ObjectiveEvaluation | null = null,
): Legality => {
  if (!result.ok) {
    return {
      evaluable: false,
      commitAllowed: false,
      reason: failureMessage(result),
      failure: result,
    };
  }

  const { timeline } = result;
  const constraints: LegalityConstraints = {
    budget: evaluateBudget(timeline, rules.budgetMps),
    deadline: evaluateDeadline(timeline, rules.deadlineSeconds),
    altitudeFloor: evaluateAltitudeFloor(timeline, rules.floorAltitudeM),
  };

  const reasons = [
    checkBudget(constraints.budget),
    checkAltitudeFloor(constraints.altitudeFloor, timeline.startEpoch),
    checkDeadline(constraints.deadline),
    checkOpenArcs(timeline),
    checkNodeSpacing(timeline.plan),
    checkObjective(objective),
  ].filter((reason): reason is LegalityReason => reason !== null);

  return {
    evaluable: true,
    commitAllowed: !reasons.some((reason) => reason.blocking),
    reasons,
    constraints,
  };
};
