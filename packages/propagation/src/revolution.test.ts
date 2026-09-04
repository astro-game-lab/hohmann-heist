/**
 * The revolution finder (FR-604).
 *
 * The epochs this module returns are `t0 + k T`, so testing them against `t0 + k T`
 * would test nothing. Every numerical assertion here is therefore made against
 * something that shares no line of code with the finder:
 *
 * - the **period** against Kepler's third law, `T = 2π√(a³/μ)`, a closed form;
 * - the **epochs** against the **DOP853 oracle**, a Runge–Kutta integrator that does
 *   not know what a period is. A full revolution is precisely the statement that
 *   position and velocity return, so an independently integrated state at a returned
 *   epoch must equal the state the arc started from. If an epoch were wrong by a
 *   second, a LEO spacecraft would be 7.6 km away and nothing about the integrator
 *   would conspire to hide it.
 *
 * The remaining assertions are structural — ordering, the endpoint rule, the origin,
 * the absence of revolutions on an open orbit — and are exact rather than approximate.
 */
import {
  MU_EARTH,
  epoch,
  period,
  semiMajorAxis,
  stateFromElements,
  type Epoch,
  type State,
} from '@hh/astro';
import { V, metres, radians, seconds } from '@hh/math';
import { describe, expect, it } from 'vitest';

import { createArc } from './arc.js';
import { integrate } from './oracle/index.js';
import { findRevolutions } from './revolution.js';

const START = epoch(1_000_000);

/** An orbit from `a` and `e`, at a true anomaly that is not a round number. */
const orbit = (a: number, e: number, nu = 0.7, inclination = 0.4, raan = 1.1, argp = 2.2): State =>
  stateFromElements(
    {
      semiLatusRectum: metres(Math.abs(a * (1 - e * e))),
      eccentricity: e,
      inclination: radians(inclination),
      raan: radians(raan),
      argp: radians(argp),
      trueAnomaly: radians(nu),
    },
    MU_EARTH,
  );

/** An arc long enough to hold several revolutions of `state`. */
const arcOf = (state: State, spanSeconds: number, start: Epoch = START) =>
  createArc({
    startEpoch: start,
    endEpoch: epoch(start + spanSeconds),
    state,
    mu: MU_EARTH,
  });

/**
 * The state at `t`, integrated numerically from the arc's own state.
 *
 * A tighter tolerance than the integrator's default, so the comparison below is
 * limited by the finder rather than by the oracle.
 */
const oracleStateAt = (state: State, from: Epoch, t: Epoch): State => {
  const result = integrate(state, seconds(t - from), MU_EARTH, { relativeTolerance: 1e-13 });
  if (!result.converged) throw new Error(`oracle failed to reach ${String(t)}`);
  return result.state;
};

/** A 400 km circular orbit — `c03-cold-open`'s ship, and the case apsides cannot serve. */
const CIRCULAR_A = 6_778_137;

