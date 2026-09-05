/**
 * The claims individual contracts make — #90, #92, #93, #94.
 *
 * ## Why this file names contracts and `content.test.ts` must not
 *
 * §13.4's suite is parameterised over the scenario directory precisely so that it cannot
 * know any contract's id: *"adding a contract adds seven tests for free"* only holds if
 * nothing there is per contract, and a single `if (id === …)` would end it.
 *
 * What that arrangement cannot express is a claim about a **particular** contract, and
 * §6.8 makes several. C01 teaches its lesson *in one burn*; C02's costs two; C05's floor
 * bites where C06's does not. Those are properties of the content, and §6.8 currently
 * asserts them in prose — which means a retuned deadline or a moved target could quietly
 * falsify the teaching claim while all seven of §13.4's checks stayed green, because
 * every one of them would still be true of the changed contract.
 *
 * So they are asserted here instead, in a file whose whole purpose is to name names. It
 * replays the committed reference solutions — it does not re-solve — so it belongs to the
 * fast `content` project and runs on every `pnpm test`.
 *
 * ## The closed forms below are written out rather than imported
 *
 * The phasing relation appears here in six lines and again in `tools/pars/solve.ts`. That
 * duplication is the point: importing the solver's own construction would make these
 * tests ask whether the solver agrees with itself. Written out from the relation, they ask
 * whether the *contract* has the property §6.8 says it has.
 */
import { MU_EARTH, R_EARTH_EQ, elementsFromState, metAt, period, periapsisRadius } from '@hh/astro';
import { metres } from '@hh/math';
import { evaluateLegality, stationDrift } from '@hh/game';
import { describe, expect, it } from 'vitest';

import {
  outcomeFor,
  parseStoredReplay,
  planForReplay,
  requireContract,
  timelineFor,
} from './evaluate.js';
import type { ContractFile } from './scenarios.js';
import { contractFiles } from './scenarios.js';

const files = new Map(contractFiles().map((file): [string, ContractFile] => [file.stem, file]));

const contract = (stem: string) => {
  const file = files.get(stem);
  if (file === undefined) throw new Error(`${stem} is not in content/contracts/`);
  return requireContract(file);
};

/** The committed reference solution, evaluated exactly as §13.4's suite evaluates it. */
const reference = (stem: string) => {
  const scenario = contract(stem);
  const plan = planForReplay(scenario, parseStoredReplay(scenario.document.par.referenceReplay));
  const outcome = outcomeFor(scenario, plan);
  if (outcome === null) throw new Error(`${stem}: the reference replay produces no timeline`);
  return { scenario, plan, outcome };
};

