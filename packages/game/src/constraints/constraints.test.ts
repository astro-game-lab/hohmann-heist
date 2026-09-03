/**
 * Constraint evaluation — #78, FR-107, §6.5.
 *
 * The theme of every case here is FR-107's "every violating interval": a boolean would
 * satisfy the rule and fail the product, because §6.5 draws these as bands on the
 * timeline and a band needs two epochs.
 */
import { R_EARTH_EQ, epoch } from '@hh/astro';
import { describe, expect, it } from 'vitest';

import { ALTITUDE_FLOOR_M } from '../objectives/tolerances.js';
import {
  HORIZON,
  LEO_RADIUS_M,
  START,
  circular,
  definitely,
  elliptical,
  planOf,
  timelineFor,
} from '../test-support.js';
import { BUDGET_WARNING_FRACTION, evaluateBudget, totalDeltaV } from './budget.js';
import { evaluateDeadline } from './deadline.js';
import { evaluateAltitudeFloor } from './altitude-floor.js';
import { firstViolationEpoch, isViolated, mergeAbutting } from './violation.js';

describe('the Δv budget (DEP-02)', () => {
  it('sums burn magnitudes, not vectors', () => {
    // 10 m/s prograde then 10 m/s retrograde: the ship ends where it started and the
    // propellant does not come back.
    const timeline = timelineFor(planOf([600, 10], [1800, -10]));
    expect(totalDeltaV(timeline)).toBeCloseTo(20, 6);
  });

  it('is satisfied by an empty plan, and reports no violation rather than an error', () => {
    const evaluation = evaluateBudget(timelineFor(planOf()), 250);
    expect(evaluation.violations).toStrictEqual([]);
    expect(isViolated(evaluation)).toBe(false);
    expect(evaluation.remainingMps).toBe(250);
  });

  it('returns an interval starting at the burn that broke the budget', () => {
    const timeline = timelineFor(planOf([600, 40], [1800, 40], [3000, 40]));
    const evaluation = evaluateBudget(timeline, 100);
    expect(evaluation.exceededAtNode).toBe(2);
    const interval = definitely(evaluation.violations[0]);
    expect(interval.start).toBe(definitely(timeline.plan.nodes[2]).epoch);
    expect(interval.end).toBe(timeline.horizon);
    expect(interval.clippedEnd).toBe(true);
  });

  // §8.3.4: the HUD bar is amber at 90% and red above 100%.
  it('reports the three HUD states at their thresholds', () => {
    const under = evaluateBudget(timelineFor(planOf([600, 50])), 100);
    expect(under.level).toBe('ok');

    const amber = evaluateBudget(timelineFor(planOf([600, 90])), 100);
    expect(amber.fraction).toBeCloseTo(BUDGET_WARNING_FRACTION, 6);
    expect(amber.level).toBe('warning');

    // Exactly at budget is still legal — the cap is `Σ|Δv| > budget`.
    const exact = evaluateBudget(timelineFor(planOf([600, 100])), 100);
    expect(exact.level).toBe('warning');
    expect(exact.violations).toStrictEqual([]);

    const over = evaluateBudget(timelineFor(planOf([600, 101])), 100);
    expect(over.level).toBe('exceeded');
    expect(over.violations).toHaveLength(1);
  });

  it('does not divide by zero on a zero budget', () => {
    expect(evaluateBudget(timelineFor(planOf()), 0).fraction).toBe(0);
    expect(evaluateBudget(timelineFor(planOf([600, 1])), 0).fraction).toBe(
      Number.POSITIVE_INFINITY,
    );
  });
});

describe('the deadline', () => {
  it('passes a plan whose burns are all before it', () => {
    const evaluation = evaluateDeadline(timelineFor(planOf([600, 10], [1800, 10])), 3600);
    expect(evaluation.violations).toStrictEqual([]);
    expect(evaluation.overrunSeconds).toBeLessThan(0);
    expect(evaluation.firstLateNode).toBeNull();
  });

  it('is about burns, not about the horizon', () => {
    // The horizon is six hours and the deadline is one; a plan that burns inside the
    // deadline is legal even though the timeline runs well past it (§6.3).
    const evaluation = evaluateDeadline(timelineFor(planOf([600, 10])), 3600);
    expect(HORIZON).toBeGreaterThan(3600);
    expect(evaluation.violations).toStrictEqual([]);
  });

  it('returns the span from the deadline to the last burn', () => {
    const timeline = timelineFor(planOf([600, 10], [5400, 10]));
    const evaluation = evaluateDeadline(timeline, 3600);
    expect(evaluation.firstLateNode).toBe(1);
    expect(evaluation.overrunSeconds).toBeCloseTo(1800, 6);
    const interval = definitely(evaluation.violations[0]);
    expect(interval.start).toBe(START + 3600);
    expect(interval.end).toBe(definitely(timeline.plan.nodes[1]).epoch);
  });

  it('has nothing to say about a plan with no burns', () => {
    const evaluation = evaluateDeadline(timelineFor(planOf()), 60);
    expect(evaluation.lastBurnMetSeconds).toBeNull();
    expect(evaluation.violations).toStrictEqual([]);
  });
});

