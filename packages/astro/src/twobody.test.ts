import { describe, expect, it } from 'vitest';

import { metres, metresPerSec, radians, seconds, TAU, V } from '@hh/math';

import { MU_EARTH, OMEGA_EARTH, R_EARTH_EQ, R_GEO } from './constants.js';
import type { OrbitShape } from './elements.js';
import { apoapsisRadius, periapsisRadius, semiMajorAxis, stateFromElements } from './elements.js';
import {
  biEllipticTransfer,
  circularSpeed,
  escapeSpeed,
  hohmannTransfer,
  meanMotion,
  period,
  specificEnergy,
  visVivaSpeed,
} from './twobody.js';

/*
 * ===========================================================================
 * Tier 1 — closed form.  docs/PHYSICS.md, and docs/PRODUCT.md section 7.6.
 *
 * PROVENANCE. Section 7.6's process rule says no value in docs/PRODUCT.md may be
 * copied into a test: that document's numbers were computed from the constants
 * and exist to be *checked*, not trusted. It has already earned its keep once,
 * catching an R_GEO that was 33 m wrong. (Its Appendix A still carries that stale
 * 42164140.0 in two places, which is a documentation bug rather than a code one,
 * and is exactly why nothing below reads from it.)
 *
 * So every expected value here was re-derived from the constants in
 * constants.ts, and each is *additionally* checked against something that does
 * not come from those constants at all wherever such a thing exists:
 *
 *   period          the measured mean sidereal day, 86164.0905 s (IERS)
 *   circular speed  the observed ISS orbital period at ~400 km, ~92.5 min
 *   vis-viva        states built independently by stateFromElements
 *   bi-elliptic     the published dimensionless thresholds 11.94 and 15.58,
 *                   which do not depend on mu or on any radius
 *
 * Where no external anchor exists, the check is a *different route to the same
 * number* — which catches an implementation error even though it cannot catch a
 * wrong constant. Those are labelled as cross-checks rather than as validation,
 * because the difference matters.
 *
 * TOLERANCES. Every one below states what sets it. None was widened to make a
 * failing assertion pass.
 * ===========================================================================
 */

/** 400 km altitude above the WGS-84 equatorial radius — the reference LEO. */
const R_LEO_400 = metres(R_EARTH_EQ + 400_000);

/** Relative comparison, with the deviation in the failure message. */
const expectRelative = (actual: number, expected: number, tol: number, what: string): void => {
  const deviation = Math.abs(actual - expected) / Math.abs(expected);
  expect(
    deviation,
    `${what}: expected ${String(expected)}, got ${String(actual)} (relative ${deviation.toExponential(2)})`,
  ).toBeLessThanOrEqual(tol);
};

const shape = (p: number, e: number, nu: number): OrbitShape => ({
  semiLatusRectum: metres(p),
  eccentricity: e,
  inclination: radians(0.4),
  raan: radians(1.1),
  argp: radians(2.3),
  trueAnomaly: radians(nu),
});

describe('orbital period — T = 2 pi sqrt(a^3 / mu)', () => {
  it('reproduces the measured sidereal day at the geostationary radius', () => {
    /*
     * The independent anchor. A geostationary orbit's period is a sidereal day by
     * definition of the orbit, and the measured mean sidereal day is 86164.0905 s
     * (IERS) — a value observed rather than derived from MU_EARTH.
     *
     * TOLERANCE 20 ms, the same figure constants.test.ts uses and for the same
     * reason: OMEGA_EARTH is the rounded IERS nominal rate and implies a sidereal
     * day about 10 ms longer than the measured one. The tolerance admits that known
     * discrepancy and nothing more. Tightening it would fail on a real, documented
     * difference; loosening it would stop catching anything.
     */
    expect(Math.abs(period(metres(R_GEO), MU_EARTH) - 86_164.0905)).toBeLessThan(0.02);
  });

  it('agrees with the circular-orbit kinematic period, 2 pi r / v', () => {
    // Cross-check, not validation: Kepler's third law against plain kinematics.
    // Different expression, same constants — catches an algebra error, not a wrong mu.
    for (const r of [R_LEO_400, metres(7.178e6), metres(R_GEO), metres(4.0e8)]) {
      const kinematic = (TAU * r) / circularSpeed(r, MU_EARTH);
      // 1e-15 relative: both routes are three or four float operations from the
      // same inputs, so anything above a couple of ulps is a real disagreement.
      expectRelative(period(r, MU_EARTH), kinematic, 1e-15, `period at r = ${String(r)}`);
    }
  });

  it('is consistent with mean motion, n = 2 pi / T', () => {
    for (const a of [R_LEO_400, metres(R_GEO), metres(2.4e7)]) {
      expectRelative(meanMotion(a, MU_EARTH), TAU / period(a, MU_EARTH), 1e-15, 'mean motion');
    }
  });

  it('scales as a^(3/2), which is the content of the third law', () => {
    // Kepler's third law stated as the ratio it actually claims, so a formula that
    // happened to be right at one radius and wrong at another would fail here.
    const inner = metres(7.0e6);
    const outer = metres(2.8e7); // exactly 4x
    expectRelative(
      period(outer, MU_EARTH) / period(inner, MU_EARTH),
      8, // 4^(3/2)
      1e-15,
      'period ratio for a 4x radius ratio',
    );
  });

  it('rejects an orbit that is not closed rather than returning NaN', () => {
    expect(() => period(metres(Number.POSITIVE_INFINITY), MU_EARTH)).toThrow(RangeError);
    expect(() => period(metres(-1.2e7), MU_EARTH)).toThrow(RangeError);
    expect(() => meanMotion(metres(-1.2e7), MU_EARTH)).toThrow(RangeError);
  });
});

