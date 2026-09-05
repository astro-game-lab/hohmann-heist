/**
 * `station` — FR-106 and §6.4's fifth objective type.
 *
 * > *Mean longitude within ±0.05° of a slot, drift ≤ 0.01°/day.* — §6.4
 *
 * Contract 07 *Slot Machine* is the only contract in v1.0 that uses it, and §6.8 calls it
 * *"the delta-v/time trade at its most extreme"* — 1.7 m/s and ten days, or 3.7 m/s and
 * five. That lesson only exists if the game can judge a slot.
 *
 * ## This shares nothing with the other four, which is why it is its own module
 *
 * `reach_orbit` compares element sets; `intercept` and the two rendezvous kinds search for
 * a minimum of the separation between two bodies. A slot is neither: there is no second
 * body, and the condition is on where the ship sits **in the rotating frame** and how fast
 * it is sliding through it.
 *
 * ## The slot is relative to where the ship starts, and that is not a shortcut
 *
 * A geostationary slot is a longitude in the Earth-fixed frame, and this game does not
 * model Earth's absolute orientation. `@hh/propagation`'s ground-station visibility takes
 * the rotation angle at a reference epoch **as a parameter** for exactly that reason
 * (§7.4): the sidereal angle at J2000 is an ephemeris fact, and adding one here would be a
 * second, unvalidated model of something nothing else in the repo claims to know.
 *
 * So the slot is stated as an offset from the ship's own longitude at the start of the
 * plan — which is also how §6.8 phrases the contract: *"reach a slot 3.0° **east**"*. The
 * unknown constant cancels, the objective is self-contained, and no scenario has to carry
 * a sidereal angle that nobody can check.
 *
 * What that means arithmetically: longitude relative to the start is the inertial angle
 * swept, minus the Earth's rotation over the same interval.
 *
 *     λ(t) = atan2(y, x) − ω_earth · (t − t₀)
 *
 * and the offset from the slot is `λ(t) − λ(t₀) − slot`, normalised to the shortest arc.
 * No ECEF transform appears, because the only Earth-fixed quantity that survives is a
 * difference.
 *
 * ## Drift is a property of the orbit, not a difference of samples
 *
 * The obvious implementation of "drift" differences λ over some interval. It is wrong in a
 * way that would pass every test written against a circular orbit: a slightly eccentric
 * geostationary orbit **librates** — its longitude oscillates once per revolution with an
 * amplitude of roughly `2e` radians — and differencing reads that oscillation as drift.
 * At e = 1e-4 that is 0.011° of swing, which is larger than the entire drift budget.
 *
 * The secular rate is a property of the semi-major axis alone:
 *
 *     drift = n(a) − ω_earth,   n = √(μ/a³)
 *
 * and on a Keplerian arc `a` is constant, so the drift is one number per arc rather than
 * something that has to be searched for.
 *
 * ## "Held" is what the drift limit already means
 *
 * §6.4 asks for both conditions, and the natural worry is a satellite sweeping through the
 * slot without stopping. **The drift limit is what rules that out**, so no separate dwell
 * parameter is invented here: 0.01°/day across a ±0.05° box takes ten days to traverse.
 * A pass therefore requires both conditions *at one epoch*, and the second condition is
 * what makes that epoch mean something. A satellite crossing at 0.5°/day fails on drift,
 * which is the test.
 *
 * ## Why sampling is safe here and was not for proximity
 *
 * `proximity.ts` argues at length that sampling a timeline is the wrong tool, because a
 * 1 km intercept window at 100 m/s is twenty seconds wide out of a fourteen-hour horizon
 * and any affordable step walks over it. The opposite holds here, and for the same reason
 * stated in reverse: an admissible station-keeping solution is inside the box for **days**,
 * because that is what the drift limit forces. A coarse scan cannot miss a window that
 * wide, and the entry epoch is then refined by bisection to a stated tolerance rather than
 * being reported at whatever sample happened to be first.
 */
import type { Epoch } from '@hh/astro';
import { MU_EARTH, OMEGA_EARTH, period } from '@hh/astro';
import { angularDifference, bisect, metres, radians, type Radians } from '@hh/math';
import type { Arc } from '@hh/propagation';
import { stateAt as stateOnArc } from '@hh/propagation';
import type { Timeline } from '@hh/sim';

import { STATION_MAX_DRIFT_RAD_PER_SEC, STATION_MAX_OFFSET_RAD } from './tolerances.js';

/** The slot a contract asks the ship to occupy. */
export interface StationGoal {
  /**
   * Where the slot is, as a signed offset from the ship's longitude at the start of the
   * plan. Positive is **east** — the direction of Earth's rotation, and the direction
   * §6.8 states contract 07's slot in.
   */
  readonly slotOffsetRad: Radians;
  /** Half-width of the slot. DEP-14's ±0.05° unless the scenario tightens it. */
  readonly maxOffsetRad: Radians;
  /** Largest admissible secular drift, in radians per second. DEP-14's 0.01°/day. */
  readonly maxDriftRadPerSec: number;
}

