/**
 * Tier 3 — external-library reference (#55).
 *
 * Every expected number in this file was computed by `hapsira` (the maintained fork
 * of the archived `poliastro`), `astropy` and `sgp4`, by the generator in
 * `generate.py`, and committed to `fixtures.json`. **No Python runs here.** The
 * fixture is read like any other data file, which is what lets this sit in CI.
 *
 * ## What this adds that the repository could not supply itself
 *
 * `crosscheck.test.ts` compares the analytic propagator against the DOP853 oracle.
 * Both are ours. A shared misunderstanding of a convention -- a frame, an anomaly,
 * a sign in the Lagrange coefficients -- would agree with itself and pass. These
 * fixtures come from a lineage that traces back to poliastro rather than to this
 * repository, so they cannot make our mistakes.
 *
 * It also closes the row `docs/PHYSICS.md` had marked "none available": Izzo's
 * solver takes a revolution count and both branches, so **multi-revolution Lambert
 * finally has an external reference**. Curtis does not treat that case at all, and
 * #51 shipped it checked only against oracles internal to this repository.
 *
 * ## Tolerances
 *
 * These are not "the reference's printed precision" like the textbook cases -- both
 * sides are float64 and neither is exact. The tolerances are set at roughly two
 * orders above the worst observed agreement, and every observed figure is quoted
 * next to the assertion that uses it.
 */
import { MU_EARTH, eci, solveLambert } from '@hh/astro';
import type { LambertBranchChoice, State } from '@hh/astro';
import { V, metres, metresPerSec, seconds } from '@hh/math';
import { propagate } from '@hh/propagation';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

interface PropagationCase {
  readonly name: string;
  readonly dt: number;
  readonly r0: readonly number[];
  readonly v0: readonly number[];
  readonly r: readonly number[];
  readonly v: readonly number[];
}

interface LambertCase {
  readonly name: string;
  readonly revolutions: number;
  readonly lowpath: boolean;
  readonly tof: number;
  readonly r1: readonly number[];
  readonly r2: readonly number[];
  readonly v1: readonly number[];
  readonly v2: readonly number[];
}

interface IssSample {
  readonly dt: number;
  readonly sgp4_r: readonly number[];
  readonly twobody_r: readonly number[];
  readonly separation: number;
}

interface Fixture {
  readonly mu: number;
  readonly versions: Readonly<Record<string, string>>;
  readonly propagation: readonly PropagationCase[];
  readonly lambert: readonly LambertCase[];
  readonly iss: {
    readonly frame: string;
    readonly period: number;
    readonly r0: readonly number[];
    readonly v0: readonly number[];
    readonly j2_displacement_bound: number;
    readonly samples: readonly IssSample[];
  };
}

const FIXTURE = JSON.parse(
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures.json'), 'utf8'),
) as Fixture;

const position = (a: readonly number[]) =>
  eci(V.vec3(metres(a[0] ?? Number.NaN), metres(a[1] ?? Number.NaN), metres(a[2] ?? Number.NaN)));
const velocity = (a: readonly number[]) =>
  eci(
    V.vec3(
      metresPerSec(a[0] ?? Number.NaN),
      metresPerSec(a[1] ?? Number.NaN),
      metresPerSec(a[2] ?? Number.NaN),
    ),
  );

/** Norm of the difference over the norm of the expected -- what "relative" means for a vector. */
const deviation = (actual: V.Vec3, expected: V.Vec3): number =>
  V.norm(V.sub(actual, expected)) / V.norm(expected);

const stateOf = (r: readonly number[], v: readonly number[]): State => ({
  position: position(r),
  velocity: velocity(v),
});

const propagateOrThrow = (state: State, dt: number): State => {
  const result = propagate(state, seconds(dt), MU_EARTH);
  if (!result.converged)
    throw new Error(`propagation failed over ${String(dt)} s: ${result.reason}`);
  return result.state;
};

