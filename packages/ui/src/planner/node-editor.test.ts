import { MU_EARTH, R_EARTH_EQ, type OrbitShape } from '@hh/astro';
import { metres, radians } from '@hh/math';
import { describe, expect, it } from 'vitest';

import { DELTA_V_STEP_MPS, burnResult, deltaVStep, metFromParts, metParts } from './node-editor.js';

describe('§8.3.5’s four epoch fields', () => {
  it('splits a time into hours, minutes, seconds and milliseconds', () => {
    // §8.3.5's own example: T+ [00]:[04]:[12].[000]
    expect(metParts(252)).toEqual({ hours: 0, minutes: 4, seconds: 12, milliseconds: 0 });
    expect(metParts(3723.456)).toEqual({
      hours: 1,
      minutes: 2,
      seconds: 3,
      milliseconds: 456,
    });
  });

  it('round-trips', () => {
    for (const seconds of [0, 252, 3723.456, 50_399.999]) {
      expect(metFromParts(metParts(seconds))).toBeCloseTo(seconds, 3);
    }
  });

  it('never goes negative', () => {
    expect(metParts(-5)).toEqual({ hours: 0, minutes: 0, seconds: 0, milliseconds: 0 });
  });

  it('carries hours past 24 rather than wrapping — a mission is not a clock', () => {
    // The horizon can exceed a day (C11 is 17 days), so the hours field is unbounded and
    // the deadline is what limits it, not the calendar.
    expect(metParts(100 * 3600).hours).toBe(100);
  });
});

describe('invalid epoch input is refused, never clamped (§8.3.5, #137)', () => {
  it('refuses an out-of-range part', () => {
    // A player who types 75 minutes meant something. Quietly making it 59 produces a plan
    // they did not author and cannot see is different from the one they asked for.
    expect(metFromParts({ hours: 0, minutes: 75, seconds: 0, milliseconds: 0 })).toBeNull();
    expect(metFromParts({ hours: 0, minutes: 0, seconds: 60, milliseconds: 0 })).toBeNull();
    expect(metFromParts({ hours: 0, minutes: 0, seconds: 0, milliseconds: 1000 })).toBeNull();
  });

  it('refuses a negative part', () => {
    expect(metFromParts({ hours: -1, minutes: 0, seconds: 0, milliseconds: 0 })).toBeNull();
  });

  it('refuses a non-integer part', () => {
    // What an emptied or half-typed number input produces.
    expect(metFromParts({ hours: 0, minutes: Number.NaN, seconds: 0, milliseconds: 0 })).toBeNull();
    expect(metFromParts({ hours: 0.5, minutes: 0, seconds: 0, milliseconds: 0 })).toBeNull();
  });

  it('accepts the boundary values', () => {
    expect(metFromParts({ hours: 0, minutes: 59, seconds: 59, milliseconds: 999 })).toBeCloseTo(
      3599.999,
      6,
    );
  });
});

describe('§8.3.5’s stepper increments', () => {
  it('is 1 m/s, a tenth with Shift, ten times with Ctrl', () => {
    expect(DELTA_V_STEP_MPS).toBe(1);
    expect(deltaVStep({})).toBe(1);
    expect(deltaVStep({ shift: true })).toBeCloseTo(0.1, 12);
    expect(deltaVStep({ ctrl: true })).toBe(10);
  });

  it('takes the finer step when both modifiers are held', () => {
    // A hand resting on the keyboard should not produce the coarse step by accident.
    expect(deltaVStep({ shift: true, ctrl: true })).toBeCloseTo(0.1, 12);
  });
});

describe('the result block’s deltas (FR-410)', () => {
  const orbit = (eccentricity: number, semiLatusRectum = 6_778_137): OrbitShape => ({
    semiLatusRectum: metres(semiLatusRectum),
    eccentricity,
    inclination: radians(0),
    raan: radians(0),
    argp: radians(0),
    trueAnomaly: radians(0),
  });

  it('reports before, after and the difference for each row', () => {
    const result = burnResult(orbit(0.01), orbit(0.05), MU_EARTH, R_EARTH_EQ);
    for (const row of [result.apoapsisAltitude, result.periapsisAltitude, result.period]) {
      expect(row).not.toBeNull();
      if (row === null) continue;
      expect(row.delta).toBeCloseTo(row.after - row.before, 9);
    }
  });

  it('shows a raised apoapsis and a dropped periapsis for a more eccentric orbit', () => {
    // The learning surface, stated as a sign: at the same semi-latus rectum, adding
    // eccentricity raises apoapsis and lowers periapsis. A player dragging prograde and
    // watching "periapsis −125.8" sees exactly this.
    const result = burnResult(orbit(0.01), orbit(0.05), MU_EARTH, R_EARTH_EQ);
    expect(result.apoapsisAltitude?.delta ?? 0).toBeGreaterThan(0);
    expect(result.periapsisAltitude.delta).toBeLessThan(0);
  });

  it('reports zero deltas for a burn that changed nothing', () => {
    const result = burnResult(orbit(0.02), orbit(0.02), MU_EARTH, R_EARTH_EQ);
    expect(result.periapsisAltitude.delta).toBe(0);
    expect(result.period?.delta).toBe(0);
  });

  it('drops apoapsis and period when the burn opens the orbit', () => {
    // The clearest possible statement of what just happened: a hyperbola has neither, and
    // reporting a negative period would be worse than saying nothing.
    const result = burnResult(orbit(0.05), orbit(1.4), MU_EARTH, R_EARTH_EQ);
    expect(result.apoapsisAltitude).toBeNull();
    expect(result.period).toBeNull();
    // Periapsis survives — it is the one apsis a hyperbola has, and the number the player
    // needs while being told their plan escapes. It is *below the surface* here, which is
    // the honest reading for this fixture: p/(1+e) at e = 1.4 is inside the Earth, so the
    // trajectory escapes only in the sense that it would have hit the ground first. A
    // suppressed or clamped row would hide that.
    expect(result.periapsisAltitude.after).toBeLessThan(0);
    expect(Number.isFinite(result.periapsisAltitude.after)).toBe(true);
  });

  it('measures altitudes above the reference radius it is given', () => {
    const fromCentre = burnResult(orbit(0.01), orbit(0.05), MU_EARTH, 0);
    const fromSurface = burnResult(orbit(0.01), orbit(0.05), MU_EARTH, R_EARTH_EQ);
    expect(fromCentre.periapsisAltitude.after - fromSurface.periapsisAltitude.after).toBeCloseTo(
      R_EARTH_EQ,
      6,
    );
    // The delta is unaffected: a difference of altitudes is a difference of radii.
    expect(fromCentre.periapsisAltitude.delta).toBeCloseTo(fromSurface.periapsisAltitude.delta, 9);
  });
});
