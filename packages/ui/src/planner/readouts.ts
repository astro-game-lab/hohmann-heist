/**
 * What the readouts panel shows, and what it refuses to show — #131, #132, FR-406, FR-407.
 *
 * §8.3.4's region ④ is four osculating elements at the scrub head and a closest-approach
 * block. Neither is a formatting problem, which is why this module exists separately from
 * the component that renders it: the interesting decisions are *which rows are meaningful
 * for this orbit* and *whether there is an encounter at all*, and both are answerable
 * without a DOM.
 *
 * ## Everything here is SI, and stays SI
 *
 * #131's fifth criterion: *"Unit conversion happens here, at the boundary: values arriving
 * from the core are SI."* The boundary is the **catalogue**, not this module — metres to
 * kilometres is a locale decision as much as a unit one, since the separator, the grouping
 * and the abbreviation's position all change with the language, and `catalogue/types.ts`
 * spends a page on why that cannot live in a component. So this returns metres and
 * seconds, tagged with which rows to draw, and the message keys turn them into text.
 *
 * That split is also what makes #131's sixth criterion — *"decimal separators are not
 * hard-coded"* — structurally true rather than reviewed: there is no `toFixed` in this
 * file and nothing for one to act on.
 *
 * ## Suppression is §9.3's rule, imported rather than restated
 *
 * A circular orbit's apoapsis and periapsis differ by centimetres, and the last digits of
 * that difference are float noise rather than a fact about the orbit. §9.3 already fixes
 * the threshold — *"apsis markers are suppressed for near-circular orbits (e < 1e-3)"* —
 * and `@hh/propagation` exports `APSIS_ECCENTRICITY_FLOOR` precisely so that no second
 * copy of the number can drift from the first.
 *
 * So this imports it, and the readouts suppress exactly what the orbit view suppresses.
 * That agreement is the point: a player looking at an orbit with no apsis ticks and a
 * panel quoting an apoapsis to one decimal place would reasonably conclude one of the two
 * was broken. A single mean altitude replaces the pair, because "this orbit is round and
 * this is its altitude" is the true statement.
 *
 * ## An open orbit has no period and no apoapsis
 *
 * `e >= 1` is `L4` and illegal to commit, but it is reachable — the player is allowed to
 * build one and be told about it (§6.4), so the panel has to render it. `a` is negative
 * for a hyperbola and infinite at `e = 1`, so both rows are absent rather than showing a
 * negative period. `null` says "there is no such quantity"; it is never a stand-in for
 * "not computed yet".
 */
import type { Epoch, OrbitShape } from '@hh/astro';
import { apoapsisRadius, period, periapsisRadius, semiMajorAxis } from '@hh/astro';
import type { ProximityEvaluation } from '@hh/game';
import { APSIS_ECCENTRICITY_FLOOR } from '@hh/propagation';

/**
 * The osculating elements at the scrub head, in SI, with the meaningless rows removed.
 *
 * Every altitude is measured above the reference radius the caller supplies rather than
 * above a constant of this module's own: the readouts sit above whatever body the
 * scenario names, and baking Earth in here would be the kind of assumption that survives
 * until the first contract that is not in Earth orbit.
 */
export interface OrbitReadout {
  /** `null` when the orbit is near-circular or open. Metres above the reference radius. */
  readonly apoapsisAltitudeM: number | null;
  /** `null` when the orbit is near-circular. Metres above the reference radius. */
  readonly periapsisAltitudeM: number | null;
  /** The single altitude a round orbit has, replacing the pair above. `null` otherwise. */
  readonly meanAltitudeM: number | null;
  /** `null` for an open orbit, which does not have one. Seconds. */
  readonly periodSeconds: number | null;
  /** Always shown: it is the number that explains why the other rows look as they do. */
  readonly eccentricity: number;
  /** Whether §9.3's suppression applied. Drives which rows the panel renders. */
  readonly circular: boolean;
  /** Whether the orbit is open — `e >= 1`, and `L4` (§6.4). */
  readonly open: boolean;
}

