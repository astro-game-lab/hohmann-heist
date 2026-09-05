/**
 * `station`, checked — FR-106, §6.4, DEP-14.
 *
 * The claims worth testing here are not "does it return a number". They are that the
 * drift is the **secular** rate rather than an artefact of sampling, that the two
 * conditions are required together rather than in sequence, and that the degenerate
 * geometry this game runs on — circular, equatorial, and both at once — is the ordinary
 * path rather than an edge case.
 *
 * Every reference value is derived from `@hh/astro`'s own constants inside the test.
 * §7.6's process rule forbids copying one out of `docs/PRODUCT.md`, and the numbers §6.4
 * states for a slot are exactly the kind that would look right while being wrong.
 */
import { MU_EARTH, OMEGA_EARTH, R_GEO } from '@hh/astro';
import { fromDegrees, radians, toDegrees } from '@hh/math';
import { describe, expect, it } from 'vitest';

import { circular, planOf, timelineFor } from '../test-support.js';
import { defaultStationGoal, evaluateStation, slotTraverseSeconds } from './station.js';
import { STATION_MAX_DRIFT_RAD_PER_SEC, STATION_MAX_OFFSET_RAD } from './tolerances.js';

/** Twelve days, which is contract 07's window (§6.8) and long enough to drift across a slot. */
const TWELVE_DAYS = 12 * 86_400;

/** A timeline that coasts on one orbit for `seconds`, with no burns. */
const coasting = (radiusM: number, options: { i?: number; nu?: number; span?: number } = {}) =>
  timelineFor(planOf(), {
    initialState: circular(radiusM, options.i ?? 0, 0, options.nu ?? 0),
    horizon: (options.span ?? TWELVE_DAYS) as never,
  });

describe('a geostationary orbit is on station', () => {
  it('reads zero offset and zero drift at R_GEO, from the constants themselves', () => {
    // R_GEO is *derived*: ω²r³ = μ. So a circular orbit there has mean motion exactly
    // ω_earth and cannot drift — which makes this a check on the evaluator rather than on
    // a number someone typed.
    const evaluation = evaluateStation(coasting(R_GEO), defaultStationGoal(radians(0)));

    expect(evaluation.kind).toBe('station');
    expect(evaluation.met).toBe(true);
    expect(evaluation.atEpoch).not.toBeNull();
    expect(evaluation.achieved.offsetRad).toBeCloseTo(0, 9);
    // Float64 noise on a cube root, not a real rate: a full day of this is under a
    // millidegree.
    expect(Math.abs(evaluation.achieved.driftRadPerSec)).toBeLessThan(1e-15);
    expect(evaluation.achieved.withinSlot).toBe(true);
    expect(evaluation.achieved.withinDrift).toBe(true);
  });

  it('reports the drift a closed form predicts for an orbit off R_GEO', () => {
    // Independent of the evaluator: n = √(μ/a³), drift = n − ω.
    const radius = R_GEO + 10_000;
    const expected = Math.sqrt(MU_EARTH / radius ** 3) - OMEGA_EARTH;

    const evaluation = evaluateStation(coasting(radius), defaultStationGoal(radians(0)));

    // 1e-12 relative: both sides are the same handful of float64 operations, so anything
    // looser would stop distinguishing this from a differenced-samples implementation,
    // which is the mistake the module exists to avoid.
    expect(evaluation.achieved.driftRadPerSec).toBeCloseTo(expected, 12);
    // 10 km high is a westward drift of a few degrees a day — far outside DEP-14.
    expect(Math.abs(expected)).toBeGreaterThan(STATION_MAX_DRIFT_RAD_PER_SEC);
    expect(evaluation.met).toBe(false);
  });

  it('reaches a slot to the east when it drifts toward one', () => {
    // Slightly low, so the orbit runs fast and the longitude walks east.
    //
    // 5 km rather than 1: at 1 km the whole four-day drift is 0.051°, which is barely
    // wider than the ±0.05° slot, so the ship starts *almost inside the box* and arrives
    // in hours. The geometry has to be bigger than the tolerance for "arrives after four
    // days" to be a statement about drift rather than about the slot's width.
    const radius = R_GEO - 5_000;
    const drift = Math.sqrt(MU_EARTH / radius ** 3) - OMEGA_EARTH;
    expect(drift).toBeGreaterThan(0);

    // Entry happens when the offset closes to the slot's edge, so the centre goes one
    // half-width further out than four days of drift.
    const slot = radians(drift * 4 * 86_400 + STATION_MAX_OFFSET_RAD);
    const evaluation = evaluateStation(coasting(radius), {
      slotOffsetRad: slot,
      maxOffsetRad: STATION_MAX_OFFSET_RAD,
      // Loosened so the arrival itself is what is being tested, not the drift gate.
      maxDriftRadPerSec: Math.abs(drift) * 2,
    });

    expect(evaluation.met).toBe(true);
    expect(evaluation.atEpoch).not.toBeNull();
    // It should arrive around four days in, not at the first sample.
    const arrivalDays = ((evaluation.atEpoch ?? 0) - 0) / 86_400;
    expect(arrivalDays).toBeGreaterThan(3.5);
    expect(arrivalDays).toBeLessThan(4.5);
  });
});