describe('findRevolutions', () => {
  describe('against an independent integrator', () => {
    it('returns the spacecraft to its own state, on a circular orbit', () => {
      // `e = 0` exactly. `findApsisCrossings` reports nothing here by design, which is
      // the whole reason this finder exists — see the module docstring.
      const state = orbit(CIRCULAR_A, 0);
      const arc = arcOf(state, 20_000);
      const events = findRevolutions(arc, arc.startEpoch, arc.endEpoch);

      expect(events.length).toBeGreaterThan(2);
      for (const event of events) {
        const there = oracleStateAt(state, START, event.epoch);
        // A metre on a 6 778 km radius, and a millimetre per second on 7.7 km/s. Both
        // are the oracle's own accumulated error over three revolutions rather than the
        // finder's: the epochs are exact in float64 by construction.
        expect(V.distance(there.position, state.position)).toBeLessThan(1);
        expect(V.distance(there.velocity, state.velocity)).toBeLessThan(1e-3);
      }
    });

    it('returns the spacecraft to its own state, on an eccentric orbit', () => {
      const state = orbit(9_000_000, 0.3);
      const arc = arcOf(state, 30_000);
      const events = findRevolutions(arc, arc.startEpoch, arc.endEpoch);

      expect(events.length).toBeGreaterThan(1);
      for (const event of events) {
        const there = oracleStateAt(state, START, event.epoch);
        expect(V.distance(there.position, state.position)).toBeLessThan(2);
        expect(V.distance(there.velocity, state.velocity)).toBeLessThan(1e-3);
      }
    });
  });

  describe('the period', () => {
    it('agrees with Kepler’s third law', () => {
      const state = orbit(9_000_000, 0.3);
      const arc = arcOf(state, 30_000);
      const [first] = findRevolutions(arc, arc.startEpoch, arc.endEpoch);

      // `period` is `@hh/astro`'s closed form, computed from the elements rather than
      // from the clock this finder uses.
      const expected = period(semiMajorAxis(arc.elements), MU_EARTH);
      expect(first?.periodSeconds).toBeCloseTo(expected, 6);
    });

    it('is the same on every revolution of one arc', () => {
      const arc = arcOf(orbit(CIRCULAR_A, 0), 20_000);
      const events = findRevolutions(arc, arc.startEpoch, arc.endEpoch);
      const periods = new Set(events.map((event) => event.periodSeconds));
      expect(periods.size).toBe(1);
    });
  });

  describe('the origin is the arc’s start, not periapsis', () => {
    it('places the first completion exactly one period after the arc begins', () => {
      // True anomaly 2.9 rad: the arc starts nowhere near periapsis, so a
      // periapsis-anchored count would put the first event somewhere else entirely.
      const state = orbit(9_000_000, 0.3, 2.9);
      const arc = arcOf(state, 30_000);
      const [first] = findRevolutions(arc, arc.startEpoch, arc.endEpoch);

      expect(first).toBeDefined();
      expect(first?.epoch).toBeCloseTo(
        arc.startEpoch + period(semiMajorAxis(arc.elements), MU_EARTH),
        6,
      );
    });

    it('numbers revolutions from 1, in order, with no gaps', () => {
      const arc = arcOf(orbit(CIRCULAR_A, 0), 20_000);
      const events = findRevolutions(arc, arc.startEpoch, arc.endEpoch);
      expect(events.map((event) => event.index)).toEqual(events.map((_, position) => position + 1));
    });

    it('is ordered by epoch', () => {
      const arc = arcOf(orbit(CIRCULAR_A, 0), 20_000);
      const events = findRevolutions(arc, arc.startEpoch, arc.endEpoch);
      for (let i = 1; i < events.length; i++) {
        expect(events[i]?.epoch).toBeGreaterThan(events[i - 1]?.epoch ?? Number.NaN);
      }
    });
  });

  describe('the endpoint rule', () => {
    const arc = arcOf(orbit(CIRCULAR_A, 0), 20_000);
    const T = period(semiMajorAxis(arc.elements), MU_EARTH);

    it('reports a completion landing exactly on the interval start', () => {
      const at = epoch(START + T);
      const events = findRevolutions(arc, at, epoch(at + 10));
      expect(events).toHaveLength(1);
      expect(events[0]?.index).toBe(1);
    });

    it('excludes a completion landing exactly on the interval end', () => {
      const at = epoch(START + T);
      // The interval stops at the completion, so nothing is inside it. `[start, end)`.
      expect(findRevolutions(arc, START, at)).toHaveLength(0);
    });

    it('reports nothing for an empty interval', () => {
      expect(findRevolutions(arc, START, START)).toHaveLength(0);
    });

    it('reports nothing for an interval shorter than one period', () => {
      expect(findRevolutions(arc, START, epoch(START + T * 0.9))).toHaveLength(0);
    });

    it('finds the same epochs whether the interval is searched whole or in halves', () => {
      // The concatenation property every finder in this package shares: abutting
      // searches report each event exactly once, with no duplicate at the joint.
      const end = epoch(START + 20_000);
      const middle = epoch(START + T * 1.5);
      const whole = findRevolutions(arc, START, end).map((event) => event.epoch);
      const halves = [
        ...findRevolutions(arc, START, middle),
        ...findRevolutions(arc, middle, end),
      ].map((event) => event.epoch);
      expect(halves).toEqual(whole);
    });

    it('does not count the origin itself as a completion', () => {
      // Revolution 0 is the arc's start. Being at the start is not having been round.
      const events = findRevolutions(arc, START, epoch(START + 20_000));
      expect(events.every((event) => event.epoch > START)).toBe(true);
    });
  });

  describe('open orbits have no revolutions', () => {
    it('returns nothing on a hyperbola', () => {
      const state = orbit(-9_000_000, 1.4);
      const arc = arcOf(state, 30_000);
      expect(findRevolutions(arc, arc.startEpoch, arc.endEpoch)).toHaveLength(0);
    });

    it('returns nothing on a parabola', () => {
      const state = stateFromElements(
        {
          semiLatusRectum: metres(14_000_000),
          eccentricity: 1,
          inclination: radians(0.4),
          raan: radians(1.1),
          argp: radians(2.2),
          trueAnomaly: radians(0.7),
        },
        MU_EARTH,
      );
      const arc = arcOf(state, 30_000);
      expect(findRevolutions(arc, arc.startEpoch, arc.endEpoch)).toHaveLength(0);
    });
  });

  describe('refuses a search interval that is not one', () => {
    const arc = arcOf(orbit(CIRCULAR_A, 0), 20_000);

    it('throws when the interval runs backwards', () => {
      expect(() => findRevolutions(arc, epoch(START + 10), START)).toThrow(RangeError);
    });

    it('throws when a bound is not finite', () => {
      expect(() => findRevolutions(arc, START, epoch(Number.NaN))).toThrow(RangeError);
    });
  });
});