describe('C01 and C02 — one burn, then two (#90, §6.8)', () => {
  /**
   * §6.8 gives C01 *"a prograde burn raises the orbit on the opposite side … delivered in
   * one burn"* and C02 *"a transfer is two burns"*. Both are claims about the content, and
   * this is what stops them being claims about the prose: if C01's goal were ever changed
   * to something needing a circularisation, or C02's to something a single impulse
   * reaches, §13.4's seven checks would all still pass.
   */
  it('C01 is solvable in exactly one burn', () => {
    const { outcome, scenario } = reference('c01-shakedown');
    expect(outcome.burns).toBe(1);
    expect(scenario.document.par.burns).toBe(1);
  });

  it('C02 takes exactly two', () => {
    const { outcome, scenario } = reference('c02-round-trip');
    expect(outcome.burns).toBe(2);
    expect(scenario.document.par.burns).toBe(2);
  });

  /**
   * The reason C01 is one burn, stated as the thing that makes it true.
   *
   * Its goal shares the ship's *periapsis*, so the second impulse a circularisation would
   * add buys nothing the objective asks for. A goal that did not would need two.
   */
  it('C01’s goal keeps the ship’s own periapsis, which is why one burn reaches it', () => {
    const { scenario } = reference('c01-shakedown');
    const objective = scenario.objective;
    if (objective.kind !== 'reach_orbit') throw new Error('C01 should be a reach_orbit');
    const goal = objective.goal;
    const goalPeriapsis = goal.semiLatusRectum / (1 + goal.eccentricity);
    const shipShape = elementsFromState(
      scenario.ship.state.position,
      scenario.ship.state.velocity,
      scenario.mu,
    );
    expect(Math.abs(goalPeriapsis - periapsisRadius(shipShape))).toBeLessThanOrEqual(
      objective.tolerance.radiusM,
    );
  });

  /**
   * C01 asks for a shape, not an orientation — #90.
   *
   * *"The goal spec must express 'raise apoapsis to 800 km, leave periapsis alone' without
   * asserting an argument of periapsis that does not exist."* The goal is eccentric, so it
   * genuinely **has** an apse line and the evaluator would compare it by default; the
   * contract declines to state one, and this is the assertion that keeps it declining.
   *
   * The version that did assert `argp: 0` passed all seven of §13.4's checks and was
   * unplayable: a correct prograde burn raised apoapsis to exactly 800 km and failed,
   * because the apse line pointed 180° from an inertial axis nothing in the game draws.
   */
  it('C01 asks for its shape in any orientation', () => {
    const { scenario } = reference('c01-shakedown');
    const objective = scenario.objective;
    if (objective.kind !== 'reach_orbit') throw new Error('C01 should be a reach_orbit');
    expect(objective.oriented.argp).toBe(false);
    expect(objective.goal.eccentricity).toBeGreaterThan(0.01);

    const evaluation = reference('c01-shakedown').outcome.objective;
    if (evaluation.kind !== 'reach_orbit') throw new Error('C01 should be a reach_orbit');
    const argp = evaluation.comparisons.find((c) => c.element === 'argumentOfPeriapsis');
    expect(argp?.compared).toBe(false);
    if (argp?.compared === false) expect(argp.reason).toBe('goal-unoriented');
  });

  /**
   * What *does* pin C01's burn, now that the apse line does not.
   *
   * The ship flies a 400 × 450 km ellipse, so a prograde burn leaves periapsis at 400 km
   * only when it happens **at** periapsis. That is a reference the planner draws and the
   * snapping assist snaps to, which is the whole difference from the version this
   * replaced: the constraint is visible on screen instead of being an invisible axis.
   */
  it('C01’s burn is pinned by the ship’s own periapsis, which is drawn on screen', () => {
    const { scenario, outcome } = reference('c01-shakedown');
    const shipShape = elementsFromState(
      scenario.ship.state.position,
      scenario.ship.state.velocity,
      scenario.mu,
    );
    // Genuinely eccentric, or there would be no periapsis to find and no reason to wait.
    expect(shipShape.eccentricity).toBeGreaterThan(1e-3);

    const node = outcome.timeline.plan.nodes[0];
    if (node === undefined) throw new Error('C01 should have a burn');
    const burnMet = metAt(scenario.startEpoch, node.epoch);
    const shipPeriod = period(
      metres(shipShape.semiLatusRectum / (1 - shipShape.eccentricity ** 2)),
      scenario.mu,
    );
    // The ship starts at apoapsis, so its periapsis comes half a period later.
    expect(burnMet).toBeCloseTo(shipPeriod / 2, 0);
  });
});

describe('C04 — the burn-count cap is published and soft (#92, §6.5)', () => {
  it('declares a cap, and declares the same number its par carries', () => {
    const { scenario } = reference('c04-long-haul');
    // §6.7's Gold already requires `burns ≤ par_burns`. The cap is the *visible* form of
    // that threshold, so the two have to be the same number — a cap above par.burns would
    // promise a player a Gold that the medal ladder would then refuse.
    expect(scenario.rules.maxBurns).toBe(scenario.document.par.burns);
  });

  it('the reference solution sits exactly at the cap', () => {
    const { outcome, scenario } = reference('c04-long-haul');
    expect(outcome.burns).toBe(scenario.rules.maxBurns);
  });

  it('the cap produces no legality reason, so it cannot block a commit', () => {
    const { scenario, plan } = reference('c04-long-haul');
    const legality = evaluateLegality(timelineFor(scenario, plan), scenario.rules);
    if (!legality.evaluable) throw new Error('C04’s reference solution should evaluate');
    expect(legality.reasons.map((reason) => reason.code)).toStrictEqual([]);
    expect(legality.constraints.burnCount.maxBurns).toBe(2);
  });

  it('its budget clears §13.4’s headroom, which §6.8’s 4 200 m/s does not', () => {
    const { scenario } = reference('c04-long-haul');
    const par = scenario.document.par.dv_mps;
    expect(scenario.ship.dvBudgetMps).toBeGreaterThanOrEqual(par * 1.15);
    // The number §6.8 quotes, asserted as *failing* — so that a future edit restoring it
    // fails here with the reason rather than in the content suite with a bare inequality.
    expect(4200).toBeLessThan(par * 1.15);
  });
});

