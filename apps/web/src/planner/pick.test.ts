/**
 * The screen→epoch picker. Pure values throughout: a real timeline, a real camera, and
 * screen points computed from the projection rather than guessed, so every assertion is
 * about the search and not about where the fixture happens to draw.
 */
import {
  MU_EARTH,
  R_EARTH_EQ,
  elementsFromState,
  epoch,
  period as orbitalPeriod,
  semiMajorAxis,
  stateFromElements,
} from '@hh/astro';
import { metres, radians } from '@hh/math';
import { EQUATORIAL_BASIS, boundsOfSphere, frameBounds, worldToScreen } from '@hh/render';
import { EMPTY_PLAN, buildTimeline, createPlan, maneuverNodeFromCounts, stateAt } from '@hh/sim';
import { describe, expect, it } from 'vitest';

import { AMBIGUITY_TOLERANCE_PX, COARSE_SAMPLES, pickEpoch, pickEpochInSpan } from './pick.js';

const VIEWPORT = { width: 1200, height: 800, devicePixelRatio: 1 };
const CAMERA = frameBounds(boundsOfSphere(9_000_000), VIEWPORT, EQUATORIAL_BASIS);

/** A 400 x 1200 km ellipse, inclined so the projection genuinely crosses itself. */
const SHIP = stateFromElements(
  {
    semiLatusRectum: metres(6_900_000),
    eccentricity: 0.05,
    inclination: radians(0.6),
    raan: radians(0.4),
    argp: radians(0.3),
    trueAnomaly: radians(0),
  },
  MU_EARTH,
);

const START = epoch(0);
const HORIZON = epoch(6 * 3600);

const timelineFor = (plan = EMPTY_PLAN) => {
  const result = buildTimeline({
    startEpoch: START,
    initialState: SHIP,
    plan,
    horizon: HORIZON,
    mu: MU_EARTH,
  });
  if (!result.ok) throw new Error('fixture timeline failed to build');
  return result.timeline;
};

/** Where the trajectory is drawn at `at`. The point a player would be clicking. */
const screenAt = (timeline: ReturnType<typeof timelineFor>, at: number) => {
  const propagation = stateAt(timeline, epoch(at));
  if (!propagation.converged) throw new Error('fixture state did not converge');
  return worldToScreen(CAMERA, propagation.state.position);
};

describe('picking an epoch off the drawn trajectory (#133, #134)', () => {
  const timeline = timelineFor();

  it('recovers the epoch a point was drawn at, given a reference on that pass', () => {
    for (const at of [300, 1234.5, 2700, 5400, 12_000]) {
      const pick = pickEpoch(timeline, CAMERA, screenAt(timeline, at), epoch(at));
      expect(pick.epoch).toBeCloseTo(at, 3);
      // And it reports that the cursor was on the curve.
      expect(pick.distancePx).toBeLessThan(1e-6);
    }
  });

  it('reports how far the cursor was from the trajectory', () => {
    const on = screenAt(timeline, 1800);
    const off = { x: on.x + 37, y: on.y };
    const pick = pickEpoch(timeline, CAMERA, off, epoch(1800));
    // Not 37 exactly — the nearest instant is not necessarily the one directly beside it —
    // but the same order, and definitely not zero.
    expect(pick.distancePx).toBeGreaterThan(1);
    expect(pick.distancePx).toBeLessThanOrEqual(37 + 1e-6);
  });

  it('is deterministic', () => {
    const point = screenAt(timeline, 2345);
    expect(pickEpoch(timeline, CAMERA, point, epoch(2345))).toEqual(
      pickEpoch(timeline, CAMERA, point, epoch(2345)),
    );
  });
});

