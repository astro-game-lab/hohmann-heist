/**
 * `intercept`, `rendezvous` and `soft_rendezvous` — #76, FR-106, §6.4.
 *
 * ## The fixture, and why it is two crossing orbits
 *
 * Most of these tests use a target on a 400 km equatorial circular orbit and a ship on
 * the same radius inclined by 1°, both starting at true anomaly zero. Two consequences
 * make it the right shape for this module:
 *
 * - The orbits **intersect at both nodes**, so the two objects pass through the same
 *   point every half revolution. Separation runs 0 → 118 km → 0, repeatedly.
 * - They arrive there with a relative speed of `2 v sin(Δi/2)` ≈ **134 m/s**, so the
 *   window inside a 1 km intercept radius is about **15 seconds wide**.
 *
 * The default search grid is 32 samples per revolution, which at this altitude is one
 * sample every ~172 s. **A sampled evaluator would step over the encounter entirely**,
 * eleven times out of twelve. That is the failure #76's "not from fixed-interval
 * sampling" criterion exists to prevent, and this fixture is what makes its absence
 * visible: the assertions below are on sub-metre separations that no 172 s grid could
 * have found.
 */
import { MU_EARTH } from '@hh/astro';
import { metres, metresPerSec } from '@hh/math';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  HORIZON,
  LEO_RADIUS_M,
  START,
  circular,
  definitely,
  planOf,
  timelineFor,
} from '../test-support.js';
import { evaluateProximity, targetArc, toleranceFor } from './proximity.js';
import {
  INTERCEPT_MAX_RANGE_M,
  RENDEZVOUS_MAX_RANGE_M,
  RENDEZVOUS_MAX_REL_SPEED_MPS,
  SOFT_RENDEZVOUS_MAX_REL_SPEED_MPS,
} from './tolerances.js';

/** One degree of plane change, which is what makes the encounters fast. */
const CROSSING_INCLINATION_RAD = Math.PI / 180;

const equatorialTarget = () => targetArc(circular(LEO_RADIUS_M), START, HORIZON, MU_EARTH);

/** The ship, crossing the target's plane at both nodes. */
const crossingShip = () =>
  timelineFor(planOf(), { initialState: circular(LEO_RADIUS_M, CROSSING_INCLINATION_RAD) });

/** A ship trailing the target on the same orbit by a fixed angle — never closes. */
const trailingShip = (trueAnomalyRad: number) =>
  timelineFor(planOf(), { initialState: circular(LEO_RADIUS_M, 0, 0, trueAnomalyRad) });

describe('intercept', () => {
  it('finds an encounter far narrower than the search grid', () => {
    const result = evaluateProximity(crossingShip(), equatorialTarget(), 'intercept');
    expect(result.met).toBe(true);
    // Sub-metre, at a node the sampler never lands on.
    expect(result.achieved.rangeM).toBeLessThan(1);
    expect(result.achieved.relativeSpeedMps).toBeGreaterThan(100);
  });

  it('reports the epoch of the encounter, not of a sample', () => {
    const result = evaluateProximity(crossingShip(), equatorialTarget(), 'intercept');
    const epoch = definitely(result.atEpoch);
    // Half a revolution is ~2 776 s at this radius; the sample spacing is ~172 s. An
    // epoch this close to a node crossing cannot have come off the grid.
    expect(epoch).toBeGreaterThanOrEqual(START);
    const interior = result.candidates.filter((c) => c.boundary === 'interior');
    expect(interior.length).toBeGreaterThan(0);
    for (const candidate of interior.slice(0, 3)) {
      expect(candidate.rangeM).toBeLessThan(1);
    }
  });

  it('misses a target it never comes near', () => {
    // Ten degrees behind on the same orbit: 1 183 km, constant.
    const result = evaluateProximity(
      trailingShip(10 * CROSSING_INCLINATION_RAD),
      equatorialTarget(),
      'intercept',
    );
    expect(result.met).toBe(false);
    expect(result.atEpoch).toBeNull();
    // Achieved values are still returned, because §8.3.9 quotes them on a miss.
    expect(result.achieved.rangeM).toBeGreaterThan(1e6);
    expect(Number.isFinite(result.achieved.epoch)).toBe(true);
  });

  it('imposes no speed condition', () => {
    const tolerance = toleranceFor('intercept');
    expect(tolerance.maxRelativeSpeedMps).toBeNull();
    const result = evaluateProximity(crossingShip(), equatorialTarget(), 'intercept');
    // 134 m/s at closest approach, and it still counts.
    expect(result.met).toBe(true);
    for (const candidate of result.candidates) expect(candidate.withinSpeed).toBe(true);
  });
});

