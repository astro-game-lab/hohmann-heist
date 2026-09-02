import { describe, expect, it } from 'vitest';

import type { Metres } from './brand.js';
import { metres } from './brand.js';
import * as V from './vec3.js';

const m = (x: number, y: number, z: number): V.Vec3<Metres> =>
  V.vec3(metres(x), metres(y), metres(z));

describe('vec3', () => {
  it('adds, subtracts, scales and negates', () => {
    expect(V.add(m(1, 2, 3), m(4, 5, 6))).toEqual(m(5, 7, 9));
    expect(V.sub(m(4, 5, 6), m(1, 2, 3))).toEqual(m(3, 3, 3));
    expect(V.scale(m(1, 2, 3), 2)).toEqual(m(2, 4, 6));
    expect(V.negate(m(1, -2, 3))).toEqual(m(-1, 2, -3));
  });

  it('computes dot and cross products', () => {
    expect(V.dot(m(1, 2, 3), m(4, -5, 6))).toBe(4 - 10 + 18);
    // Right-handed: x cross y is z.
    expect(V.cross(m(1, 0, 0), m(0, 1, 0))).toEqual({ x: 0, y: 0, z: 1 });
    expect(V.cross(m(0, 1, 0), m(1, 0, 0))).toEqual({ x: 0, y: 0, z: -1 });
  });

  it('measures magnitude and distance', () => {
    expect(V.norm(m(3, 4, 0))).toBe(5);
    expect(V.normSq(m(3, 4, 0))).toBe(25);
    expect(V.distance(m(1, 1, 1), m(1, 1, 4))).toBe(3);
  });

  it('normalizes to unit length', () => {
    const u = V.normalize(m(3, 4, 0));
    expect(V.norm(u)).toBeCloseTo(1, 15);
    expect(u.x).toBeCloseTo(0.6, 15);
  });

  it('refuses to normalize the zero vector rather than producing NaN', () => {
    expect(() => V.normalize(m(0, 0, 0))).toThrow(RangeError);
  });

  describe('angleBetween', () => {
    it('handles the ordinary cases', () => {
      expect(V.angleBetween(m(1, 0, 0), m(0, 1, 0))).toBeCloseTo(Math.PI / 2, 12);
      expect(V.angleBetween(m(1, 0, 0), m(1, 0, 0))).toBeCloseTo(0, 12);
      expect(V.angleBetween(m(1, 0, 0), m(-1, 0, 0))).toBeCloseTo(Math.PI, 12);
    });

    // This is why the function uses atan2 rather than acos on a normalised dot.
    // For nearly-parallel vectors the acos form loses most of its significant
    // digits, because the derivative of acos is unbounded at its endpoints.
    it('stays accurate for nearly-parallel vectors, where acos would not', () => {
      const eps = 1e-8;
      const a = m(1, 0, 0);
      const b = m(1, eps, 0);
      const viaAtan2 = V.angleBetween(a, b);

      // What the banned formulation would have produced. The lint rule that
      // forbids Math.acos is correct and firing here is the rule working: this is
      // the one place in the repository that needs it, precisely in order to
      // demonstrate that it is worse.
      // eslint-disable-next-line no-restricted-properties -- deliberately showing acos losing precision, per NFR-006
      const viaAcos = Math.acos(V.dot(a, b) / (V.norm(a) * V.norm(b)));

      expect(viaAtan2).toBeCloseTo(eps, 20);
      // acos gets it wrong by a relative margin that would be unacceptable.
      expect(Math.abs(viaAcos - eps) / eps).toBeGreaterThan(1e-4);
    });
  });

  it('interpolates', () => {
    expect(V.lerp(m(0, 0, 0), m(10, 20, 30), 0.5)).toEqual(m(5, 10, 15));
    expect(V.lerp(m(0, 0, 0), m(10, 20, 30), 0)).toEqual(m(0, 0, 0));
  });

  it('compares exactly and approximately', () => {
    expect(V.equals(m(1, 2, 3), m(1, 2, 3))).toBe(true);
    expect(V.equals(m(1, 2, 3), m(1, 2, 3.0000001))).toBe(false);
    expect(V.approxEquals(m(1, 2, 3), m(1, 2, 3.0000001), 1e-6)).toBe(true);
  });

  it('round-trips through an array', () => {
    expect(V.fromArray(V.toArray(m(1, 2, 3)) as [Metres, Metres, Metres])).toEqual(m(1, 2, 3));
  });

  it('detects non-finite components', () => {
    expect(V.isFinite_(m(1, 2, 3))).toBe(true);
    expect(V.isFinite_(m(1, Number.NaN, 3))).toBe(false);
    expect(V.isFinite_(m(1, Number.POSITIVE_INFINITY, 3))).toBe(false);
  });

  it('does not mutate its inputs', () => {
    const a = m(1, 2, 3);
    const b = m(4, 5, 6);
    V.add(a, b);
    V.scale(a, 10);
    expect(a).toEqual(m(1, 2, 3));
    expect(b).toEqual(m(4, 5, 6));
  });
});
