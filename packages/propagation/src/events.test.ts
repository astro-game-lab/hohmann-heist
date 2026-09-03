/**
 * The vocabulary the five event finders share.
 *
 * Everything here is a contract the finders rest on rather than a physical claim,
 * so the assertions are exact: the half-open rule, the sample grid hitting its
 * endpoints, the anomaly ↔ epoch map agreeing with the propagator, and the two
 * failure paths returning nothing rather than a plausible answer.
 *
 * The anomaly ↔ epoch map is checked against **universal-variable propagation**,
 * which is a different route to the same instant: the clock goes ν → E → M → t in
 * closed form, and the propagator solves a transcendental equation in a universal
 * anomaly. Neither knows about the other.
 */
import {
  MU_EARTH,
  elementsFromState,
  epoch,
  period,
  semiMajorAxis,
  stateFromElements,
} from '@hh/astro';
import type { Epoch, State } from '@hh/astro';
import { TAU, V, metres, radians } from '@hh/math';
import { describe, expect, it } from 'vitest';

import { createArc, stateAt } from './arc.js';
import {
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_TOLERANCE_SECONDS,
  conicClock,
  conicGeometry,
  refineRoot,
  requireSearchInterval,
  requireStateAt,
  revolutionRange,
  sampleAt,
  sampleCount,
  timeGridStep,
  withinSearch,
} from './events.js';

const START = epoch(250_000);

const conic = (p: number, e: number, nu = 0.9, inclination = 0.6): State =>
  stateFromElements(
    {
      semiLatusRectum: metres(p),
      eccentricity: e,
      inclination: radians(inclination),
      raan: radians(2.4),
      argp: radians(0.8),
      trueAnomaly: radians(nu),
    },
    MU_EARTH,
  );

const arcOf = (state: State, start: Epoch = START) =>
  createArc({ startEpoch: start, endEpoch: epoch(start + 1), state, mu: MU_EARTH });

describe('the defaults', () => {
  it('states a tolerance in seconds, small enough to be below anything the game resolves', () => {
    // 1e-6 s at LEO's 7.7 km/s is 7.7 mm of along-track motion.
    expect(DEFAULT_TOLERANCE_SECONDS).toBe(1e-6);
    expect(DEFAULT_TOLERANCE_SECONDS * 7700).toBeLessThan(0.01);
  });

  it('caps refinement at the same iteration count as @hh/math', () => {
    expect(DEFAULT_MAX_ITERATIONS).toBe(100);
  });
});

describe('the search interval', () => {
  it('accepts a zero-length interval, which finds nothing rather than erroring', () => {
    expect(() => {
      requireSearchInterval(START, START);
    }).not.toThrow();
    expect(withinSearch(START, START, START)).toBe(false);
  });

  it.each([
    ['reversed', epoch(10), epoch(0)],
    ['a NaN start', epoch(Number.NaN), epoch(10)],
    ['an infinite end', epoch(0), epoch(Number.POSITIVE_INFINITY)],
  ])('rejects %s interval', (_label, start, end) => {
    expect(() => {
      requireSearchInterval(start, end);
    }).toThrow(RangeError);
  });

  it('is half-open: the start is inside, the end is not', () => {
    expect(withinSearch(0, epoch(0), epoch(10))).toBe(true);
    expect(withinSearch(9.999_999_9, epoch(0), epoch(10))).toBe(true);
    expect(withinSearch(10, epoch(0), epoch(10))).toBe(false);
    expect(withinSearch(-1e-12, epoch(0), epoch(10))).toBe(false);
  });
});