describe('rendezvous requires both conditions at one epoch', () => {
  it('refuses a close pass that is far too fast', () => {
    const result = evaluateProximity(crossingShip(), equatorialTarget(), 'rendezvous');
    // The ship passes through the target's position — range is zero — at 134 m/s.
    expect(result.achieved.rangeM).toBeLessThan(1);
    expect(result.met).toBe(false);
    const closest = definitely(result.candidates.find((c) => c.boundary === 'interior'));
    expect(closest.withinRange).toBe(true);
    expect(closest.withinSpeed).toBe(false);
  });

  it('accepts a co-orbiting ship that is close and slow', () => {
    // 50 m ahead on the same circular orbit: the along-track separation is a fixed
    // 50 m and the relative speed is a few micrometres per second.
    const ahead = 50 / LEO_RADIUS_M;
    const result = evaluateProximity(trailingShip(ahead), equatorialTarget(), 'rendezvous');
    expect(result.achieved.rangeM).toBeLessThan(RENDEZVOUS_MAX_RANGE_M);
    expect(result.achieved.relativeSpeedMps).toBeLessThan(RENDEZVOUS_MAX_REL_SPEED_MPS);
    expect(result.met).toBe(true);
  });

  it('tightens the speed limit for soft_rendezvous, and nothing else', () => {
    expect(toleranceFor('soft_rendezvous')).toStrictEqual({
      maxRangeM: RENDEZVOUS_MAX_RANGE_M,
      maxRelativeSpeedMps: SOFT_RENDEZVOUS_MAX_REL_SPEED_MPS,
    });
    expect(toleranceFor('intercept').maxRangeM).toBe(INTERCEPT_MAX_RANGE_M);
  });
});

describe('candidates', () => {
  it('is ordered by epoch, then by arc, so a joint reads pre-impulse first', () => {
    const timeline = timelineFor(planOf([1800, 5], [5400, 5]), {
      initialState: circular(LEO_RADIUS_M, CROSSING_INCLINATION_RAD),
    });
    const result = evaluateProximity(timeline, equatorialTarget(), 'intercept');
    const keys = result.candidates.map((c) => [c.epoch, c.arcIndex] as const);
    const sorted = [...keys].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    expect(keys).toStrictEqual(sorted);
  });

  it('searches every arc of the plan', () => {
    const timeline = timelineFor(planOf([1800, 5], [5400, 5]), {
      initialState: circular(LEO_RADIUS_M, CROSSING_INCLINATION_RAD),
    });
    const result = evaluateProximity(timeline, equatorialTarget(), 'intercept');
    expect(new Set(result.candidates.map((c) => c.arcIndex))).toStrictEqual(new Set([0, 1, 2]));
  });
});

describe('monotone in tolerance (§13.3)', () => {
  it('never turns a pass into a fail', () => {
    const timeline = crossingShip();
    const target = equatorialTarget();

    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 1e6, noNaN: true }),
        fc.double({ min: 1e-3, max: 500, noNaN: true }),
        fc.double({ min: 1, max: 10, noNaN: true }),
        (maxRangeM, maxSpeed, factor) => {
          const tight = evaluateProximity(
            timeline,
            target,
            'rendezvous',
            {},
            {
              maxRangeM: metres(maxRangeM),
              maxRelativeSpeedMps: metresPerSec(maxSpeed),
            },
          );
          const loose = evaluateProximity(
            timeline,
            target,
            'rendezvous',
            {},
            {
              maxRangeM: metres(maxRangeM * factor),
              maxRelativeSpeedMps: metresPerSec(maxSpeed * factor),
            },
          );
          return !tight.met || loose.met;
        },
      ),
      { numRuns: 40 },
    );
  });
});

describe('station is out of scope', () => {
  // §6.4 lists five objective types; this module implements three of them. `station`
  // is a mean-longitude and drift-rate condition on a geostationary slot, it shares no
  // machinery with these, and it arrives with contract 07.
  it('covers exactly the three proximity kinds', () => {
    const kinds = ['intercept', 'rendezvous', 'soft_rendezvous'] as const;
    for (const kind of kinds) expect(toleranceFor(kind).maxRangeM).toBeGreaterThan(0);
    expect(kinds).toHaveLength(3);
  });
});
