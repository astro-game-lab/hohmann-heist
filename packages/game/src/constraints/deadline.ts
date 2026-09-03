/**
 * The deadline — §6.5 and FR-107.
 *
 * A hard cap on mission elapsed time. Contract 01 has one and so does every contract
 * after it: the deadline is what turns "reach this orbit" into "reach this orbit in
 * time", and it is half of why phasing is interesting.
 *
 * ## The deadline is about burns, not about the horizon
 *
 * §6.3 defines the planning horizon as *"the deadline, plus a small margin"*, so a
 * timeline whose horizon is past the deadline is the normal case and not a violation.
 * What violates is **activity** past the deadline, which is what `L3`'s message says:
 * *"Last burn is after the deadline"* (§6.4).
 *
 * Whether the *objective* is achieved before the deadline is a different question with
 * a different answer — it is `L6`, a warning, and it is the objective evaluator's job.
 * Keeping the two apart is what lets a player commit a plan that they know arrives
 * late, which §6.4 is explicit about wanting to allow.
 *
 * ## The interval
 *
 * From the deadline to the last burn. That is the span of the plan that cannot happen,
 * and drawn as a band it sits exactly over the part of the timeline the player has to
 * pull back before the deadline wall.
 */
import type { Epoch } from '@hh/astro';
import { addSeconds, metAt } from '@hh/astro';
import { seconds } from '@hh/math';
import type { Timeline } from '@hh/sim';

import type { ConstraintEvaluation, ConstraintViolation } from './violation.js';

export interface DeadlineEvaluation extends ConstraintEvaluation {
  readonly kind: 'deadline';
  /** The cap, as mission elapsed seconds from the timeline's start. */
  readonly deadlineSeconds: number;
  /** MET of the last burn, or `null` for a plan with no nodes. */
  readonly lastBurnMetSeconds: number | null;
  /** How far past the deadline the last burn falls. Zero or negative when legal. */
  readonly overrunSeconds: number;
  /** Index of the first node past the deadline, or `null`. */
  readonly firstLateNode: number | null;
}

/**
 * Evaluate the deadline against a timeline.
 *
 * `deadlineSeconds` is mission elapsed time, because that is what the scenario file
 * carries and what the player reads; it is converted to an epoch here, at the boundary,
 * exactly once.
 */
export const evaluateDeadline = (
  timeline: Timeline,
  deadlineSeconds: number,
): DeadlineEvaluation => {
  const deadlineEpoch: Epoch = addSeconds(timeline.startEpoch, seconds(deadlineSeconds));
  const nodes = timeline.plan.nodes;
  const lastNode = nodes[nodes.length - 1];

  const firstLateIndex = nodes.findIndex((node) => node.epoch > deadlineEpoch);
  const firstLateNode = firstLateIndex === -1 ? null : firstLateIndex;

  const lastBurnMetSeconds =
    lastNode === undefined ? null : metAt(timeline.startEpoch, lastNode.epoch);
  const overrunSeconds = lastBurnMetSeconds === null ? 0 : lastBurnMetSeconds - deadlineSeconds;

  const violations: readonly ConstraintViolation[] =
    firstLateNode === null || lastNode === undefined
      ? []
      : [
          {
            kind: 'deadline',
            start: deadlineEpoch,
            end: lastNode.epoch,
            clippedStart: false,
            clippedEnd: false,
          },
        ];

  return {
    kind: 'deadline',
    deadlineSeconds,
    lastBurnMetSeconds,
    overrunSeconds,
    firstLateNode,
    violations,
  };
};
