/**
 * What a constraint evaluator returns, and why it is never a boolean.
 *
 * FR-107: *"The system MUST evaluate all constraint types in §6.5 against a timeline,
 * returning **every violating interval**."* The plural and the word "interval" are both
 * load-bearing, and they come from the UI rather than from a preference for rich types.
 *
 * §6.5: *"Constraints are evaluated during planning, drawn on the timeline as shaded
 * bands, and shown on the orbit view where they are geometric. A player never discovers
 * a constraint by failing it."* A shaded band needs two epochs. A boolean cannot be
 * drawn, and a single epoch draws as a line, which tells the player where the trouble
 * starts and not how long it lasts. And **every** interval, because a plan that dips
 * below the floor three times has three bands: fixing the first and re-running is the
 * loop this is meant to spare them.
 *
 * The epochs also have to be precise enough to quote. `L2`'s message is *"Trajectory
 * intersects the atmosphere at T+02:14"* (§6.4), so the interval start is rendered to
 * the second, which the 1e-6 s event tolerance clears by six orders of magnitude.
 */
import type { Epoch } from '@hh/astro';
import type { EpochInterval } from '@hh/propagation';

/** The constraint types this milestone evaluates. §6.5's other five arrive with their contracts. */
export type ConstraintKind = 'dv_budget' | 'deadline' | 'altitude_floor';

/**
 * One span of time during which a constraint was violated.
 *
 * `clippedStart` and `clippedEnd` carry `@hh/propagation`'s meaning unchanged: the
 * condition already held when the search began, or still held when it ended. For a
 * renderer that is the difference between a band with an edge and a band running off
 * the end of the timeline, and for a message it is the difference between "enters the
 * atmosphere at T+02:14" and "is already below the floor".
 */
export interface ConstraintViolation extends EpochInterval {
  readonly kind: ConstraintKind;
}

/** Common shape of every constraint evaluation. */
export interface ConstraintEvaluation {
  readonly kind: ConstraintKind;
  /** Every violating interval, in epoch order. Empty means satisfied — never an error. */
  readonly violations: readonly ConstraintViolation[];
}

/** Whether an evaluation found anything. Spelled once so no caller writes `.length > 0` twice. */
export const isViolated = (evaluation: ConstraintEvaluation): boolean =>
  evaluation.violations.length > 0;

/** The earliest epoch at which a constraint was violated, or `null`. */
export const firstViolationEpoch = (evaluation: ConstraintEvaluation): Epoch | null =>
  evaluation.violations[0]?.start ?? null;

/**
 * Join intervals that touch.
 *
 * The altitude search runs per arc, so one continuous dip below the floor that spans a
 * burn comes back as two intervals abutting at the node's epoch. Drawn unmerged that is
 * two bands with a hairline between them, which reads as two separate excursions and is
 * not what happened. Merging on exact epoch equality is safe precisely because the
 * abutment is exact — arc *j*'s `endEpoch` and arc *j+1*'s `startEpoch` are the same
 * float, not two numbers that happen to be close.
 *
 * The merged interval inherits the first interval's `clippedStart` and the last one's
 * `clippedEnd`, which is what those flags mean about the joined span.
 */
export const mergeAbutting = (
  intervals: readonly ConstraintViolation[],
): readonly ConstraintViolation[] => {
  const sorted = [...intervals].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: ConstraintViolation[] = [];

  for (const interval of sorted) {
    const previous = merged[merged.length - 1];
    if (previous?.end === interval.start) {
      merged[merged.length - 1] = {
        kind: previous.kind,
        start: previous.start,
        end: interval.end,
        clippedStart: previous.clippedStart,
        clippedEnd: interval.clippedEnd,
      };
      continue;
    }
    merged.push(interval);
  }

  return merged;
};
