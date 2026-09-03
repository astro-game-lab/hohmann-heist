/**
 * Plan legality — #80, FR-108, §6.4.
 */
import type { State } from '@hh/astro';
import { R_EARTH_EQ, eci } from '@hh/astro';
import { V, metres, metresPerSec, radians } from '@hh/math';
import type { ManeuverNode, Plan } from '@hh/sim';
import {
  MINIMUM_NODE_SPACING_S,
  createPlan,
  fromDeltaVCounts,
  maneuverNodeFromCounts,
} from '@hh/sim';
import { describe, expect, it } from 'vitest';

import { evaluateLegality } from './legality.js';
import type { LegalityCode, LegalityRules } from './legality.js';
import { evaluateReachOrbit } from './objectives/index.js';
import {
  LEO_RADIUS_M,
  circular,
  definitely,
  elliptical,
  nodeAt,
  planOf,
  timelineFor,
  timelineResultFor,
} from './test-support.js';

const RULES: LegalityRules = { budgetMps: 100, deadlineSeconds: 4 * 3600 };

const codes = (rules: LegalityRules, plan: Plan, initialState = circular(LEO_RADIUS_M)) => {
  const legality = evaluateLegality(timelineResultFor(plan, { initialState }), rules);
  if (!legality.evaluable) throw new Error('expected an evaluable timeline');
  return legality.reasons.map((reason) => reason.code);
};

describe('a legal plan', () => {
  it('reports nothing and allows commit', () => {
    const legality = evaluateLegality(timelineResultFor(planOf([600, 10])), RULES);
    expect(legality.evaluable).toBe(true);
    if (!legality.evaluable) return;
    expect(legality.reasons).toStrictEqual([]);
    expect(legality.commitAllowed).toBe(true);
  });

  it('carries the constraint evaluations, so a caller need not repeat them', () => {
    const legality = evaluateLegality(timelineResultFor(planOf([600, 10])), RULES);
    if (!legality.evaluable) throw new Error('expected an evaluable timeline');
    expect(legality.constraints.budget.usedMps).toBeCloseTo(10, 6);
    expect(legality.constraints.deadline.deadlineSeconds).toBe(RULES.deadlineSeconds);
    expect(legality.constraints.altitudeFloor.floorAltitudeM).toBeGreaterThan(0);
  });
});

describe('each reason in isolation', () => {
  it('L1 — over budget', () => {
    const legality = evaluateLegality(timelineResultFor(planOf([600, 150])), RULES);
    if (!legality.evaluable) throw new Error('expected an evaluable timeline');
    const reason = definitely(legality.reasons.find((r) => r.code === 'L1'));
    expect(reason.blocking).toBe(true);
    expect(reason.message.key).toBe('legality.l1.overBudget');
    if (reason.message.key === 'legality.l1.overBudget') {
      expect(reason.message.params.excessMps).toBeCloseTo(50, 6);
    }
    expect(legality.commitAllowed).toBe(false);
  });

  it('L2 — below the altitude floor, with the epoch the message quotes', () => {
    const low = elliptical(R_EARTH_EQ + 50_000, LEO_RADIUS_M);
    const legality = evaluateLegality(timelineResultFor(planOf(), { initialState: low }), RULES);
    if (!legality.evaluable) throw new Error('expected an evaluable timeline');
    const reason = definitely(legality.reasons.find((r) => r.code === 'L2'));
    expect(reason.message.key).toBe('legality.l2.belowAltitudeFloor');
    expect(reason.epoch).not.toBeNull();
    // The bands the timeline draws come back with the reason rather than being
    // recomputed by whatever draws them.
    expect(reason.intervals.length).toBeGreaterThan(0);
  });

  it('L3 — a burn after the deadline', () => {
    const legality = evaluateLegality(timelineResultFor(planOf([600, 5], [5 * 3600, 5])), RULES);
    if (!legality.evaluable) throw new Error('expected an evaluable timeline');
    const reason = definitely(legality.reasons.find((r) => r.code === 'L3'));
    expect(reason.message.key).toBe('legality.l3.pastDeadline');
    if (reason.message.key === 'legality.l3.pastDeadline') {
      expect(reason.message.params.overSeconds).toBeCloseTo(3600, 3);
    }
  });

  it('L4 — an arc that escapes', () => {
    const legality = evaluateLegality(
      timelineResultFor(planOf([600, 4000]), { initialState: circular(LEO_RADIUS_M) }),
      { ...RULES, budgetMps: 1e6 },
    );
    if (!legality.evaluable) throw new Error('expected an evaluable timeline');
    const reason = definitely(legality.reasons.find((r) => r.code === 'L4'));
    expect(reason.message.key).toBe('legality.l4.escapes');
    if (reason.message.key === 'legality.l4.escapes') {
      expect(reason.message.params.eccentricity).toBeGreaterThanOrEqual(1);
      expect(reason.message.params.arcIndex).toBe(1);
    }
  });

  /**
   * `L5` cannot be reached through `createPlan`, which refuses the spacing itself —
   * so the only way to reach the check is to assemble the node array directly. That
   * this test has to do so is the evidence for the claim in `legality.ts`: the rule
   * lives in a constructor, and legality's contract is over the plan as data.
   */
  it('L5 — two nodes closer than the minimum spacing', () => {
    const close: readonly ManeuverNode[] = [nodeAt(600, 5), nodeAt(600.5, 5)];

    // The ordinary path refuses this before legality ever sees it, which is the whole
    // point of the note in `legality.ts` — so the only way to reach the check is to
    // assemble the plan directly.
    expect(() => createPlan([...close])).toThrow(/at least 1 s apart/);

    const plan: Plan = { nodes: close };
    const legality = evaluateLegality(timelineResultFor(plan), RULES);
    if (!legality.evaluable) throw new Error('expected an evaluable timeline');
    const reason = definitely(legality.reasons.find((r) => r.code === 'L5'));
    expect(reason.blocking).toBe(true);
    if (reason.message.key === 'legality.l5.nodesTooClose') {
      expect(reason.message.params.gapSeconds).toBeCloseTo(0.5, 3);
      expect(reason.message.params.minimumSeconds).toBe(MINIMUM_NODE_SPACING_S);
    }
  });
});