/** The goal a scenario gets when it names none of the tolerances. */
export const defaultStationGoal = (slotOffsetRad: Radians): StationGoal => ({
  slotOffsetRad,
  maxOffsetRad: STATION_MAX_OFFSET_RAD,
  maxDriftRadPerSec: STATION_MAX_DRIFT_RAD_PER_SEC,
});

/** What the ship was doing at the moment reported. */
export interface StationAchieved {
  /** Signed offset from the slot, shortest arc, in radians. Positive is east of it. */
  readonly offsetRad: Radians;
  /** Secular longitude drift, radians per second. Positive is eastward. */
  readonly driftRadPerSec: number;
  readonly withinSlot: boolean;
  readonly withinDrift: boolean;
}

/** What `station` evaluation returns. */
export interface StationEvaluation {
  readonly kind: 'station';
  readonly met: boolean;
  /** The first epoch at which both conditions held, or `null` if they never did. */
  readonly atEpoch: Epoch | null;
  /**
   * The best the run managed, whether or not it met the goal.
   *
   * "Best" is the epoch of smallest `|offset|` **among the epochs whose drift was
   * admissible**, falling back to smallest `|offset|` overall when none was — so a debrief
   * that says "you were 0.4° away" is quoting a moment the player could have held, not one
   * they flew through at speed.
   */
  readonly achieved: StationAchieved;
  readonly goal: StationGoal;
}

/**
 * How finely each arc is scanned, in seconds.
 *
 * Ten minutes. The window this is looking for is days wide — see the module docstring —
 * so this is roughly three orders of magnitude finer than it needs to be, chosen so that
 * the libration of a mildly eccentric orbit is also resolved rather than aliased: a
 * geostationary period is about a day, so ten minutes samples one revolution ~144 times.
 */
const SCAN_STEP_SECONDS = 600;

/** Absolute tolerance on the reported entry epoch, in seconds. */
const EPOCH_TOLERANCE_SECONDS = 1e-3;

/** Most samples taken on one arc, so a long horizon cannot become unbounded work. */
const MAX_SAMPLES_PER_ARC = 4096;

/**
 * Longitude relative to the plan's start, in the rotating frame.
 *
 * The inertial angle of the position, minus Earth's rotation since `startEpoch`. The
 * absolute Earth-fixed longitude of `startEpoch` is the constant that cancels when this is
 * differenced against the reference — see the module docstring.
 *
 * `atan2`, never `acos` (NFR-006): the quadrant is the entire quantity here.
 */
const relativeLongitude = (arc: Arc, at: Epoch, startEpoch: Epoch): number => {
  const result = stateOnArc(arc, at);
  if (!result.converged) return Number.NaN;
  const { position } = result.state;
  return Math.atan2(position.y, position.x) - OMEGA_EARTH * (at - startEpoch);
};

/**
 * Secular drift of an arc, in radians per second.
 *
 * `n − ω`, with `n` taken from the arc's own semi-major axis. `period` is `@hh/astro`'s,
 * so the mean motion here and the one the rest of the game uses are one calculation.
 * A non-elliptic arc has no mean motion and cannot be on station; it reports `NaN`, which
 * fails the comparison below rather than propagating.
 */
export const stationDrift = (arc: Arc): number => {
  const { semiLatusRectum, eccentricity } = arc.elements;
  if (!(eccentricity < 1)) return Number.NaN;
  const semiMajorAxis = semiLatusRectum / (1 - eccentricity * eccentricity);
  if (!Number.isFinite(semiMajorAxis) || semiMajorAxis <= 0) return Number.NaN;
  const orbitalPeriod = period(metres(semiMajorAxis), arc.mu === 0 ? MU_EARTH : arc.mu);
  return (2 * Math.PI) / orbitalPeriod - OMEGA_EARTH;
};

/**
 * Judge a run against a slot.
 *
 * Pure: no clock, no randomness, no ambient state (§11.4). Never throws and never returns
 * `NaN` in a reported field — a timeline that cannot be propagated reports "not met" with
 * the offset it could measure, which is what the debrief needs to say anything at all.
 */
