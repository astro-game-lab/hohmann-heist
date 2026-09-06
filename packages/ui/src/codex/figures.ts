/**
 * The numbers a Codex entry quotes — FR-903, §7.6, §8.3.10 (#161, #163).
 *
 * > *A Codex number that disagrees with the simulation is worse than no Codex.*
 *
 * Every figure below is **computed from `@hh/astro`'s constants and solvers**, at module
 * load, by the same code the game plans with. None is typed in by hand, and none is copied
 * out of `docs/PRODUCT.md` — §7.6's process rule is explicit that the product definition's
 * worked numbers are inputs to be checked rather than an oracle, and §8.3.10's own mock is
 * one of the things this file checks rather than reproduces.
 *
 * That is the whole reason this module exists instead of the numbers living in the message
 * strings. A string cannot be wrong about arithmetic it does not do; a string that quotes
 * `92.6 min` can be wrong about it forever.
 *
 * ## The reference orbits are the contracts' own
 *
 * The altitudes here are not round numbers chosen for the prose. They are read off the
 * scenario files, so an entry and the contract it is "seen in" describe the same orbit:
 *
 * | Orbit | Where it comes from |
 * | --- | --- |
 * | 400 km circular | C01–C05's ship state, `a_m = 6 778 137` |
 * | 800 km circular | C02's goal and C03's target, `a_m = 7 178 137` |
 * | GEO | C04's goal, which is `R_GEO` to the metre |
 * | 40° of phasing | C05's target, `nu_rad = 0.698…` |
 * | 8 revolutions | C05's deadline, and the case §8.3.10 draws |
 *
 * If a contract moves, the entry moves with it, and `figures.test.ts` is what says so.
 *
 * ## SI in, SI out — the display units are the message's problem
 *
 * Kilometres, minutes and hours appear in the field names because a Codex entry is read by
 * a person, and §8.3.10's mock is written in them. The conversion happens **here**, at the
 * boundary, exactly once per figure, rather than in seven message functions that would
 * each have their own opinion about whether to divide by 60.
 */
import { MU_EARTH, R_EARTH_EQ, R_GEO, circularSpeed, hohmannTransfer, period } from '@hh/astro';
import {
  INTERCEPT_MAX_RANGE_M,
  RENDEZVOUS_MAX_RANGE_M,
  RENDEZVOUS_MAX_REL_SPEED_MPS,
} from '@hh/game';
import { metres } from '@hh/math';
import type { Metres } from '@hh/math';

import type { AllMessageParams } from '../catalogue/types.js';

// ── The reference orbits ────────────────────────────────────────────────────

/** C01–C05's parking orbit: 400 km circular. */
export const LEO_RADIUS_M: Metres = metres(6_778_137);
/** C02's goal and C03's target: 800 km circular. */
export const HIGH_RADIUS_M: Metres = metres(7_178_137);
/** C04's goal. `R_GEO` itself — the scenario carries the same value to the metre. */
export const GEO_RADIUS_M: Metres = metres(R_GEO);

/** C05's lead angle: the target is 40° ahead in the same orbit. */
export const PHASING_GAIN_DEG = 40;
/** The revolutions §8.3.10's worked example takes to close it. See the module docstring. */
export const PHASING_REVOLUTIONS = 8;
/** The faster, dearer alternative the delta-v/time trade is drawn against. */
export const PHASING_REVOLUTIONS_FAST = 4;

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;
const DEGREES_PER_TURN = 360;

const altitudeKm = (radius: number): number => (radius - R_EARTH_EQ) / 1000;

/**
 * The circular orbit that gains `gainDeg` of phase over `revolutions`, and what it costs.
 *
 * A phasing orbit is entered and left by burns of equal magnitude at the same point, so
 * the round trip is twice one of them — which is why `deltaVMps` is doubled here rather
 * than in a message. Retrograde to *catch* something ahead: the shorter period is the
 * whole mechanism, and the sign is the part players get wrong.
 */
