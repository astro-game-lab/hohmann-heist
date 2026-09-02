import { describe, expect, it } from 'vitest';

import { bisect, brent, type RootResult } from './root.js';

const rootOf = (r: RootResult): number => {
  if (!r.converged) throw new Error(`expected convergence, got ${r.reason}`);
  return r.root;
};

describe.each([
  ['bisect', bisect],
  ['brent', brent],
])('%s', (_name, find) => {
  it('finds a simple polynomial root', () => {
    // x^2 - 2 on [0, 2] has its root at sqrt(2).
    const r = find((x) => x * x - 2, 0, 2);
    expect(rootOf(r)).toBeCloseTo(Math.SQRT2, 10);
  });

  it('finds a transcendental root', () => {
    // cos(x) - x has a root near 0.7390851332.
    const r = find((x) => Math.cos(x) - x, 0, 1);
    expect(rootOf(r)).toBeCloseTo(0.7390851332151607, 10);
  });

  it('finds a root shaped like the Kepler equation it will serve', () => {
    // M = E - e sin E, solved for E. This is the fallback path the elliptic
    // solver uses when Newton misbehaves, so it is worth exercising here.
    const e = 0.7;
    const M = 1.2;
    const r = find((E) => E - e * Math.sin(E) - M, 0, 2 * Math.PI);
    const E = rootOf(r);
    expect(E - e * Math.sin(E)).toBeCloseTo(M, 10);
  });

  it('returns an endpoint that is already a root', () => {
    expect(rootOf(find((x) => x, 0, 1))).toBe(0);
    expect(rootOf(find((x) => x - 1, 0, 1))).toBe(1);
  });

  it('reports a bracket that does not straddle a root, rather than guessing', () => {
    const r = find((x) => x * x + 1, -1, 1);
    expect(r.converged).toBe(false);
    if (!r.converged) expect(r.reason).toBe('not-bracketed');
  });

  it('reports hitting the iteration cap, rather than returning a wrong root', () => {
    const r = find((x) => x * x - 2, 0, 2, { maxIterations: 1, tolerance: 1e-15 });
    expect(r.converged).toBe(false);
    if (!r.converged) {
      expect(r.reason).toBe('max-iterations');
      expect(r.iterations).toBe(1);
    }
  });

  it('respects the requested tolerance', () => {
    const r = find((x) => x * x - 2, 0, 2, { tolerance: 1e-6 });
    expect(Math.abs(rootOf(r) - Math.SQRT2)).toBeLessThan(1e-5);
  });

  it('works with a reversed bracket', () => {
    expect(rootOf(find((x) => x * x - 2, 2, 0))).toBeCloseTo(Math.SQRT2, 10);
  });
});

describe('sign handling near the limits of the float range', () => {
  // Regression. A property test found this: with f(mid) = -5e-324 the conventional
  // `flo * fmid < 0` bracket test underflows to zero, reads false, and the search
  // discards the half of the bracket containing the root -- returning an endpoint
  // as a confidently wrong root. Sign is now compared directly.
  it.each([
    ['bisect', bisect],
    ['brent', brent],
  ])('%s does not lose the bracket when a value is denormal', (_name, find) => {
    const shift = 5e-324;
    const f = (x: number): number => (x - shift) ** 3 + (x - shift);
    const r = find(f, -0.5 + shift, 0.5 + shift, { tolerance: 1e-10 });
    expect(r.converged).toBe(true);
    expect(Math.abs(f(rootOf(r)))).toBeLessThan(1e-6);
  });

  it.each([
    ['bisect', bisect],
    ['brent', brent],
  ])('%s handles values large enough that a product would overflow', (_name, find) => {
    // f(a) * f(b) would be Infinity here, which is not > 0 in the way the naive
    // bracket test needs, and is meaningless besides.
    const f = (x: number): number => (x < 1 ? -1e300 : 1e300);
    const r = find(f, 0, 2, { tolerance: 1e-9 });
    expect(r.converged).toBe(true);
    if (r.converged) expect(r.root).toBeCloseTo(1, 6);
  });
});

describe('brent vs bisect', () => {
  it('brent converges in fewer iterations on a smooth function', () => {
    const f = (x: number): number => x * x * x - 2 * x - 5;
    const b = brent(f, 2, 3, { tolerance: 1e-12 });
    const s = bisect(f, 2, 3, { tolerance: 1e-12 });
    expect(b.converged && s.converged).toBe(true);
    expect(b.iterations).toBeLessThan(s.iterations);
  });
});
