/**
 * The Codex's numbers, checked against something that is not the Codex — #163, §7.6.
 *
 * > *Every number in a "the numbers" layer is derived from `@hh/astro`'s constants by a
 * > test, not copied from `docs/PRODUCT.md`; the test fails if the simulation and the
 * > entry disagree.*
 *
 * A Codex entry that contradicts the game is worse than no entry, and the failure is
 * invisible: prose does not stop compiling when the constant under it moves. So every
 * figure is checked here, and the checks are deliberately **not** re-runs of the code that
 * produced them.
 *
 * ## What counts as independent, in this file
 *
 * Four kinds of check, in descending order of how much they are worth:
 *
 * 1. **A value produced by a different program.** C03's par is the strongest thing in this
 *    file: `tools/pars/solve.ts` finds it with a Lambert grid search refined by
 *    Nelder–Mead and evaluated as a quantised plan through the game's own timeline —
 *    thousands of lines with nothing in common with `hohmannTransfer` but the constants.
 *    It lands on the same number to the last printed digit.
 * 2. **A different derivation of the same quantity.** The transfer's periapsis speed comes
 *    out of vis-viva in `figures.ts`; here it comes out of conservation of angular
 *    momentum and energy between the two apsides, which is where vis-viva comes *from* and
 *    is a genuinely different arrangement of the algebra.
 * 3. **An internal consistency law.** A phasing orbit that claims 5° per revolution must
 *    lose exactly 5/360 of a period per revolution. That is a statement about the
 *    construction, and it fails if the construction is wrong regardless of the constants.
 * 4. **`docs/PRODUCT.md` §8.3.10's printed figures, treated as a claim to be checked.**
 *    §7.6's process rule is that the product definition is an input, never an oracle — so
 *    these assertions are the mock being *verified*, which is the opposite of copying from
 *    it, and they are written to the mock's own printed precision because that is all it
 *    claims.
 *
 * No textbook is cited. `CLAUDE.md` requires a printed citation to be verified against the
 * physical book by the person writing the test, and these were not; a plausible page
 * number nobody opened is exactly what that rule exists to keep out. Everything below is
 * either derivable here or produced elsewhere in this repository.
 */
import { MU_EARTH, OMEGA_EARTH, R_EARTH_EQ, R_GEO } from '@hh/astro';
import { describe, expect, it } from 'vitest';

import {
  BURNS_AND_APSIDES_FIGURES,
  COST_OF_ALTITUDE_FIGURES,
  DEPARTURE_TIMING_FIGURES,
  GEO_RADIUS_M,
  HIGH_RADIUS_M,
  HOHMANN_FIGURES,
  LEO_RADIUS_M,
  PHASING_FIGURES,
  PHASING_GAIN_DEG,
  PHASING_REVOLUTIONS,
  PHASING_REVOLUTIONS_FAST,
  RENDEZVOUS_FIGURES,
  TRADE_FIGURES,
} from './figures.js';

// ── An independent implementation, written from the conservation laws ──────
//
// Not a copy of `figures.ts`'s helpers. The speeds come from angular momentum and energy
// at the two apsides rather than from vis-viva, and the periods from Kepler's third law
// written out, so an error in `@hh/astro`'s formulation would have to be reproduced here
// by coincidence to go unnoticed.

/** Speed at the periapsis of an ellipse with apsidal radii `rp` and `ra`. */
const periapsisSpeed = (rp: number, ra: number): number =>
  Math.sqrt((2 * MU_EARTH * ra) / (rp * (rp + ra)));

/** Speed at the apoapsis of the same ellipse — `rp v_p = ra v_a`. */
const apoapsisSpeed = (rp: number, ra: number): number => (rp * periapsisSpeed(rp, ra)) / ra;

const circular = (r: number): number => Math.sqrt(MU_EARTH / r);
const keplerPeriod = (a: number): number => 2 * Math.PI * Math.sqrt(a ** 3 / MU_EARTH);

const LEO = 6_778_137;
const HIGH = 7_178_137;
const MINUTE = 60;
const HOUR = 3600;

/**
 * Six significant figures, which is far tighter than any of these numbers is rendered at.
 *
 * The two implementations are algebraically identical, so the only difference between them
 * is float64 rounding through a different order of operations — nanometres per second on
 * quantities of hundreds of metres per second. A loose tolerance here would let a real
 * error through; this one is set at the measured agreement.
 */