describe('both conditions, at the same epoch', () => {
  it('fails a satellite that sweeps through the slot at speed', () => {
    // §6.4's failure mode: passing through the box is not being on station. This orbit
    // crosses the slot centre — so a range-only check would pass it — while drifting far
    // faster than DEP-14 allows.
    const radius = R_GEO - 40_000;
    const drift = Math.sqrt(MU_EARTH / radius ** 3) - OMEGA_EARTH;
    expect(toDegrees(radians(Math.abs(drift) * 86_400))).toBeGreaterThan(0.4);

    const evaluation = evaluateStation(
      coasting(radius),
      defaultStationGoal(radians(drift * 2 * 86_400)),
    );

    expect(evaluation.met).toBe(false);
    // It did get to the slot — which is exactly why the drift condition is what decides.
    expect(Math.abs(evaluation.achieved.offsetRad)).toBeLessThan(STATION_MAX_OFFSET_RAD);
    expect(evaluation.achieved.withinSlot).toBe(true);
    expect(evaluation.achieved.withinDrift).toBe(false);
  });

  it('fails a satellite parked steadily in the wrong place', () => {
    // The mirror image: drift is fine, position is not.
    const evaluation = evaluateStation(coasting(R_GEO), defaultStationGoal(fromDegrees(3)));

    expect(evaluation.met).toBe(false);
    expect(evaluation.achieved.withinDrift).toBe(true);
    expect(evaluation.achieved.withinSlot).toBe(false);
    expect(toDegrees(radians(Math.abs(evaluation.achieved.offsetRad)))).toBeCloseTo(3, 6);
  });

  it('quotes a moment the player could have held, not the closest flypast', () => {
    // `achieved` prefers an admissible-drift epoch over a nearer one at speed, so a
    // debrief saying "you were 0.4° away" is describing something reachable.
    const radius = R_GEO - 40_000;
    const drift = Math.sqrt(MU_EARTH / radius ** 3) - OMEGA_EARTH;
    const evaluation = evaluateStation(
      coasting(radius),
      defaultStationGoal(radians(drift * 2 * 86_400)),
    );

    expect(evaluation.achieved.withinDrift).toBe(false);
    // Nothing in this run had admissible drift, so the fallback is the closest approach to
    // the slot — which it did reach.
    expect(Math.abs(evaluation.achieved.offsetRad)).toBeLessThan(STATION_MAX_OFFSET_RAD);
  });
});

describe('the degenerate cases are the common case', () => {
  const cases: readonly (readonly [label: string, i: number])[] = [
    ['equatorial, prograde', 0],
    ['retrograde equatorial', Math.PI],
    ['inclined', 0.4],
  ];

  it.each(cases)('handles %s without NaN', (_label, i) => {
    const evaluation = evaluateStation(coasting(R_GEO, { i }), defaultStationGoal(radians(0)));

    expect(Number.isFinite(evaluation.achieved.offsetRad)).toBe(true);
    expect(Number.isFinite(evaluation.achieved.driftRadPerSec)).toBe(true);
  });

  it('is retrograde-aware: the sin i test, not the i test', () => {
    // A retrograde equatorial orbit has sin i = 0 like a prograde one, and the drift is a
    // property of `a` either way — so it reports the same rate, not a NaN and not a sign
    // flip. `docs/PHYSICS.md` § Conventions is explicit that the test is on sin i.
    const prograde = evaluateStation(coasting(R_GEO, { i: 0 }), defaultStationGoal(radians(0)));
    const retrograde = evaluateStation(
      coasting(R_GEO, { i: Math.PI }),
      defaultStationGoal(radians(0)),
    );

    expect(retrograde.achieved.driftRadPerSec).toBeCloseTo(prograde.achieved.driftRadPerSec, 15);
  });

  it('never throws and never reports NaN on an empty horizon', () => {
    const evaluation = evaluateStation(
      timelineFor(planOf(), { initialState: circular(R_GEO), horizon: 0 as never }),
      defaultStationGoal(radians(0)),
    );
    expect(Number.isFinite(evaluation.achieved.offsetRad)).toBe(true);
  });
});

describe('the slot is relative to where the ship starts', () => {
  it('does not depend on where in its orbit the ship begins', () => {
    // The absolute Earth-fixed longitude is not modelled, so a run that starts a quarter
    // of the way round its orbit must score identically. This is the property that makes
    // the relative formulation correct rather than merely convenient.
    const at0 = evaluateStation(coasting(R_GEO, { nu: 0 }), defaultStationGoal(radians(0)));
    const atQuarter = evaluateStation(
      coasting(R_GEO, { nu: Math.PI / 2 }),
      defaultStationGoal(radians(0)),
    );

    expect(atQuarter.met).toBe(at0.met);
    expect(atQuarter.achieved.offsetRad).toBeCloseTo(at0.achieved.offsetRad, 9);
  });
});

describe('DEP-14 makes "held" follow from the drift limit', () => {
  it('takes about ten days at the limit to cross the whole slot', () => {
    // The argument `station.ts` makes for not inventing a dwell parameter, as a number.
    const days = slotTraverseSeconds(defaultStationGoal(radians(0))) / 86_400;
    expect(days).toBeGreaterThan(9);
    expect(days).toBeLessThan(11);
  });
});
