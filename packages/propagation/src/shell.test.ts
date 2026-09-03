/**
 * The altitude-shell crossing finder (#62, FR-008).
 *
 * The interval endpoints come from a closed-form true anomaly, so the check that
 * matters is geometric and independent: propagate to a returned boundary with the
 * **DOP853 oracle** and confirm the radius really is the shell's, then confirm the
 * radius is strictly smaller inside the interval and strictly larger just outside
 * it. That is the definition of the interval, asserted without reference to how it
 * was computed.
 *
 * The rest is the contract — the tangency rule, the wholly-inside and wholly-outside
 * cases, the clipping flags — and those are exact.
 */
import {
  MU_EARTH,
  apoapsisRadius,
  epoch,
  period,
  periapsisRadius,
  semiMajorAxis,
  stateFromElements,
} from '@hh/astro';
import type { Epoch, State } from '@hh/astro';
import { V, metres, radians, seconds } from '@hh/math';
import { describe, expect, it } from 'vitest';

import { createArc } from './arc.js';
import { integrate } from './oracle/index.js';
import { SHELL_CIRCULAR_FLOOR, findShellCrossings, findShellIntervals } from './shell.js';

const START = epoch(500_000);

const conic = (p: number, e: number, nu = 0.7, inclination = 0.4): State =>
  stateFromElements(
    {
      semiLatusRectum: metres(p),
      eccentricity: e,
      inclination: radians(inclination),
      raan: radians(1.1),
      argp: radians(2.2),
      trueAnomaly: radians(nu),
    },
    MU_EARTH,
  );

/** An orbit from its periapsis and apoapsis radii, which is how a shell test thinks. */
const between = (rp: number, ra: number, nu = 0.7): State =>
  conic((2 * rp * ra) / (rp + ra), (ra - rp) / (ra + rp), nu);

const arcOf = (state: State) =>
  createArc({ startEpoch: START, endEpoch: epoch(START + 1), state, mu: MU_EARTH });

const oracleRadiusAt = (state: State, t: Epoch): number => {
  const result = integrate(state, seconds(t - START), MU_EARTH, { relativeTolerance: 1e-13 });
  if (!result.converged) throw new Error(`oracle failed to reach ${String(t)}`);
  return V.norm(result.state.position);
};

describe('an eccentric orbit crossing a shell', () => {
  const state = between(6.8e6, 8.0e6);
  const arc = arcOf(state);
  const T = period(semiMajorAxis(arc.elements), MU_EARTH);
  const RADIUS = 7.2e6;

  it('puts every unclipped boundary on the shell, checked by an independent integrator', () => {
    for (const interval of findShellIntervals(arc, RADIUS, START, epoch(START + 3 * T))) {
      if (!interval.clippedStart) {
        expect(oracleRadiusAt(state, interval.start) / RADIUS).toBeCloseTo(1, 9);
      }
      if (!interval.clippedEnd) {
        expect(oracleRadiusAt(state, interval.end) / RADIUS).toBeCloseTo(1, 9);
      }
    }
  });

  it('is strictly inside the shell within an interval and strictly outside just beyond it', () => {
    const interval = findShellIntervals(arc, RADIUS, START, epoch(START + 3 * T)).find(
      (i) => !i.clippedStart && !i.clippedEnd,
    );
    expect(interval).toBeDefined();
    if (interval === undefined) return;

    const middle = epoch((interval.start + interval.end) / 2);
    expect(oracleRadiusAt(state, middle)).toBeLessThan(RADIUS);
    expect(oracleRadiusAt(state, epoch(interval.start - 60))).toBeGreaterThan(RADIUS);
    expect(oracleRadiusAt(state, epoch(interval.end + 60))).toBeGreaterThan(RADIUS);
  });

  it('centres each interval on a periapsis passage, one per revolution', () => {
    const intervals = findShellIntervals(arc, RADIUS, START, epoch(START + 3 * T));
    const interior = intervals.filter((i) => !i.clippedStart && !i.clippedEnd);

    expect(interior.length).toBeGreaterThanOrEqual(2);
    // Consecutive interiors are one period apart, and each is shorter than half of
    // one -- an interval that reached half a period would mean the shell was outside
    // apoapsis, which is the wholly-inside case, not this one.
    for (let i = 1; i < interior.length; i++) {
      const previous = interior[i - 1];
      const current = interior[i];
      if (previous === undefined || current === undefined) continue;
      expect(current.start - previous.start).toBeCloseTo(T, 6);
      expect(current.end - current.start).toBeLessThan(T / 2);
    }
  });

  it('derives crossings that pair up, entry before exit', () => {
    const crossings = findShellCrossings(arc, RADIUS, START, epoch(START + 3 * T));

    expect(crossings.length).toBeGreaterThan(0);
    expect(crossings.map((c) => c.epoch)).toEqual(
      [...crossings].sort((a, b) => a.epoch - b.epoch).map((c) => c.epoch),
    );
    // No two crossings of the same kind in a row, and no crossing shares an epoch.
    for (let i = 1; i < crossings.length; i++) {
      expect(crossings[i]?.direction).not.toBe(crossings[i - 1]?.direction);
      expect(crossings[i]?.epoch).not.toBe(crossings[i - 1]?.epoch);
    }
  });

  it('reports no crossing at a clipped bound', () => {
    // Start the search inside an interval: the pass is returned clipped, and no
    // entry is claimed, because nothing entered.
    const first = findShellIntervals(arc, RADIUS, START, epoch(START + 3 * T)).find(
      (i) => !i.clippedStart,
    );
    expect(first).toBeDefined();
    if (first === undefined) return;

    const inside = epoch((first.start + first.end) / 2);
    const intervals = findShellIntervals(arc, RADIUS, inside, epoch(inside + 100));
    const crossings = findShellCrossings(arc, RADIUS, inside, epoch(inside + 100));

    expect(intervals[0]?.clippedStart).toBe(true);
    expect(crossings.filter((c) => c.direction === 'entry')).toHaveLength(0);
  });

  it('is deterministic', () => {
    const call = () => findShellIntervals(arc, RADIUS, START, epoch(START + 3 * T));
    expect(call()).toEqual(call());
  });
});