describe('the fixture itself', () => {
  it('was generated against our own gravitational parameter', () => {
    // If hapsira's Earth.k ever stops being our MU_EARTH the generator asserts and
    // refuses to write. This is the same check from the reading end, so a fixture
    // generated before that guard existed cannot slip through.
    expect(FIXTURE.mu).toBe(MU_EARTH);
  });

  it('records the versions it was generated with', () => {
    // Not decoration. "Which poliastro?" is the first question anyone asks of a
    // number like these, and #55 requires the answer to travel with the fixture.
    expect(FIXTURE.versions['hapsira']).toBe('0.18.0');
    expect(FIXTURE.versions['astropy']).toMatch(/^6\./);
    expect(FIXTURE.versions['sgp4']).toBeDefined();
  });
});

describe('two-body propagation against hapsira', () => {
  /*
   * Worst observed over all sixteen cases: 6.7e-15 relative, on the 100 000-second
   * case that covers about eighteen revolutions -- which is where a period error
   * would show first, and does not. Every other case is between 1.5e-16 and 6e-15.
   *
   * 1e-13 is the assertion: about two orders above that, which leaves room for
   * float64 rounding to fall differently on another machine's BLAS without leaving
   * room for a real disagreement. Two independent implementations of the same
   * analytic solution -- our universal-variable formulation against Farnocchia's
   * -- have no business agreeing better than this, and none to agree worse.
   */
  const TOLERANCE = 1e-13;

  it.each(FIXTURE.propagation.map((c) => [c.name, c] as const))(
    'reproduces hapsira for %s',
    (_name, testCase) => {
      const moved = propagateOrThrow(stateOf(testCase.r0, testCase.v0), testCase.dt);
      expect(deviation(moved.position, position(testCase.r))).toBeLessThanOrEqual(TOLERANCE);
      expect(deviation(moved.velocity, velocity(testCase.v))).toBeLessThanOrEqual(TOLERANCE);
    },
  );

  it('covers every conic class and both directions of time', () => {
    // A guard on the fixture's coverage rather than on the code: a regenerated
    // fixture that quietly lost its hyperbolic or backwards cases would still pass
    // every assertion above.
    const names = FIXTURE.propagation.map((c) => c.name);
    expect(names).toContain('hyperbolic-slow');
    expect(names).toContain('hyperbolic-fast');
    expect(FIXTURE.propagation.filter((c) => c.dt < 0).length).toBeGreaterThanOrEqual(2);
    expect(FIXTURE.propagation.length).toBeGreaterThanOrEqual(16);
  });
});

describe("Lambert against Izzo's algorithm", () => {
  /*
   * Worst observed 6.5e-13, on `zero-rev-short`; every other case is between
   * 1.5e-16 and 5.4e-15. 1e-11 is the assertion, on the same reasoning as above.
   *
   * **Branch mapping.** Izzo's `lowpath=True` is our `'low'` and `lowpath=False`
   * our `'high'`. That is measured, not assumed: swapping them moves the deviation
   * from 5e-15 to about 1.2 -- a 120% disagreement -- so the correspondence is not
   * a coincidence of naming and there is no ambiguity about which is which.
   */
  const TOLERANCE = 1e-11;

  it.each(FIXTURE.lambert.map((c) => [c.name, c] as const))(
    'reproduces izzo for %s',
    (_name, testCase) => {
      const branch: LambertBranchChoice = testCase.lowpath ? 'low' : 'high';
      const result = solveLambert(
        position(testCase.r1),
        position(testCase.r2),
        seconds(testCase.tof),
        'prograde',
        MU_EARTH,
        testCase.revolutions === 0 ? {} : { revolutions: testCase.revolutions, branch },
      );

      expect(result.converged).toBe(true);
      if (!result.converged) return;

      expect(result.revolutions).toBe(testCase.revolutions);
      expect(deviation(result.departureVelocity, velocity(testCase.v1))).toBeLessThanOrEqual(
        TOLERANCE,
      );
      expect(deviation(result.arrivalVelocity, velocity(testCase.v2))).toBeLessThanOrEqual(
        TOLERANCE,
      );
    },
  );

  it('checks the multi-revolution case Curtis cannot', () => {
    // The reason this fixture exists. docs/PHYSICS.md recorded "none available" for
    // the multi-revolution row because Curtis has no worked example and nothing
    // else was held in this workspace. Both branches of one, two and three
    // revolutions are now covered.
    const multi = FIXTURE.lambert.filter((c) => c.revolutions > 0);
    expect(new Set(multi.map((c) => c.revolutions))).toEqual(new Set([1, 2, 3]));
    expect(multi.filter((c) => c.lowpath).length).toBe(3);
    expect(multi.filter((c) => !c.lowpath).length).toBe(3);
  });
});

