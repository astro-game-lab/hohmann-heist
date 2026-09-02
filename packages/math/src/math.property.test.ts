/**
 * Property tests for `@hh/math` (§13.3).
 *
 * Unit tests check the cases we thought of. These check the invariants that must
 * hold for every input, which is where the cases we did not think of live.
 *
 * **The seed is deliberately not pinned.** A fixed seed would make this suite
 * reproducible at the cost of it never exploring anything new, and the exploration
 * is the point: an unpinned run found a genuine sign-comparison bug in the root
 * finders that a pinned one would likely never have reached. fast-check prints the
 * seed and the counterexample on failure, so any red build here is reproducible and
 * is a real defect rather than noise. Treat a failure as a bug to fix, never as a
 * test to re-run until it passes.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { angularDifference, normalize, TAU } from './angle.js';
import { radians } from './brand.js';
import * as M from './mat3.js';
import { bisect, brent } from './root.js';
import { createRng, nextInt, nextUint32 } from './rng.js';
import * as V from './vec3.js';

/** Finite, well-scaled reals. Avoids denormals and overflow swamping the algebra. */
const real = fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true });
const angle = fc.double({ min: -1e4, max: 1e4, noNaN: true, noDefaultInfinity: true });
const vec = fc.record({ x: real, y: real, z: real });
const nonZeroVec = vec.filter((v) => V.normSq(v) > 1e-6);

const REL = 1e-9;
const closeRel = (a: number, b: number, tol = REL): boolean =>
  Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

describe('vector algebra', () => {
  it('addition is commutative', () => {
    fc.assert(
      fc.property(vec, vec, (a, b) => {
        expect(V.approxEquals(V.add(a, b), V.add(b, a), 0)).toBe(true);
      }),
    );
  });

  it('subtraction undoes addition', () => {
    fc.assert(
      fc.property(vec, vec, (a, b) => {
        const back = V.sub(V.add(a, b), b);
        expect(V.approxEquals(back, a, 1e-6)).toBe(true);
      }),
    );
  });

  it('the cross product is antisymmetric', () => {
    fc.assert(
      fc.property(vec, vec, (a, b) => {
        expect(V.approxEquals(V.cross(a, b), V.negate(V.cross(b, a)), 1e-6)).toBe(true);
      }),
    );
  });

  it('the cross product is orthogonal to both operands', () => {
    fc.assert(
      fc.property(nonZeroVec, nonZeroVec, (a, b) => {
        const c = V.cross(a, b);
        const scale = V.norm(a) * V.norm(b) * V.norm(c);
        if (scale === 0) return;
        expect(Math.abs(V.dot(a, c)) / scale).toBeLessThan(1e-9);
        expect(Math.abs(V.dot(b, c)) / scale).toBeLessThan(1e-9);
      }),
    );
  });

  it('the dot product is commutative', () => {
    fc.assert(
      fc.property(vec, vec, (a, b) => {
        expect(closeRel(V.dot(a, b), V.dot(b, a))).toBe(true);
      }),
    );
  });

  it('normalize always yields unit length', () => {
    fc.assert(
      fc.property(nonZeroVec, (v) => {
        expect(V.norm(V.normalize(v))).toBeCloseTo(1, 9);
      }),
    );
  });

  it('the angle between two vectors lies in [0, pi]', () => {
    fc.assert(
      fc.property(nonZeroVec, nonZeroVec, (a, b) => {
        const t = V.angleBetween(a, b);
        expect(t).toBeGreaterThanOrEqual(0);
        expect(t).toBeLessThanOrEqual(Math.PI + 1e-12);
      }),
    );
  });

  it('the angle between a vector and itself is zero', () => {
    fc.assert(
      fc.property(nonZeroVec, (v) => {
        expect(V.angleBetween(v, v)).toBeCloseTo(0, 9);
      }),
    );
  });
});

