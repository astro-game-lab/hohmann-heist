/**
 * The altitude floor — §6.5, FR-107, and DEP-08.
 *
 * *"Never below 100 km (hard, always on)."* The floor stands in for atmospheric drag
 * and reentry, neither of which this model has, and touching it fails a contract. It is
 * the one constraint present in every contract from C01, and it is drawn as a hazard
 * shell rather than merely enforced (§6.5, §9.3).
 *
 * ## The altitude-to-radius conversion happens here, and only here
 *
 * `@hh/propagation`'s shell finder takes a **radius from the central body's centre**
 * and says so: converting an altitude to a radius means choosing an Earth model, and
 * that choice belongs at the boundary. This is the boundary. The model is the WGS-84
 * equatorial radius, which is the largest of the reference radii and so the most
 * conservative choice for a floor — a trajectory that clears the equatorial radius by
 * 100 km clears the polar radius by 121 km, and a floor that is too high somewhere is
 * a floor that is never accidentally too low.
 *
 * That is a spherical Earth at the equatorial radius, and DEP-08 is where that
 * approximation is recorded rather than hidden. The alternative — an oblate floor —
 * would put a geodetic altitude computation in the middle of a game rule for a
 * difference of 21 km on a threshold that is itself a stand-in for physics we do not
 * model.
 *
 * ## Intervals, merged across burns
 *
 * The search runs per arc because that is what a shell crossing is defined on, so a
 * single dip below the floor that happens to span a burn comes back as two intervals
 * abutting at the node's epoch. They are merged — see `violation.ts` — because two
 * bands with a hairline between them reads as two excursions, and one excursion
 * happened.
 *
 * ## Closed form, so there is no shortest detectable dip
 *
 * `r = p / (1 + e cos ν)` solved for `r = R` is closed form, so unlike the sampled
 * searches this one has no bracket to step over and no tolerance to miss by. A dip
 * below the floor lasting a millisecond is found exactly. That matters here more than
 * anywhere else: the floor is an instant fail, and a fail the evaluator cannot see is
 * a fail the player discovers by watching it happen.
 */
import { R_EARTH_EQ } from '@hh/astro';
import { findShellIntervals } from '@hh/propagation';
import type { Timeline } from '@hh/sim';

import { ALTITUDE_FLOOR_M } from '../objectives/tolerances.js';
import type { ConstraintEvaluation, ConstraintViolation } from './violation.js';
import { mergeAbutting } from './violation.js';

export interface AltitudeFloorEvaluation extends ConstraintEvaluation {
  readonly kind: 'altitude_floor';
  /** The floor, in metres above the reference radius. */
  readonly floorAltitudeM: number;
  /** The reference radius the floor is measured from, in metres. */
  readonly referenceRadiusM: number;
  /** Total time spent below the floor, in seconds. */
  readonly totalSecondsBelow: number;
}

/**
 * Evaluate the altitude floor against a timeline.
 *
 * Pure. The defaults are DEP-08's 100 km over the WGS-84 equatorial radius; both are
 * parameters so that a no-fly shell (§6.5's C18 constraint) can reuse this evaluator
 * without either of them being special.
 */
export const evaluateAltitudeFloor = (
  timeline: Timeline,
  floorAltitudeM: number = ALTITUDE_FLOOR_M,
  referenceRadiusM: number = R_EARTH_EQ,
): AltitudeFloorEvaluation => {
  const radius = referenceRadiusM + floorAltitudeM;

  const found: ConstraintViolation[] = [];
  for (const arc of timeline.arcs) {
    // A zero-length arc has no span to be below the floor for. The finder accepts
    // `end === start` and answers for that instant, so this is a short-circuit rather
    // than a guard — but the instant it would answer for is the *next* arc's start
    // epoch too, and reporting it twice would defeat the merge below. Reachable from a
    // legal plan: a node sitting exactly on the timeline's start epoch gives arc 0 no
    // duration.
    if (arc.endEpoch <= arc.startEpoch) continue;
    for (const interval of findShellIntervals(arc, radius, arc.startEpoch, arc.endEpoch)) {
      found.push({ kind: 'altitude_floor', ...interval });
    }
  }

  const violations = mergeAbutting(found);

  return {
    kind: 'altitude_floor',
    floorAltitudeM,
    referenceRadiusM,
    totalSecondsBelow: violations.reduce(
      (total, interval) => total + (interval.end - interval.start),
      0,
    ),
    violations,
  };
};
