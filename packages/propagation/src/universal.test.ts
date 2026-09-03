/**
 * Universal-variable propagation.
 *
 * The oracles here are deliberately *not* this module. Three are used, in
 * increasing order of independence:
 *
 * 1. **Closed-form invariants** — specific energy and the angular momentum vector
 *    are constants of the two-body problem, so any propagated state must carry the
 *    ones it started with. This catches an algebra error but shares the code's
 *    assumptions about frames and units.
 * 2. **The classical elliptic path** — `elementsFromState`, Kepler's equation and
 *    `stateFromElements`, which are validated against Curtis in `@hh/astro`. This
 *    is an independent *route* to the same answer over the elliptic range, and it
 *    is what §7.6 Tier 2 asks for.
 * 3. **Time reversal** — the sharpest cheap test of a propagator, because it
 *    exercises the solver twice with no reference value at all.
 *
 * The DOP853 cross-check in `crosscheck.test.ts` is the fourth, and the only one
 * that shares no code with this module. A Tier 3 external reference (`poliastro`
 * or JPL Horizons) is still absent and `docs/PHYSICS.md` says so against #55; no
 * printed textbook value is asserted here, because §7.6's process rule requires
 * the person writing the test to have verified it against the physical book.
 */
import { MU_EARTH, eci, elementsFromState, period, stateFromElements } from '@hh/astro';
import type { State } from '@hh/astro';
import { V, metres, metresPerSec, radians, seconds } from '@hh/math';
import { describe, expect, it } from 'vitest';

import { propagate } from './universal.js';

/** A state built from elements, so the test says what orbit it means. */
const orbit = (
  a: number,
  e: number,
  nu: number,
  { inclination = 0.4, raan = 1.1, argp = 2.2 } = {},
): State =>
  stateFromElements(
    {
      semiLatusRectum: metres(e === 1 ? a : Math.abs(a * (1 - e * e))),
      eccentricity: e,
      inclination: radians(inclination),
      raan: radians(raan),
      argp: radians(argp),
      trueAnomaly: radians(nu),
    },
    MU_EARTH,
  );

/**
 * An open orbit, built from its periapsis radius.
 *
 * `p = r_p (1 + e)` holds for every conic, so this is the one constructor that
 * works unchanged at `e = 1` — where the semi-major axis is infinite and naming
 * the orbit by it is not possible.
 */
const orbitFromPeriapsis = (periapsis: number, e: number, nu: number): State =>
  stateFromElements(
    {
      semiLatusRectum: metres(periapsis * (1 + e)),
      eccentricity: e,
      inclination: radians(0.4),
      raan: radians(1.1),
      argp: radians(2.2),
      trueAnomaly: radians(nu),
    },
    MU_EARTH,
  );

const relativePosition = (got: State, want: State): number =>
  V.distance(got.position, want.position) / V.norm(want.position);

const relativeState = (got: State, want: State): number =>
  Math.max(
    relativePosition(got, want),
    V.distance(got.velocity, want.velocity) / V.norm(want.velocity),
  );

/** Specific orbital energy, a constant of the motion. */
const specificEnergy = (s: State): number =>
  V.normSq(s.velocity) / 2 - MU_EARTH / V.norm(s.position);

/** Propagate or fail the test with the reason, rather than silently skipping. */
const advance = (s: State, dt: number): State => {
  const result = propagate(s, seconds(dt), MU_EARTH);
  if (!result.converged) {
    throw new Error(`propagation did not converge: ${result.reason}`);
  }
  return result.state;
};

const SECONDS_PER_DAY = 86400;
const SEMI_MAJOR_AXES = [6.6e6, 1e7, 4.2e7, 1e8, 4e8];
const TRUE_ANOMALIES = [0, 0.3, 2, 3.14, 4.4];