// ── The phasing pair ────────────────────────────────────────────────────────────────

const SHIP_RADIUS_M = 6_778_137;
const SHIP_PERIOD_S = 2 * Math.PI * Math.sqrt(SHIP_RADIUS_M ** 3 / MU_EARTH);

/**
 * A phasing member, from the relation rather than from the solver.
 *
 * `t = T·(k − Δθ/2π)` over `n` ship revolutions. Returns the other apsis of the phasing
 * orbit — the one the altitude floor acts on — and how long the member takes.
 */
const phasingMember = (
  phaseRad: number,
  targetRevolutions: number,
  shipRevolutions: number,
): { readonly elapsedSeconds: number; readonly otherApsisAltitudeM: number } => {
  const elapsedSeconds = SHIP_PERIOD_S * (targetRevolutions - phaseRad / (2 * Math.PI));
  const phasingPeriod = elapsedSeconds / shipRevolutions;
  const axis = Math.cbrt(MU_EARTH * (phasingPeriod / (2 * Math.PI)) ** 2);
  return { elapsedSeconds, otherApsisAltitudeM: 2 * axis - SHIP_RADIUS_M - R_EARTH_EQ };
};

const AHEAD_C05 = (40 * Math.PI) / 180;
const AHEAD_C06 = (335 * Math.PI) / 180;

describe('C05 and C06 — what bounds each of them (#93, §6.8)', () => {
  /**
   * §6.8 states the asymmetry as *"there the altitude floor caps how cheap you can go,
   * here the deadline does"*, and that is backwards for the floor.
   *
   * Δv falls **monotonically with revolution count**: a longer phasing loop is a smaller
   * period change, so a cheaper solution has a *higher* periapsis, not a lower one. At
   * C05's winning eight revolutions the periapsis is 274 km, and nine would be 288. The
   * floor therefore bounds the **fast** end of the family, not the cheap end — and what
   * bounds the cheap end, in both contracts, is the deadline.
   *
   * The asymmetry §6.8 wants is real, and it is the one asserted below: C05's family runs
   * *downward* into the floor and C06's runs *upward* away from it, so only one of them
   * has a fast end the floor can bite.
   */
  it('C05 gets cheaper as it gets slower, so the floor is not what caps its cost', () => {
    const cheaperIsHigher = [4, 5, 6, 7, 8, 9].map(
      (n) => phasingMember(AHEAD_C05, n, n).otherApsisAltitudeM,
    );
    const sorted = [...cheaperIsHigher].sort((a, b) => a - b);
    expect(cheaperIsHigher).toStrictEqual(sorted);
  });

  it('C05’s floor bites at the fast end: three revolutions goes through it, four does not', () => {
    const floor = contract('c05-tailgate').rules.floorAltitudeM ?? 0;
    expect(phasingMember(AHEAD_C05, 3, 3).otherApsisAltitudeM).toBeLessThan(floor);
    expect(phasingMember(AHEAD_C05, 4, 4).otherApsisAltitudeM).toBeGreaterThan(floor);
  });

  it('C06 climbs instead, so no member of its family can reach the floor at all', () => {
    // Every admissible member of C06's family raises the other apsis above the shared
    // circular radius. There is no fast end for the floor to bound, which is the half of
    // §6.8's asymmetry that survives.
    for (let n = 1; n <= 8; n++) {
      expect(phasingMember(AHEAD_C06, n + 1, n).otherApsisAltitudeM).toBeGreaterThan(
        SHIP_RADIUS_M - R_EARTH_EQ,
      );
    }
  });

  /**
   * What actually caps how cheap each of these can go.
   *
   * Both winners fly eight ship revolutions; they differ in the target's count, because
   * C05 catches something 40° ahead while C06 lets something 25° behind catch up. The
   * assertion is the same either way: the winning member fits inside the deadline and the
   * next one along the family — cheaper, because slower — does not.
   */
  it.each([
    ['c05-tailgate', AHEAD_C05, 8, 8],
    ['c06-overtake', AHEAD_C06, 9, 8],
  ])('%s is bounded by its deadline, not by its budget or its floor', (stem, phase, k, n) => {
    const { scenario } = reference(stem);
    const deadline = scenario.rules.deadlineSeconds;
    expect(phasingMember(phase, k, n).elapsedSeconds).toBeLessThanOrEqual(deadline);
    expect(phasingMember(phase, k + 1, n + 1).elapsedSeconds).toBeGreaterThan(deadline);
    // And it is not the budget: par leaves the better part of an order of magnitude spare.
    expect(scenario.ship.dvBudgetMps).toBeGreaterThan(scenario.document.par.dv_mps * 5);
  });

  it('both ship at one burn, at half of §6.8’s two-burn figure', () => {
    // §6.8 states 72 and 44.0 m/s, which are the *two-burn* phasing costs — drop in, then
    // re-circularise. `intercept` (DEP-04) asks for 1 000 m of range and says nothing about
    // relative velocity, so the second burn is not bought. docs/PARS.md records it.
    for (const stem of ['c05-tailgate', 'c06-overtake']) {
      const { outcome, scenario } = reference(stem);
      expect(outcome.burns).toBe(1);
      expect(scenario.document.par.burns).toBe(1);
    }
  });

  it('C05’s reference solution keeps its periapsis above the floor', () => {
    const { scenario, outcome } = reference('c05-tailgate');
    const floor = scenario.rules.floorAltitudeM ?? 0;
    const legality = outcome.legality;
    if (!legality.evaluable) throw new Error('C05’s reference solution should evaluate');
    // Asserted through the game's own check rather than by recomputing an apsis: the floor
    // is a rule, and what matters is that the rule does not fire.
    expect(legality.constraints.altitudeFloor.violations).toStrictEqual([]);
    expect(floor).toBe(100_000);
  });
});