describe('angles', () => {
  it('normalize always lands in [0, 2pi)', () => {
    fc.assert(
      fc.property(angle, (a) => {
        const r = normalize(a);
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThan(TAU);
      }),
    );
  });

  it('normalize is idempotent', () => {
    fc.assert(
      fc.property(angle, (a) => {
        const once = normalize(a);
        expect(normalize(once)).toBe(once);
      }),
    );
  });

  it('normalize preserves the angle modulo a full turn', () => {
    fc.assert(
      fc.property(angle, (a) => {
        const r = normalize(a);
        expect(Math.cos(r)).toBeCloseTo(Math.cos(a), 8);
        expect(Math.sin(r)).toBeCloseTo(Math.sin(a), 8);
      }),
    );
  });

  it('angularDifference stays within (-pi, pi]', () => {
    fc.assert(
      fc.property(angle, angle, (a, b) => {
        const d = angularDifference(a, b);
        expect(d).toBeGreaterThan(-Math.PI - 1e-9);
        expect(d).toBeLessThanOrEqual(Math.PI + 1e-9);
      }),
    );
  });

  it('angularDifference is antisymmetric except at the half-turn boundary', () => {
    fc.assert(
      fc.property(angle, angle, (a, b) => {
        const forward = angularDifference(a, b);
        const backward = angularDifference(b, a);
        // At exactly pi both directions return +pi, which is the documented
        // consequence of a half-open interval and not an asymmetry bug.
        if (Math.abs(Math.abs(forward) - Math.PI) < 1e-9) return;
        expect(forward + backward).toBeCloseTo(0, 8);
      }),
    );
  });
});

describe('rotations', () => {
  it('preserve length', () => {
    fc.assert(
      fc.property(vec, angle, (v, a) => {
        const r = radians(normalize(a));
        for (const rot of [M.rotationX, M.rotationY, M.rotationZ]) {
          expect(closeRel(V.norm(M.apply(rot(r), v)), V.norm(v), 1e-9)).toBe(true);
        }
      }),
    );
  });

  it('are orthonormal with determinant one', () => {
    fc.assert(
      fc.property(angle, (a) => {
        const r = radians(normalize(a));
        for (const rot of [M.rotationX, M.rotationY, M.rotationZ]) {
          const m = rot(r);
          expect(M.determinant(m)).toBeCloseTo(1, 12);
          expect(M.approxEquals(M.multiply(m, M.transpose(m)), M.IDENTITY, 1e-12)).toBe(true);
        }
      }),
    );
  });

  it('compose and invert: R(-a) undoes R(a)', () => {
    fc.assert(
      fc.property(vec, angle, (v, a) => {
        const r = radians(normalize(a));
        const back = M.apply(M.rotationZ(radians(normalize(-a))), M.apply(M.rotationZ(r), v));
        expect(V.approxEquals(back, v, 1e-6 * Math.max(1, V.norm(v)))).toBe(true);
      }),
    );
  });
});

describe('root finders', () => {
  // A monotonic function with a known root: any bracket containing it must work.
  it('find the root of a monotonic cubic wherever it is bracketed', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -50, max: -0.5, noNaN: true }),
        fc.double({ min: 0.5, max: 50, noNaN: true }),
        fc.double({ min: -10, max: 10, noNaN: true }),
        (lo, hi, shift) => {
          const f = (x: number): number => (x - shift) ** 3 + (x - shift);
          if (Math.sign(f(lo + shift)) === Math.sign(f(hi + shift))) return;
          for (const find of [bisect, brent]) {
            const r = find(f, lo + shift, hi + shift, { tolerance: 1e-10 });
            expect(r.converged).toBe(true);
            if (r.converged) expect(Math.abs(f(r.root))).toBeLessThan(1e-6);
          }
        },
      ),
    );
  });

  it('never claim convergence on an unbracketed interval', () => {
    fc.assert(
      fc.property(fc.double({ min: 0.1, max: 10, noNaN: true }), (c) => {
        const f = (x: number): number => x * x + c;
        for (const find of [bisect, brent]) {
          const r = find(f, -1, 1);
          expect(r.converged).toBe(false);
        }
      }),
    );
  });
});

describe('rng', () => {
  it('is reproducible for any seed', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: (1n << 64n) - 1n }), (seed) => {
        const a = createRng(seed);
        const b = createRng(seed);
        for (let i = 0; i < 8; i++) expect(nextUint32(a)).toBe(nextUint32(b));
      }),
    );
  });

  it('always produces values inside the uint32 range', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: (1n << 64n) - 1n }), (seed) => {
        const rng = createRng(seed);
        for (let i = 0; i < 8; i++) {
          const v = nextUint32(rng);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThan(2 ** 32);
        }
      }),
    );
  });

  it('keeps nextInt inside its bounds for any range', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -1000, max: 1000 }),
        fc.integer({ min: 1, max: 500 }),
        (min, span) => {
          const rng = createRng(BigInt(Math.abs(min) + span));
          for (let i = 0; i < 20; i++) {
            const v = nextInt(rng, min, min + span);
            expect(v).toBeGreaterThanOrEqual(min);
            expect(v).toBeLessThan(min + span);
          }
        },
      ),
    );
  });
});