const phasingOrbit = (
  radius: Metres,
  gainDeg: number,
  revolutions: number,
): {
  readonly semiMajorAxisM: number;
  readonly periapsisAltitudeKm: number;
  readonly periodSeconds: number;
  readonly deltaVMps: number;
} => {
  const basePeriod = period(radius, MU_EARTH);
  // Give up `gainDeg` of a turn, spread over `revolutions` laps: each lap comes round
  // sooner by that fraction of a period, and the target — still on the original orbit —
  // does not.
  const phasingPeriod = basePeriod * (1 - gainDeg / (DEGREES_PER_TURN * revolutions));
  const semiMajorAxisM = Math.cbrt((MU_EARTH * phasingPeriod ** 2) / (4 * Math.PI ** 2));
  // The burn happens at `radius`, which becomes the phasing orbit's apoapsis.
  const speedAtApoapsis = Math.sqrt(MU_EARTH * (2 / radius - 1 / semiMajorAxisM));
  const oneBurn = Math.abs(circularSpeed(radius, MU_EARTH) - speedAtApoapsis);

  return {
    semiMajorAxisM,
    periapsisAltitudeKm: altitudeKm(2 * semiMajorAxisM - radius),
    periodSeconds: phasingPeriod,
    deltaVMps: 2 * oneBurn,
  };
};

// ── One figure set per entry ────────────────────────────────────────────────
//
// Each is the parameter type of that entry's `.numbers` message, indexed straight out of
// the catalogue rather than declared here and imported there. That direction is deliberate:
// a message's parameters are the catalogue's business, the shapes have exactly one consumer
// each, and a second declaration is a second thing to keep in step. It also makes a figure
// the message never mentions — or one it mentions that this file does not compute — a
// compile error, which is the mechanism underneath #163's "derived, not copied".

/** C01 — a prograde burn raises the *other* side. */
export type BurnsAndApsidesFigures = AllMessageParams['codex.burns-and-apsides.numbers'];

/** C02 — two burns, half a period apart. */
export type HohmannFigures = AllMessageParams['codex.the-hohmann-transfer.numbers'];

/** C03 — when you leave decides where the target will be. */
export type DepartureTimingFigures = AllMessageParams['codex.departure-timing.numbers'];

/** C04 — what altitude costs. */
export type CostOfAltitudeFigures = AllMessageParams['codex.the-cost-of-altitude.numbers'];

/** C05 — why slower is faster. §8.3.10's own worked example. */
export type PhasingFigures = AllMessageParams['codex.phasing-orbits.numbers'];

/** C07 — the delta-v/time trade, as two answers to one problem. */
export type TradeFigures = AllMessageParams['codex.the-delta-v-time-trade.numbers'];

/** C08 — arriving near a thing is not arriving *with* it. */
export type RendezvousFigures = AllMessageParams['codex.rendezvous-versus-intercept.numbers'];

// ── The figures themselves ──────────────────────────────────────────────────

const leoToHigh = hohmannTransfer(LEO_RADIUS_M, HIGH_RADIUS_M, MU_EARTH);
const leoToGeo = hohmannTransfer(LEO_RADIUS_M, GEO_RADIUS_M, MU_EARTH);
const slowPhasing = phasingOrbit(LEO_RADIUS_M, PHASING_GAIN_DEG, PHASING_REVOLUTIONS);
const fastPhasing = phasingOrbit(LEO_RADIUS_M, PHASING_GAIN_DEG, PHASING_REVOLUTIONS_FAST);

const leoPeriod = period(LEO_RADIUS_M, MU_EARTH);
const highPeriod = period(HIGH_RADIUS_M, MU_EARTH);

export const BURNS_AND_APSIDES_FIGURES: BurnsAndApsidesFigures = Object.freeze({
  startAltitudeKm: altitudeKm(LEO_RADIUS_M),
  raisedAltitudeKm: altitudeKm(HIGH_RADIUS_M),
  // The *first* burn only. C01 is one impulse: it raises the far side and stops there,
  // which is exactly the thing the entry is about.
  deltaVMps: leoToHigh.firstBurn,
  coastMinutes: leoToHigh.timeOfFlight / SECONDS_PER_MINUTE,
});