describe('the ISS, against SGP4', () => {
  const { iss } = FIXTURE;
  const initial = stateOf(iss.r0, iss.v0);

  it('is stated in the frame SGP4 produces', () => {
    // TEME in, TEME out, no transform anywhere. Said out loud because a frame
    // conversion is exactly the kind of thing that would be silently wrong.
    expect(iss.frame).toBe('TEME');
  });

  it('agrees with hapsira on the two-body trajectory', () => {
    // This half is a pure library cross-check and has nothing to do with SGP4:
    // both sides model the same two-body problem from the same TLE-derived state.
    // Worst observed 5.6e-15.
    for (const sample of iss.samples) {
      const moved = propagateOrThrow(initial, sample.dt);
      expect(deviation(moved.position, position(sample.twobody_r))).toBeLessThanOrEqual(1e-13);
    }
  });

  it('disagrees with SGP4 by the amount the fixture recorded', () => {
    /*
     * **Disagreement is the assertion.** We model neither J2 nor drag, so our
     * trajectory must diverge from SGP4's, and a test that asserted agreement
     * would be asserting that this simulation is something it is not (§7.6).
     *
     * Observed separations, TLE epoch 2026-09-03, over one 5585.9 s revolution:
     * 2.9, 10.4, 22.5, 38.0, 51.9, 61.5, 68.8, 72.3 km.
     */
    for (const sample of iss.samples) {
      const moved = propagateOrThrow(initial, sample.dt);
      const separation = V.distance(moved.position, position(sample.sgp4_r));
      expect(Math.abs(separation - sample.separation) / sample.separation).toBeLessThanOrEqual(
        1e-9,
      );
    }
  });

  it('diverges monotonically, as an unmodelled secular perturbation must', () => {
    // A constant-ish perturbing acceleration integrates to a monotonically growing
    // displacement over a single revolution. If this ever came back non-monotonic
    // the disagreement would not be J2 -- it would be a bug.
    const separations = iss.samples.map((s) => s.separation);
    for (let i = 1; i < separations.length; i += 1) {
      expect(separations[i]).toBeGreaterThan(separations[i - 1] ?? Number.NaN);
    }
  });

  it('disagrees by the magnitude the missing physics predicts', () => {
    /*
     * The claim §7.6 actually asks for. `j2_displacement_bound` is
     * `½ · a_J2 · T²` with `a_J2 = 1.5 J2 μ Rₑ² / r⁴` -- 192.2 km here. That is an
     * **upper bound**, not an estimate: J2's direction rotates with the orbit, so
     * it partly averages out over a revolution and the true displacement must come
     * in under it while staying the same order.
     *
     * Measured ratio after one full orbit: 0.376. The band below says the
     * separation is between a fifth and all of the bound -- loose enough to
     * survive a different TLE epoch, tight enough that a missing perturbation
     * (ratio near 0) or a broken propagation (ratio far above 1) fails it.
     */
    const final = iss.samples.at(-1);
    if (final === undefined) throw new Error('no ISS samples');

    const moved = propagateOrThrow(initial, final.dt);
    const separation = V.distance(moved.position, position(final.sgp4_r));
    const ratio = separation / iss.j2_displacement_bound;

    expect(ratio).toBeGreaterThan(0.2);
    expect(ratio).toBeLessThan(1);

    // And in absolute terms: tens of kilometres over one orbit, which is the
    // number a reader should carry away about how far to trust a two-body ISS.
    expect(separation).toBeGreaterThan(10e3);
    expect(separation).toBeLessThan(200e3);
  });
});
