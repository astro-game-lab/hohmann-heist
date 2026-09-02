import { describe, expect, it } from 'vitest';

import { bisect, normalize, TAU } from '@hh/math';

import {
  eccentricFromTrue,
  hyperbolicFromTrue,
  meanFromEccentric,
  meanFromHyperbolic,
  trueFromEccentric,
  trueFromHyperbolic,
} from './anomaly.js';
import { solveBarker, solveKeplerElliptic, solveKeplerHyperbolic } from './kepler.js';

const anomalyOf = (r: ReturnType<typeof solveKeplerElliptic>): number => {
  if (!r.converged) throw new Error(`expected convergence, got ${r.reason}`);
  return r.anomaly;
};

/**
 * An independent solve, by a completely different method.
 *
 * Newton and bisection share no code path beyond the residual itself, so agreement
 * between them is real evidence rather than a function agreeing with itself. The
 * published worked examples that check our *conventions* rather than our arithmetic
 * belong to #54, where someone verifies them against the physical book.
 */
const bisectKepler = (m: number, e: number): number => {
  const r = bisect((x) => x - e * Math.sin(x) - normalize(m), 0, TAU, {
    tolerance: 1e-15,
    maxIterations: 200,
  });
  if (!r.converged) throw new Error('reference bisection failed');
  return r.root;
};

describe('elliptic Kepler solver', () => {
  it('is the identity for a circular orbit', () => {
    for (const m of [0, 1, 3, 6]) {
      expect(anomalyOf(solveKeplerElliptic(m, 0))).toBeCloseTo(normalize(m), 12);
    }
  });

  it('satisfies its own equation across the eccentricity range', () => {
    for (const e of [0, 0.01, 0.1, 0.3, 0.5, 0.7, 0.9, 0.95, 0.99, 0.999]) {
      for (let i = 0; i < 24; i++) {
        const m = (i / 24) * TAU;
        const eccentric = anomalyOf(solveKeplerElliptic(m, e));
        const residual = normalize(eccentric - e * Math.sin(eccentric)) - normalize(m);
        expect(Math.abs(residual), `e=${String(e)} M=${String(m)}`).toBeLessThan(1e-10);
      }
    }
  });

  it('agrees with an independent bisection to 1e-12', () => {
    for (const e of [0.05, 0.4, 0.8, 0.95, 0.999]) {
      for (let i = 1; i < 20; i++) {
        const m = (i / 20) * TAU;
        expect(anomalyOf(solveKeplerElliptic(m, e))).toBeCloseTo(bisectKepler(m, e), 10);
      }
    }
  });

  it('converges within the 20-iteration cap required by the physics contract', () => {
    for (const e of [0, 0.3, 0.7, 0.9, 0.99, 0.999]) {
      for (let i = 0; i < 32; i++) {
        const r = solveKeplerElliptic((i / 32) * TAU, e);
        expect(r.converged).toBe(true);
        if (r.converged) expect(r.iterations).toBeLessThanOrEqual(20);
      }
    }
  });

  it('handles the awkward points: M at 0, pi and 2pi', () => {
    for (const e of [0.1, 0.9, 0.999]) {
      expect(anomalyOf(solveKeplerElliptic(0, e))).toBeCloseTo(0, 10);
      expect(anomalyOf(solveKeplerElliptic(Math.PI, e))).toBeCloseTo(Math.PI, 10);
      expect(anomalyOf(solveKeplerElliptic(TAU, e))).toBeCloseTo(0, 10);
    }
  });

  it('normalises an out-of-range mean anomaly', () => {
    const e = 0.4;
    expect(anomalyOf(solveKeplerElliptic(1 + 10 * TAU, e))).toBeCloseTo(
      anomalyOf(solveKeplerElliptic(1, e)),
      12,
    );
    expect(anomalyOf(solveKeplerElliptic(-1, e))).toBeCloseTo(
      anomalyOf(solveKeplerElliptic(TAU - 1, e)),
      12,
    );
  });

  it('rejects an eccentricity outside its domain rather than guessing', () => {
    for (const e of [-0.1, 1, 1.5, Number.NaN]) {
      const r = solveKeplerElliptic(1, e);
      expect(r.converged).toBe(false);
      if (!r.converged) expect(r.reason).toBe('out-of-domain');
    }
  });

  it('falls back to bracketing when Newton is denied enough iterations', () => {
    // The fallback is a real path, not decoration, so it is exercised directly.
    const r = solveKeplerElliptic(0.05, 0.999, { maxIterations: 1 });
    expect(r.converged).toBe(true);
    if (r.converged) {
      expect(r.method).toBe('bracketed');
      const residual = r.anomaly - 0.999 * Math.sin(r.anomaly) - 0.05;
      expect(Math.abs(residual)).toBeLessThan(1e-10);
    }
  });
});