export const evaluateStation = (timeline: Timeline, goal: StationGoal): StationEvaluation => {
  const { startEpoch } = timeline;
  const first = timeline.arcs[0];

  if (first === undefined) {
    return Object.freeze({
      kind: 'station' as const,
      met: false,
      atEpoch: null,
      achieved: Object.freeze({
        offsetRad: radians(0),
        driftRadPerSec: Number.NaN,
        withinSlot: false,
        withinDrift: false,
      }),
      goal,
    });
  }

  const reference = relativeLongitude(first, startEpoch, startEpoch);

  // Signed offset from the slot at an epoch, on the shortest arc. `angularDifference` is
  // `@hh/math`'s, so this and `reach_orbit`'s element comparison wrap the same way.
  const offsetAt = (arc: Arc, at: Epoch): number => {
    const longitude = relativeLongitude(arc, at, startEpoch);
    if (!Number.isFinite(longitude)) return Number.NaN;
    return angularDifference(reference + goal.slotOffsetRad, longitude);
  };

  let atEpoch: Epoch | null = null;
  let best: { offset: number; drift: number; admissible: boolean } | null = null;

  for (const arc of timeline.arcs) {
    // One number per arc: `a` is constant along a Keplerian arc, so the drift is too.
    const drift = stationDrift(arc);
    const withinDrift = Math.abs(drift) <= goal.maxDriftRadPerSec;

    const span = arc.endEpoch - arc.startEpoch;
    const steps = Math.min(MAX_SAMPLES_PER_ARC, Math.max(1, Math.ceil(span / SCAN_STEP_SECONDS)));

    let previous: { at: Epoch; offset: number } | null = null;

    for (let i = 0; i <= steps; i++) {
      const at = (arc.startEpoch + (span * i) / steps) as Epoch;
      const offset = offsetAt(arc, at);
      if (!Number.isFinite(offset)) {
        previous = null;
        continue;
      }

      const withinSlot = Math.abs(offset) <= goal.maxOffsetRad;

      // "Best" prefers a moment the player could have held over a closer flypast.
      if (
        best === null ||
        (withinDrift && !best.admissible) ||
        (withinDrift === best.admissible && Math.abs(offset) < Math.abs(best.offset))
      ) {
        best = { offset, drift, admissible: withinDrift };
      }

      if (withinDrift && withinSlot && atEpoch === null) {
        // Refine the entry rather than reporting the sample that happened to be first.
        // The bracket is the step that crossed into the slot; with no previous sample the
        // arc began inside it and its start is the answer.
        atEpoch =
          previous === null ? at : refineEntry(arc, previous.at, at, goal.maxOffsetRad, offsetAt);
      }

      previous = { at, offset };
    }
  }

  const achieved = best ?? { offset: 0, drift: Number.NaN, admissible: false };

  return Object.freeze({
    kind: 'station' as const,
    met: atEpoch !== null,
    atEpoch,
    achieved: Object.freeze({
      offsetRad: radians(achieved.offset),
      driftRadPerSec: achieved.drift,
      withinSlot: Math.abs(achieved.offset) <= goal.maxOffsetRad,
      withinDrift: Math.abs(achieved.drift) <= goal.maxDriftRadPerSec,
    }),
    goal,
  });
};

/**
 * The epoch at which `|offset|` first fell to the slot's half-width, inside a bracket.
 *
 * Bisection rather than Brent: the function being solved is `|offset| − maxOffset`, whose
 * absolute value puts a kink at the slot centre, and Brent's inverse-quadratic step is
 * built for smooth functions. Bisection only needs a sign change, which the bracket
 * guarantees, and a thousandth of a second on an epoch that is reported in minutes is
 * cheap at any iteration count.
 *
 * A bracket that does not actually change sign — possible if the scan stepped across the
 * slot and out again within one step, which the module docstring argues cannot happen at
 * this step size — falls back to the sample that was inside it, which is correct to within
 * one step rather than wrong.
 */
const refineEntry = (
  arc: Arc,
  outside: Epoch,
  inside: Epoch,
  maxOffsetRad: Radians,
  offsetAt: (arc: Arc, at: Epoch) => number,
): Epoch => {
  const excess = (at: number): number => Math.abs(offsetAt(arc, at as Epoch)) - maxOffsetRad;
  const result = bisect(excess, outside, inside, {
    tolerance: EPOCH_TOLERANCE_SECONDS,
    maxIterations: 60,
  });
  return (result.converged ? result.root : inside) as Epoch;
};

/**
 * How long a run at the drift limit would take to cross the whole slot, in seconds.
 *
 * Not a rule — nothing evaluates it. It exists so that the argument in the module
 * docstring is a number the tests can assert rather than a claim in prose: at DEP-14's
 * limits this is about ten days, which is what makes "held" follow from the drift
 * condition and why no dwell parameter is invented.
 */
export const slotTraverseSeconds = (goal: StationGoal): number =>
  goal.maxDriftRadPerSec === 0
    ? Number.POSITIVE_INFINITY
    : (2 * goal.maxOffsetRad) / goal.maxDriftRadPerSec;
