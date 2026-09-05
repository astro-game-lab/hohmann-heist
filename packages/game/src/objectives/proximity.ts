/**
 * `intercept`, `rendezvous` and `soft_rendezvous` — FR-106 and §6.4.
 *
 * | Type | Success condition |
 * | --- | --- |
 * | `intercept` | ∣Δr∣ ≤ 1 000 m at some epoch |
 * | `rendezvous` | ∣Δr∣ ≤ 100 m **and** ∣Δv∣ ≤ 0.5 m/s, simultaneously |
 * | `soft_rendezvous` | rendezvous with ∣Δv∣ ≤ 0.1 m/s |
 *
 * `station` is a separate objective type in §6.4 and is deliberately not here.
 *
 * ## The epoch comes from the closest-approach finder, never from sampling
 *
 * This is the acceptance criterion that decides the whole shape of the module, and it
 * is worth being concrete about why. Two objects in similar orbits close and separate
 * fast: a 1 km intercept window at a 100 m/s relative speed is **twenty seconds** wide,
 * out of a fourteen-hour horizon. Sampling the timeline at any fixed interval coarse
 * enough to be affordable steps straight over it, and the player is told they missed a
 * transfer they actually made. Refining the interval does not fix it — it moves the
 * failure to a faster encounter and makes evaluation slower everywhere.
 *
 * `findCloseApproaches` (#61) solves the right problem instead: it brackets the
 * stationary points of the separation and refines each with Brent to an absolute 1e-6 s
 * on the epoch. **Every local minimum is tested, not just the global one.** For
 * `intercept` that changes nothing, but for `rendezvous` it matters — the closest pass
 * may be the fastest one, and a later, slower, slightly wider pass can be the one that
 * satisfies both limits at once.
 *
 * ## Why the search runs per arc, and why joint epochs appear twice
 *
 * The ship's trajectory is a sequence of arcs; the target is one arc (targets follow
 * fixed Keplerian orbits and never maneuver — DEP-11). The search runs over each ship
 * arc's own span, and the results are concatenated.
 *
 * At an internal joint the search reports a boundary minimum from both sides, at the
 * same epoch, and **both are kept**. They are not duplicates: position is continuous
 * across an impulse but velocity is not, so the two rows carry the same range and
 * different relative speeds. Discarding either would throw away a real answer — a
 * rendezvous achieved in the instant before a burn is a rendezvous, and so is one
 * achieved in the instant after. `arcIndex` and `boundary` say which is which.
 *
 * A boundary minimum is also genuinely meaningful at a joint rather than an artefact of
 * where the search stopped, which is the usual reading of that tag: the impulse can be
 * exactly what turns closing into opening.
 *
 * ## Monotone in tolerance (§13.3)
 *
 * The candidates are found without reference to any tolerance, and success is `∃
 * candidate. range ≤ maxRange ∧ speed ≤ maxSpeed`. Loosening either limit can only
 * admit candidates, never remove them, so a pass cannot become a fail. That is why the
 * tolerances are applied after the search rather than inside it — a search that pruned
 * on range would be faster and would break the property.
 *
 * ## What is returned on a miss
 *
 * §8.3.9's failure block quotes a range, an epoch, and a relative speed, so all three
 * are returned whether or not the objective was met. `achieved` is the **closest**
 * approach over the whole horizon — the number the debrief means by "Closest approach
 * 12.4 km at T+11:47:03" — which is not necessarily the candidate that came nearest to
 * satisfying a two-sided rendezvous condition. `candidates` carries the rest.
 */
import type { Epoch, RtnVector, State } from '@hh/astro';
import { eci, rtn, toRtn } from '@hh/astro';
import type { Metres, MetresPerSec } from '@hh/math';
import { V, metres, metresPerSec } from '@hh/math';
import type { Arc, ApproachBoundary, CloseApproach, EventOptions } from '@hh/propagation';
import { createArc, findCloseApproaches, stateAt as stateOnArc } from '@hh/propagation';
import type { Timeline } from '@hh/sim';
import { stateAt } from '@hh/sim';

