/**
 * `reach_orbit` — FR-106 and §6.4.
 *
 * > *Osculating elements match the goal within tolerance, **held at the end of the
 * > plan**.*
 *
 * ## "Held at the end of the plan" is structural here, not sampled
 *
 * The obvious implementation walks the timeline looking for an epoch where the
 * elements match, and then has to answer a second question — did they stay matched? —
 * usually by sampling forward and hoping the sample spacing was fine enough.
 *
 * None of that is necessary, because of what an arc is. A Keplerian arc has **constant
 * elements**: only the true anomaly moves along it. So the orbit the plan leaves the
 * spacecraft in is exactly the last arc's elements, and it is held from the last
 * impulse to the horizon by construction. This evaluator therefore reads one arc and
 * compares five numbers.
 *
 * Two consequences worth stating, because they are the acceptance criteria:
 *
 * - **A momentary match mid-plan is not success.** If arc 2 matched the goal and arc 5
 *   does not, this returns `met: false`. There is no sampling window in which a
 *   transient match could be caught, because nothing is sampled.
 * - **`atEpoch` is when the orbit was achieved, not when it was noticed.** It is the
 *   last arc's start epoch — the burn that put the spacecraft there — which is the
 *   number a debrief wants. The empty plan is not a special case: its single arc starts
 *   at the timeline's start, so an initial orbit that already matches reports the start
 *   epoch and `met: true`.
 *
 * ## Which elements, and why these
 *
 * Periapsis radius, apoapsis radius, inclination, and — when the goal orbit makes them
 * meaningful — RAAN and argument of periapsis. `../objectives/tolerances.ts` carries
 * the full argument for preferring the two apsis radii over `a` and `e`, and the table
 * showing that all five tolerances correspond to about 10 km of position error at LEO.
 *
 * ## Degenerate goals are the common case
 *
 * Contracts 01 and 02 are circular and equatorial, so a goal with no meaningful apse
 * line and no meaningful node line is the *ordinary* input, not an edge case (§7.2).
 * The rule is:
 *
 * - **A circular goal does not compare the argument of periapsis.** There is no apse
 *   line to match. Having matched periapsis and apoapsis radii to 10 km, the player has
 *   matched everything the goal actually says about the orbit's shape.
 * - **An equatorial goal does not compare RAAN.** There is no node line to match, and
 *   the same argument applies: the inclination comparison has already bounded the plane.
 *
 * The test is on the **goal**, not on the achieved orbit, and that asymmetry is
 * deliberate. Testing the achieved orbit would make the set of compared elements depend
 * on how well the player did, so a plan could pass by being degenerate — arriving on an
 * accidentally-circular orbit would excuse it from an argument-of-periapsis check that
 * a better plan still had to pass. Both branches report themselves on the comparison
 * rows, so a briefing can say which elements were checked rather than leaving the
 * player to infer it.
 *
 * The equatorial test is on `sin i` rather than `i`, per §7.2, so a retrograde
 * equatorial goal is caught as well as a prograde one.
 *
 * ## Monotone in tolerance
 *
 * §13.3 asks that loosening a tolerance never turn a pass into a fail. Here that is
 * structural rather than tested-into-existence: the achieved values are computed
 * without reference to the tolerance, and each comparison is a `≤` against it.
 * `reach-orbit.test.ts` asserts it anyway, over generated goals and tolerances.
 */
import type { ClassicalElements, Epoch, OrbitShape } from '@hh/astro';
import {
  CIRCULAR_TOLERANCE,
  EQUATORIAL_TOLERANCE,
  apoapsisRadius,
  periapsisRadius,
  semiMajorAxis,
} from '@hh/astro';
import { angularDifference } from '@hh/math';
import type { Timeline } from '@hh/sim';

import type { OrbitTolerance } from './tolerances.js';
import { REACH_ORBIT_TOLERANCE } from './tolerances.js';

