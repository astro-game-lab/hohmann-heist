/**
 * The apsis-crossing finder (#60, FR-008).
 *
 * The epochs this module returns come out of Kepler's equation, so testing them
 * against Kepler's equation would test nothing. Every numerical assertion here is
 * therefore made on a state produced by the **DOP853 oracle** — a Runge–Kutta
 * integrator that shares no line of code with the closed form under test, and does
 * not know what an anomaly is. If a returned epoch is right, the integrator
 * arriving there independently finds `r · v = 0` and a radius of `a(1 ∓ e)`; if it
 * is wrong, nothing about the integrator would conspire to agree.
 *
 * The remaining assertions are structural — ordering, the endpoint rule, the
 * near-circular threshold — and are exact rather than approximate.
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

import { APSIS_ECCENTRICITY_FLOOR, findApsisCrossings } from './apsis.js';
import { createArc } from './arc.js';
import { integrate } from './oracle/index.js';

const START = epoch(1_000_000);

/**
 * An orbit from `a` and `e`, at a true anomaly chosen so that no apsis sits at a
 * round epoch by accident.
 */
const orbit = (a: number, e: number, nu = 0.7, inclination = 0.4, raan = 1.1, argp = 2.2): State =>
  conic(Math.abs(a * (1 - e * e)), e, nu, inclination, raan, argp);

/**
 * An orbit from its semi-latus rectum, which is the only size element defined for
 * every conic — `a` is infinite at `e = 1` and `a(1 - e²)` is `Infinity * 0` there.
 */
const conic = (p: number, e: number, nu = 0.7, inclination = 0.4, raan = 1.1, argp = 2.2): State =>
  stateFromElements(
    {
      semiLatusRectum: metres(p),
      eccentricity: e,
      inclination: radians(inclination),
      raan: radians(raan),
      argp: radians(argp),
      trueAnomaly: radians(nu),
    },
    MU_EARTH,
  );

const arcOf = (state: State, start: Epoch = START) =>
  createArc({ startEpoch: start, endEpoch: epoch(start + 1), state, mu: MU_EARTH });

/**
 * The state at `t`, integrated numerically from the arc's own state.
 *
 * The tolerance is the integrator's default relative 1e-12, which `dop853.test.ts`
 * measures as an 8th-order method; over the fraction of an orbit these tests span
 * its own error is far below the quantities being asserted.
 */
const oracleStateAt = (state: State, from: Epoch, t: Epoch): State => {
  const result = integrate(state, seconds(t - from), MU_EARTH, { relativeTolerance: 1e-13 });
  if (!result.converged) throw new Error(`oracle failed to reach ${String(t)}`);
  return result.state;
};

/** `cos` of the flight-path angle's complement: zero exactly at an apsis. */
const normalisedRadialRate = (state: State): number =>
  V.dot(state.position, state.velocity) / (V.norm(state.position) * V.norm(state.velocity));

describe('an elliptical orbit', () => {
  const state = orbit(1.2e7, 0.3);
  const arc = arcOf(state);
  const T = period(semiMajorAxis(arc.elements), MU_EARTH);

  it('finds one periapsis and one apoapsis per revolution, alternating and ordered', () => {
    const events = findApsisCrossings(arc, START, epoch(START + 3 * T));

    expect(events).toHaveLength(6);
    expect(events.map((e) => e.epoch)).toEqual(
      [...events].sort((a, b) => a.epoch - b.epoch).map((e) => e.epoch),
    );
    // Alternating: no two of a kind in a row.
    for (let i = 1; i < events.length; i++) {
      expect(events[i]?.kind).not.toBe(events[i - 1]?.kind);
    }
  });

  it('puts each crossing where an independent integrator agrees an apsis is', () => {
    for (const event of findApsisCrossings(arc, START, epoch(START + 2 * T))) {
      const there = oracleStateAt(state, START, event.epoch);

      // At an apsis the velocity is purely transverse, so the radial component of
      // `r . v` vanishes. Normalised, so the tolerance is an angle rather than a
      // quantity that scales with the orbit.
      expect(Math.abs(normalisedRadialRate(there))).toBeLessThan(1e-11);
      expect(V.norm(there.position)).toBeCloseTo(event.radius, 3);
    }
  });

  it('reports the radii the element set does', () => {
    const events = findApsisCrossings(arc, START, epoch(START + T));
    const periapses = events.filter((e) => e.kind === 'periapsis');
    const apoapses = events.filter((e) => e.kind === 'apoapsis');

    expect(periapses[0]?.radius).toBe(periapsisRadius(arc.elements));
    expect(apoapses[0]?.radius).toBe(apoapsisRadius(arc.elements));
  });

  it('spaces consecutive periapses by exactly one period', () => {
    const periapses = findApsisCrossings(arc, START, epoch(START + 5 * T)).filter(
      (e) => e.kind === 'periapsis',
    );

    expect(periapses.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < periapses.length; i++) {
      const gap = (periapses[i]?.epoch ?? 0) - (periapses[i - 1]?.epoch ?? 0);
      // Kepler's third law, independent of anything this module computed.
      expect(gap).toBeCloseTo(T, 6);
    }
  });

  it('puts apoapsis exactly half a period after periapsis', () => {
    const events = findApsisCrossings(arc, START, epoch(START + 2 * T));
    const periapsis = events.find((e) => e.kind === 'periapsis');
    const apoapsis = events.find((e) => e.kind === 'apoapsis' && e.epoch > (periapsis?.epoch ?? 0));

    expect((apoapsis?.epoch ?? 0) - (periapsis?.epoch ?? 0)).toBeCloseTo(T / 2, 6);
  });

  it('is deterministic', () => {
    const first = findApsisCrossings(arc, START, epoch(START + 3 * T));
    const second = findApsisCrossings(arc, START, epoch(START + 3 * T));
    expect(second).toEqual(first);
  });
});