describe('time reversal (§13.3, FR-005)', () => {
  /**
   * The measured error envelope, and the only tolerance in this file that is not
   * either a round-off floor or a printed precision.
   *
   * §13.3 asks for 1e-12 relative across `dt` in [-30 d, +30 d]. **That is not
   * attainable in float64 across the whole element domain, and the shortfall is a
   * property of the state representation rather than of this solver.** Reversing a
   * propagation starts from a state that is itself only known to about one `eps`,
   * and Kepler dynamics amplify that: an energy error becomes a period error,
   * which becomes an along-track error growing with every revolution, and near
   * periapsis of an eccentric orbit the same displacement in time is a much larger
   * displacement in space.
   *
   * Measured worst relative error over `a` in [6.6e6, 4e8] m, five true anomalies
   * and both signs of `dt`:
   *
   * | e | 1 rev | 10 rev | 100 rev |
   * | --- | --- | --- | --- |
   * | 0.00 | 8.6e-15 | 7.4e-14 | 8.2e-13 |
   * | 0.30 | 1.1e-14 | 2.2e-13 | 2.1e-12 |
   * | 0.60 | 1.0e-13 | 8.3e-13 | 7.5e-12 |
   * | 0.80 | 4.7e-13 | 5.7e-12 | 3.1e-11 |
   * | 0.90 | 3.2e-12 | 2.6e-11 | 2.6e-10 |
   * | 0.95 | 1.9e-11 | 1.9e-10 | 1.9e-9 |
   *
   * Every cell is `8e-15 N (1 - e)^-2.5` to within a factor of 1.3, across three
   * decades of revolutions and three of eccentricity. The linear growth in `N` and
   * the divergence as `e` approaches 1 are both expected; the exponent 2.5 is
   * **fitted to this table, not derived**, and is stated that way on purpose.
   *
   * The asserted constant is 3.75x the fitted one. That margin is for engine
   * differences in `Math.sin`/`Math.cos`, which §11.4 explicitly does not assume
   * away, not for slack in the model.
   */
  const envelope = (revolutions: number, e: number): number =>
    3e-14 * Math.max(1, revolutions) * (1 - e) ** -2.5;

  it.each([0, 0.3, 0.6, 0.8, 0.9, 0.95])(
    'returns the initial state within the measured envelope at e = %f',
    (e) => {
      let worst = 0;
      let worstLabel = '';

      for (const a of SEMI_MAJOR_AXES) {
        const orbitalPeriod = period(metres(a), MU_EARTH);
        for (const revolutions of [1, 10, 100]) {
          const dt = revolutions * orbitalPeriod;
          if (dt > 30 * SECONDS_PER_DAY) continue;
          for (const nu of TRUE_ANOMALIES) {
            const start = orbit(a, e, nu);
            for (const sign of [1, -1]) {
              const error = relativeState(advance(advance(start, sign * dt), -sign * dt), start);
              const ratio = error / envelope(revolutions, e);
              if (ratio > worst) {
                worst = ratio;
                worstLabel = `a=${a.toExponential(1)} nu=${String(nu)} revs=${String(revolutions)} sign=${String(sign)} error=${error.toExponential(2)}`;
              }
            }
          }
        }
      }

      expect(worst, `worst case was ${worstLabel}`).toBeLessThan(1);
    },
  );

  it('meets §13.3’s flat 1e-12 wherever the amplification stays under 60', () => {
    /**
     * `N (1 - e)^-2.5 <= 60` is where the envelope above crosses 1e-12, measured
     * rather than solved for: the fit's own 1.3x spread puts the analytic crossing
     * at 125 and the observed one lower, so the number here is the largest round
     * value that actually holds. Measured worst at each cap over the grid below —
     * 125: 1.1e-12, 100: 1.1e-12, 80: 1.1e-12, **60: 5.7e-13**, 40: 4.8e-13.
     *
     * A near-circular orbit therefore satisfies §13.3 literally for sixty
     * revolutions, which covers every v1.0 contract: the longest routine one is
     * twelve hours, or about seven and a half LEO revolutions.
     */
    for (const a of SEMI_MAJOR_AXES) {
      const orbitalPeriod = period(metres(a), MU_EARTH);
      for (const e of [0, 0.1, 0.3, 0.5, 0.7, 0.8]) {
        const maxRevolutions = 60 * (1 - e) ** 2.5;
        const dt = Math.min(maxRevolutions * orbitalPeriod, 30 * SECONDS_PER_DAY);
        for (const nu of TRUE_ANOMALIES) {
          const start = orbit(a, e, nu);
          expect(relativeState(advance(advance(start, dt), -dt), start)).toBeLessThan(1e-12);
          expect(relativeState(advance(advance(start, -dt), dt), start)).toBeLessThan(1e-12);
        }
      }
    }
  });

  it('reverses an open orbit, where there is no revolution count to accumulate', () => {
    for (const e of [1, 1.0001, 1.01, 1.2, 2, 5]) {
      for (const periapsis of [7e6, 4.2e7]) {
        for (const nu of [0, 0.4, 1.5]) {
          const start = orbitFromPeriapsis(periapsis, e, nu);
          for (const dt of [3600, 30 * SECONDS_PER_DAY]) {
            expect(relativeState(advance(advance(start, dt), -dt), start)).toBeLessThan(1e-8);
            expect(relativeState(advance(advance(start, -dt), dt), start)).toBeLessThan(1e-8);
          }
        }
      }
    }
  });
});