/** The elements a `reach_orbit` goal is compared on. */
export type ComparedElement =
  'periapsisRadius' | 'apoapsisRadius' | 'inclination' | 'raan' | 'argumentOfPeriapsis';

/** Why an element was not compared. Both are properties of the goal, never of the result. */
export type SkipReason = 'goal-circular' | 'goal-equatorial';

/** One element's contribution to the verdict. */
export type ElementComparison =
  | {
      readonly element: ComparedElement;
      readonly compared: true;
      /** The goal's value, in metres or radians. */
      readonly goal: number;
      /** What the plan actually achieved, same units. */
      readonly achieved: number;
      /**
       * `achieved - goal`, signed. For angles this is the shortest arc, in `(-π, π]`,
       * so a goal at 359.95° and a result at 0.05° differ by 0.1° rather than 359.9°.
       */
      readonly difference: number;
      readonly tolerance: number;
      readonly within: boolean;
    }
  | {
      readonly element: ComparedElement;
      readonly compared: false;
      readonly reason: SkipReason;
      readonly goal: number;
      readonly achieved: number;
    };

/** Every number the debrief needs, met or missed (§8.3.9). */
export interface ReachOrbitAchieved {
  readonly periapsisRadiusM: number;
  readonly apoapsisRadiusM: number;
  readonly semiMajorAxisM: number;
  readonly eccentricity: number;
  readonly inclinationRad: number;
  readonly raanRad: number;
  readonly argumentOfPeriapsisRad: number;
}

/** What `reach_orbit` evaluation returns. */
export interface ReachOrbitEvaluation {
  readonly kind: 'reach_orbit';
  readonly met: boolean;
  /** When the final orbit was entered — the last arc's start. Never `null`: a timeline always has an arc. */
  readonly atEpoch: Epoch;
  /** Every element, compared or skipped, in a fixed order. */
  readonly comparisons: readonly ElementComparison[];
  /** The achieved orbit, in full precision, whether or not the objective was met. */
  readonly achieved: ReachOrbitAchieved;
  readonly tolerance: OrbitTolerance;
}

/** `true` when the goal's eccentricity is below the threshold that makes an apse line meaningful. */
const goalIsCircular = (goal: OrbitShape): boolean => goal.eccentricity <= CIRCULAR_TOLERANCE;

/** `true` when `sin i` is below the threshold that makes a node line meaningful (§7.2). */
const goalIsEquatorial = (goal: OrbitShape): boolean =>
  Math.abs(Math.sin(goal.inclination)) <= EQUATORIAL_TOLERANCE;

/**
 * Apoapsis radius, or `Infinity` for an orbit that has none.
 *
 * `@hh/astro`'s `apoapsisRadius` **throws** at `e >= 1`, which is the right answer for a
 * physics API: an open orbit does not have an apoapsis, and returning a number for it
 * would be inventing one. An evaluator needs something comparable, though, and a thrown
 * error here would turn "your burn was far too big" into a crash on a keystroke — the
 * planner calls this on every frame of a node drag.
 *
 * `Infinity` is the honest stand-in. It is the limit of `p / (1 - e)` from below, it
 * compares as further from any goal than any finite radius, and {@link compareScalar}
 * refuses to call a non-finite difference a match.
 */
const apoapsisOrInfinity = (elements: OrbitShape): number =>
  elements.eccentricity >= 1 ? Number.POSITIVE_INFINITY : apoapsisRadius(elements);

/**
 * A scalar comparison.
 *
 * `Number.isFinite` guards the one case that would otherwise pass by accident: an open
 * achieved orbit has an infinite apoapsis, and `Infinity - Infinity` is `NaN`, which is
 * not greater than any tolerance. A goal is always closed — the schema requires
 * `eccentricity < 1` — so a non-finite difference means the plan escaped, which is a
 * miss and not a match.
 */
const compareScalar = (
  element: ComparedElement,
  goal: number,
  achieved: number,
  tolerance: number,
): ElementComparison => {
  const difference = achieved - goal;
  return {
    element,
    compared: true,
    goal,
    achieved,
    difference,
    tolerance,
    within: Number.isFinite(difference) && Math.abs(difference) <= tolerance,
  };
};