describe('a trajectory that never meets the shell', () => {
  const arc = arcOf(between(6.8e6, 8.0e6));
  const T = period(semiMajorAxis(arc.elements), MU_EARTH);

  it('returns no intervals when the shell is inside periapsis, rather than erroring', () => {
    expect(findShellIntervals(arc, 6.0e6, START, epoch(START + 3 * T))).toHaveLength(0);
  });

  it('returns one clipped interval when the shell is outside apoapsis', () => {
    const intervals = findShellIntervals(arc, 9.0e6, START, epoch(START + 3 * T));

    expect(intervals).toHaveLength(1);
    expect(intervals[0]?.start).toBe(START);
    expect(intervals[0]?.end).toBe(epoch(START + 3 * T));
    expect(intervals[0]?.clippedStart).toBe(true);
    expect(intervals[0]?.clippedEnd).toBe(true);
    // Wholly inside means no surface was crossed.
    expect(findShellCrossings(arc, 9.0e6, START, epoch(START + 3 * T))).toHaveLength(0);
  });
});

describe('tangency', () => {
  const state = between(6.8e6, 8.0e6);
  const arc = arcOf(state);
  const T = period(semiMajorAxis(arc.elements), MU_EARTH);

  it('produces neither a spurious nor a duplicated crossing at periapsis', () => {
    // The shell exactly at periapsis: the trajectory touches it once per revolution
    // and is never strictly inside.
    const radius = periapsisRadius(arc.elements);

    expect(findShellIntervals(arc, radius, START, epoch(START + 3 * T))).toHaveLength(0);
    expect(findShellCrossings(arc, radius, START, epoch(START + 3 * T))).toHaveLength(0);
  });

  it('treats a shell exactly at apoapsis as continuously inside', () => {
    // The excluded set is one instant per revolution rather than an interval, so
    // "inside except at isolated points" is reported as inside. The alternative --
    // splitting the search into a chain of touching intervals -- would report a
    // crossing where nothing crosses.
    const intervals = findShellIntervals(
      arc,
      apoapsisRadius(arc.elements),
      START,
      epoch(START + 3 * T),
    );

    expect(intervals).toHaveLength(1);
    expect(intervals[0]?.clippedStart).toBe(true);
    expect(intervals[0]?.clippedEnd).toBe(true);
  });

  it.each([
    ['a shell it sits entirely inside', 7.001e6, 1],
    ['a shell it sits entirely outside', 6.999e6, 0],
    ['a shell exactly on it', 7.0e6, 0],
  ])('handles a circular orbit against %s', (_label, radius, expected) => {
    const circular = arcOf(conic(7.0e6, 0, 0.5));
    const T_circ = period(semiMajorAxis(circular.elements), MU_EARTH);
    expect(findShellIntervals(circular, radius, START, epoch(START + 2 * T_circ))).toHaveLength(
      expected,
    );
  });

  it('does not invent crossings for an orbit whose radius varies below float64 resolution', () => {
    // A state built from e = 0 comes back with e ~ 1e-16, so `r_p < R < r_a` holds
    // in float64 for a shell exactly on the orbit and the crossing branch would
    // report being inside for half of every revolution -- over a radius excursion of
    // about a nanometre. `SHELL_CIRCULAR_FLOOR` is what stops that, and this is the
    // case that found it.
    const circular = arcOf(conic(7.0e6, 0, 0.5));
    expect(circular.elements.eccentricity).toBeLessThan(SHELL_CIRCULAR_FLOOR);

    const T_circ = period(semiMajorAxis(circular.elements), MU_EARTH);
    expect(findShellCrossings(circular, 7.0e6, START, epoch(START + 2 * T_circ))).toHaveLength(0);
  });
});