describe('vis-viva — v^2 = mu (2/r - 1/a)', () => {
  it('matches the speed of a state built by the element machinery', () => {
    /*
     * The independent route. stateFromElements computes velocity in the perifocal
     * frame as sqrt(mu/p) (-sin nu, e + cos nu, 0) and rotates it — an expression
     * that shares no term with mu (2/r - 1/a). Agreement across the conic classes
     * is what makes this a check rather than a restatement.
     *
     * TOLERANCE 1e-14 relative: the two routes differ by a rotation and a square
     * root, which is a handful of ulps. Not tightened to the observed value because
     * Math.sin is not required to be correctly rounded and differs between engines
     * (docs/PHYSICS.md, cross-platform equality).
     */
    for (const e of [0, 0.1, 0.5, 0.9]) {
      for (let n = 0; n < 16; n++) {
        const nu = (TAU * n) / 16;
        const s = shape(7.0e6, e, nu);
        const state = stateFromElements(s, MU_EARTH);
        const r = V.norm(state.position);

        expectRelative(
          V.norm(state.velocity),
          visVivaSpeed(metres(r), semiMajorAxis(s), MU_EARTH),
          1e-14,
          `speed at e = ${String(e)}, nu = ${String(nu)}`,
        );
      }
    }
  });

  it('gives the closed-form speeds at periapsis and apoapsis', () => {
    // v_peri = sqrt(mu (1+e) / (a (1-e))), v_apo = sqrt(mu (1-e) / (a (1+e))).
    // A second closed form, derived from angular-momentum conservation rather than
    // from the energy integral vis-viva comes from.
    for (const e of [0.1, 0.5, 0.9]) {
      const p = 7.0e6;
      const s = shape(p, e, 0);
      const a = semiMajorAxis(s);
      const rp = periapsisRadius(s);
      const ra = apoapsisRadius(s);

      expectRelative(
        visVivaSpeed(rp, a, MU_EARTH),
        Math.sqrt((MU_EARTH * (1 + e)) / (a * (1 - e))),
        1e-14,
        `periapsis speed at e = ${String(e)}`,
      );
      expectRelative(
        visVivaSpeed(ra, a, MU_EARTH),
        Math.sqrt((MU_EARTH * (1 - e)) / (a * (1 + e))),
        1e-14,
        `apoapsis speed at e = ${String(e)}`,
      );
      // And the product r*v is the same at both apsides, since both are transverse.
      expectRelative(
        rp * visVivaSpeed(rp, a, MU_EARTH),
        ra * visVivaSpeed(ra, a, MU_EARTH),
        1e-14,
        `angular momentum at e = ${String(e)}`,
      );
    }
  });

  it('reduces to the circular and escape cases', () => {
    const r = R_LEO_400;
    expectRelative(visVivaSpeed(r, r, MU_EARTH), circularSpeed(r, MU_EARTH), 1e-15, 'circular');
    expectRelative(
      visVivaSpeed(r, metres(Number.POSITIVE_INFINITY), MU_EARTH),
      escapeSpeed(r, MU_EARTH),
      1e-15,
      'escape',
    );
    // Escape speed is sqrt(2) times circular speed, at every radius.
    expectRelative(
      escapeSpeed(r, MU_EARTH) / circularSpeed(r, MU_EARTH),
      Math.SQRT2,
      1e-15,
      'escape / circular',
    );
  });

  it('rejects a radius that lies off the orbit rather than returning NaN', () => {
    // Beyond apoapsis of a 7000 km-by-8000 km ellipse.
    expect(() => visVivaSpeed(metres(2.0e7), metres(7.5e6), MU_EARTH)).toThrow(RangeError);
    expect(() => visVivaSpeed(metres(0), metres(7.5e6), MU_EARTH)).toThrow(RangeError);
  });
});