import {
  INTERCEPT_MAX_RANGE_M,
  RENDEZVOUS_MAX_RANGE_M,
  RENDEZVOUS_MAX_REL_SPEED_MPS,
  SOFT_RENDEZVOUS_MAX_REL_SPEED_MPS,
} from './tolerances.js';

/** The three proximity objectives. `station` is not one of them (§6.4). */
export type ProximityKind = 'intercept' | 'rendezvous' | 'soft_rendezvous';

/** The limits an encounter is judged against. */
export interface ProximityTolerance {
  readonly maxRangeM: Metres;
  /** `null` for `intercept`, which has no speed condition at all. */
  readonly maxRelativeSpeedMps: MetresPerSec | null;
}

/**
 * §6.4's tolerances, by objective — DEP-03 and DEP-04.
 *
 * A total function over the union rather than a lookup with a default, so adding a
 * fourth proximity objective is a compile error here instead of a silent fallback to
 * somebody else's numbers.
 */
export const toleranceFor = (kind: ProximityKind): ProximityTolerance => {
  switch (kind) {
    case 'intercept':
      return Object.freeze({ maxRangeM: INTERCEPT_MAX_RANGE_M, maxRelativeSpeedMps: null });
    case 'rendezvous':
      return Object.freeze({
        maxRangeM: RENDEZVOUS_MAX_RANGE_M,
        maxRelativeSpeedMps: RENDEZVOUS_MAX_REL_SPEED_MPS,
      });
    case 'soft_rendezvous':
      return Object.freeze({
        maxRangeM: RENDEZVOUS_MAX_RANGE_M,
        maxRelativeSpeedMps: SOFT_RENDEZVOUS_MAX_REL_SPEED_MPS,
      });
  }
};

/** One stationary point of the separation, with the verdict on it. */
export interface ProximityCandidate {
  readonly epoch: Epoch;
  readonly rangeM: Metres;
  readonly relativeSpeedMps: MetresPerSec;
  /** Which ship arc this minimum was found on. Disambiguates the two rows at a joint. */
  readonly arcIndex: number;
  /** `interior` for a genuine stationary point; `start`/`end` at an arc bound. */
  readonly boundary: ApproachBoundary;
  readonly withinRange: boolean;
  /** `true` for `intercept`, which imposes no speed condition. */
  readonly withinSpeed: boolean;
  /** Both conditions, at this one epoch. This is what "simultaneously" means. */
  readonly satisfies: boolean;
}

/** The encounter the debrief quotes, met or missed. */
export interface ProximityAchieved {
  readonly epoch: Epoch;
  readonly rangeM: Metres;
  readonly relativeSpeedMps: MetresPerSec;
  /**
   * Where the target was relative to the ship, in the **ship's** RTN frame, at this epoch.
   *
   * `rangeM` is its magnitude and says how badly the encounter missed; this says *how* it
   * missed, which is a different question and the one §8.3.9's diagnosis has to answer.
   * A miss that is mostly along-track (T̂) is a **timing** error — the ship was on the
   * right path at the wrong moment. A miss that is mostly radial (R̂) is an **altitude**
   * error — the right moment on the wrong path. Those want opposite advice, and a scalar
   * range cannot tell them apart.
   *
   * The frame is the ship's rather than the target's because the sentence is addressed to
   * the player: "you arrived early" is a statement about where *they* were.
   *
   * Computed only for the closest approach, not for every candidate. It costs a frame
   * construction per call and only the reported encounter is ever explained (#83).
   */
  readonly missRtn: RtnVector<Metres>;
}

/** What a proximity evaluation returns. */
export interface ProximityEvaluation {
  readonly kind: ProximityKind;
  readonly met: boolean;
  /** The earliest epoch at which the objective was satisfied, or `null` if never. */
  readonly atEpoch: Epoch | null;
  /** The closest approach over the whole horizon. Always present — every horizon has one. */
  readonly achieved: ProximityAchieved;
  /** Every local minimum found, in epoch order. */
  readonly candidates: readonly ProximityCandidate[];
  readonly tolerance: ProximityTolerance;
}

/**
 * Build the target's arc.
 *
 * One arc for the whole horizon, because a target follows a fixed Keplerian orbit and
 * never maneuvers (DEP-11). Offered here so that a caller does not have to know that
 * the shape the search wants is an `Arc`.
 */