export const HOHMANN_FIGURES: HohmannFigures = Object.freeze({
  startAltitudeKm: altitudeKm(LEO_RADIUS_M),
  endAltitudeKm: altitudeKm(HIGH_RADIUS_M),
  firstBurnMps: leoToHigh.firstBurn,
  secondBurnMps: leoToHigh.secondBurn,
  totalMps: leoToHigh.totalDeltaV,
  transferMinutes: leoToHigh.timeOfFlight / SECONDS_PER_MINUTE,
});

export const DEPARTURE_TIMING_FIGURES: DepartureTimingFigures = Object.freeze({
  transferMinutes: leoToHigh.timeOfFlight / SECONDS_PER_MINUTE,
  targetPeriodMinutes: highPeriod / SECONDS_PER_MINUTE,
  // How far round its own orbit the target moves while the ship is in transit. The ship
  // arrives half a turn from where it left, so the target has to start the difference
  // *short* of the arrival point — which is the lead angle, and the whole of C03.
  targetSweepDeg: (DEGREES_PER_TURN * leoToHigh.timeOfFlight) / highPeriod,
  leadAngleDeg: DEGREES_PER_TURN / 2 - (DEGREES_PER_TURN * leoToHigh.timeOfFlight) / highPeriod,
});

export const COST_OF_ALTITUDE_FIGURES: CostOfAltitudeFigures = Object.freeze({
  startAltitudeKm: altitudeKm(LEO_RADIUS_M),
  geoAltitudeKm: altitudeKm(GEO_RADIUS_M),
  firstBurnMps: leoToGeo.firstBurn,
  secondBurnMps: leoToGeo.secondBurn,
  totalMps: leoToGeo.totalDeltaV,
  transferHours: leoToGeo.timeOfFlight / SECONDS_PER_HOUR,
});

export const PHASING_FIGURES: PhasingFigures = Object.freeze({
  altitudeKm: altitudeKm(LEO_RADIUS_M),
  basePeriodMinutes: leoPeriod / SECONDS_PER_MINUTE,
  phasingPeriodMinutes: slowPhasing.periodSeconds / SECONDS_PER_MINUTE,
  phasingPeriapsisKm: slowPhasing.periapsisAltitudeKm,
  phasingSemiMajorKm: slowPhasing.semiMajorAxisM / 1000,
  gainPerRevMinutes: (leoPeriod - slowPhasing.periodSeconds) / SECONDS_PER_MINUTE,
  gainPerRevDeg: PHASING_GAIN_DEG / PHASING_REVOLUTIONS,
  deltaVMps: slowPhasing.deltaVMps,
});

export const TRADE_FIGURES: TradeFigures = Object.freeze({
  gainDeg: PHASING_GAIN_DEG,
  fastRevolutions: PHASING_REVOLUTIONS_FAST,
  fastDeltaVMps: fastPhasing.deltaVMps,
  fastHours: (PHASING_REVOLUTIONS_FAST * fastPhasing.periodSeconds) / SECONDS_PER_HOUR,
  slowRevolutions: PHASING_REVOLUTIONS,
  slowDeltaVMps: slowPhasing.deltaVMps,
  slowHours: (PHASING_REVOLUTIONS * slowPhasing.periodSeconds) / SECONDS_PER_HOUR,
});

export const RENDEZVOUS_FIGURES: RendezvousFigures = Object.freeze({
  interceptRangeM: INTERCEPT_MAX_RANGE_M,
  rendezvousRangeM: RENDEZVOUS_MAX_RANGE_M,
  rendezvousSpeedMps: RENDEZVOUS_MAX_REL_SPEED_MPS,
  // Arrive on a transfer ellipse and you arrive *slower* than the thing you are meeting,
  // by exactly the burn you did not do. The second Hohmann impulse is the price of
  // turning a near miss into a meeting, and it is why the second burn exists.
  closingSpeedMps: leoToHigh.secondBurn,
});