describe('circular speed — v = sqrt(mu / r)', () => {
  it('is 7668.6 m/s at 400 km altitude', () => {
    /*
     * Re-derived here, not copied: r = R_EARTH_EQ + 400 km = 6 778 137 m, and
     * sqrt(MU_EARTH / r) = 7668.5582 m/s.
     *
     * TOLERANCE 0.05 m/s, which is half an ulp of the last digit of the 7668.6
     * figure this row is stated to. Asserting tighter would be asserting digits
     * the row does not carry; asserting looser would admit a 100 m error in the
     * radius, which is the kind of mistake this is here to catch.
     */
    expect(Math.abs(circularSpeed(R_LEO_400, MU_EARTH) - 7668.6)).toBeLessThan(0.05);
  });

  it('is 3074.66 m/s at the geostationary radius', () => {
    // Re-derived: sqrt(MU_EARTH / R_GEO) = 3074.6600 m/s.
    // TOLERANCE 0.005 m/s, half an ulp of the last digit of 3074.66.
    expect(Math.abs(circularSpeed(metres(R_GEO), MU_EARTH) - 3074.66)).toBeLessThan(0.005);
  });

  it('agrees with the rotation rate at the geostationary radius', () => {
    // Cross-check: a geostationary orbit's speed is omega * r by definition. This
    // is algebraically the same relation that derives R_GEO, so it validates
    // nothing new — but it does catch a circularSpeed that had drifted from it.
    expectRelative(
      circularSpeed(metres(R_GEO), MU_EARTH),
      OMEGA_EARTH * R_GEO,
      1e-15,
      'geostationary speed',
    );
  });

  it('puts a 400 km orbit at the observed ISS period of about 92.5 minutes', () => {
    /*
     * The one external anchor available for this row, and a deliberately loose one.
     * The ISS orbits at roughly 400 km with a period near 92.5 min. Our answer is
     * 5553.62 s = 92.56 min.
     *
     * TOLERANCE 30 s, which is about 0.5 percent. It has to be loose: the station's
     * altitude varies by tens of kilometres between reboosts, and its real orbit
     * has J2 and drag that this model does not. A tight tolerance here would be
     * asserting agreement the physics does not claim. What it still catches is a
     * unit error or a wrong mu, which would move this by minutes or hours.
     */
    const minutes = period(R_LEO_400, MU_EARTH) / 60;
    expect(Math.abs(minutes - 92.5)).toBeLessThan(0.5);
  });
});