describe('the altitude floor (DEP-08)', () => {
  it('is silent for an orbit that never approaches it', () => {
    const evaluation = evaluateAltitudeFloor(timelineFor(planOf()));
    expect(evaluation.violations).toStrictEqual([]);
    expect(evaluation.totalSecondsBelow).toBe(0);
    expect(firstViolationEpoch(evaluation)).toBeNull();
  });

  it('converts the altitude to a radius using the equatorial radius', () => {
    const evaluation = evaluateAltitudeFloor(timelineFor(planOf()));
    expect(evaluation.floorAltitudeM).toBe(ALTITUDE_FLOOR_M);
    expect(evaluation.referenceRadiusM).toBe(R_EARTH_EQ);
  });

  it('finds the interval a low periapsis spends below the floor', () => {
    // Periapsis 50 km below the floor, apoapsis at the parking orbit: the orbit dips
    // under twice per revolution boundary and comes back out.
    const low = elliptical(R_EARTH_EQ + 50_000, LEO_RADIUS_M);
    const evaluation = evaluateAltitudeFloor(timelineFor(planOf(), { initialState: low }));
    expect(evaluation.violations.length).toBeGreaterThan(0);
    expect(evaluation.totalSecondsBelow).toBeGreaterThan(0);
    for (const interval of evaluation.violations) {
      expect(interval.kind).toBe('altitude_floor');
      expect(interval.end).toBeGreaterThan(interval.start);
    }
  });

  it('reports every excursion, not just the first', () => {
    const low = elliptical(R_EARTH_EQ + 50_000, LEO_RADIUS_M);
    const evaluation = evaluateAltitudeFloor(timelineFor(planOf(), { initialState: low }));
    // Six hours is a little under four revolutions of this orbit, so there are several.
    expect(evaluation.violations.length).toBeGreaterThan(2);
  });

  it('takes a different floor, so a no-fly shell can reuse it', () => {
    const evaluation = evaluateAltitudeFloor(
      timelineFor(planOf(), { initialState: circular(LEO_RADIUS_M) }),
      LEO_RADIUS_M - R_EARTH_EQ + 10_000,
    );
    // The whole orbit is now "below" a floor above it: one interval, clipped at both ends.
    const interval = definitely(evaluation.violations[0]);
    expect(interval.clippedStart).toBe(true);
    expect(interval.clippedEnd).toBe(true);
  });
});

describe('merging intervals that abut', () => {
  // A dip below the floor that spans a burn comes back from the per-arc search as two
  // intervals meeting at the node's epoch. Two bands with a hairline between them read
  // as two excursions, and one happened.
  it('joins two intervals that meet exactly', () => {
    const merged = mergeAbutting([
      {
        kind: 'altitude_floor',
        start: epoch(100),
        end: epoch(200),
        clippedStart: false,
        clippedEnd: true,
      },
      {
        kind: 'altitude_floor',
        start: epoch(200),
        end: epoch(300),
        clippedStart: true,
        clippedEnd: false,
      },
    ]);
    expect(merged).toHaveLength(1);
    expect(definitely(merged[0]).start).toBe(100);
    expect(definitely(merged[0]).end).toBe(300);
    expect(definitely(merged[0]).clippedStart).toBe(false);
    expect(definitely(merged[0]).clippedEnd).toBe(false);
  });

  it('leaves a gap alone', () => {
    const merged = mergeAbutting([
      {
        kind: 'altitude_floor',
        start: epoch(100),
        end: epoch(200),
        clippedStart: false,
        clippedEnd: false,
      },
      {
        kind: 'altitude_floor',
        start: epoch(201),
        end: epoch(300),
        clippedStart: false,
        clippedEnd: false,
      },
    ]);
    expect(merged).toHaveLength(2);
  });
});