describe('the sample grid', () => {
  it('lays at least one interval across a span shorter than one step', () => {
    expect(sampleCount(5, 100)).toBe(1);
    expect(sampleCount(0, 100)).toBe(1);
  });

  it('covers the span without leaving a partial step at the end', () => {
    expect(sampleCount(250, 100)).toBe(3);
    expect(sampleCount(300, 100)).toBe(3);
  });

  it('hits both endpoints exactly, whatever the count', () => {
    for (const count of [1, 3, 7, 64]) {
      expect(sampleAt(100, 900, 0, count)).toBe(100);
      expect(sampleAt(100, 900, count, count)).toBe(900);
    }
  });

  it('is a pure function of the index, not an accumulation', () => {
    // Walking forwards and asking directly must give the same number, or two
    // searches over the same span would disagree by round-off (§11.4).
    const direct = sampleAt(1e9, 1e9 + 12_345.678, 999, 1000);
    let walked = 1e9;
    const step = 12_345.678 / 1000;
    for (let i = 0; i < 999; i++) walked += step;
    expect(direct).not.toBe(walked);
    expect(sampleAt(1e9, 1e9 + 12_345.678, 999, 1000)).toBe(direct);
  });

  it('sets the step from the shortest orbital period, not from the span', () => {
    expect(timeGridStep([1000, 4000], 1e6, 10)).toBe(100);
  });

  it('falls back to the span when no orbit involved is closed', () => {
    expect(timeGridStep([Number.POSITIVE_INFINITY], 5000, 10)).toBe(500);
  });
});

describe('refinement', () => {
  it('finds a bracketed root to the stated tolerance', () => {
    const root = refineRoot((x) => x - 3.25, 0, 10);
    expect(root).toBeDefined();
    expect(root ?? 0).toBeCloseTo(3.25, 9);
  });

  it('returns nothing rather than a best guess when the bracket holds no root', () => {
    // `@hh/math`'s RootResult carries a `best` for diagnostics that is explicitly not
    // a root. An event finder that returned it would be reporting an event that is
    // not there, so this drops it.
    expect(refineRoot((x) => x + 1, 0, 10)).toBeUndefined();
  });

  it('returns nothing when the iteration cap is reached', () => {
    // A cubic rather than the linear case above: Brent's first secant step lands
    // exactly on a linear root and reports convergence honestly, so a linear
    // function cannot exercise the cap at all.
    expect(refineRoot((x) => x ** 3 - 30, 0, 10, { maxIterations: 1 })).toBeUndefined();
  });
});

describe('the conic clock', () => {
  it.each([
    ['a circular orbit', 7e6, 0, 1e-13],
    ['an eccentric orbit', 1.1e7, 0.42, 1e-13],
    // e = 0.97 is not the clock losing accuracy, it is the propagator: docs/PHYSICS.md
    // measures universal-variable propagation at 1.9e-11 relative for one revolution
    // at e = 0.95, and this case is tighter than that. The other four are two orders
    // of magnitude better, which is what says the clock is not the limiting term.
    ['a near-parabolic ellipse', 1.1e7, 0.97, 5e-11],
    ['a hyperbola', 1.1e7, 1.5, 1e-13],
    ['a parabola', 1.1e7, 1, 1e-13],
  ])('agrees with the propagator about where an anomaly is, on %s', (_label, p, e, tolerance) => {
    const state = conic(p, e);
    const arc = arcOf(state);
    const clock = conicClock(arc);
    const geometry = conicGeometry(arc);

    // Anomalies inside the asymptotes for every conic tested.
    for (const nu of [0, 0.4, 1.2, 2.0, TAU - 0.4]) {
      const t = clock.epochAt(nu, 0);
      const propagated = stateAt(arc, t);
      expect(propagated.converged).toBe(true);
      if (!propagated.converged) continue;

      // The clock says "this anomaly happens at t"; the propagator, which never sees
      // an anomaly, is asked what the state at t is. The two positions must coincide.
      const fromGeometry = geometry.positionAt(nu);
      expect(
        V.distance(propagated.state.position, fromGeometry) / V.norm(fromGeometry),
      ).toBeLessThan(tolerance);
    }
  });

  it('puts periapsis where the radius is smallest', () => {
    const arc = arcOf(conic(1.1e7, 0.42));
    const clock = conicClock(arc);
    const geometry = conicGeometry(arc);

    expect(geometry.radiusAt(0)).toBeLessThan(geometry.radiusAt(0.1));
    expect(geometry.radiusAt(0)).toBeLessThan(geometry.radiusAt(-0.1));
    expect(clock.timeSincePeriapsis(0)).toBeCloseTo(0, 9);
  });

  it('reports a period for a closed orbit and none for an open one', () => {
    const closed = conicClock(arcOf(conic(1.1e7, 0.42)));
    expect(closed.period).toBeCloseTo(
      period(semiMajorAxis(arcOf(conic(1.1e7, 0.42)).elements), MU_EARTH),
      6,
    );
    expect(conicClock(arcOf(conic(1.1e7, 1.5))).period).toBe(Number.POSITIVE_INFINITY);
    expect(conicClock(arcOf(conic(1.1e7, 1))).period).toBe(Number.POSITIVE_INFINITY);
  });

  it('measures time from periapsis as odd in the anomaly on an open orbit', () => {
    // t(-nu) = -t(nu): the inbound and outbound legs are mirror images, which is what
    // makes the shell finder's symmetric intervals correct.
    const clock = conicClock(arcOf(conic(1.1e7, 1.5)));
    for (const nu of [0.3, 0.8, 1.4]) {
      expect(clock.timeSincePeriapsis(TAU - nu)).toBeCloseTo(-clock.timeSincePeriapsis(nu), 6);
    }
  });

  it('does not turn revolution zero of an open orbit into NaN', () => {
    // `revolution * period` is `0 * Infinity` on an open orbit. Guarded, because the
    // resulting NaN epoch would silently fail every interval test it reached.
    const clock = conicClock(arcOf(conic(1.1e7, 1.5)));
    expect(Number.isFinite(clock.epochAt(0.5, 0))).toBe(true);
  });

  it('agrees with the element set about the anomaly at the arc’s own epoch', () => {
    const state = conic(1.1e7, 0.42, 2.3);
    const arc = arcOf(state);
    const clock = conicClock(arc);
    const recovered = elementsFromState(state.position, state.velocity, MU_EARTH);

    expect(clock.epochAt(recovered.trueAnomaly, 0)).toBeCloseTo(START, 6);
  });
});