/**
 * Read the elements at the scrub head.
 *
 * Pure, and cheap enough to call every frame: three closed-form expressions over an
 * element set the timeline already carries. FR-403 makes scrubbing a view operation, and
 * a view operation that cost a Kepler solve per row would not stay one.
 */
export const orbitReadout = (
  elements: OrbitShape,
  mu: number,
  referenceRadiusM: number,
): OrbitReadout => {
  const e = elements.eccentricity;
  const open = e >= 1;
  // Note the order: openness is decided before circularity, because a parabolic orbit is
  // not "round" and must not fall into the mean-altitude branch on its way past.
  const circular = !open && e < APSIS_ECCENTRICITY_FLOOR;

  const periapsisAltitudeM = periapsisRadius(elements) - referenceRadiusM;

  if (open) {
    return {
      apoapsisAltitudeM: null,
      periapsisAltitudeM,
      meanAltitudeM: null,
      periodSeconds: null,
      eccentricity: e,
      circular: false,
      open: true,
    };
  }

  const apoapsisAltitudeM = apoapsisRadius(elements) - referenceRadiusM;
  const periodSeconds = period(semiMajorAxis(elements), mu);

  return circular
    ? {
        apoapsisAltitudeM: null,
        periapsisAltitudeM: null,
        // The mean of the two rather than `a - R`: they agree to within the noise this
        // branch exists to hide, and averaging says plainly that neither was preferred.
        meanAltitudeM: (apoapsisAltitudeM + periapsisAltitudeM) / 2,
        periodSeconds,
        eccentricity: e,
        circular: true,
        open: false,
      }
    : {
        apoapsisAltitudeM,
        periapsisAltitudeM,
        meanAltitudeM: null,
        periodSeconds,
        eccentricity: e,
        circular: false,
        open: false,
      };
};

/**
 * The closest-approach block — #132, FR-407.
 *
 * `present: false` is #132's fifth criterion, and it is a real case rather than a
 * defensive one: `evaluateProximity` reports an infinite range when the search found no
 * stationary point of the separation at all, and a panel that rendered that as `Infinity`
 * — or worse, as `0.0 km` after a unit conversion — would be telling the player they had
 * arrived. Everything else in this shape is `null` when it is absent, so there is no stale
 * value for the component to reach for by accident.
 */
export type ApproachReadout =
  | {
      readonly present: true;
      readonly rangeM: number;
      readonly relativeSpeedMps: number;
      /** Absolute epoch of the encounter, for the timeline's tick. */
      readonly epoch: Epoch;
      /** Whether the objective's tolerances are met at this encounter (FR-407). */
      readonly met: boolean;
      /** The limits it was judged against, so the panel can say what "met" meant. */
      readonly maxRangeM: number;
      /** `null` for `intercept`, which imposes no speed condition. */
      readonly maxRelativeSpeedMps: number | null;
    }
  | {
      /** No approach within the horizon. §6.3 stops prediction there; this says so. */
      readonly present: false;
    };

/**
 * Shape a proximity evaluation for the panel.
 *
 * Reads `achieved` — the closest approach over the whole horizon — rather than the first
 * *satisfying* candidate, because the block's job is to answer "how close does this plan
 * get?", and on a plan that misses there is no satisfying candidate to quote. `met` still
 * comes from the evaluation's own verdict, so a plan that satisfies the objective earlier
 * and drifts away later reads as met, which is what §6.4 means by "anywhere in the
 * timeline".
 */
export const approachReadout = (evaluation: ProximityEvaluation): ApproachReadout => {
  const { achieved, tolerance } = evaluation;
  if (!Number.isFinite(achieved.rangeM)) return { present: false };

  return {
    present: true,
    rangeM: achieved.rangeM,
    relativeSpeedMps: achieved.relativeSpeedMps,
    epoch: achieved.epoch,
    met: evaluation.met,
    maxRangeM: tolerance.maxRangeM,
    maxRelativeSpeedMps: tolerance.maxRelativeSpeedMps,
  };
};