const CLOSE = 1e-6;
const agrees = (actual: number, expected: number): void => {
  expect(Math.abs(actual - expected) / Math.abs(expected)).toBeLessThan(CLOSE);
};

describe('the reference orbits are the contracts’ own', () => {
  it('is the ship state C01–C05 start from, and the orbit C02 and C03 aim at', () => {
    expect(LEO_RADIUS_M).toBe(LEO);
    expect(HIGH_RADIUS_M).toBe(HIGH);
    expect(LEO_RADIUS_M - R_EARTH_EQ).toBe(400_000);
    expect(HIGH_RADIUS_M - R_EARTH_EQ).toBe(800_000);
  });

  it('is C04’s goal, to the metre', () => {
    // C04's scenario stores `42164172.931157276`. That it is `R_GEO` rather than a rounded
    // 42 164 km is what makes the entry and the contract describe one orbit.
    expect(GEO_RADIUS_M).toBe(R_GEO);
    // And `R_GEO` is the radius whose period is the sidereal day — the definition, checked
    // rather than assumed, because it is the only constant here derived from another.
    agrees(keplerPeriod(R_GEO), (2 * Math.PI) / OMEGA_EARTH);
  });
});

describe('burns and apsides — C01', () => {
  it('raises the far side with one burn, from conservation rather than vis-viva', () => {
    const expected = periapsisSpeed(LEO, HIGH) - circular(LEO);
    agrees(BURNS_AND_APSIDES_FIGURES.deltaVMps, expected);
    expect(BURNS_AND_APSIDES_FIGURES.startAltitudeKm).toBe(400);
    expect(BURNS_AND_APSIDES_FIGURES.raisedAltitudeKm).toBe(800);
  });

  it('arrives at the new apoapsis half a transfer period later', () => {
    agrees(BURNS_AND_APSIDES_FIGURES.coastMinutes, keplerPeriod((LEO + HIGH) / 2) / 2 / MINUTE);
  });

  /**
   * The check this file exists for.
   *
   * `content/contracts/c03-cold-open.json` stores `par.dv_mps: 109.1177`, found by
   * `tools/pars/solve.ts` — a Lambert search over departure epoch and time of flight,
   * 38 801 grid points across nine transfer families, each refined by a simplex and then
   * evaluated as a quantised plan through the game's own timeline. C03 is a 400 km ship
   * intercepting an 800 km target, so the cheapest answer *is* this burn, and the two
   * programs agree to the fourth decimal place.
   *
   * `pnpm pars:check` is what keeps the par side honest; this is what ties the Codex to it.
   */
  it('agrees with C03’s independently searched par', () => {
    expect(BURNS_AND_APSIDES_FIGURES.deltaVMps).toBeCloseTo(109.1177, 4);
  });
});

describe('the Hohmann transfer — C02', () => {
  it('costs both burns, each derived from the apsidal speeds', () => {
    agrees(HOHMANN_FIGURES.firstBurnMps, periapsisSpeed(LEO, HIGH) - circular(LEO));
    agrees(HOHMANN_FIGURES.secondBurnMps, circular(HIGH) - apoapsisSpeed(LEO, HIGH));
    agrees(HOHMANN_FIGURES.totalMps, HOHMANN_FIGURES.firstBurnMps + HOHMANN_FIGURES.secondBurnMps);
  });

  it('spends more on leaving than on arriving, which is what the entry says', () => {
    expect(HOHMANN_FIGURES.firstBurnMps).toBeGreaterThan(HOHMANN_FIGURES.secondBurnMps);
  });

  it('takes half the transfer ellipse’s period', () => {
    agrees(HOHMANN_FIGURES.transferMinutes, keplerPeriod((LEO + HIGH) / 2) / 2 / MINUTE);
  });
});

describe('departure timing — C03', () => {
  it('sweeps the target through the fraction of its period the transfer takes', () => {
    const sweep = (360 * (HOHMANN_FIGURES.transferMinutes * MINUTE)) / keplerPeriod(HIGH);
    agrees(DEPARTURE_TIMING_FIGURES.targetSweepDeg, sweep);
    agrees(DEPARTURE_TIMING_FIGURES.targetPeriodMinutes, keplerPeriod(HIGH) / MINUTE);
  });

  /**
   * The lead angle and the sweep are the same statement seen from the two ends, and the
   * entry says both. If they ever stopped summing to a half turn the prose would be
   * describing an arrival that does not happen.
   */
  it('leads by whatever is left of the half turn', () => {
    agrees(DEPARTURE_TIMING_FIGURES.leadAngleDeg + DEPARTURE_TIMING_FIGURES.targetSweepDeg, 180);
    // Small and positive: the target is nearly opposite at departure, which is the shape
    // of the answer and the thing a sign error would invert.
    expect(DEPARTURE_TIMING_FIGURES.leadAngleDeg).toBeGreaterThan(0);
    expect(DEPARTURE_TIMING_FIGURES.leadAngleDeg).toBeLessThan(15);
  });
});

