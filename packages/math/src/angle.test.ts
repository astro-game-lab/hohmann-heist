import { describe, expect, it } from 'vitest';

import { angularDifference, fromDegrees, normalize, TAU, toDegrees } from './angle.js';

describe('normalize', () => {
  it('leaves angles already in range alone', () => {
    expect(normalize(0)).toBe(0);
    expect(normalize(1)).toBe(1);
    expect(normalize(Math.PI)).toBe(Math.PI);
  });

  it('wraps positive angles', () => {
    expect(normalize(TAU)).toBeCloseTo(0, 12);
    expect(normalize(TAU + 1)).toBeCloseTo(1, 12);
    expect(normalize(10 * TAU + 2)).toBeCloseTo(2, 12);
  });

  it('wraps negative angles into [0, 2pi)', () => {
    expect(normalize(-1)).toBeCloseTo(TAU - 1, 12);
    expect(normalize(-TAU)).toBeCloseTo(0, 12);
    expect(normalize(-10 * TAU - 2)).toBeCloseTo(TAU - 2, 12);
  });

  // The trap this function exists to avoid: for a very small negative input,
  // (x % TAU) + TAU rounds to exactly TAU, landing outside the half-open range.
  it('never returns exactly 2pi, even for a tiny negative input', () => {
    for (const tiny of [-1e-18, -1e-20, -Number.MIN_VALUE, -1e-300]) {
      const result = normalize(tiny);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThan(TAU);
    }
  });

  it('always lands in [0, 2pi) across a wide sweep', () => {
    for (let i = -1000; i <= 1000; i++) {
      const r = normalize(i * 0.37);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThan(TAU);
    }
  });
});

describe('angularDifference', () => {
  it('is zero for equal angles', () => {
    expect(angularDifference(1, 1)).toBe(0);
  });

  it('takes the short way round', () => {
    expect(angularDifference(0.1, TAU - 0.1)).toBeCloseTo(-0.2, 12);
    expect(angularDifference(TAU - 0.1, 0.1)).toBeCloseTo(0.2, 12);
  });

  it('stays within (-pi, pi]', () => {
    for (let i = 0; i < 200; i++) {
      const a = (i / 200) * TAU;
      const d = angularDifference(a, a + Math.PI * 1.5);
      expect(d).toBeGreaterThan(-Math.PI - 1e-12);
      expect(d).toBeLessThanOrEqual(Math.PI + 1e-12);
    }
  });

  it('returns +pi rather than -pi for an exact half turn', () => {
    expect(angularDifference(0, Math.PI)).toBeCloseTo(Math.PI, 12);
  });
});

describe('degree conversion', () => {
  it('round-trips', () => {
    for (const deg of [0, 1, 90, 180, 270, 359.999]) {
      expect(toDegrees(fromDegrees(deg))).toBeCloseTo(deg, 9);
    }
  });

  it('normalises out-of-range degrees', () => {
    expect(toDegrees(fromDegrees(720 + 45))).toBeCloseTo(45, 9);
    expect(toDegrees(fromDegrees(-90))).toBeCloseTo(270, 9);
  });
});