describe('specific energy — sign matches orbit class', () => {
  it('is negative for an ellipse, zero for a parabola, positive for a hyperbola', () => {
    const p = 1.4e7;
    const cases: readonly (readonly [string, number, 'negative' | 'positive'])[] = [
      ['circular', 0, 'negative'],
      ['elliptic', 0.6, 'negative'],
      ['hyperbolic', 1.5, 'positive'],
    ];

    for (const [label, e, expected] of cases) {
      const state = stateFromElements(shape(p, e, 0.7), MU_EARTH);
      const eps = specificEnergy(
        metres(V.norm(state.position)),
        metresPerSec(V.norm(state.velocity)),
        MU_EARTH,
      );

      if (expected === 'negative') {
        expect(eps, `${label} energy should be negative`).toBeLessThan(0);
        // And for a closed orbit the magnitude is -mu / 2a, the energy integral.
        expectRelative(eps, -MU_EARTH / (2 * semiMajorAxis(shape(p, e, 0))), 1e-12, `${label} eps`);
      } else {
        expect(eps, `${label} energy should be positive`).toBeGreaterThan(0);
      }
    }
  });

  it('is zero for a parabola, to the precision the cancellation allows', () => {
    /*
     * The parabolic case gets its own assertion because it is the one that cannot
     * be stated as a sign. eps = v^2/2 - mu/r differences two nearly equal numbers
     * here, so the answer is zero only to the relative precision of the terms.
     *
     * TOLERANCE is expressed relative to mu/r rather than as an absolute energy,
     * because that is what the cancellation is measured against: 1e-15 of the
     * larger term is a couple of ulps, and an absolute bound would be meaningless
     * without saying at what radius.
     */
    const state = stateFromElements(shape(1.4e7, 1, 0.7), MU_EARTH);
    const r = V.norm(state.position);
    const eps = specificEnergy(metres(r), metresPerSec(V.norm(state.velocity)), MU_EARTH);
    expect(Math.abs(eps) / (MU_EARTH / r)).toBeLessThan(1e-15);
  });

  it('is constant over an orbit, which is what makes it an integral', () => {
    const s = (nu: number) => shape(1.4e7, 0.6, nu);
    const at = (nu: number): number => {
      const state = stateFromElements(s(nu), MU_EARTH);
      return specificEnergy(
        metres(V.norm(state.position)),
        metresPerSec(V.norm(state.velocity)),
        MU_EARTH,
      );
    };
    const reference = at(0);
    for (let n = 1; n < 32; n++) {
      // 1e-12 relative: the terms cancel to about a tenth of their size at e = 0.6,
      // so a few digits are lost and this is the honest bound rather than 1e-15.
      expectRelative(at((TAU * n) / 32), reference, 1e-12, `energy at nu = ${String(n)}/32 turn`);
    }
  });
});

describe('Hohmann transfer — LEO 400 km to GEO', () => {
  const transfer = hohmannTransfer(R_LEO_400, metres(R_GEO), MU_EARTH);

  /*
   * Re-derived from the constants:
   *   r1 = 6 778 137 m, r2 = R_GEO = 42 164 172.93 m, a_t = 24 471 154.97 m
   *   dv1 = 2397.4731 m/s   dv2 = 1456.4867 m/s   total = 3853.9598 m/s
   *   TOF = pi sqrt(a_t^3 / mu) = 19 048.5835 s
   *
   * TOLERANCE 0.05 m/s and 0.05 s throughout — half an ulp of the last digit each
   * figure is stated to. Nothing here is tuned; the derived values sit 0.03 m/s and
   * 0.02 s from the stated ones, comfortably inside.
   */
  it('costs 2397.5 m/s to leave and 1456.5 m/s to circularise', () => {
    expect(Math.abs(transfer.firstBurn - 2397.5)).toBeLessThan(0.05);
    expect(Math.abs(transfer.secondBurn - 1456.5)).toBeLessThan(0.05);
  });

  it('costs 3854.0 m/s in total', () => {
    expect(Math.abs(transfer.totalDeltaV - 3854.0)).toBeLessThan(0.05);
    // And the total really is the sum, rather than a separately computed number
    // that could drift from its parts.
    expectRelative(
      transfer.totalDeltaV,
      transfer.firstBurn + transfer.secondBurn,
      1e-15,
      'total vs parts',
    );
  });

  it('takes 19048.6 s, which is 5.29 hours', () => {
    expect(Math.abs(transfer.timeOfFlight - 19_048.6)).toBeLessThan(0.05);
    expect(Math.abs(transfer.timeOfFlight / 3600 - 5.29)).toBeLessThan(0.005);
  });

  it('flies an ellipse tangent to both circular orbits', () => {
    /*
     * The structural check, and the one that would catch a transfer that produced
     * the right Δv for the wrong geometry. The transfer ellipse is reconstructed as
     * an OrbitShape and handed to the element machinery: its periapsis must be the
     * inner radius and its apoapsis the outer one.
     */
    const a = transfer.transferSemiMajorAxis;
    const e = (R_GEO - R_LEO_400) / (R_GEO + R_LEO_400);
    const ellipse = shape(a * (1 - e * e), e, 0);

    expectRelative(periapsisRadius(ellipse), R_LEO_400, 1e-12, 'transfer periapsis');
    expectRelative(apoapsisRadius(ellipse), R_GEO, 1e-12, 'transfer apoapsis');
    // Time of flight is half that ellipse's period.
    expectRelative(transfer.timeOfFlight, period(a, MU_EARTH) / 2, 1e-15, 'time of flight');
  });

  it('gives the same burns in the opposite direction', () => {
    // Going down costs what going up costs, burn for burn with the roles swapped.
    // An absolute value in the wrong place would hide inside the total but not here.
    const inward = hohmannTransfer(metres(R_GEO), R_LEO_400, MU_EARTH);
    expectRelative(inward.firstBurn, transfer.secondBurn, 1e-15, 'first burn inward');
    expectRelative(inward.secondBurn, transfer.firstBurn, 1e-15, 'second burn inward');
    expectRelative(inward.timeOfFlight, transfer.timeOfFlight, 1e-15, 'time of flight inward');
  });

  it('is free when the radii are equal', () => {
    const none = hohmannTransfer(R_LEO_400, R_LEO_400, MU_EARTH);
    expect(none.totalDeltaV).toBe(0);
    expectRelative(none.timeOfFlight, period(R_LEO_400, MU_EARTH) / 2, 1e-15, 'half a period');
  });
});

