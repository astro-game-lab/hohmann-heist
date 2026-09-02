import { describe, expect, it } from 'vitest';

import { cloneRng, createRng, nextFloat, nextInt, nextRange, nextUint32 } from './rng.js';

const hex = (n: number): string => n.toString(16).padStart(8, '0');

describe('pcg32', () => {
  /**
   * The reference vectors.
   *
   * Source: the PCG reference C implementation's demo program, `pcg32-demo.c`,
   * from https://www.pcg-random.org/ — the output of `pcg32_srandom_r(&rng, 42u,
   * 54u)` followed by six calls to `pcg32_random_r`. M. E. O'Neill, *PCG: A Family
   * of Simple Fast Space-Efficient Statistically Good Algorithms for Random Number
   * Generation* (2014).
   *
   * These come from outside this codebase on purpose. A test that compares our
   * generator against output our generator produced would prove only that it is
   * consistent with itself.
   */
  it('reproduces the published reference vectors for seed=42, seq=54', () => {
    const rng = createRng(42n, 54n);
    const got = Array.from({ length: 6 }, () => hex(nextUint32(rng)));
    expect(got).toEqual(['a15c02b7', '7b47f409', 'ba1d3330', '83d2f293', 'bfa4784b', 'cbed606e']);
  });

  it('gives the same sequence for the same seed', () => {
    const a = createRng(12345n, 1n);
    const b = createRng(12345n, 1n);
    for (let i = 0; i < 50; i++) expect(nextUint32(a)).toBe(nextUint32(b));
  });

  it('gives different sequences for different seeds', () => {
    const a = createRng(1n, 1n);
    const b = createRng(2n, 1n);
    const da = Array.from({ length: 20 }, () => nextUint32(a));
    const db = Array.from({ length: 20 }, () => nextUint32(b));
    expect(da).not.toEqual(db);
  });

  it('gives uncorrelated streams for the same seed and different sequences', () => {
    const a = createRng(7n, 1n);
    const b = createRng(7n, 2n);
    const da = Array.from({ length: 20 }, () => nextUint32(a));
    const db = Array.from({ length: 20 }, () => nextUint32(b));
    expect(da).not.toEqual(db);
  });

  it('accepts a number seed as well as a bigint', () => {
    const a = createRng(42, 54);
    const b = createRng(42n, 54n);
    expect(nextUint32(a)).toBe(nextUint32(b));
  });

  it('produces values in the uint32 range', () => {
    const rng = createRng(99n);
    for (let i = 0; i < 2000; i++) {
      const v = nextUint32(rng);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(2 ** 32);
    }
  });

  describe('nextFloat', () => {
    it('stays within [0, 1)', () => {
      const rng = createRng(3n);
      for (let i = 0; i < 5000; i++) {
        const v = nextFloat(rng);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    });

    it('has a mean near one half over many draws', () => {
      const rng = createRng(2024n);
      const n = 20000;
      let sum = 0;
      for (let i = 0; i < n; i++) sum += nextFloat(rng);
      expect(sum / n).toBeCloseTo(0.5, 2);
    });
  });

  describe('nextRange', () => {
    it('stays within bounds', () => {
      const rng = createRng(5n);
      for (let i = 0; i < 2000; i++) {
        const v = nextRange(rng, -10, 30);
        expect(v).toBeGreaterThanOrEqual(-10);
        expect(v).toBeLessThan(30);
      }
    });
  });

  describe('nextInt', () => {
    it('stays within bounds and hits every value', () => {
      const rng = createRng(11n);
      const seen = new Set<number>();
      for (let i = 0; i < 5000; i++) {
        const v = nextInt(rng, 3, 9);
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(3);
        expect(v).toBeLessThan(9);
        seen.add(v);
      }
      expect(seen.size).toBe(6);
    });

    // Rejection sampling rather than a modulo: a modulo biases the low values
    // whenever the range does not divide 2^32.
    it('is close to uniform for a range that does not divide 2^32', () => {
      const rng = createRng(777n);
      const range = 7;
      const counts = new Map<number, number>();
      const n = 70000;
      for (let i = 0; i < n; i++) {
        const v = nextInt(rng, 0, range);
        counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      expect(counts.size).toBe(range);
      for (const c of counts.values()) {
        expect(Math.abs(c - n / range) / (n / range)).toBeLessThan(0.05);
      }
    });

    it('rejects bad bounds rather than returning nonsense', () => {
      const rng = createRng(1n);
      expect(() => nextInt(rng, 5, 5)).toThrow(RangeError);
      expect(() => nextInt(rng, 5, 1)).toThrow(RangeError);
      expect(() => nextInt(rng, 0.5, 3)).toThrow(RangeError);
    });
  });

  it('clones so a sequence can be replayed from a known point', () => {
    const rng = createRng(31n);
    for (let i = 0; i < 5; i++) nextUint32(rng);
    const snapshot = cloneRng(rng);
    const first = Array.from({ length: 10 }, () => nextUint32(rng));
    const second = Array.from({ length: 10 }, () => nextUint32(snapshot));
    expect(first).toEqual(second);
  });
});