describe('the cost of altitude — C04', () => {
  it('derives both burns to GEO from the apsidal speeds', () => {
    agrees(COST_OF_ALTITUDE_FIGURES.firstBurnMps, periapsisSpeed(LEO, R_GEO) - circular(LEO));
    agrees(COST_OF_ALTITUDE_FIGURES.secondBurnMps, circular(R_GEO) - apoapsisSpeed(LEO, R_GEO));
    agrees(COST_OF_ALTITUDE_FIGURES.geoAltitudeKm, (R_GEO - R_EARTH_EQ) / 1000);
  });

  /**
   * The one number here that is checked against the outside world, and loosely on purpose.
   *
   * "LEO to GEO is about 3.9 km/s" is the figure the entry is asking a player to carry
   * away, and it is worth knowing that the model produces it. The band is ±2% rather than
   * anything tighter because the quoted value is itself a round number for a transfer whose
   * exact cost depends on the starting altitude — a tight tolerance here would be asserting
   * precision the comparison does not have.
   */
  it('lands where the commonly quoted LEO→GEO figure of about 3.9 km/s does', () => {
    expect(COST_OF_ALTITUDE_FIGURES.totalMps / 1000).toBeGreaterThan(3.9 * 0.98);
    expect(COST_OF_ALTITUDE_FIGURES.totalMps / 1000).toBeLessThan(3.9 * 1.02);
  });

  it('spends about two thirds of it on the first burn, which is the entry’s claim', () => {
    const share = COST_OF_ALTITUDE_FIGURES.firstBurnMps / COST_OF_ALTITUDE_FIGURES.totalMps;
    expect(share).toBeGreaterThan(0.6);
    expect(share).toBeLessThan(0.67);
  });

  it('coasts for the half period of the transfer ellipse', () => {
    agrees(COST_OF_ALTITUDE_FIGURES.transferHours, keplerPeriod((LEO + R_GEO) / 2) / 2 / HOUR);
  });
});

describe('phasing orbits — C05', () => {
  /**
   * The construction's defining property, checked as a law rather than as a number.
   *
   * A phasing orbit exists to give up a fixed slice of a turn per lap. If the period
   * shortfall and the claimed angle ever disagree, the entry is describing a manoeuvre that
   * does not close the gap it says it closes — and no amount of agreement on the absolute
   * values would reveal it.
   */
  it('gives up exactly the angle it claims, every revolution', () => {
    const shortfallFraction = PHASING_FIGURES.gainPerRevMinutes / PHASING_FIGURES.basePeriodMinutes;
    agrees(shortfallFraction * 360, PHASING_FIGURES.gainPerRevDeg);
    expect(PHASING_FIGURES.gainPerRevDeg).toBe(PHASING_GAIN_DEG / PHASING_REVOLUTIONS);
  });

  it('is an ellipse tangent to the parking orbit at its high point', () => {
    // Apoapsis stays where the burn happened, so the semi-major axis and the periapsis are
    // one statement: 2a = r_apo + r_peri.
    const periapsis = 2 * PHASING_FIGURES.phasingSemiMajorKm * 1000 - LEO;
    agrees(PHASING_FIGURES.phasingPeriapsisKm, (periapsis - R_EARTH_EQ) / 1000);
  });

  it('costs the round trip into the phasing orbit and back out', () => {
    const oneBurn =
      circular(LEO) - apoapsisSpeed(2 * PHASING_FIGURES.phasingSemiMajorKm * 1000 - LEO, LEO);
    agrees(PHASING_FIGURES.deltaVMps, 2 * oneBurn);
  });

  /**
   * §8.3.10's mock, verified.
   *
   * The Codex mock in `docs/PRODUCT.md` prints *"At 400 km, T = 92.6 min. Drop the periapsis
   * to 274 km and a falls to 6 715 km, giving T = 91.3 min. That is 1.3 min per revolution,
   * or 5.0° of angle."* Every one of those is reproduced from the constants below, to the
   * precision the mock states — which is §7.6's rule applied in the direction it is written:
   * the product definition is the claim, and this is the check.
   */
  it('reproduces §8.3.10’s printed example to its own precision', () => {
    expect(PHASING_FIGURES.altitudeKm).toBe(400);
    expect(PHASING_FIGURES.basePeriodMinutes).toBeCloseTo(92.6, 1);
    expect(PHASING_FIGURES.phasingPeriodMinutes).toBeCloseTo(91.3, 1);
    expect(Math.round(PHASING_FIGURES.phasingPeriapsisKm)).toBe(274);
    expect(Math.round(PHASING_FIGURES.phasingSemiMajorKm)).toBe(6715);
    expect(PHASING_FIGURES.gainPerRevMinutes).toBeCloseTo(1.3, 1);
    expect(PHASING_FIGURES.gainPerRevDeg).toBeCloseTo(5.0, 1);
  });
});