describe('agreement with the classical elliptic solver (§7.6 Tier 2)', () => {
  /**
   * Solve Kepler's equation directly and rebuild the state from elements. This
   * route shares no code with the universal formulation beyond `@hh/astro`'s
   * element conversions, and it is the one §7.6 names — "agrees with the classical
   * elliptic solver to 1e-11 across the elliptic range".
   *
   * Worst observed across the grid below is 1.5e-12, so the 1e-11 the requirement
   * asks for is met with an order to spare rather than by tuning.
   */
  const classical = (a: number, e: number, dt: number): State => {
    const meanMotion = Math.sqrt(MU_EARTH / a ** 3);
    const meanAnomaly = (meanMotion * dt) % (2 * Math.PI);
    let eccentric = meanAnomaly;
    for (let i = 0; i < 200; i++) {
      const denominator = 1 - e * Math.cos(eccentric);
      eccentric -= (eccentric - e * Math.sin(eccentric) - meanAnomaly) / denominator;
    }
    const trueAnomaly =
      2 *
      Math.atan2(
        Math.sqrt(1 + e) * Math.sin(eccentric / 2),
        Math.sqrt(1 - e) * Math.cos(eccentric / 2),
      );
    return orbit(a, e, trueAnomaly);
  };

  it('agrees to better than 1e-11 across the elliptic range', () => {
    let worst = 0;
    for (const a of [6.6e6, 4.2e7, 4e8]) {
      for (const e of [0, 0.05, 0.3, 0.7, 0.95]) {
        // Start at periapsis, where mean, eccentric and true anomaly all vanish, so
        // the classical route needs no inversion to establish its own start.
        const start = orbit(a, e, 0);
        const orbitalPeriod = period(metres(a), MU_EARTH);
        for (const fraction of [0.01, 0.13, 0.37, 0.5, 0.79, 0.99, 3.4, 17.2]) {
          const dt = fraction * orbitalPeriod;
          worst = Math.max(worst, relativeState(advance(start, dt), classical(a, e, dt)));
        }
      }
    }
    expect(worst).toBeLessThan(1e-11);
  });
});

describe('no accumulation with elapsed time (D5, §11.4)', () => {
  /**
   * The determinism specification's "no accumulation" row is the claim under test:
   * because the state at `t` is a pure function of the state at `t0` and the
   * elapsed time, a long arc is not a stack of short ones and does not inherit
   * their errors.
   *
   * The comparison is one 17-day call against the same span walked in `n` chained
   * calls. A stepped integrator would drift steadily from the single call as `n`
   * grows; this does not, because the single call is the accurate one and the chain
   * is the one paying `n` times for re-representing an intermediate state.
   */
  it('a 17-day arc is not worse than a 17-minute one', () => {
    for (const a of [6.6e6, 4.2e7]) {
      const start = orbit(a, 0.3, 0.9);
      const short = relativePosition(advance(advance(start, 17 * 60), -17 * 60), start);
      const long = relativePosition(
        advance(advance(start, 17 * SECONDS_PER_DAY), -17 * SECONDS_PER_DAY),
        start,
      );
      // Both are at the float64 floor for their orbit. The long arc is allowed the
      // revolution-count amplification the envelope above quantifies and nothing
      // more; it is emphatically not allowed to be worse by orders of magnitude,
      // which is what a stepped propagator would give.
      const revolutions = (17 * SECONDS_PER_DAY) / period(metres(a), MU_EARTH);
      expect(long).toBeLessThan(Math.max(short, 1e-15) + 3e-14 * revolutions);
    }
  });

  it('one long call is at least as accurate as the same span in chained calls', () => {
    const total = 17 * SECONDS_PER_DAY;
    for (const a of [6.6e6, 4.2e7]) {
      const start = orbit(a, 0.3, 0.9);
      const single = advance(start, total);

      for (const steps of [10, 100, 1000]) {
        let walked = start;
        for (let i = 0; i < steps; i++) walked = advance(walked, total / steps);
        // The chain and the single call agree to the chain's own accumulated
        // round-off. The point is that this number belongs to the chain: the
        // single call did no stepping to accumulate it.
        expect(relativePosition(walked, single)).toBeLessThan(1e-9);
      }
    }
  });
});

