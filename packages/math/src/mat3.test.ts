import { describe, expect, it } from 'vitest';

import { radians } from './brand.js';
import * as M from './mat3.js';
import * as V from './vec3.js';

const TOL = 1e-12;

describe('mat3', () => {
  it('multiplies by the identity without change', () => {
    const r = M.rotationZ(radians(0.7));
    expect(M.approxEquals(M.multiply(r, M.IDENTITY), r, TOL)).toBe(true);
    expect(M.approxEquals(M.multiply(M.IDENTITY, r), r, TOL)).toBe(true);
  });

  it('transposes', () => {
    const a: M.Mat3 = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    expect(M.transpose(a)).toEqual([1, 4, 7, 2, 5, 8, 3, 6, 9]);
    expect(M.transpose(M.transpose(a))).toEqual(a);
  });

  it('applies to a vector', () => {
    // A quarter turn about z takes x to y.
    const r = M.rotationZ(radians(Math.PI / 2));
    const out = M.apply(r, V.vec3(1, 0, 0));
    expect(out.x).toBeCloseTo(0, 12);
    expect(out.y).toBeCloseTo(1, 12);
    expect(out.z).toBeCloseTo(0, 12);
  });

  describe('rotations', () => {
    const angles = [0, 0.3, 1, Math.PI / 2, Math.PI, 2.5, 6];

    it('are right-handed about each axis', () => {
      const q = radians(Math.PI / 2);
      // x about x is unchanged; y about x goes to z; z about y goes to x.
      expect(V.approxEquals(M.apply(M.rotationX(q), V.vec3(1, 0, 0)), V.vec3(1, 0, 0), TOL)).toBe(
        true,
      );
      expect(V.approxEquals(M.apply(M.rotationX(q), V.vec3(0, 1, 0)), V.vec3(0, 0, 1), TOL)).toBe(
        true,
      );
      expect(V.approxEquals(M.apply(M.rotationY(q), V.vec3(0, 0, 1)), V.vec3(1, 0, 0), TOL)).toBe(
        true,
      );
    });

    it('have determinant 1', () => {
      for (const a of angles) {
        expect(M.determinant(M.rotationX(radians(a)))).toBeCloseTo(1, 12);
        expect(M.determinant(M.rotationY(radians(a)))).toBeCloseTo(1, 12);
        expect(M.determinant(M.rotationZ(radians(a)))).toBeCloseTo(1, 12);
      }
    });

    it('are orthonormal, so the transpose is the inverse', () => {
      for (const a of angles) {
        for (const r of [M.rotationX, M.rotationY, M.rotationZ]) {
          const m = r(radians(a));
          expect(M.approxEquals(M.multiply(m, M.transpose(m)), M.IDENTITY, TOL)).toBe(true);
        }
      }
    });

    it('preserve vector length', () => {
      const v = V.vec3(1, -2, 3);
      const before = V.norm(v);
      for (const a of angles) {
        expect(V.norm(M.apply(M.rotationZ(radians(a)), v))).toBeCloseTo(before, 12);
      }
    });

    it('compose as a 3-1-3 sequence, which is what element conversion needs', () => {
      // The perifocal-to-inertial transform is Rz(raan) Rx(inc) Rz(argp).
      const raan = radians(0.4);
      const inc = radians(0.9);
      const argp = radians(1.2);
      const q = M.multiply(M.multiply(M.rotationZ(raan), M.rotationX(inc)), M.rotationZ(argp));

      expect(M.determinant(q)).toBeCloseTo(1, 12);
      expect(M.approxEquals(M.multiply(q, M.transpose(q)), M.IDENTITY, TOL)).toBe(true);
    });
  });
});