describe('L6 is a warning and never blocks commit', () => {
  // §6.4: "Committing a plan you know will fail is a legitimate way to learn."
  it('reports the objective as unmet without disabling commit', () => {
    const timeline = timelineFor(planOf([600, 10]));
    const objective = evaluateReachOrbit(timeline, {
      semiLatusRectum: metres(LEO_RADIUS_M + 5e6),
      eccentricity: 0,
      inclination: radians(0),
      raan: radians(0),
      argp: radians(0),
      trueAnomaly: radians(0),
    });
    expect(objective.met).toBe(false);

    const legality = evaluateLegality(timelineResultFor(planOf([600, 10])), RULES, objective);
    if (!legality.evaluable) throw new Error('expected an evaluable timeline');
    const reason = definitely(legality.reasons.find((r) => r.code === 'L6'));
    expect(reason.blocking).toBe(false);
    expect(legality.commitAllowed).toBe(true);
  });

  it('says nothing when the objective was not evaluated — that is not "not met"', () => {
    const legality = evaluateLegality(timelineResultFor(planOf([600, 10])), RULES, null);
    if (!legality.evaluable) throw new Error('expected an evaluable timeline');
    expect(legality.reasons.map((r) => r.code)).not.toContain('L6');
  });
});

describe('all simultaneous failures are returned together', () => {
  it('reports L1, L2 and L3 from one plan', () => {
    // Starts below the floor, burns past the deadline, and spends more than the budget.
    const low = elliptical(R_EARTH_EQ + 50_000, LEO_RADIUS_M);
    const reported = codes(
      { budgetMps: 10, deadlineSeconds: 3600 },
      planOf([600, 40], [5 * 3600, 40]),
      low,
    );
    for (const code of ['L1', 'L2', 'L3'] satisfies LegalityCode[]) {
      expect(reported).toContain(code);
    }
  });

  it('orders the reasons L1 through L6, so a panel renders them the same way twice', () => {
    const low = elliptical(R_EARTH_EQ + 50_000, LEO_RADIUS_M);
    const reported = codes(
      { budgetMps: 10, deadlineSeconds: 3600 },
      planOf([600, 40], [5 * 3600, 40]),
      low,
    );
    expect(reported).toStrictEqual([...reported].sort());
  });
});

describe('a plan with no timeline', () => {
  it('is not evaluable, blocks commit, and says what actually happened', () => {
    // Built so the cancellation is exact rather than nearly so, the same way
    // `timeline.test.ts` reaches this case: the node sits on the start epoch, so the
    // burn is applied to `state` itself with no propagation in between, and the RTN
    // basis for a state along +x moving along +y is a permutation of the identity. The
    // transverse speed and the burn come from the same count, so their sum is exactly
    // zero — which quantisation (DEP-09) would otherwise prevent, leaving a residual
    // 5e-5 m/s and a very thin ellipse rather than a rectilinear state.
    const transverse = fromDeltaVCounts(75_000_000);
    const state: State = {
      position: eci(V.vec3(metres(7e6), metres(0), metres(0))),
      velocity: eci(V.vec3(metresPerSec(0), transverse, metresPerSec(0))),
    };
    const plan: Plan = { nodes: [maneuverNodeFromCounts(0, [0, -75_000_000, 0])] };

    const legality = evaluateLegality(timelineResultFor(plan, { initialState: state }), {
      ...RULES,
      budgetMps: 1e6,
    });
    expect(legality.evaluable).toBe(false);
    expect(legality.commitAllowed).toBe(false);
    if (!legality.evaluable) {
      expect(legality.reason.key).toBe('legality.plan.rectilinear');
      expect(legality.failure.reason).toBe('rectilinear');
      if (legality.reason.key === 'legality.plan.rectilinear') {
        expect(legality.reason.params.nodeIndex).toBe(0);
      }
    }
  });
});