describe('invariants of the two-body problem', () => {
  it('conserves specific energy and the angular momentum vector', () => {
    for (const a of SEMI_MAJOR_AXES) {
      for (const e of [0, 0.3, 0.8]) {
        const start = orbit(a, e, 0.7);
        const energy0 = specificEnergy(start);
        const momentum0 = V.cross(start.position, start.velocity);

        for (const dt of [-8e4, -600, 600, 8e4]) {
          const moved = advance(start, dt);
          expect(Math.abs(specificEnergy(moved) - energy0) / Math.abs(energy0)).toBeLessThan(1e-12);
          const momentum = V.cross(moved.position, moved.velocity);
          expect(V.distance(momentum, momentum0) / V.norm(momentum0)).toBeLessThan(1e-12);
        }
      }
    }
  });

  it('preserves the orbit it was given', () => {
    for (const e of [0, 0.4, 1.6]) {
      const start = orbit(2e7 * (e > 1 ? -1 : 1), e, 0.5);
      const before = elementsFromState(start.position, start.velocity, MU_EARTH);
      const after = (() => {
        const moved = advance(start, 4000);
        return elementsFromState(moved.position, moved.velocity, MU_EARTH);
      })();
      expect(after.semiLatusRectum).toBeCloseTo(before.semiLatusRectum, 4);
      expect(after.eccentricity).toBeCloseTo(before.eccentricity, 10);
      expect(after.inclination).toBeCloseTo(before.inclination, 10);
    }
  });
});

describe('conic classes (FR-005)', () => {
  it.each([
    ['circular', 0],
    ['elliptic', 0.4],
    ['highly elliptic', 0.95],
    ['parabolic', 1],
    ['near-parabolic hyperbolic', 1.000001],
    ['hyperbolic', 1.6],
    ['strongly hyperbolic', 4],
  ])('propagates a %s orbit forwards and backwards', (_label, e) => {
    // Named by periapsis rather than by semi-major axis so the parabolic row is
    // constructible at all, and so every row describes an orbit of the same size.
    const start = orbitFromPeriapsis(7e6, e, 0.3);
    for (const dt of [-8e4, -60, 60, 8e4]) {
      const result = propagate(start, seconds(dt), MU_EARTH);
      expect(result.converged).toBe(true);
      if (!result.converged) return;
      expect(Number.isFinite(V.norm(result.state.position))).toBe(true);
      expect(relativeState(advance(result.state, -dt), start)).toBeLessThan(1e-9);
    }
  });

  it('never reaches the bracketed fallback on the grid it is tuned for', () => {
    // Documents the measurement in `BARKER_STARTER_BAND`: the starting values are
    // good enough that Newton alone covers every case here. The fallback is still a
    // tested path -- see the domain tests below -- but it is not the working path.
    for (const e of [0, 0.5, 0.9, 0.99, 1, 1.001, 1.1, 3]) {
      for (const nu of [0, 0.8, 1.9]) {
        const start = orbitFromPeriapsis(7e6, e, nu);
        for (const dt of [-8e4, -60, 60, 8e4]) {
          const result = propagate(start, seconds(dt), MU_EARTH);
          expect(result.converged).toBe(true);
          if (result.converged) expect(result.method).toBe('newton');
        }
      }
    }
  });
});