export const targetArc = (state: State, startEpoch: Epoch, horizon: Epoch, mu: number): Arc =>
  createArc({ startEpoch, endEpoch: horizon, state, mu });

/** A miss of nothing, for the case where there is no encounter to decompose. */
const ZERO_MISS: RtnVector<Metres> = rtn(V.vec3(metres(0), metres(0), metres(0)));

/**
 * The target's offset from the ship, in the ship's RTN frame, at one epoch.
 *
 * Returns a zero miss rather than throwing when either propagation fails to converge —
 * a non-convergent solve is a return value everywhere else in this repo (`RootResult`,
 * `KeplerResult`), and a diagnosis that cannot be computed should fall through to bare
 * numbers rather than take the debrief down with it.
 */
const missInRtn = (timeline: Timeline, target: Arc, at: Epoch): RtnVector<Metres> => {
  const ship = stateAt(timeline, at);
  const other = stateOnArc(target, at);
  if (!ship.converged || !other.converged) return ZERO_MISS;

  const separation = V.sub(other.state.position, ship.state.position);
  return toRtn(eci(separation), ship.state.position, ship.state.velocity);
};

/** Apply the tolerances to one close approach. */
const judge = (
  approach: CloseApproach,
  arcIndex: number,
  tolerance: ProximityTolerance,
): ProximityCandidate => {
  const withinRange = approach.separation <= tolerance.maxRangeM;
  const withinSpeed =
    tolerance.maxRelativeSpeedMps === null ||
    approach.relativeSpeed <= tolerance.maxRelativeSpeedMps;
  return {
    epoch: approach.epoch,
    rangeM: approach.separation,
    relativeSpeedMps: approach.relativeSpeed,
    arcIndex,
    boundary: approach.boundary,
    withinRange,
    withinSpeed,
    satisfies: withinRange && withinSpeed,
  };
};

/**
 * Evaluate a proximity objective against a timeline.
 *
 * A pure function of its arguments (§11.4). `options` is passed straight through to the
 * event search, so a caller that needs a finer bracket — a very fast encounter, a very
 * long horizon — can ask for one without this module inventing a policy.
 */
export const evaluateProximity = (
  timeline: Timeline,
  target: Arc,
  kind: ProximityKind,
  options: EventOptions = {},
  tolerance: ProximityTolerance = toleranceFor(kind),
): ProximityEvaluation => {
  const candidates: ProximityCandidate[] = [];

  timeline.arcs.forEach((arc, arcIndex) => {
    for (const approach of findCloseApproaches(
      arc,
      target,
      arc.startEpoch,
      arc.endEpoch,
      options,
    )) {
      candidates.push(judge(approach, arcIndex, tolerance));
    }
  });

  // Epoch order, with the arc index breaking the tie at a joint so the pre-impulse row
  // precedes the post-impulse one. Deterministic, and stable across runs (NFR-009).
  candidates.sort((a, b) => a.epoch - b.epoch || a.arcIndex - b.arcIndex);

  const closest = candidates.reduce<ProximityCandidate | undefined>(
    (best, candidate) => (best === undefined || candidate.rangeM < best.rangeM ? candidate : best),
    undefined,
  );
  const satisfying = candidates.find((candidate) => candidate.satisfies);

  return {
    kind,
    met: satisfying !== undefined,
    atEpoch: satisfying?.epoch ?? null,
    achieved:
      closest === undefined
        ? // Unreachable for a well-formed timeline: every arc span yields at least one
          // bound that qualifies as a minimum. Handled rather than asserted away, and
          // reported as an infinite range so nothing downstream reads it as a success.
          {
            epoch: timeline.startEpoch,
            rangeM: metres(Number.POSITIVE_INFINITY),
            relativeSpeedMps: metresPerSec(Number.POSITIVE_INFINITY),
            missRtn: ZERO_MISS,
          }
        : {
            epoch: closest.epoch,
            rangeM: closest.rangeM,
            relativeSpeedMps: closest.relativeSpeedMps,
            missRtn: missInRtn(timeline, target, closest.epoch),
          },
    candidates,
    tolerance,
  };
};
