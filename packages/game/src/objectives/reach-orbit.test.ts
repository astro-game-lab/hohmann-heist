/**
 * `reach_orbit` evaluation — #75, FR-106, §6.4.
 */
import type { OrbitShape } from '@hh/astro';
import { MU_EARTH, elementsFromState } from '@hh/astro';
import { fromDegrees, metres, radians } from '@hh/math';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  HORIZON,
  LEO_RADIUS_M,
  circular,
  definitely,
  elliptical,
  planOf,
  timelineFor,
} from '../test-support.js';
import { evaluateReachOrbit } from './reach-orbit.js';
import type { ElementComparison } from './reach-orbit.js';
import { REACH_ORBIT_TOLERANCE } from './tolerances.js';

/** The orbit a state is on, as a goal. */
const goalFrom = (radiusM: number, inclinationRad = 0, raanRad = 0, argpRad = 0): OrbitShape => ({
  semiLatusRectum: metres(radiusM),
  eccentricity: 0,
  inclination: radians(inclinationRad),
  raan: radians(raanRad),
  argp: radians(argpRad),
  trueAnomaly: radians(0),
});

const find = (
  comparisons: readonly ElementComparison[],
  element: ElementComparison['element'],
): ElementComparison => definitely(comparisons.find((c) => c.element === element));

/** The same, narrowed to a row that was actually compared. */
const compared = (
  comparisons: readonly ElementComparison[],
  element: ElementComparison['element'],
): Extract<ElementComparison, { compared: true }> => {
  const comparison = find(comparisons, element);
  if (!comparison.compared) throw new Error(`${element} was not compared`);
  return comparison;
};

describe('reach_orbit', () => {
  it('matches an orbit the plan is already on', () => {
    const state = circular(LEO_RADIUS_M, 0.9006, 1.1, 0.6);
    const timeline = timelineFor(planOf(), { initialState: state });
    const result = evaluateReachOrbit(timeline, goalFrom(LEO_RADIUS_M, 0.9006, 1.1));
    expect(result.met).toBe(true);
  });

  it('reports the achieving epoch as the start of the final arc', () => {
    const timeline = timelineFor(planOf([1200, 5], [3600, 5]));
    const result = evaluateReachOrbit(timeline, goalFrom(LEO_RADIUS_M));
    expect(result.atEpoch).toBe(definitely(timeline.arcs[timeline.arcs.length - 1]).startEpoch);
  });

  // §6.4: "held at the end of the plan". The first burn puts the ship on the goal
  // orbit; the second takes it off again. A momentary match is not success.
  it('refuses a match that the plan does not hold to the end', () => {
    // Circular 400 km, raised to a 400 x 600 km transfer and then circularised at the
    // wrong place: what matters is only that the last arc is not the goal.
    const state = circular(LEO_RADIUS_M);
    const goal = goalFrom(LEO_RADIUS_M);

    const held = evaluateReachOrbit(timelineFor(planOf(), { initialState: state }), goal);
    expect(held.met).toBe(true);

    const departed = evaluateReachOrbit(
      timelineFor(planOf([1800, 60]), { initialState: state }),
      goal,
    );
    expect(departed.met).toBe(false);
    // The orbit *was* the goal for the whole of arc 0, and that does not count.
    expect(
      definitely(departed.comparisons.find((c) => c.element === 'apoapsisRadius')).achieved,
    ).toBeGreaterThan(LEO_RADIUS_M + 100_000);
  });

  it('returns the achieved values on a miss, because the debrief states them', () => {
    const state = elliptical(LEO_RADIUS_M, LEO_RADIUS_M + 200_000);
    const result = evaluateReachOrbit(
      timelineFor(planOf(), { initialState: state }),
      goalFrom(LEO_RADIUS_M),
    );
    expect(result.met).toBe(false);
    expect(result.achieved.periapsisRadiusM).toBeCloseTo(LEO_RADIUS_M, 0);
    expect(result.achieved.apoapsisRadiusM).toBeCloseTo(LEO_RADIUS_M + 200_000, 0);
    expect(result.achieved.eccentricity).toBeGreaterThan(0);
  });

  it('is within tolerance at the tolerance, and outside it just beyond', () => {
    const state = circular(LEO_RADIUS_M);
    const timeline = timelineFor(planOf(), { initialState: state });

    const inside = evaluateReachOrbit(timeline, goalFrom(LEO_RADIUS_M - 9_000));
    expect(inside.met).toBe(true);

    const outside = evaluateReachOrbit(timeline, goalFrom(LEO_RADIUS_M - 11_000));
    expect(outside.met).toBe(false);
    expect(compared(outside.comparisons, 'periapsisRadius').within).toBe(false);
  });
});