describe('the revolution range', () => {
  const arc = arcOf(conic(1.1e7, 0.42));
  const clock = conicClock(arc);

  it('covers every revolution the interval touches', () => {
    const { first, last } = revolutionRange(clock, START, epoch(START + 3 * clock.period));
    expect(last - first).toBeGreaterThanOrEqual(2);
    expect(clock.epochAt(0, first)).toBeLessThanOrEqual(START);
    expect(clock.epochAt(0, last)).toBeLessThan(START + 3 * clock.period);
  });

  it('is empty for a zero-length interval', () => {
    const { first, last } = revolutionRange(clock, START, START);
    expect(last).toBeLessThan(first);
  });

  it('does not reach into a revolution that opens exactly at the end', () => {
    // The half-open rule: a search ending on a periapsis passage stops short of the
    // revolution that passage begins.
    const boundary = clock.epochAt(0, 4);
    const { last } = revolutionRange(clock, START, boundary);
    expect(clock.epochAt(0, last)).toBeLessThan(boundary);
  });

  it('gives an open orbit exactly one revolution, and none for an empty interval', () => {
    const open = conicClock(arcOf(conic(1.1e7, 1.5)));
    expect(revolutionRange(open, START, epoch(START + 1000))).toEqual({ first: 0, last: 0 });
    expect(revolutionRange(open, START, START).last).toBeLessThan(0);
  });
});

describe('requireStateAt', () => {
  it('returns the propagated state', () => {
    const arc = arcOf(conic(1.1e7, 0.42));
    const state = requireStateAt(arc, START + 1000);
    const direct = stateAt(arc, epoch(START + 1000));
    expect(direct.converged).toBe(true);
    if (!direct.converged) return;
    expect(state.position).toEqual(direct.state.position);
  });

  it('raises rather than letting a failed propagation look like "no events"', () => {
    // A non-finite epoch is the reachable way to make the propagator give up. The
    // finders have no partial answer to offer for a sample they cannot evaluate, so
    // this is the one place the package throws rather than returning a union.
    const arc = arcOf(conic(1.1e7, 0.42));
    expect(() => requireStateAt(arc, Number.NaN)).toThrow(RangeError);
  });
});
