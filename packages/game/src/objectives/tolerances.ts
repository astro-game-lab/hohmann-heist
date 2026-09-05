/**
 * Objective tolerances — the numbers §6.4 chose for the puzzle, and nothing else.
 *
 * Every value here is a **gameplay departure**. None of them is a physical constant,
 * none is derived from one, and none may appear in `@hh/astro`, `@hh/propagation` or
 * `@hh/sim` — §7.5's rule, `docs/PHYSICS.md`'s table, and the registry in
 * `../departures.ts` all say the same thing three ways so that it survives.
 *
 * They are also **shown to the player**, in the briefing and in the HUD (§6.4). A
 * hidden tolerance turns a near miss into an argument with the game, and the whole
 * design rests on the player being able to see how close they came.
 *
 * ## The `reach_orbit` set, and why it is metres rather than elements
 *
 * §6.4 says only "osculating elements match the goal within tolerance", which leaves
 * the interesting half unspecified: *which* elements, and how much is "within". #75
 * asks for that to be explicit rather than implied by the code, so here it is.
 *
 * The comparison is on **periapsis radius, apoapsis radius, inclination**, and — where
 * the goal orbit makes them meaningful — **RAAN and argument of periapsis**. Periapsis
 * and apoapsis rather than `a` and `e` for two reasons. They are the two numbers the
 * HUD already shows and the debrief already quotes ("a 274 × 400 km phasing orbit",
 * §8.3.9), so the tolerance is stated in the units the player is reading. And each
 * carries a tolerance in **metres**, whereas an eccentricity tolerance means a
 * different physical slop at every altitude — 1e-3 is 6.8 km at LEO and 42 km at GEO,
 * which is one tolerance doing two jobs badly. The two forms carry the same
 * information for a closed orbit, so nothing is lost by preferring the legible one.
 *
 * **All five tolerances are set to about 10 km of position error at a LEO radius**,
 * which is what makes them one tolerance rather than five unrelated ones:
 *
 * | Element | Tolerance | Position error at r = 6 778 km |
 * | --- | --- | --- |
 * | Periapsis radius | 10 km | 10 km, by definition |
 * | Apoapsis radius | 10 km | 10 km, by definition |
 * | Inclination | 0.1° | `r·sin 0.1°` = 11.8 km cross-track |
 * | RAAN | 0.1° | `r·sin i·sin 0.1°` = 9.3 km at i = 51.6°, less nearer the equator |
 * | Argument of periapsis | 0.1° | `r·0.1°` = 11.8 km along the apse line |
 *
 * That is roughly two orders of magnitude above what a node drag can resolve and two
 * orders below the size of the orbits being flown, which is the band where a tolerance
 * is generous enough not to be fiddly and tight enough to still be a puzzle.
 *
 * ## The degenerate cases are the common case
 *
 * Contracts 01 and 02 are circular and equatorial, so a `reach_orbit` goal will
 * routinely have no meaningful RAAN and no meaningful argument of periapsis.
 * `../objectives/reach-orbit.ts` skips those comparisons based on the **goal**, not the
 * achieved orbit: a circular goal is fully described without an apse line, and having
 * matched its periapsis and apoapsis to 10 km the player has matched its shape. The
 * rule is stated there and tested against both degeneracies and their combination.
 */
import { fromDegrees, metres, metresPerSec, radians } from '@hh/math';
import type { Metres, MetresPerSec, Radians } from '@hh/math';

/**
 * DEP-04 — maximum range for `intercept`, in metres.
 *
 * §6.4. Real proximity operations do not have a 1 km "close enough"; this exists so a
 * grab-and-go objective ends where the interesting part of the problem ends.
 */
export const INTERCEPT_MAX_RANGE_M: Metres = metres(1000);

/** DEP-03 — maximum range for `rendezvous` and `soft_rendezvous`, in metres. */
export const RENDEZVOUS_MAX_RANGE_M: Metres = metres(100);

/** DEP-03 — maximum relative speed for `rendezvous`, in metres per second. */
export const RENDEZVOUS_MAX_REL_SPEED_MPS: MetresPerSec = metresPerSec(0.5);

/**
 * DEP-03 — maximum relative speed for `soft_rendezvous`, in metres per second.
 *
 * The tightened variant §6.4 gives contract 10. Still five times looser than the
 * ~0.02 m/s a real docking closes at, and reached in minutes rather than hours.
 */
export const SOFT_RENDEZVOUS_MAX_REL_SPEED_MPS: MetresPerSec = metresPerSec(0.1);

/** The tolerances a `reach_orbit` goal is compared under. See the module docstring. */
export interface OrbitTolerance {
  /** Periapsis and apoapsis radius, in metres. */
  readonly radiusM: Metres;
  /** Inclination, RAAN and argument of periapsis, as a shortest-arc separation. */
  readonly angleRad: Radians;
}

/** DEP-13 — the default `reach_orbit` tolerance. */
export const REACH_ORBIT_TOLERANCE: OrbitTolerance = Object.freeze({
  radiusM: metres(10_000),
  angleRad: fromDegrees(0.1),
});

/**
 * DEP-08 — the altitude floor, in metres above the equatorial radius.
 *
 * Stands in for atmospheric drag and reentry, neither of which is modelled. It is a
 * hard rule that is always on (§6.5) and it is drawn, not merely enforced.
 */
export const ALTITUDE_FLOOR_M: Metres = metres(100_000);

/**
 * The relative speed below which two objects are considered co-moving for display.
 *
 * Not a rule and not a departure — it exists so that a debrief can say "matched
 * velocity" without inventing a threshold at the call site. Set an order of magnitude
 * below `soft_rendezvous`, so anything this quiet has already passed every objective.
 */
export const COMOVING_REL_SPEED_MPS: MetresPerSec = metresPerSec(0.01);

/** Zero, as an angle. Spelled once so the degenerate branches all agree. */
export const ZERO_ANGLE: Radians = radians(0);

/**
 * DEP-14 — how far from a geostationary slot still counts as being in it.
 *
 * §6.4: *"mean longitude within ±0.05° of a slot"*. Real slot-keeping is held to roughly
 * this, which makes it one of the less forgiving numbers in the table — the departure is
 * that the game judges it on a two-body model with no triaxiality and no luni-solar
 * perturbation, which is what actually makes a real satellite drift out of its box.
 */
export const STATION_MAX_OFFSET_RAD: Radians = fromDegrees(0.05);

/**
 * DEP-14 — the largest secular drift that still counts as being on station, rad/s.
 *
 * §6.4's 0.01°/day. Stated here in SI, because everything inside the core is
 * (`docs/PHYSICS.md` § Conventions), and converted for display at the boundary only.
 *
 * The pair is chosen so that the drift limit is what makes "on station" mean "staying
 * there": at 0.01°/day a satellite takes about ten days to cross the ±0.05° box, so a
 * moment inside it with admissible drift is a moment that lasts. `station.ts` relies on
 * that and says so; `slotTraverseSeconds` turns it into a number a test can assert.
 */
export const STATION_MAX_DRIFT_RAD_PER_SEC: number = fromDegrees(0.01) / 86_400;
