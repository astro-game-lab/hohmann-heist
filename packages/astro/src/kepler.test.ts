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
import { MU_EARTH } from './constants.js';
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

/*
 * ---------------------------------------------------------------------------
 * Tier 3 — independent reference (#54)
 *
 * Vallado, D. A., "Fundamentals of Astrodynamics and Applications", 4th edition,
 * Microcosm Press / Springer, 2013. ISBN 978-1-881883-18-0.
 *
 * All three examples were read from that edition, per the process rule in
 * docs/PRODUCT.md section 7.6. Nothing here was copied out of docs/PRODUCT.md.
 *
 * SIGNS AND DIGITS WERE READ FROM THE RENDERED PAGE, not from the PDF's text
 * layer. `lambert.test.ts` records that the Curtis PDF drops minus signs under
 * text extraction; the same hazard applies here and every value below was
 * confirmed against an image of the printed page (pp. 67, 69 and 71).
 *
 * ## Vallado's mu is ours, exactly
 *
 * The book works in km and uses mu = 398,600.4418 km^3/s^2, which is
 * 3.986004418e14 m^3/s^2 -- `MU_EARTH` to the digit. Unlike Curtis, whose 398,600
 * differs from ours by 1.1e-8 relative and has to be passed explicitly, there is
 * no constant to substitute here and none of these tests needs a book-specific mu.
 * Only Example 2-2 uses mu at all; the other two are pure Kepler solves.
 *
 * ## Why the tolerances differ by six orders of magnitude between examples
 *
 * They are the *books's* printed precisions, and Vallado does not print the same
 * number of digits in each example. See each case.
 * ---------------------------------------------------------------------------
 */

describe('Vallado 4th ed., Example 2-1 (section 2.2, p. 67) — elliptical Kepler', () => {
  // GIVEN M = 235.4 deg, e = 0.4. FIND E.
  //
  // The book prints the mean anomaly as 4.108 505 059 194 65 rad and the answer
  // twice: E = 220.512 074 767 522 deg in the body text, and 3.848 661 745 097 17
  // rad in Table 2-2. Those two are independent transcriptions of the same
  // quantity and they agree to 1.8e-15 when converted, which is float64 round-off
  // -- so the reference is exact to the precision a double can hold, and the
  // deviation this test measures is entirely ours.
  const M = 4.10850505919465;
  const E_EXPECTED_RAD = 3.84866174509717;
  const E_EXPECTED_DEG = 220.512074767522;

  it('reproduces the eccentric anomaly the book prints', () => {
    const result = solveKeplerElliptic(M, 0.4);
    expect(result.converged).toBe(true);

    // 1e-13 is `kepler.ts`'s own default convergence tolerance, and therefore the
    // most this solver promises. It is not the book's limit: the book is tighter
    // than we are, which is the opposite of the Curtis situation and is why this
    // number is not a "printed precision" like the two below.
    expect(Math.abs(anomalyOf(result) - E_EXPECTED_RAD)).toBeLessThanOrEqual(1e-13);
  });

  it('agrees with the book in degrees as well as radians', () => {
    // Not redundant: it checks the transcription rather than the solver. If either
    // printed value had been mistyped, the two would disagree by far more than the
    // 1.8e-15 that separates them in the book.
    const degrees = (anomalyOf(solveKeplerElliptic(M, 0.4)) * 180) / Math.PI;
    expect(Math.abs(degrees - E_EXPECTED_DEG)).toBeLessThanOrEqual(1e-11);
  });

  it("satisfies Kepler's equation to round-off at the book's own answer", () => {
    // The book's value, not ours, put back into M = E - e sin E. This is what
    // establishes that the printed 15 digits are real rather than a long decimal
    // expansion of a shorter answer.
    expect(Math.abs(E_EXPECTED_RAD - 0.4 * Math.sin(E_EXPECTED_RAD) - M)).toBeLessThanOrEqual(
      1e-14,
    );
  });
});