describe('degenerate orbits are the common case, not an edge case', () => {
  it.each([
    ['circular', 0, 0.5],
    ['equatorial', 0.3, 0],
    ['circular equatorial', 0, 0],
    ['retrograde equatorial', 0.2, Math.PI],
  ])('propagates a %s orbit without special-casing it', (_label, e, inclination) => {
    const start = orbit(1.2e7, e, 0.6, { inclination, raan: 0, argp: 0 });
    for (const dt of [-5000, 5000, 5e5]) {
      const moved = advance(start, dt);
      expect(Number.isFinite(V.norm(moved.position))).toBe(true);
      expect(relativeState(advance(moved, -dt), start)).toBeLessThan(1e-12);
    }
  });
});

describe('zero elapsed time', () => {
  it('returns the state it was given, by identity rather than to a tolerance', () => {
    const start = orbit(1.2e7, 0.3, 0.6);
    const result = propagate(start, seconds(0), MU_EARTH);
    expect(result.converged).toBe(true);
    if (!result.converged) return;
    // Reference equality: FR-102 needs an arc at its own start epoch to give back
    // what it was built from, and "equal to 1e-16" is a weaker promise.
    expect(result.state).toBe(start);
    expect(result.universalAnomaly).toBe(0);
    expect(result.wholeRevolutions).toBe(0);
  });

  it('returns the initial state exactly after a whole number of periods', () => {
    const a = 1.2e7;
    const start = orbit(a, 0.3, 0.6);
    const result = propagate(start, period(metres(a), MU_EARTH), MU_EARTH);
    expect(result.converged).toBe(true);
    if (!result.converged) return;
    expect(result.wholeRevolutions).toBe(1);
    // The remainder after removing one whole period is not exactly zero -- the
    // period is a float64 number -- so this is a tolerance, not an identity.
    expect(relativeState(result.state, start)).toBeLessThan(1e-14);
  });
});

describe('non-convergence is a return value (§11.4)', () => {
  const start = orbit(1e7, 0.2, 0.4);

  it.each([
    ['a non-positive gravitational parameter', 0],
    ['a negative gravitational parameter', -MU_EARTH],
    ['a non-finite gravitational parameter', Number.POSITIVE_INFINITY],
    ['a NaN gravitational parameter', Number.NaN],
  ])('reports %s as out-of-domain rather than throwing', (_label, mu) => {
    const result = propagate(start, seconds(600), mu);
    expect(result.converged).toBe(false);
    if (result.converged) return;
    expect(result.reason).toBe('out-of-domain');
  });

  it.each([
    ['an infinite elapsed time', Number.POSITIVE_INFINITY],
    ['a NaN elapsed time', Number.NaN],
  ])('reports %s as out-of-domain rather than throwing', (_label, dt) => {
    const result = propagate(start, seconds(dt), MU_EARTH);
    expect(result.converged).toBe(false);
    if (result.converged) return;
    expect(result.reason).toBe('out-of-domain');
  });

  it('reports a zero-radius state as out-of-domain', () => {
    const result = propagate(
      { position: start.position, velocity: start.velocity },
      seconds(600),
      MU_EARTH,
    );
    expect(result.converged).toBe(true);
    const degenerate = propagate(
      { ...start, position: eci(V.scale(start.position, 0)) },
      seconds(600),
      MU_EARTH,
    );
    expect(degenerate.converged).toBe(false);
    if (degenerate.converged) return;
    expect(degenerate.reason).toBe('out-of-domain');
  });

  it('reaches the bracketed fallback when Newton is denied its iterations', () => {
    // The fallback is a tested path, not decoration. Capping Newton at a single
    // step forces it, and the answer must still be the same one.
    const reference = advance(start, 4000);
    const result = propagate(start, seconds(4000), MU_EARTH, { maxIterations: 1 });
    expect(result.converged).toBe(true);
    if (!result.converged) return;
    expect(result.method).toBe('bracketed');
    expect(relativeState(result.state, reference)).toBeLessThan(1e-12);
  });

  it('reports a state whose energy overflows as out-of-domain', () => {
    // A velocity this large makes `v^2` infinite, so `alpha` is -Infinity and `F`
    // is not finite anywhere. The bracket search then cannot straddle a root -- not
    // because the root is elsewhere, but because there is no finite function to
    // search. That is an out-of-domain input, and it is reported as one rather than
    // as an iteration budget that was never the problem.
    const result = propagate(
      { ...start, velocity: eci(V.scale(start.velocity, 1e200)) },
      seconds(600),
      MU_EARTH,
    );
    expect(result.converged).toBe(false);
    if (result.converged) return;
    expect(result.reason).toBe('out-of-domain');
  });

  it('cannot exhaust the bracketed fallback on a well-formed state', () => {
    // `max-iterations` stays in the result type because `brent` can return it and
    // an unhandled case is worse than an unreachable one. It is not reachable here:
    // `F` is strictly increasing, the bracket is grown until it straddles, and
    // Brent on a valid bracket of a monotone function converges well inside its cap.
    // Denying Newton every iteration proves the fallback carries the whole solve.
    for (const dt of [60, 4000, 1234.5678, 987654.321]) {
      const result = propagate(start, seconds(dt), MU_EARTH, { maxIterations: 1, tolerance: 0 });
      expect(result.converged).toBe(true);
      if (!result.converged) continue;
      expect(result.method).toBe('bracketed');
      expect(relativeState(result.state, advance(start, dt))).toBeLessThan(1e-12);
    }
  });
});

