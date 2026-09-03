/**
 * Property tests for `@hh/propagation` (§13.3, issue #53).
 *
 * Three rows of §13.3's table land here: *"propagate forward then back is identity"*
 * over Δt in [−30 d, +30 d], and energy and angular momentum *"conserved over a
 * period"* over the full element domain. `universal.test.ts` checks the first against
 * curated cases and `crosscheck.test.ts` checks the propagator against a numerical
 * oracle; neither sweeps the domain, which is what this file does.
 *
 * **The seed is deliberately not pinned**, for the reason `math.property.test.ts` gives
 * and `astro.property.test.ts` repeats. fast-check prints the seed and shrinks to a
 * minimal counterexample, so a red build here is reproducible and is a defect. `RUNS`
 * below is the iteration knob; it cannot be an environment variable, because `process`
 * is banned in `packages/**` by the core guardrail block (NFR-005).
 *
 * ## Time reversal is asserted against a measured envelope, not §13.3's flat 1e-12
 *
 * §13.3 asks for 1e-12 relative across the whole domain. That is not attainable in
 * float64 and `docs/PHYSICS.md` § "Time reversal, measured" already says why: a float64
 * state determines its own period to about one `eps`, and a few hundred revolutions
 * amplify that. At the bottom of the `a` range, 30 days is 485 revolutions. Asserting a
 * number that correct code cannot meet would mean loosening it later under pressure,
 * which is how a tolerance stops meaning anything.
 *
 * So the requirement is asserted where the document says it holds, and the measured law
 * is asserted everywhere else. Issue #53 asked for the flat figure; this was overruled
 * deliberately, and the result is a stronger claim rather than a weaker one -- the
 * fitted law in that section was previously prose, and is now checked.
 */
import { MU_EARTH, period, stateFromElements } from '@hh/astro';
import type { State } from '@hh/astro';
import { TAU, V, metres, normalize, radians, seconds } from '@hh/math';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { propagate } from './universal.js';

/** Iterations per property. See the module docstring. */
const RUNS = 3000;

const DAY_SECONDS = 86_400;

const real = (min: number, max: number) =>
  fc.double({ min, max, noNaN: true, noDefaultInfinity: true });

/** §13.3's element domain: a in [6.6e6, 4e8] m, e in [0, 0.95], all angles. */
const orbit = fc
  .tuple(
    real(6.6e6, 4e8),
    real(0, 0.95),
    real(0, Math.PI),
    real(0, TAU),
    real(0, TAU),
    real(0, TAU),
  )
  .map(([a, e, i, raan, argp, nu]) => ({
    a,
    e,
    state: stateFromElements(
      {
        semiLatusRectum: metres(a * (1 - e * e)),
        eccentricity: e,
        inclination: radians(i),
        raan: radians(normalize(raan)),
        argp: radians(normalize(argp)),
        trueAnomaly: radians(normalize(nu)),
      },
      MU_EARTH,
    ),
  }));

const stateDeviation = (actual: State, expected: State): number =>
  Math.max(
    V.distance(actual.position, expected.position) / V.norm(expected.position),
    V.distance(actual.velocity, expected.velocity) / V.norm(expected.velocity),
  );

/** Propagate or fail loudly. A non-convergence in this domain is itself a defect. */
const step = (state: State, dt: number): State => {
  const result = propagate(state, seconds(dt), MU_EARTH);
  if (!result.converged) {
    throw new Error(`propagation did not converge over ${String(dt)} s: ${result.reason}`);
  }
  return result.state;
};

/**
 * `docs/PHYSICS.md`'s fitted law: `8e-15 · N · (1 − e)^−2.5`, with N in revolutions.
 *
 * N is floored at 1 because the table is measured per revolution and a sub-revolution
 * step cannot do better than the round-off the first one already costs.
 */
const reversalEnvelope = (revolutions: number, e: number): number =>
  8e-15 * Math.max(1, revolutions) * Math.pow(1 - e, -2.5);