/**
 * An angle comparison on the shortest arc.
 *
 * Used for RAAN and argument of periapsis, which are periodic in `2π`. **Not** used for
 * inclination, which lives in `[0, π]` and is not periodic there — the shortest-arc
 * reading would call `i = 5°` and `i = 355°` neighbours, and `355°` is not an
 * inclination at all.
 */
const compareAngle = (
  element: ComparedElement,
  goal: number,
  achieved: number,
  tolerance: number,
): ElementComparison => {
  const difference = angularDifference(goal, achieved);
  return {
    element,
    compared: true,
    goal,
    achieved,
    difference,
    tolerance,
    within: Math.abs(difference) <= tolerance,
  };
};

const skipped = (
  element: ComparedElement,
  reason: SkipReason,
  goal: number,
  achieved: number,
): ElementComparison => ({ element, compared: false, reason, goal, achieved });

/** The orbit the plan leaves the spacecraft in. */
const finalArc = (timeline: Timeline): { elements: ClassicalElements; startEpoch: Epoch } => {
  const arc = timeline.arcs[timeline.arcs.length - 1];
  if (arc === undefined) {
    // `buildTimeline` produces `nodes.length + 1` arcs, so this is unreachable. It is
    // checked rather than asserted away because `noUncheckedIndexedAccess` is on and a
    // cast here would be the one place the invariant stopped being enforced.
    throw new Error('timeline has no arcs, which buildTimeline cannot produce');
  }
  return { elements: arc.elements, startEpoch: arc.startEpoch };
};

/**
 * Evaluate `reach_orbit` against a timeline.
 *
 * A pure function of the timeline, the goal and the tolerance (§11.4): no clock, no
 * randomness, and no dependence on anything but its arguments.
 */
export const evaluateReachOrbit = (
  timeline: Timeline,
  goal: OrbitShape,
  tolerance: OrbitTolerance = REACH_ORBIT_TOLERANCE,
): ReachOrbitEvaluation => {
  const { elements, startEpoch } = finalArc(timeline);

  const achieved: ReachOrbitAchieved = {
    periapsisRadiusM: periapsisRadius(elements),
    apoapsisRadiusM: apoapsisOrInfinity(elements),
    semiMajorAxisM: semiMajorAxis(elements),
    eccentricity: elements.eccentricity,
    inclinationRad: elements.inclination,
    raanRad: elements.raan,
    argumentOfPeriapsisRad: elements.argp,
  };

  const circular = goalIsCircular(goal);
  const equatorial = goalIsEquatorial(goal);

  const comparisons: readonly ElementComparison[] = [
    compareScalar(
      'periapsisRadius',
      periapsisRadius(goal),
      achieved.periapsisRadiusM,
      tolerance.radiusM,
    ),
    compareScalar(
      'apoapsisRadius',
      apoapsisOrInfinity(goal),
      achieved.apoapsisRadiusM,
      tolerance.radiusM,
    ),
    compareScalar('inclination', goal.inclination, achieved.inclinationRad, tolerance.angleRad),
    equatorial
      ? skipped('raan', 'goal-equatorial', goal.raan, achieved.raanRad)
      : compareAngle('raan', goal.raan, achieved.raanRad, tolerance.angleRad),
    circular
      ? skipped('argumentOfPeriapsis', 'goal-circular', goal.argp, achieved.argumentOfPeriapsisRad)
      : compareAngle(
          'argumentOfPeriapsis',
          goal.argp,
          achieved.argumentOfPeriapsisRad,
          tolerance.angleRad,
        ),
  ];

  return {
    kind: 'reach_orbit',
    met: comparisons.every((comparison) => !comparison.compared || comparison.within),
    atEpoch: startEpoch,
    comparisons,
    achieved,
    tolerance,
  };
};