describe('degenerate goals, which are the common case', () => {
  const timeline = timelineFor(planOf(), { initialState: circular(LEO_RADIUS_M, 0.5, 1.0, 2.0) });

  it('skips the argument of periapsis for a circular goal', () => {
    const result = evaluateReachOrbit(timeline, goalFrom(LEO_RADIUS_M, 0.5, 1.0, 3.0));
    const argp = find(result.comparisons, 'argumentOfPeriapsis');
    expect(argp.compared).toBe(false);
    if (!argp.compared) expect(argp.reason).toBe('goal-circular');
    // Skipped, and still reported: a briefing says which elements were checked.
    expect(Number.isFinite(argp.achieved)).toBe(true);
  });

  it('skips the RAAN for an equatorial goal', () => {
    const equatorial = timelineFor(planOf(), { initialState: circular(LEO_RADIUS_M, 0, 0, 1.0) });
    const result = evaluateReachOrbit(equatorial, goalFrom(LEO_RADIUS_M, 0, 2.0));
    const raan = find(result.comparisons, 'raan');
    expect(raan.compared).toBe(false);
    if (!raan.compared) expect(raan.reason).toBe('goal-equatorial');
    expect(result.met).toBe(true);
  });

  it('skips both for a circular equatorial goal, and still compares the shape', () => {
    const orbit = timelineFor(planOf(), { initialState: circular(LEO_RADIUS_M, 0, 0, 1.0) });
    const met = evaluateReachOrbit(orbit, goalFrom(LEO_RADIUS_M, 0, 3.0, 3.0));
    expect(met.met).toBe(true);
    expect(met.comparisons.filter((c) => c.compared).map((c) => c.element)).toStrictEqual([
      'periapsisRadius',
      'apoapsisRadius',
      'inclination',
    ]);

    // The shape is still checked: a circular equatorial goal is not a free pass.
    const missed = evaluateReachOrbit(orbit, goalFrom(LEO_RADIUS_M + 50_000, 0, 3.0, 3.0));
    expect(missed.met).toBe(false);
  });

  // §7.2: the equatorial test is on `sin i`, so it catches retrograde too.
  it('treats a retrograde equatorial goal as equatorial', () => {
    const retrograde = timelineFor(planOf(), {
      initialState: circular(LEO_RADIUS_M, Math.PI, 0, 1.0),
    });
    const result = evaluateReachOrbit(retrograde, goalFrom(LEO_RADIUS_M, Math.PI, 2.5));
    expect(find(result.comparisons, 'raan').compared).toBe(false);
    expect(result.met).toBe(true);
  });

  it('never returns NaN for a degenerate orbit', () => {
    const result = evaluateReachOrbit(
      timelineFor(planOf(), { initialState: circular(LEO_RADIUS_M) }),
      goalFrom(LEO_RADIUS_M),
    );
    for (const value of Object.values(result.achieved)) expect(Number.isNaN(value)).toBe(false);
  });
});

describe('angles are compared on the shortest arc', () => {
  it('reads 359.95° and 0.05° as 0.1° apart', () => {
    // An orbit whose RAAN is just below 2π, against a goal at just above 0. A naive
    // subtraction would call these 359.9° apart and fail every time.
    const nearZero = 2 * Math.PI - fromDegrees(0.05);
    const timeline = timelineFor(planOf(), {
      initialState: circular(LEO_RADIUS_M, 0.9, nearZero, 0.3),
    });
    const result = evaluateReachOrbit(timeline, goalFrom(LEO_RADIUS_M, 0.9, fromDegrees(0.05)));
    const raan = find(result.comparisons, 'raan');
    expect(raan.compared).toBe(true);
    if (raan.compared) expect(Math.abs(raan.difference)).toBeLessThan(fromDegrees(0.11));
    expect(result.met).toBe(true);
  });
});

describe('an open orbit', () => {
  it('misses rather than matching by an infinite arithmetic accident', () => {
    // A burn large enough to escape. Apoapsis is then infinite, and `Infinity -
    // Infinity` is NaN — which is not greater than any tolerance, so an unguarded
    // comparison would pass.
    const escape = timelineFor(planOf([600, 4000]), { initialState: circular(LEO_RADIUS_M) });
    const last = definitely(escape.arcs[escape.arcs.length - 1]);
    expect(last.elements.eccentricity).toBeGreaterThan(1);

    const result = evaluateReachOrbit(escape, goalFrom(LEO_RADIUS_M));
    expect(result.met).toBe(false);
    expect(compared(result.comparisons, 'apoapsisRadius').within).toBe(false);
  });
});

describe('monotone in tolerance (§13.3)', () => {
  // Loosening a tolerance must never turn a pass into a fail. Structural here — the
  // achieved values are computed without reference to the tolerance — and asserted
  // because "structural" is an argument and this is a fact.
  it('never turns a pass into a fail', () => {
    const timeline = timelineFor(planOf(), {
      initialState: circular(LEO_RADIUS_M, 0.9006, 1.1, 0.6),
    });
    const arc = definitely(timeline.arcs[0]);
    const achieved = elementsFromState(arc.state.position, arc.state.velocity, MU_EARTH);

    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 5e5, noNaN: true }),
        fc.double({ min: 1e-6, max: 1, noNaN: true }),
        fc.double({ min: 1, max: 3, noNaN: true }),
        fc.double({ min: -2e5, max: 2e5, noNaN: true }),
        (radiusM, angleRad, factor, offsetM) => {
          const goal: OrbitShape = {
            semiLatusRectum: metres(achieved.semiLatusRectum + offsetM),
            eccentricity: achieved.eccentricity,
            inclination: achieved.inclination,
            raan: achieved.raan,
            argp: achieved.argp,
            trueAnomaly: radians(0),
          };
          const tight = evaluateReachOrbit(timeline, goal, {
            radiusM: metres(radiusM),
            angleRad: radians(angleRad),
          });
          const loose = evaluateReachOrbit(timeline, goal, {
            radiusM: metres(radiusM * factor),
            angleRad: radians(Math.min(angleRad * factor, Math.PI)),
          });
          return !tight.met || loose.met;
        },
      ),
    );
  });

  it("uses DEP-13's tolerance by default", () => {
    const timeline = timelineFor(planOf(), { initialState: circular(LEO_RADIUS_M) });
    expect(evaluateReachOrbit(timeline, goalFrom(LEO_RADIUS_M)).tolerance).toBe(
      REACH_ORBIT_TOLERANCE,
    );
    expect(HORIZON).toBeGreaterThan(0);
  });
});
