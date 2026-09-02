/**
 * Analytic propagation against the numerical oracle (#59, §7.6).
 *
 * This is the check that makes the other two mean something. `universal.test.ts`
 * tests the analytic propagator against closed forms and against itself; the
 * oracle's own tests establish that it is an 8th-order integrator. Neither says the
 * two agree, and they share no line of code — one solves a transcendental equation
 * in a universal anomaly, the other steps Newton's law with a Runge-Kutta tableau.
 * A shared error would have to be in `@hh/astro`'s constants or in the problem
 * statement, and nowhere else.
 *
 * ## Where the tolerance comes from
 *
 * Not from what makes the test pass. The oracle is run **twice per case**, at
 * `rtol = 1e-11` and at `rtol = 1e-13`, and the distance between those two answers
 * is the oracle's own demonstrated error scale: it bounds the error of the looser
 * run directly, and since the tighter run is roughly a hundred times more accurate
 * — measured, in `dop853.test.ts`, as global error proportional to the requested
 * tolerance — it over-bounds the error of the tighter run by about that factor.
 *
 * The analytic path is then required to agree with the tighter run to within that
 * self-difference. In words: **the two independent methods differ by less than the
 * numerical one demonstrably differs from itself when you change its tolerance.**
 * That is a criterion the integrator sets, case by case, and it tightens
 * automatically wherever the integrator is doing well. It cannot be tuned, because
 * nothing in it was chosen.
 *
 * ## Cost
 *
 * Two adaptive integrations per case at tight tolerances, over a grid spanning all
 * three conic classes. This is the most expensive test in the package by some way
 * and it is still under a second, so it stays in the ordinary suite rather than
 * being split into a slower tier.
 */
import { MU_EARTH, eci, period, stateFromElements } from '@hh/astro';
import type { State } from '@hh/astro';
import { V, metres, radians, seconds } from '@hh/math';
import { describe, expect, it } from 'vitest';

import { integrate } from './oracle/index.js';
import { propagate } from './universal.js';

/** Named by periapsis, the one size parameter defined for every conic. */
const orbit = (periapsis: number, e: number, nu: number): State =>
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

const separation = (a: State, b: State): number =>
  V.distance(a.position, b.position) / V.norm(b.position);

interface Case {
  readonly regime: string;
  readonly periapsis: number;
  readonly eccentricity: number;
  readonly trueAnomaly: number;
  readonly dt: number;
}

/** One period for a closed orbit, capped; a few hours for an open one. */
const spanFor = (periapsis: number, e: number): number => {
  if (e >= 1) return 4 * 3600;
  const semiMajorAxis = periapsis / (1 - e);
  return Math.min(period(metres(semiMajorAxis), MU_EARTH), 6 * 3600);
};

const CASES: readonly Case[] = [
  ...[6.6e6, 1.2e7, 2.4e7].flatMap((periapsis) =>
    [0, 0.1, 0.4, 0.7, 0.9].map((eccentricity) => ({
      regime: 'elliptic',
      periapsis,
      eccentricity,
      trueAnomaly: 0.6,
      dt: spanFor(periapsis, eccentricity),
    })),
  ),
  ...[0.999, 0.99999, 1, 1.00001, 1.001].map((eccentricity) => ({
    regime: 'near-parabolic',
    periapsis: 7e6,
    eccentricity,
    trueAnomaly: 0.4,
    dt: spanFor(7e6, eccentricity),
  })),
  ...[1.05, 1.3, 2, 5].flatMap((eccentricity) =>
    [0, 1.1].map((trueAnomaly) => ({
      regime: 'hyperbolic',
      periapsis: 7e6,
      eccentricity,
      trueAnomaly,
      dt: 4 * 3600,
    })),
  ),
];

const LOOSE_TOLERANCE = 1e-11;
const TIGHT_TOLERANCE = 1e-13;

describe('analytic vs numerical propagation (§7.6 Tier 2)', () => {
  it('agrees to within the oracle’s own error scale, across every conic class', () => {
    const worstByRegime = new Map<string, { ratio: number; detail: string }>();

    for (const testCase of CASES) {
      const { regime, periapsis, eccentricity, trueAnomaly, dt } = testCase;
      const start = orbit(periapsis, eccentricity, trueAnomaly);

      const loose = integrate(start, seconds(dt), MU_EARTH, {
        relativeTolerance: LOOSE_TOLERANCE,
      });
      const tight = integrate(start, seconds(dt), MU_EARTH, {
        relativeTolerance: TIGHT_TOLERANCE,
      });
      const analytic = propagate(start, seconds(dt), MU_EARTH);

      expect(loose.converged, `loose integration for ${regime} e=${String(eccentricity)}`).toBe(
        true,
      );
      expect(tight.converged, `tight integration for ${regime} e=${String(eccentricity)}`).toBe(
        true,
      );
      expect(analytic.converged, `analytic solve for ${regime} e=${String(eccentricity)}`).toBe(
        true,
      );
      if (!loose.converged || !tight.converged || !analytic.converged) continue;

      // The oracle's demonstrated error scale, set by the oracle and not by us.
      const oracleUncertainty = separation(loose.state, tight.state);
      const disagreement = separation(analytic.state, tight.state);

      const ratio = disagreement / oracleUncertainty;
      const previous = worstByRegime.get(regime);
      if (previous === undefined || ratio > previous.ratio) {
        worstByRegime.set(regime, {
          ratio,
          detail:
            `e=${String(eccentricity)} rp=${periapsis.toExponential(1)} nu=${String(trueAnomaly)} ` +
            `dt=${dt.toFixed(0)}s disagreement=${disagreement.toExponential(2)} ` +
            `oracle self-difference=${oracleUncertainty.toExponential(2)}`,
        });
      }
    }

    // Reported per regime rather than as one number, so a regression says which one
    // moved. A failure here means the two methods have parted company by more than
    // the numerical one's own tolerance sensitivity, which is not something a
    // tolerance tweak should be allowed to hide.
    for (const [regime, worst] of worstByRegime) {
      expect(worst.ratio, `worst ${regime} case: ${worst.detail}`).toBeLessThan(1);
    }

    expect([...worstByRegime.keys()].sort()).toStrictEqual([
      'elliptic',
      'hyperbolic',
      'near-parabolic',
    ]);
  });

  it('disagrees loudly if the analytic path is perturbed', () => {
    // A test that only ever passes proves nothing about its own sensitivity. This
    // asks the same question of a deliberately wrong answer — the analytic state
    // displaced by a part in 1e9, far below anything a reader would notice by eye —
    // and requires the criterion above to reject it.
    const start = orbit(1.2e7, 0.3, 0.6);
    const dt = spanFor(1.2e7, 0.3);

    const loose = integrate(start, seconds(dt), MU_EARTH, { relativeTolerance: LOOSE_TOLERANCE });
    const tight = integrate(start, seconds(dt), MU_EARTH, { relativeTolerance: TIGHT_TOLERANCE });
    const analytic = propagate(start, seconds(dt), MU_EARTH);
    expect(loose.converged && tight.converged && analytic.converged).toBe(true);
    if (!loose.converged || !tight.converged || !analytic.converged) return;

    const perturbed: State = {
      position: eci(V.scale(analytic.state.position, 1 + 1e-9)),
      velocity: analytic.state.velocity,
    };

    const oracleUncertainty = separation(loose.state, tight.state);
    expect(separation(analytic.state, tight.state) / oracleUncertainty).toBeLessThan(1);
    expect(separation(perturbed, tight.state) / oracleUncertainty).toBeGreaterThan(1);
  });
});