describe('the near-circular convention', () => {
  it.each([
    ['well below the floor', 1e-6],
    ['just below the floor', APSIS_ECCENTRICITY_FLOOR / 2],
  ])('reports no apsides %s', (_label, e) => {
    const arc = arcOf(orbit(7e6, e));
    const T = period(semiMajorAxis(arc.elements), MU_EARTH);
    expect(findApsisCrossings(arc, START, epoch(START + 3 * T))).toHaveLength(0);
  });

  it('reports them again just above the floor', () => {
    const arc = arcOf(orbit(7e6, APSIS_ECCENTRICITY_FLOOR * 2));
    const T = period(semiMajorAxis(arc.elements), MU_EARTH);
    expect(findApsisCrossings(arc, START, epoch(START + T)).length).toBeGreaterThan(0);
  });

  it('uses §9.3’s threshold, not the element set’s degeneracy tolerance', () => {
    // docs/PRODUCT.md §9.3 suppresses apsis markers below e = 1e-3; elements.ts
    // suppresses the argument of periapsis below 1e-8. #60 requires the finder to
    // agree with the renderer, so this constant is the renderer's. An orbit between
    // the two thresholds has a well-defined argument of periapsis and still gets no
    // apsis events, which is the whole point of the distinction.
    expect(APSIS_ECCENTRICITY_FLOOR).toBe(1e-3);

    const between = arcOf(orbit(7e6, 1e-5));
    expect(between.elements.degeneracy).toBe('none');
    expect(findApsisCrossings(between, START, epoch(START + 1e5))).toHaveLength(0);
  });
});

describe('open orbits', () => {
  it.each([
    ['a hyperbola', 1.4],
    ['a strong hyperbola', 3],
    ['a parabola', 1],
  ])('%s has one periapsis and no apoapsis', (_label, e) => {
    // Stated as a semi-latus rectum so the parabolic case is not a special one:
    // 1.4e7 m is the same size of orbit in all three.
    const state = conic(1.4e7, e, 0.5);
    const arc = arcOf(state);
    const events = findApsisCrossings(arc, epoch(START - 200_000), epoch(START + 200_000));

    expect(events.filter((x) => x.kind === 'apoapsis')).toHaveLength(0);
    expect(events).toHaveLength(1);
    expect(events[0]?.radius).toBe(periapsisRadius(arc.elements));

    const there = oracleStateAt(state, START, events[0]?.epoch ?? START);
    expect(Math.abs(normalisedRadialRate(there))).toBeLessThan(1e-11);
    expect(V.norm(there.position)).toBeCloseTo(events[0]?.radius ?? 0, 3);
  });

  it('reports nothing when the single passage is outside the interval', () => {
    // Already outbound at the search start: periapsis is in the past.
    const arc = arcOf(orbit(-2e7, 1.4, 0.5));
    expect(findApsisCrossings(arc, epoch(START + 100_000), epoch(START + 200_000))).toHaveLength(0);
  });
});

describe('the degenerate orbit shapes', () => {
  it.each([
    ['equatorial prograde', 0],
    ['equatorial retrograde', Math.PI],
    ['polar', Math.PI / 2],
  ])('handles an %s orbit', (_label, inclination) => {
    const state = orbit(1.1e7, 0.25, 0.7, inclination, 0, 1.3);
    const arc = arcOf(state);
    const T = period(semiMajorAxis(arc.elements), MU_EARTH);
    const events = findApsisCrossings(arc, START, epoch(START + 2 * T));

    expect(events).toHaveLength(4);
    for (const event of events) {
      const there = oracleStateAt(state, START, event.epoch);
      expect(Math.abs(normalisedRadialRate(there))).toBeLessThan(1e-11);
    }
  });
});

describe('the interval', () => {
  const arc = arcOf(orbit(1.2e7, 0.3));
  const T = period(semiMajorAxis(arc.elements), MU_EARTH);
  const firstPeriapsis = findApsisCrossings(arc, START, epoch(START + T))[0]?.epoch ?? START;

  it('includes a crossing exactly at the start', () => {
    const events = findApsisCrossings(arc, firstPeriapsis, epoch(firstPeriapsis + 10));
    expect(events).toHaveLength(1);
    expect(events[0]?.epoch).toBe(firstPeriapsis);
  });

  it('excludes a crossing exactly at the end', () => {
    expect(findApsisCrossings(arc, epoch(firstPeriapsis - 10), firstPeriapsis)).toHaveLength(0);
  });

  it('reports every crossing exactly once across two abutting searches', () => {
    const middle = epoch(START + 1.5 * T);
    const whole = findApsisCrossings(arc, START, epoch(START + 3 * T));
    const halves = [
      ...findApsisCrossings(arc, START, middle),
      ...findApsisCrossings(arc, middle, epoch(START + 3 * T)),
    ];
    expect(halves).toEqual(whole);
  });

  it('finds nothing in a zero-length interval', () => {
    expect(findApsisCrossings(arc, START, START)).toHaveLength(0);
  });

  it.each([
    ['reversed', epoch(START + 100), epoch(START)],
    ['non-finite', epoch(START), epoch(Number.NaN)],
  ])('rejects a %s interval', (_label, start, end) => {
    expect(() => findApsisCrossings(arc, start, end)).toThrow(RangeError);
  });
});
