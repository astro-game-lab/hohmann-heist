/**
 * The two marker builders — the regression that froze the ship and the target on screen.
 *
 * `MarkerSpec.offsetSeconds` is where a body *is*: `markerCentre` is exactly
 * `keplerianSampler(elements, mu)(offsetSeconds)`, so a constant offset is a marker that
 * cannot move however far the epoch runs. Both call sites used to pass one — the module
 * constant `MARKER_TRAIL_SECONDS = 900`, which is a *trail length* — and the result was a
 * ship and a target pinned 900 seconds into their opening orbit for the whole of a
 * scrub and the whole of a playback run.
 *
 * These tests assert the property that was missing rather than the numbers that happen to
 * come out: **the offset tracks the epoch**, and for the ship it is measured from the arc
 * the epoch lands on rather than from the start of the plan.
 */
import { MU_EARTH, epoch, stateFromElements, type OrbitShape } from '@hh/astro';
import { metres, radians } from '@hh/math';
import { buildTimeline, createPlan, maneuverNodeFromCounts, type Timeline } from '@hh/sim';
import { describe, expect, it } from 'vitest';

import { shipMarkerOf, targetMarkerOf } from './content.js';

const orbit = (semiLatusRectumM: number, eccentricity = 0.01): OrbitShape => ({
  semiLatusRectum: metres(semiLatusRectumM),
  eccentricity,
  inclination: radians(0),
  raan: radians(0),
  argp: radians(0),
  trueAnomaly: radians(0),
});

const START = 0;
const HORIZON = 14 * 3600;
const BURN_AT = 1200;

/** A one-burn plan, so there is a second arc for the ship to be on after the impulse. */
const timelineOf = (): Timeline => {
  const result = buildTimeline({
    startEpoch: epoch(START),
    initialState: stateFromElements(orbit(7_000_000), MU_EARTH),
    // DEP-09 quantises Δv to 1e-4 m/s, so 400 000 counts is 40 m/s prograde.
    plan: createPlan([maneuverNodeFromCounts(Math.round(BURN_AT * 1024), [0, 400_000, 0])]),
    horizon: epoch(HORIZON),
    mu: MU_EARTH,
  });
  if (!result.ok) throw new Error(`fixture timeline failed to build: ${JSON.stringify(result)}`);
  return result.timeline;
};

const fallback = orbit(7_000_000);

describe('shipMarkerOf', () => {
  it('places the ship at the epoch asked for, not at a fixed offset', () => {
    const timeline = timelineOf();
    const at = (seconds: number) =>
      shipMarkerOf(timeline, epoch(seconds), fallback, MU_EARTH).offsetSeconds;

    // The whole bug in one assertion: these were all 900 before.
    expect(at(0)).toBe(0);
    expect(at(300)).toBe(300);
    expect(at(900)).toBe(900);
    expect(new Set([at(0), at(300), at(900)]).size).toBe(3);
  });

  it('measures the offset from the arc the epoch lands on, not from the plan start', () => {
    const timeline = timelineOf();
    // 300 s after the burn is 300 s into arc 1, not 1500 s into arc 0. Getting this wrong
    // draws the ship a full quarter-orbit from where it is.
    const after = shipMarkerOf(timeline, epoch(BURN_AT + 300), fallback, MU_EARTH);
    expect(after.offsetSeconds).toBeCloseTo(300, 9);
  });

  it('puts the ship on the arc it is actually flying after a burn', () => {
    const timeline = timelineOf();
    const before = shipMarkerOf(timeline, epoch(BURN_AT - 300), fallback, MU_EARTH);
    const after = shipMarkerOf(timeline, epoch(BURN_AT + 300), fallback, MU_EARTH);
    // A 40 m/s prograde burn raises the orbit, so the two arcs are different conics. A
    // marker left on `arcs[0]` would sit on the parking orbit for the rest of the run.
    expect(after.elements.semiLatusRectum).not.toBe(before.elements.semiLatusRectum);
  });

  it('clamps an epoch past the horizon rather than extrapolating', () => {
    // Playback can land a float past the end on its last frame. The run is over, so the
    // marker belongs at the horizon — and `arcAt` stays a total function.
    const timeline = timelineOf();
    const past = shipMarkerOf(timeline, epoch(HORIZON + 5000), fallback, MU_EARTH);
    const atEnd = shipMarkerOf(timeline, epoch(HORIZON), fallback, MU_EARTH);
    expect(past.offsetSeconds).toBe(atEnd.offsetSeconds);
  });

  it('never reports a negative offset', () => {
    const timeline = timelineOf();
    expect(shipMarkerOf(timeline, epoch(START - 600), fallback, MU_EARTH).offsetSeconds).toBe(0);
  });
});

describe('targetMarkerOf', () => {
  const scenario = {
    mu: MU_EARTH,
    targets: [{ id: 'KESTREL-2', state: stateFromElements(orbit(7_400_000), MU_EARTH) }],
    // Only the two fields above are read; the cast keeps the fixture to what is used
    // rather than building a whole `LoadedScenario` to assert one number.
  } as unknown as Parameters<typeof targetMarkerOf>[0];

  it('places the target at the offset asked for', () => {
    expect(targetMarkerOf(scenario, 0)?.offsetSeconds).toBe(0);
    expect(targetMarkerOf(scenario, 450)?.offsetSeconds).toBe(450);
    expect(targetMarkerOf(scenario, 5400)?.offsetSeconds).toBe(5400);
  });

  it('clamps a negative offset to zero', () => {
    expect(targetMarkerOf(scenario, -120)?.offsetSeconds).toBe(0);
  });

  it('is undefined for a contract with no target', () => {
    const none = { mu: MU_EARTH, targets: [] } as unknown as Parameters<typeof targetMarkerOf>[0];
    expect(targetMarkerOf(none, 0)).toBeUndefined();
  });
});