describe('Vallado 4th ed., Example 2-2 (section 2.2, p. 69) — parabolic Barker', () => {
  // GIVEN dt = 53.7874 min, p = 25,512 km, e = 1. FIND B.
  //
  // Vallado's B is `tan(nu/2)`, which is exactly the `D` in `solveBarker`'s
  // `M_p = D + D^3/3`, and his parabolic mean motion `n_p = 2 sqrt(mu/p^3)` is the
  // same one. So the conventions coincide and no re-derivation is needed -- but
  // `solveBarker` returns the *true anomaly*, since a parabola has no eccentric
  // anomaly, so the comparison converts back through `tan(nu/2)`.
  const P_METRES = 25_512e3;
  const DT_SECONDS = 53.7874 * 60;
  const B_EXPECTED = 0.817751;

  it('reproduces the parabolic anomaly the book prints', () => {
    // SI in, SI out: the book's kilometres are converted here, at the boundary.
    const parabolicMeanMotion = 2 * Math.sqrt(MU_EARTH / P_METRES ** 3);
    const trueAnomaly = solveBarker(parabolicMeanMotion * DT_SECONDS);
    const b = Math.tan(trueAnomaly / 2);

    // 1.5e-6 relative. Vallado prints six significant figures for B, so a half-ulp
    // of the last printed digit is 5e-7 / 0.8178 = 6.1e-7 relative; the observed
    // deviation is 1.3e-7, comfortably inside where rounding alone puts it. The
    // tolerance is the book's precision with a small margin, not a tuned number.
    expect(Math.abs(b - B_EXPECTED) / B_EXPECTED).toBeLessThanOrEqual(1.5e-6);
  });

  it("reproduces the book's parabolic mean motion", () => {
    // The book prints n_p = 0.000 309 9 rad/s -- four significant figures, so this
    // asserts four. Worth its line because it is where a wrong mu or a kilometre /
    // metre slip would show up first, before it could hide inside the cubic.
    const parabolicMeanMotion = 2 * Math.sqrt(MU_EARTH / P_METRES ** 3);
    expect(Math.abs(parabolicMeanMotion - 0.0003099) / 0.0003099).toBeLessThanOrEqual(1e-3);
  });
});

describe('Vallado 4th ed., Example 2-3 (section 2.2, p. 71) — hyperbolic Kepler', () => {
  // GIVEN M = 235.4 deg (the same 4.108 505 059 194 65 rad as Example 2-1), e = 2.4.
  // FIND H. The body text gives H = 1.601 376 144 rad and Table 2-3's final
  // iteration gives 1.601 376 144 9.
  //
  // Vallado's Algorithm 4 drives the residual M - (e sinh H - H) to zero, which is
  // `kepler.ts`'s `M = e sinh H - H` -- the same convention, so H is directly
  // comparable with no sign or definition change.
  const M = 4.10850505919465;
  const H_EXPECTED = 1.6013761449;

  it('reproduces the hyperbolic anomaly the book prints', () => {
    const result = solveKeplerHyperbolic(M, 2.4);
    expect(result.converged).toBe(true);

    // 1e-9 relative. Table 2-3 prints eleven digits and stops iterating at a step
    // of 2.2e-10, so the printed value is itself converged to about that -- putting
    // the book's own uncertainty an order of magnitude above float64. Asserting
    // tighter would be asserting digits the book did not converge.
    expect(Math.abs(anomalyOf(result) - H_EXPECTED) / H_EXPECTED).toBeLessThanOrEqual(1e-9);
  });

  it("satisfies the hyperbolic Kepler equation at the book's own answer", () => {
    // As in Example 2-1, this checks the transcription rather than the solver. The
    // residual here is 1.7e-10 rather than round-off, which is the book's
    // convergence showing through and is consistent with the tolerance above.
    expect(Math.abs(2.4 * Math.sinh(H_EXPECTED) - H_EXPECTED - M)).toBeLessThanOrEqual(1e-9);
  });
});