describe('bi-elliptic transfer, and the threshold against Hohmann', () => {
  /*
   * ---------------------------------------------------------------------------
   * The two published thresholds are 11.94 and 15.58, and they are NOT the two
   * ends of one comparison. They answer two different questions, and a test that
   * treats them as endpoints of a single sweep gets the second one wrong — a
   * sweep that picks the best intermediate radius reproduces 11.94 and never sees
   * 15.58 at all.
   *
   *   11.94  below this ratio Hohmann wins for EVERY intermediate radius. It is
   *          where the bi-elliptic with r_b -> infinity ties Hohmann; that limit
   *          is the best the bi-elliptic can ever do, so if it loses there it
   *          loses everywhere.
   *
   *   15.58  above this ratio bi-elliptic wins for EVERY intermediate radius
   *          beyond r2. It is where the derivative of the bi-elliptic Δv with
   *          respect to r_b turns negative at r_b = r2, so leaving the Hohmann
   *          geometry at all immediately pays.
   *
   * Between them it depends on r_b, which is the interesting regime and the one
   * contract C11 sits in.
   *
   * Both are dimensionless and independent of mu and of r1, which is what makes
   * them an external check rather than a restatement of our constants. That
   * independence is asserted below rather than assumed.
   *
   * TOLERANCE 0.005 on each, half an ulp of the last digit of the published
   * four-figure values. Measured: 11.9388 and 15.5817.
   * ---------------------------------------------------------------------------
   */

  /** Bisection on the ratio, for a predicate that changes sign exactly once. */
  const findRatio = (predicate: (ratio: number) => number, low: number, high: number): number => {
    let a = low;
    let b = high;
    for (let n = 0; n < 200; n++) {
      const mid = (a + b) / 2;
      if (predicate(a) * predicate(mid) <= 0) b = mid;
      else a = mid;
    }
    return (a + b) / 2;
  };

  /** How much cheaper bi-elliptic is than Hohmann, for a given ratio and r_b. */
  const saving = (r1: number, ratio: number, rbOverR2: number, mu: number): number => {
    const r2 = r1 * ratio;
    return (
      hohmannTransfer(metres(r1), metres(r2), mu).totalDeltaV -
      biEllipticTransfer(metres(r1), metres(r2), metres(r2 * rbOverR2), mu).totalDeltaV
    );
  };

  it('costs exactly the Hohmann Δv when the intermediate radius is the target', () => {
    /*
     * r_b = r2 collapses the second ellipse onto the target circle: the first two
     * burns become the Hohmann pair and the THIRD burn is the one that vanishes,
     * not the second. Getting this the wrong way round is easy — the naming
     * suggests the middle burn should be the redundant one — so it is asserted
     * per burn rather than only on the total.
     *
     * The time of flight does NOT collapse, and deliberately is not asserted to.
     * See the note on the artefact below.
     */
    for (const ratio of [2, 8, 16, 40]) {
      const r2 = R_LEO_400 * ratio;
      const bi = biEllipticTransfer(R_LEO_400, metres(r2), metres(r2), MU_EARTH);
      const hohmann = hohmannTransfer(R_LEO_400, metres(r2), MU_EARTH);

      expectRelative(bi.firstBurn, hohmann.firstBurn, 1e-15, `first burn, ratio ${String(ratio)}`);
      expectRelative(
        bi.secondBurn,
        hohmann.secondBurn,
        1e-15,
        `second burn, ratio ${String(ratio)}`,
      );
      expect(bi.thirdBurn, `third burn, ratio ${String(ratio)}`).toBe(0);
      expectRelative(bi.totalDeltaV, hohmann.totalDeltaV, 1e-15, `total at ratio ${String(ratio)}`);
    }
  });

  it('carries a half-revolution of extra coast in the degenerate case', () => {
    /*
     * The artefact, asserted so that it is a known property rather than a surprise.
     * At r_b = r2 the second ellipse IS the target circle, so the parameterisation
     * still charges half a revolution of it before a burn that costs nothing. The
     * Δv is exact; the time is half a period of r2 too long.
     *
     * Not special-cased in the code. A branch at r_b = r2 would be a discontinuity
     * introduced to tidy up a boundary that no real transfer sits on — every useful
     * bi-elliptic has r_b strictly greater than r2 — and the honest answer is to
     * say what the formula does.
     */
    const r2 = metres(R_LEO_400 * 16);
    const bi = biEllipticTransfer(R_LEO_400, r2, r2, MU_EARTH);
    const hohmann = hohmannTransfer(R_LEO_400, r2, MU_EARTH);

    expectRelative(
      bi.timeOfFlight,
      hohmann.timeOfFlight + period(r2, MU_EARTH) / 2,
      1e-15,
      'degenerate time of flight',
    );
  });

  it('puts the bi-parabolic limit tie at r2/r1 = 11.94', () => {
    // r_b/r2 = 1e6 stands in for the limit; the curve is flat enough there that
    // going further moves the root by less than the tolerance.
    const threshold = findRatio((ratio) => saving(R_LEO_400, ratio, 1e6, MU_EARTH), 5, 30);
    expect(Math.abs(threshold - 11.94)).toBeLessThan(0.005);
  });

  it('puts the always-wins threshold at r2/r1 = 15.58', () => {
    // Where d(dv_bi)/d(r_b) turns negative at r_b = r2. A one-sided difference just
    // above r2, because at r2 exactly the bi-elliptic IS the Hohmann transfer.
    const slopeAtR2 = (ratio: number): number => {
      const step = 1e-7;
      return (
        saving(R_LEO_400, ratio, 1 + 2 * step, MU_EARTH) -
        saving(R_LEO_400, ratio, 1 + step, MU_EARTH)
      );
    };
    const threshold = findRatio(slopeAtR2, 10, 30);
    expect(Math.abs(threshold - 15.58)).toBeLessThan(0.005);
  });

  it('places both thresholds independently of mu and of the inner radius', () => {
    // The claim that makes these external references rather than facts about our
    // constants. Same two numbers for a different central body and a different r1.
    const MU_MARS = 4.282837e13;
    const cases: readonly (readonly [number, number])[] = [
      [R_LEO_400, MU_EARTH],
      [7.5e6, MU_EARTH],
      [3.6e6, MU_MARS],
    ];

    for (const [r1, mu] of cases) {
      const first = findRatio((ratio) => saving(r1, ratio, 1e6, mu), 5, 30);
      expect(Math.abs(first - 11.94), `first threshold at r1 = ${String(r1)}`).toBeLessThan(0.005);
    }
  });

  it('behaves as the thresholds say on each side of them', () => {
    // The thresholds restated as the statements a player would care about, checked
    // at ratios either side rather than only at the roots.
    // Below 11.94: Hohmann wins even against the most extreme bi-elliptic.
    expect(saving(R_LEO_400, 11, 1e6, MU_EARTH)).toBeLessThan(0);
    // Above 15.58: bi-elliptic wins even for an intermediate radius barely past r2.
    expect(saving(R_LEO_400, 16, 1.05, MU_EARTH)).toBeGreaterThan(0);
    // In between, it depends on r_b — losing when close in, winning when far out.
    expect(saving(R_LEO_400, 13, 1.05, MU_EARTH)).toBeLessThan(0);
    expect(saving(R_LEO_400, 13, 100, MU_EARTH)).toBeGreaterThan(0);
  });

  it('rejects an intermediate radius inside either circular orbit', () => {
    expect(() => biEllipticTransfer(R_LEO_400, metres(R_GEO), metres(2.0e7), MU_EARTH)).toThrow(
      RangeError,
    );
  });

  it('charges three burns whose sum is the total', () => {
    const bi = biEllipticTransfer(R_LEO_400, metres(R_GEO), metres(5.0e8), MU_EARTH);
    expectRelative(
      bi.totalDeltaV,
      bi.firstBurn + bi.secondBurn + bi.thirdBurn,
      1e-15,
      'total vs parts',
    );
    expect(bi.timeOfFlight).toBeGreaterThan(seconds(0));
  });
});