describe('C07 — a slot held, not flown through (#94, §6.4)', () => {
  it('meets both station conditions at one epoch', () => {
    const { outcome } = reference('c07-slot-machine');
    const objective = outcome.objective;
    if (objective.kind !== 'station') throw new Error('C07 should be a station objective');
    expect(objective.met).toBe(true);
    expect(objective.atEpoch).not.toBeNull();
    // Both, together. A satellite sweeping through the box satisfies the first and fails
    // the second, which is exactly the run this contract must not accept.
    expect(objective.achieved.withinSlot).toBe(true);
    expect(objective.achieved.withinDrift).toBe(true);
  });

  it('holds them, because the orbit it ends on has nowhere to drift to', () => {
    const { scenario, outcome } = reference('c07-slot-machine');
    const objective = outcome.objective;
    if (objective.kind !== 'station') throw new Error('C07 should be a station objective');

    // "Held" is a property of the **final arc**, not of a sample: `a` is constant along a
    // Keplerian arc, so its drift is one number that applies from the last burn to the
    // horizon. Checking the arc is checking every instant of it at once.
    const arcs = outcome.timeline.arcs;
    const last = arcs[arcs.length - 1];
    if (last === undefined) throw new Error('a timeline always has an arc');
    expect(Math.abs(stationDrift(last))).toBeLessThanOrEqual(objective.goal.maxDriftRadPerSec);

    // And the plan really does end well before the horizon, so there is a stretch of time
    // over which "held" means something.
    expect(scenario.horizonSeconds - (outcome.metSeconds ?? 0)).toBeGreaterThan(86_400);
  });

  it('takes two burns: one to start the drift and one to stop it', () => {
    const { outcome } = reference('c07-slot-machine');
    expect(outcome.burns).toBe(2);
  });

  it('spans a horizon of days, which nothing before it does', () => {
    // The thing #94 warned would surface. Asserted so that a later contract cannot quietly
    // shorten it and take the multi-day rendering path out of the shipped content.
    expect(contract('c07-slot-machine').horizonSeconds).toBeGreaterThan(7 * 86_400);
  });
});