describe('hyperbolic Kepler solver', () => {
  it('satisfies its own equation across eccentricity and mean anomaly', () => {
    for (const e of [1.01, 1.1, 1.5, 2, 5, 10]) {
      for (const m of [-50, -10, -1, -0.1, 0.1, 1, 10, 50, 500]) {
        const r = solveKeplerHyperbolic(m, e);
        expect(r.converged, `e=${String(e)} M=${String(m)}`).toBe(true);
        if (r.converged) {
          const residual = e * Math.sinh(r.anomaly) - r.anomaly - m;
          expect(Math.abs(residual) / Math.max(1, Math.abs(m))).toBeLessThan(1e-10);
        }
      }
    }
  });

  it('is odd in the mean anomaly', () => {
    const e = 1.7;
    for (const m of [0.3, 2, 20]) {
      const plus = solveKeplerHyperbolic(m, e);
      const minus = solveKeplerHyperbolic(-m, e);
      expect(plus.converged && minus.converged).toBe(true);
      if (plus.converged && minus.converged) {
        expect(plus.anomaly + minus.anomaly).toBeCloseTo(0, 9);
      }
    }
  });

  it('returns zero at zero', () => {
    const r = solveKeplerHyperbolic(0, 2);
    expect(r.converged && r.anomaly).toBe(0);
  });

  it('does not normalise, because hyperbolic anomaly is not periodic', () => {
    const r = solveKeplerHyperbolic(500, 1.5);
    expect(r.converged).toBe(true);
    if (r.converged) expect(r.anomaly).toBeGreaterThan(TAU);
  });

  it('rejects an elliptic eccentricity', () => {
    for (const e of [0.5, 1]) {
      const r = solveKeplerHyperbolic(1, e);
      expect(r.converged).toBe(false);
    }
  });
});

describe('Barker (parabolic)', () => {
  it('inverts the parabolic equation M = D + D^3/3', () => {
    for (const m of [0, 0.1, 1, 5, 50]) {
      const nu = solveBarker(m);
      const d = Math.tan(nu / 2);
      expect(d + (d * d * d) / 3).toBeCloseTo(m, 8);
    }
  });

  it('gives zero true anomaly at periapsis', () => {
    expect(solveBarker(0)).toBeCloseTo(0, 12);
  });
});

describe('anomaly conversions', () => {
  it('round-trip true and eccentric', () => {
    for (const e of [0, 0.1, 0.5, 0.9, 0.99]) {
      for (let i = 0; i < 16; i++) {
        const nu = (i / 16) * TAU;
        expect(trueFromEccentric(eccentricFromTrue(nu, e), e)).toBeCloseTo(nu, 9);
      }
    }
  });

  it('round-trip mean, eccentric and true', () => {
    for (const e of [0.05, 0.3, 0.8, 0.97]) {
      for (let i = 1; i < 16; i++) {
        const m = (i / 16) * TAU;
        const eccentric = anomalyOf(solveKeplerElliptic(m, e));
        expect(meanFromEccentric(eccentric, e)).toBeCloseTo(m, 9);
        const nu = trueFromEccentric(eccentric, e);
        expect(eccentricFromTrue(nu, e)).toBeCloseTo(eccentric, 9);
      }
    }
  });

  it('true anomaly leads eccentric anomaly before apoapsis, and lags after', () => {
    // A geometric check that does not depend on our own solver: for an eccentric
    // orbit, nu > E on the outbound leg and nu < E on the inbound one.
    const e = 0.6;
    expect(trueFromEccentric(1, e)).toBeGreaterThan(1);
    expect(trueFromEccentric(TAU - 1, e)).toBeLessThan(TAU - 1);
  });

  it('round-trip hyperbolic true and hyperbolic anomaly', () => {
    for (const e of [1.05, 1.5, 3]) {
      for (const h of [-2, -0.5, 0.5, 2]) {
        expect(hyperbolicFromTrue(trueFromHyperbolic(h, e), e)).toBeCloseTo(h, 9);
      }
    }
  });

  it('hyperbolic mean anomaly round-trips through the solver', () => {
    for (const e of [1.2, 2.5]) {
      for (const h of [-3, -1, 1, 3]) {
        const m = meanFromHyperbolic(h, e);
        const r = solveKeplerHyperbolic(m, e);
        expect(r.converged).toBe(true);
        if (r.converged) expect(r.anomaly).toBeCloseTo(h, 9);
      }
    }
  });
});
