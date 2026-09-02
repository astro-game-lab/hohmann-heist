import { describe, expect, it } from 'vitest';

import { M, metres, metresPerSec, radians, V } from '@hh/math';

import {
  eci,
  eciToPqw,
  eciToRtnMatrix,
  fromRtn,
  inertialToPerifocalMatrix,
  perifocalToInertialMatrix,
  pqw,
  pqwToEci,
  rtn,
  toRtn,
} from './frames.js';

const TOL = 1e-12;
const pos = (x: number, y: number, z: number) => eci(V.vec3(metres(x), metres(y), metres(z)));
const vel = (x: number, y: number, z: number) =>
  eci(V.vec3(metresPerSec(x), metresPerSec(y), metresPerSec(z)));

describe('perifocal to inertial', () => {
  it('is the identity when all three angles are zero', () => {
    const m = perifocalToInertialMatrix(radians(0), radians(0), radians(0));
    expect(M.approxEquals(m, M.IDENTITY, TOL)).toBe(true);
  });

  it('is a rotation: orthonormal, determinant one', () => {
    for (const [raan, inc, argp] of [
      [0.4, 0.9, 1.2],
      [3.0, 0.1, 5.5],
      [1.0, Math.PI / 2, 2.0],
    ] as const) {
      const m = perifocalToInertialMatrix(radians(raan), radians(inc), radians(argp));
      expect(M.determinant(m)).toBeCloseTo(1, 12);
      expect(M.approxEquals(M.multiply(m, M.transpose(m)), M.IDENTITY, TOL)).toBe(true);
    }
  });

  it('round-trips a vector', () => {
    const m = perifocalToInertialMatrix(radians(0.4), radians(0.9), radians(1.2));
    const inv = inertialToPerifocalMatrix(radians(0.4), radians(0.9), radians(1.2));
    const original = pqw(V.vec3(metres(7000e3), metres(1000e3), metres(0)));
    const back = eciToPqw(inv, pqwToEci(m, original));
    expect(V.approxEquals(back, original, 1e-6)).toBe(true);
  });

  it('depends only on the sum of raan and argp when the orbit is equatorial', () => {
    // At i = 0 the node line is undefined and only Omega + omega is meaningful.
    // The composed rotation must reflect that, which is why the degenerate case is
    // handled by the element set rather than here.
    const a = perifocalToInertialMatrix(radians(0.3), radians(0), radians(1.1));
    const b = perifocalToInertialMatrix(radians(1.0), radians(0), radians(0.4));
    expect(M.approxEquals(a, b, TOL)).toBe(true);
  });

  it('places periapsis along the node line for an equatorial orbit with argp zero', () => {
    const m = perifocalToInertialMatrix(radians(Math.PI / 2), radians(0), radians(0));
    const out = pqwToEci(m, pqw(V.vec3(metres(1), metres(0), metres(0))));
    expect(out.x).toBeCloseTo(0, 12);
    expect(out.y).toBeCloseTo(1, 12);
  });
});

describe('RTN', () => {
  // A circular orbit in the equatorial plane: position along +x, velocity along +y.
  const r = pos(7000e3, 0, 0);
  const v = vel(0, 7546, 0);

  it('has radial outward, transverse along velocity, normal along angular momentum', () => {
    const m = eciToRtnMatrix(r, v);
    // Rows of the matrix are the RTN basis vectors expressed in ECI.
    expect([m[0], m[1], m[2]]).toEqual([1, 0, 0]);
    expect(m[3]).toBeCloseTo(0, 12);
    expect(m[4]).toBeCloseTo(1, 12);
    expect(m[6]).toBeCloseTo(0, 12);
    expect(m[8]).toBeCloseTo(1, 12);
  });

  it('is a rotation', () => {
    const m = eciToRtnMatrix(r, v);
    expect(M.determinant(m)).toBeCloseTo(1, 12);
    expect(M.approxEquals(M.multiply(m, M.transpose(m)), M.IDENTITY, TOL)).toBe(true);
  });

  it('converts a prograde burn into an inertial delta-v along the velocity', () => {
    // This is the conversion every maneuver goes through.
    const dv = rtn(V.vec3(metresPerSec(0), metresPerSec(100), metresPerSec(0)));
    const inertial = fromRtn(dv, r, v);
    expect(inertial.x).toBeCloseTo(0, 9);
    expect(inertial.y).toBeCloseTo(100, 9);
    expect(inertial.z).toBeCloseTo(0, 9);
  });

  it('round-trips through RTN and back', () => {
    const original = eci(V.vec3(metresPerSec(12), metresPerSec(-34), metresPerSec(56)));
    const back = fromRtn(toRtn(original, r, v), r, v);
    expect(V.approxEquals(back, original, 1e-9)).toBe(true);
  });

  it('distinguishes transverse from along-velocity on an eccentric orbit', () => {
    // With a nonzero radial velocity component the flight-path angle is nonzero, so
    // the transverse axis and the velocity direction differ. This is exactly the
    // distinction DEP-10 papers over in the UI by calling transverse "prograde".
    const re = pos(7000e3, 0, 0);
    const ve = vel(1000, 7000, 0);
    const m = eciToRtnMatrix(re, ve);
    const transverse = V.vec3(m[3], m[4], m[5]);
    const alongVelocity = V.normalize(ve);
    const angle = V.angleBetween(transverse, alongVelocity);
    expect(angle).toBeGreaterThan(1e-3);
  });

  it('refuses a rectilinear orbit rather than returning NaN', () => {
    const radial = pos(7000e3, 0, 0);
    const parallel = vel(100, 0, 0);
    expect(() => eciToRtnMatrix(radial, parallel)).toThrow(RangeError);
  });
});