describe('the delta-v/time trade — C07', () => {
  it('is the same manoeuvre at two deadlines, and the slow one is the cheap one', () => {
    expect(TRADE_FIGURES.gainDeg).toBe(PHASING_GAIN_DEG);
    expect(TRADE_FIGURES.slowRevolutions).toBe(PHASING_REVOLUTIONS);
    expect(TRADE_FIGURES.fastRevolutions).toBe(PHASING_REVOLUTIONS_FAST);
    expect(TRADE_FIGURES.fastDeltaVMps).toBeGreaterThan(TRADE_FIGURES.slowDeltaVMps);
    expect(TRADE_FIGURES.fastHours).toBeLessThan(TRADE_FIGURES.slowHours);
  });

  it('is the eight-revolution answer the phasing entry describes', () => {
    agrees(TRADE_FIGURES.slowDeltaVMps, PHASING_FIGURES.deltaVMps);
  });

  /**
   * The trade the entry actually claims: *"half the time for twice the Δv"*.
   *
   * Halving the revolutions doubles the period shortfall per lap, and for a shallow phasing
   * ellipse the Δv is very nearly linear in that — so the ratio comes out near two rather
   * than exactly two, and the entry says "twice" because that is what a player should carry
   * away. The bands are what make the sentence checkable rather than decorative.
   */
  it('costs about twice as much to take about half as long', () => {
    const costRatio = TRADE_FIGURES.fastDeltaVMps / TRADE_FIGURES.slowDeltaVMps;
    const timeRatio = TRADE_FIGURES.fastHours / TRADE_FIGURES.slowHours;
    expect(costRatio).toBeGreaterThan(1.9);
    expect(costRatio).toBeLessThan(2.1);
    expect(timeRatio).toBeGreaterThan(0.45);
    expect(timeRatio).toBeLessThan(0.55);
  });

  /**
   * And the reason it stops there, which is the second half of the entry's point.
   *
   * The four-revolution answer is legal — its periapsis clears DEP-08's 100 km floor — and
   * the next step down would not be. If this ever failed, the entry would be recommending a
   * manoeuvre the game refuses to fly.
   */
  it('offers a fast answer that is still above the altitude floor', () => {
    const fastPeriod = (TRADE_FIGURES.fastHours * HOUR) / TRADE_FIGURES.fastRevolutions;
    const a = Math.cbrt((MU_EARTH * fastPeriod ** 2) / (4 * Math.PI ** 2));
    expect(2 * a - LEO - R_EARTH_EQ).toBeGreaterThan(100_000);
  });
});

describe('rendezvous versus intercept — C08', () => {
  it('quotes the tolerances the game actually judges by', () => {
    // DEP-04 and DEP-03, read from `@hh/game` rather than restated. A tolerance the entry
    // and the objective disagreed about would be the Codex lying about the rules.
    expect(RENDEZVOUS_FIGURES.interceptRangeM).toBe(1000);
    expect(RENDEZVOUS_FIGURES.rendezvousRangeM).toBe(100);
    expect(RENDEZVOUS_FIGURES.rendezvousSpeedMps).toBe(0.5);
  });

  it('closes at the second Hohmann burn, which is the whole of the difference', () => {
    agrees(RENDEZVOUS_FIGURES.closingSpeedMps, circular(HIGH) - apoapsisSpeed(LEO, HIGH));
    agrees(RENDEZVOUS_FIGURES.closingSpeedMps, HOHMANN_FIGURES.secondBurnMps);
  });
});