describe('open orbits', () => {
  it.each([
    ['a hyperbola', 1.4],
    ['a parabola', 1],
  ])('%s crosses the shell at most once in and once out', (_label, e) => {
    const state = conic(1.0e7, e, 0.5);
    const arc = arcOf(state);
    const radius = 1.2e7;
    const intervals = findShellIntervals(
      arc,
      radius,
      epoch(START - 400_000),
      epoch(START + 400_000),
    );

    expect(intervals).toHaveLength(1);
    const interval = intervals[0];
    if (interval === undefined) return;
    expect(oracleRadiusAt(state, interval.start) / radius).toBeCloseTo(1, 9);
    expect(oracleRadiusAt(state, interval.end) / radius).toBeCloseTo(1, 9);
  });

  it('reports nothing when the whole pass is outside the search interval', () => {
    const arc = arcOf(conic(1.0e7, 1.4, 0.5));
    expect(
      findShellIntervals(arc, 1.2e7, epoch(START + 500_000), epoch(START + 900_000)),
    ).toHaveLength(0);
  });
});

describe('the interval', () => {
  const arc = arcOf(between(6.8e6, 8.0e6));
  const T = period(semiMajorAxis(arc.elements), MU_EARTH);
  const RADIUS = 7.2e6;
  const reference = findShellIntervals(arc, RADIUS, START, epoch(START + 3 * T)).find(
    (i) => !i.clippedStart && !i.clippedEnd,
  );

  it('includes an entry exactly at the start', () => {
    expect(reference).toBeDefined();
    if (reference === undefined) return;
    const crossings = findShellCrossings(arc, RADIUS, reference.start, epoch(reference.start + 10));
    expect(crossings[0]?.direction).toBe('entry');
    expect(crossings[0]?.epoch).toBe(reference.start);
  });

  it('excludes an exit exactly at the end', () => {
    expect(reference).toBeDefined();
    if (reference === undefined) return;
    const crossings = findShellCrossings(arc, RADIUS, epoch(reference.end - 10), reference.end);
    expect(crossings.filter((c) => c.direction === 'exit')).toHaveLength(0);
  });

  it('reports every crossing exactly once across two abutting searches', () => {
    const middle = epoch(START + 1.5 * T);
    const whole = findShellCrossings(arc, RADIUS, START, epoch(START + 3 * T));
    const halves = [
      ...findShellCrossings(arc, RADIUS, START, middle),
      ...findShellCrossings(arc, RADIUS, middle, epoch(START + 3 * T)),
    ];
    expect(halves.map((c) => c.epoch)).toEqual(whole.map((c) => c.epoch));
  });

  it('finds nothing in a zero-length interval', () => {
    expect(findShellIntervals(arc, RADIUS, START, START)).toHaveLength(0);
  });

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['non-finite', Number.POSITIVE_INFINITY],
  ])('rejects a %s radius', (_label, radius) => {
    expect(() => findShellIntervals(arc, radius, START, epoch(START + T))).toThrow(RangeError);
  });

  it('rejects a reversed interval', () => {
    expect(() => findShellIntervals(arc, RADIUS, epoch(START + 10), START)).toThrow(RangeError);
  });
});