describe('time reversal', () => {
  const reversal = fc
    .tuple(orbit, real(-30 * DAY_SECONDS, 30 * DAY_SECONDS))
    .map(([o, dt]) => ({ ...o, dt, revolutions: Math.abs(dt) / period(metres(o.a), MU_EARTH) }));

  /*
   * The document fits every cell of its table to within a factor of 1.3, over a curated
   * grid of six eccentricities and five true anomalies. A randomised sweep of 60 000
   * samples over the same domain reaches **3.1x** the fitted value -- worst at *near
   * circular* orbits, where the fit is least constrained: `(1 − e)^−2.5` is flat there
   * and the grid had only e = 0 to pin it.
   *
   * So the margin asserted is 10x rather than 1.3x, and the reason is stated rather
   * than absorbed: the fit's own spread is wider than a curated grid could show. That
   * correction is one of the two useful outputs of this file, and it has gone back
   * into `docs/PHYSICS.md`.
   */
  it('returns the initial state within the measured envelope, over ±30 days', () => {
    fc.assert(
      fc.property(reversal, ({ state, e, dt, revolutions }) => {
        const back = step(step(state, dt), -dt);
        expect(
          stateDeviation(back, state),
          `e = ${e.toFixed(4)}, ${revolutions.toFixed(1)} revolutions`,
        ).toBeLessThanOrEqual(10 * reversalEnvelope(revolutions, e));
      }),
      { numRuns: RUNS },
    );
  });

  /*
   * §13.3's flat 1e-12, asserted where it actually holds.
   *
   * `docs/PHYSICS.md` said "wherever N · (1 − e)^−2.5 <= 60", measured on the same
   * curated grid as the fit. **That figure was wrong and this property is what found
   * it**: over 60 000 randomised samples the smallest K with a deviation above 1e-12
   * is 53.6, and the worst observed constant puts the true crossing at K = 40.6.
   * The document now says 40, and this asserts over K <= 30 -- the margin, stated
   * rather than absorbed, because the seed is unpinned and each run samples corners
   * the last one did not.
   *
   * 30 still covers every v1.0 contract: the longest routine one is twelve hours,
   * about seven and a half LEO revolutions, at eccentricities well under 0.5.
   */
  const LITERAL_K = 30;

  it('meets §13.3 literally wherever the document says it does', () => {
    fc.assert(
      fc.property(
        reversal.filter(
          ({ e, revolutions }) => Math.max(1, revolutions) * Math.pow(1 - e, -2.5) <= LITERAL_K,
        ),
        ({ state, dt }) => {
          expect(stateDeviation(step(step(state, dt), -dt), state)).toBeLessThanOrEqual(1e-12);
        },
      ),
      { numRuns: RUNS },
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * Conservation over a full period.
 *
 * Both quantities are integrals of the two-body motion, so a violation means the
 * propagator has moved the state off its own orbit. The propagator is analytic, which
 * makes these a check on conditioning rather than on accumulated integration error --
 * there is no accumulation to find. What they would catch is a solve that returned the
 * wrong branch, or a Lagrange coefficient assembled with the wrong sign.
 *
 * Sampled at a random fraction of the period and at exactly one whole period, so the
 * "over a full period" in §13.3 is swept rather than sampled at its endpoints.
 * ---------------------------------------------------------------------------
 */

/** Specific orbital energy, `v²/2 − μ/r`. */
const specificEnergyOf = (state: State): number =>
  V.normSq(state.velocity) / 2 - MU_EARTH / V.norm(state.position);

describe('conservation over a full period', () => {
  const sampled = fc
    .tuple(orbit, real(0, 1))
    .map(([o, fraction]) => ({ ...o, fraction, T: period(metres(o.a), MU_EARTH) }));

  // 1e-12 is §7.6 Tier 2's stated figure. Worst observed over 15 000 samples is
  // 2.2e-14, at e = 0.95 -- the eccentric end, where periapsis speed is highest and
  // `v²/2` and `μ/r` are largest relative to the difference between them. This is the
  // catastrophic-cancellation case for energy, and it is two orders inside the
  // requirement.
  it('specific orbital energy is constant', () => {
    fc.assert(
      fc.property(sampled, ({ state, e, fraction, T }) => {
        const initial = specificEnergyOf(state);
        for (const dt of [fraction * T, T]) {
          const deviation =
            Math.abs(specificEnergyOf(step(state, dt)) - initial) / Math.abs(initial);
          expect(
            deviation,
            `e = ${e.toFixed(4)} at ${(dt / T).toFixed(3)} periods`,
          ).toBeLessThanOrEqual(1e-12);
        }
      }),
      { numRuns: RUNS },
    );
  });

  // Magnitude to 1e-12 (worst observed 7.5e-15) and direction to 1e-12 rad (worst
  // observed 2.8e-17 -- five orders of margin, because the orbital plane is fixed by
  // the Lagrange coefficients exactly rather than approximately: both propagated
  // vectors are combinations of the same two, so the plane cannot rotate at all
  // except through round-off in those coefficients).
  //
  // The direction check uses `V.angleBetween`, which is `atan2(|a × b|, a · b)`.
  // `Math.acos` is a lint error in this layer and would be the wrong tool anyway --
  // its derivative is unbounded at ±1, which is precisely where two nearly-identical
  // angular-momentum vectors sit.
  it('angular momentum is constant in magnitude and in direction', () => {
    fc.assert(
      fc.property(sampled, ({ state, e, fraction, T }) => {
        const initial = V.cross(state.position, state.velocity);
        for (const dt of [fraction * T, T]) {
          const moved = step(state, dt);
          const h = V.cross(moved.position, moved.velocity);

          expect(
            Math.abs(V.norm(h) - V.norm(initial)) / V.norm(initial),
            `|h| at e = ${e.toFixed(4)}`,
          ).toBeLessThanOrEqual(1e-12);
          expect(
            V.angleBetween(initial, h),
            `h direction at e = ${e.toFixed(4)}`,
          ).toBeLessThanOrEqual(1e-12);
        }
      }),
      { numRuns: RUNS },
    );
  });
});