describe('a closed orbit is ambiguous, and `near` is what resolves it', () => {
  const timeline = timelineFor();

  /**
   * One revolution of the fixture, from its own elements.
   *
   * Derived rather than measured with the picker: using the thing under test to build the
   * fixture the test asserts against would make the block self-consistent and meaningless.
   */
  const period = orbitalPeriod(
    semiMajorAxis(elementsFromState(SHIP.position, SHIP.velocity, MU_EARTH)),
    MU_EARTH,
  );

  it('has a period inside the horizon several times over — the premise of this block', () => {
    // Stated rather than assumed: if the fixture ever changed to an orbit with one
    // revolution in the horizon, every test below would pass vacuously.
    expect(period).toBeGreaterThan(0);
    expect(HORIZON / period).toBeGreaterThan(3);
  });

  it('returns the pass nearest the reference, not whichever the scan saw last', () => {
    // The same pixel is on the trajectory once per revolution, exactly — a Keplerian
    // orbit returns to the same world position and so to the same projection. Without
    // `near` this is genuinely ambiguous; with it, each reference selects its own pass.
    const point = screenAt(timeline, 600);
    for (const revolution of [0, 1, 2]) {
      const expected = 600 + revolution * period;
      const pick = pickEpoch(timeline, CAMERA, point, epoch(expected));
      expect(pick.epoch).toBeCloseTo(expected, 2);
      expect(pick.distancePx).toBeLessThan(1e-6);
    }
  });

  it('keeps an epoch drag on the burn’s own revolution (#134)', () => {
    // The drag case: a node at 600 s dragged to a pixel that is also on three later
    // passes must land on its own, or a small drag would teleport the burn an orbit away.
    const target = screenAt(timeline, 900);
    const pick = pickEpoch(timeline, CAMERA, target, epoch(600));
    expect(pick.epoch).toBeCloseTo(900, 2);
  });

  it('breaks ties only within the stated pixel tolerance', () => {
    // A genuinely nearer point wins regardless of the reference — the tolerance
    // disambiguates equals, it does not let the reference drag the answer off the curve.
    expect(AMBIGUITY_TOLERANCE_PX).toBeLessThan(1);
    const point = screenAt(timeline, 2400);
    const pick = pickEpoch(timeline, CAMERA, point, epoch(0));
    expect(pick.distancePx).toBeLessThan(1e-6);
  });
});

describe('the projected orbit crosses itself, and the coarse scan is why that is handled', () => {
  const timeline = timelineFor();

  it('finds a minimum inside a span whose endpoints are both further away', () => {
    // A bare ternary search would converge on whichever local minimum it started beside.
    const at = 2700;
    const pick = pickEpochInSpan(
      timeline,
      CAMERA,
      screenAt(timeline, at),
      epoch(0),
      HORIZON,
      epoch(at),
    );
    expect(pick.epoch).toBeCloseTo(at, 3);
  });
});

describe('spans and degenerate inputs', () => {
  const timeline = timelineFor();

  it('returns the start of an empty span rather than dividing by zero', () => {
    const pick = pickEpochInSpan(
      timeline,
      CAMERA,
      { x: 0, y: 0 },
      epoch(120),
      epoch(120),
      epoch(120),
    );
    expect(pick.epoch).toBe(120);
    expect(Number.isFinite(pick.distancePx)).toBe(true);
  });

  it('stays inside the span it was given', () => {
    const pick = pickEpochInSpan(
      timeline,
      CAMERA,
      screenAt(timeline, 5400),
      epoch(600),
      epoch(1200),
      epoch(900),
    );
    expect(pick.epoch).toBeGreaterThanOrEqual(600);
    expect(pick.epoch).toBeLessThanOrEqual(1200);
  });

  it('samples the arc at the documented resolution', () => {
    expect(COARSE_SAMPLES).toBe(256);
  });
});

describe('a multi-arc plan', () => {
  it('searches every arc, not only the one a hit-test named', () => {
    // Two burns, three arcs. A point drawn on the last arc has to be recovered as an
    // epoch on the last arc, which only happens if every arc is searched.
    const timeline = timelineFor(
      createPlan([
        maneuverNodeFromCounts(1200 * 1024, [0, 400_000, 0]),
        maneuverNodeFromCounts(4000 * 1024, [0, -300_000, 0]),
      ]),
    );
    expect(timeline.arcs).toHaveLength(3);

    const at = 15_000;
    const pick = pickEpoch(timeline, CAMERA, screenAt(timeline, at), epoch(at));
    expect(pick.epoch).toBeCloseTo(at, 2);
    expect(pick.distancePx).toBeLessThan(1e-6);
  });
});

describe('the search is in screen space, not world space', () => {
  it('works at a framing where the orbit fills the viewport', () => {
    // The same epochs must be recovered at a much tighter framing, because the
    // minimisation is over drawn distance rather than over metres.
    const tight = frameBounds(boundsOfSphere(R_EARTH_EQ + 500_000), VIEWPORT, EQUATORIAL_BASIS);
    const timeline = timelineFor();
    const propagation = stateAt(timeline, epoch(3000));
    if (!propagation.converged) throw new Error('fixture state did not converge');
    const point = worldToScreen(tight, propagation.state.position);
    expect(pickEpoch(timeline, tight, point, epoch(3000)).epoch).toBeCloseTo(3000, 3);
  });
});