describe('determinism (NFR-008)', () => {
  it('is a pure function of its arguments', () => {
    const start = orbit(2.4e7, 0.42, 1.7);
    const first = propagate(start, seconds(9e5), MU_EARTH);
    const second = propagate(start, seconds(9e5), MU_EARTH);
    expect(second).toStrictEqual(first);
  });

  it('does not mutate the state it was given', () => {
    const start = orbit(2.4e7, 0.42, 1.7);
    const snapshot = structuredClone({
      position: { ...start.position },
      velocity: { ...start.velocity },
    });
    advance(start, 9e5);
    expect({ position: { ...start.position }, velocity: { ...start.velocity } }).toStrictEqual(
      snapshot,
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * Tier 3 — independent reference (#54)
 *
 * Vallado, D. A., "Fundamentals of Astrodynamics and Applications", 4th edition,
 * Microcosm Press / Springer, 2013. ISBN 978-1-881883-18-0. Example 2-4,
 * "Solving Kepler's Problem", section 2.3, pp. 94-95.
 *
 * Read from that edition per the process rule in docs/PRODUCT.md section 7.6, and
 * from an image of the printed page rather than the PDF's text layer -- four of
 * the twelve numbers below are negative and a dropped sign would be a passing
 * test of the wrong thing.
 *
 * ## Why this is here and not only in @hh/astro
 *
 * The Tier 3 table's propagation row said a `poliastro`/`astropy` fixture would be
 * the first external reference for propagation (#55, and that fixture lands in the
 * same pull request). This is a *textbook* one, and it is a stronger check in one
 * specific way: the fixture and this propagator could in principle share a
 * misconception about universal variables, whereas a worked example computed by
 * hand in 2013 cannot have inherited anything from either.
 *
 * It is a Chapter 2 Kepler worked example, so it belongs to #54; it happens to
 * exercise the propagator, which is #55's row. Both are in this pull request.
 *
 * ## mu and conventions
 *
 * Vallado's 398,600.4418 km^3/s^2 is `MU_EARTH` exactly. His chi is our universal
 * anomaly and his psi our z; the algorithm is the same one `universal.ts` cites.
 * The book works in km and km/s throughout and the conversion happens here, at the
 * boundary, and nowhere else.
 * ---------------------------------------------------------------------------
 */

describe("Vallado 4th ed., Example 2-4 (section 2.3, pp. 94-95) — Kepler's problem", () => {
  const KM = 1e3;

  // GIVEN, in the geocentric equatorial frame:
  //   r = 1131.340 I - 2282.343 J + 6672.423 K km
  //   v = -5.643 05 I + 4.303 33 J + 2.428 79 K km/s
  //   dt = 40 min
  const initial: State = {
    position: eci(V.vec3(metres(1131.34 * KM), metres(-2282.343 * KM), metres(6672.423 * KM))),
    velocity: eci(
      V.vec3(metresPerSec(-5.64305 * KM), metresPerSec(4.30333 * KM), metresPerSec(2.42879 * KM)),
    ),
  };
  const dt = seconds(40 * 60);

  const result = propagate(initial, dt, MU_EARTH);

  it('converges', () => {
    expect(result.converged).toBe(true);
  });

  it("reproduces the book's intermediate orbit size", () => {
    // The book computes xi = -27.678 777 km^2/s^2 and a = 7200.4706 km on the way
    // through. Asserted because they are where a unit slip would surface before it
    // could be absorbed into the final state.
    const r0 = V.norm(initial.position);
    const energy = V.normSq(initial.velocity) / 2 - MU_EARTH / r0;
    expect(Math.abs(energy / KM ** 2 - -27.678777) / 27.678777).toBeLessThanOrEqual(1e-6);

    const a = -MU_EARTH / (2 * energy);
    expect(Math.abs(a / KM - 7200.4706) / 7200.4706).toBeLessThanOrEqual(1e-6);
  });

  it('reproduces the state the book prints after 40 minutes', () => {
    if (!result.converged) throw new Error('expected convergence');

    /*
     * r = -4219.7527 I + 4363.0292 J - 3958.7666 K km
     * v =  3.689 866 I - 1.916 735 J - 6.112 511 K km/s
     *
     * TOLERANCE. 1e-6 relative on each component -- the book's precision, not
     * ours. The binding component is the velocity, printed to seven significant
     * figures, whose half-ulp is 5e-7 / 3.69 = 1.4e-7 relative; 1e-6 sits a small
     * margin above that, because Vallado reaches these numbers through
     * intermediates he prints to six or seven figures (f to -0.806 632, g to
     * 586.061 95 s) and stops iterating at |chi_n - chi_{n-1}| < 1e-6 sqrt(km) by
     * the algorithm's own UNTIL clause.
     *
     * Observed: 9.0e-9 on position and 1.2e-7 on velocity. The position agrees to
     * very nearly all eight printed figures and the velocity to its half-ulp, so
     * the book earned its last digit in both -- which the stopping rule above did
     * not guarantee and is worth recording as a measurement rather than assuming.
     */
    const TOL = 1e-6;
    const expectComponent = (actual: number, expected: number, what: string): void => {
      const deviation = Math.abs(actual - expected) / Math.abs(expected);
      expect(
        deviation,
        `${what}: expected ${String(expected)}, got ${String(actual)} (relative ${deviation.toExponential(2)})`,
      ).toBeLessThanOrEqual(TOL);
    };

    expectComponent(result.state.position.x / KM, -4219.7527, 'r x');
    expectComponent(result.state.position.y / KM, 4363.0292, 'r y');
    expectComponent(result.state.position.z / KM, -3958.7666, 'r z');

    expectComponent(result.state.velocity.x / KM, 3.689866, 'v x');
    expectComponent(result.state.velocity.y / KM, -1.916735, 'v y');
    expectComponent(result.state.velocity.z / KM, -6.112511, 'v z');
  });

  it('conserves the orbit it was propagated along', () => {
    // Independent of the book: the propagated state must lie on the same conic.
    // A reference test that passed while the orbit changed would be checking a
    // coincidence.
    if (!result.converged) throw new Error('expected convergence');
    const before = elementsFromState(initial.position, initial.velocity, MU_EARTH);
    const after = elementsFromState(result.state.position, result.state.velocity, MU_EARTH);

    expect(
      Math.abs(after.semiLatusRectum - before.semiLatusRectum) / before.semiLatusRectum,
    ).toBeLessThanOrEqual(1e-13);
    expect(Math.abs(after.eccentricity - before.eccentricity)).toBeLessThanOrEqual(1e-13);
    expect(Math.abs(after.inclination - before.inclination)).toBeLessThanOrEqual(1e-13);
  });
});
