/**
 * The Δv budget — §6.5, FR-107, and DEP-02.
 *
 * A hard cap on `Σ∣Δv∣`. **DEP-02 lives here**: there is no mass, no specific impulse
 * and no rocket equation anywhere in this project, and the budget is a scalar tank
 * rather than propellant. That is a simplification for fun — propellant bookkeeping is
 * a second learning curve on top of orbital mechanics — and it is why the HUD labels
 * the bar "Δv" and not "fuel".
 *
 * ## The sum is over magnitudes, and it is not a vector sum
 *
 * `Σ∣Δv∣` adds the *lengths* of the burns, so a 10 m/s burn followed by a 10 m/s burn
 * back the other way costs 20 m/s and leaves the spacecraft where it started. That is
 * the physically honest accounting — propellant does not come back — and it is also
 * what makes a wasteful plan legible as wasteful.
 *
 * ## Why a budget has intervals at all
 *
 * FR-107 asks every constraint for violating intervals rather than a boolean, and a
 * budget looks like the one constraint that has no time in it. It does: the budget is
 * exceeded **from the burn that crosses the cap onward**, and that is a real interval
 * with a real start epoch. It draws as a band on the timeline covering the part of the
 * plan that cannot be afforded, which is more useful than a red number, and it tells
 * the player *which* burn broke the budget rather than leaving them to work it out.
 *
 * ## The three HUD states
 *
 * §8.3.4 specifies amber at 90% of budget and red above 100%. Those thresholds belong
 * with the rule rather than in the component that draws the bar, so they are here and
 * the bar reads {@link BudgetEvaluation.level} instead of re-deriving them.
 */
import type { Epoch } from '@hh/astro';
import { V } from '@hh/math';
import type { Timeline } from '@hh/sim';

import type { ConstraintEvaluation, ConstraintViolation } from './violation.js';

/** Fraction of budget at which the HUD bar turns amber (§8.3.4). */
export const BUDGET_WARNING_FRACTION = 0.9;

/** What the HUD bar shows. */
export type BudgetLevel = 'ok' | 'warning' | 'exceeded';

export interface BudgetEvaluation extends ConstraintEvaluation {
  readonly kind: 'dv_budget';
  /** `Σ∣Δv∣` over the plan's nodes, in metres per second. */
  readonly usedMps: number;
  /** The contract's cap, in metres per second. */
  readonly budgetMps: number;
  /** `budget - used`. Negative when over. */
  readonly remainingMps: number;
  /** `used / budget`, for the bar. `Infinity` for a zero budget with any spend. */
  readonly fraction: number;
  readonly level: BudgetLevel;
  /** Index of the first node whose burn takes the plan over the cap, or `null`. */
  readonly exceededAtNode: number | null;
}

/** `Σ∣Δv∣` over a plan, in metres per second. */
export const totalDeltaV = (timeline: Timeline): number =>
  timeline.plan.nodes.reduce((sum, node) => sum + V.norm(node.deltaVRtn), 0);

const levelFor = (fraction: number): BudgetLevel => {
  if (fraction > 1) return 'exceeded';
  if (fraction >= BUDGET_WARNING_FRACTION) return 'warning';
  return 'ok';
};

/**
 * Evaluate the Δv budget against a timeline.
 *
 * Pure, and a function of the plan rather than of the trajectory — but it takes the
 * timeline so that the violating interval can be closed at the horizon, and so that
 * every constraint evaluator has the same signature.
 */
export const evaluateBudget = (timeline: Timeline, budgetMps: number): BudgetEvaluation => {
  const nodes = timeline.plan.nodes;

  let running = 0;
  let exceededAtNode: number | null = null;
  let exceededAtEpoch: Epoch | null = null;

  for (const [index, node] of nodes.entries()) {
    running += V.norm(node.deltaVRtn);
    if (exceededAtNode === null && running > budgetMps) {
      exceededAtNode = index;
      exceededAtEpoch = node.epoch;
    }
  }

  const violations: readonly ConstraintViolation[] =
    exceededAtEpoch === null
      ? []
      : [
          {
            kind: 'dv_budget',
            start: exceededAtEpoch,
            end: timeline.horizon,
            clippedStart: false,
            // The band runs to the horizon because nothing after the overspend is
            // affordable either; it is clipped there rather than ending there.
            clippedEnd: true,
          },
        ];

  const fraction =
    budgetMps === 0 ? (running === 0 ? 0 : Number.POSITIVE_INFINITY) : running / budgetMps;

  return {
    kind: 'dv_budget',
    usedMps: running,
    budgetMps,
    remainingMps: budgetMps - running,
    fraction,
    level: levelFor(fraction),
    exceededAtNode,
    violations,
  };
};
