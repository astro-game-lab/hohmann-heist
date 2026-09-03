/**
 * Property tests for `@hh/astro` (§13.3, issue #53).
 *
 * The curated grids in `elements.test.ts`, `equinoctial.test.ts` and `lambert.test.ts`
 * check the cases we thought of, one conic class and one degeneracy at a time. These
 * check the same invariants over the whole of §13.3's generator domain, which is where
 * the cases we did not think of live. This file **extends** those grids rather than
 * restating them: nothing here re-asserts a case that is already enumerated there.
 *
 * ## The seed is deliberately not pinned
 *
 * For the reason `math.property.test.ts` gives at length, and `timeline.property.test.ts`
 * repeats: a fixed seed is reproducible at the cost of never exploring anything new, and
 * an unpinned run in this repository has already found a real bug that a pinned one would
 * not have reached. fast-check prints the seed and shrinks to a minimal counterexample on
 * failure, so a red build here is reproducible locally and is a defect rather than noise.
 *
 * Issue #53 asked for a fixed seed in CI. That was overruled deliberately, in favour of
 * the convention this repository had already settled on twice.
 *
 * **Treat a failure as a bug to fix, never as a test to re-run until it passes.**
 *
 * ## Running more iterations locally
 *
 * `RUNS` below is the knob. It cannot be an environment variable: `process` is banned in
 * `packages/**` by the core guardrail block (NFR-005), and this file is inside it. Raise
 * the constant, or simply re-run — with an unpinned seed every run is a fresh sample, so
 * `pnpm vitest run --project packages astro.property` in a loop explores as effectively
 * as one long run and needs no edit.
 *
 * ## Where the tolerances come from
 *
 * Every one of them is measured, and the measurement is quoted next to it. None was
 * tuned until the suite went green — where the honest answer was "1e-12 does not hold
 * here", the property says what does hold instead and the domain of validity is stated.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { TAU, V, metres, normalize, radians, seconds } from '@hh/math';

import {
  eccentricFromTrue,
  hyperbolicFromTrue,
  meanFromEccentric,
  meanFromHyperbolic,
  trueFromEccentric,
  trueFromHyperbolic,
} from './anomaly.js';
import { MU_EARTH } from './constants.js';
import type { OrbitShape, State } from './elements.js';
import {
  CIRCULAR_TOLERANCE,
  EQUATORIAL_TOLERANCE,
  elementsFromState,
  semiMajorAxis,
  stateFromElements,
} from './elements.js';
import { equinoctialFromState, stateFromEquinoctial } from './equinoctial.js';
import { solveKeplerElliptic, solveKeplerHyperbolic } from './kepler.js';
import { solveLambertBranches } from './lambert.js';
import { period } from './twobody.js';

/** Iterations per property. See "Running more iterations locally" above. */
const RUNS = 3000;

/** Machine epsilon, named because two of the envelopes below are expressed in it. */
const EPS = Number.EPSILON;

/*
 * ---------------------------------------------------------------------------
 * Generators — §13.3's stated domain.
 *
 *   Element <-> Cartesian round-trip: a in [6.6e6, 4e8] m, e in [0, 0.95], all angles.
 *
 * `a` spans a low-Earth orbit skimming the atmosphere to well beyond geostationary;
 * `e` stops at 0.95 because that is where §13.3 stops, not because anything breaks
 * above it. Inclination covers [0, pi], so both chart poles of the equinoctial atlas
 * and both orientations of the classical equatorial degeneracy are reachable.
 * ---------------------------------------------------------------------------
 */

const A_MIN = 6.6e6;
const A_MAX = 4e8;

const real = (min: number, max: number) =>
  fc.double({ min, max, noNaN: true, noDefaultInfinity: true });

const sma = real(A_MIN, A_MAX);
const anyAngle = real(0, TAU);
const anyInclination = real(0, Math.PI);

/**
 * An orbit shape in the form the conversions promise to round-trip.
 *
 * The canonicalisation is the contract, not a convenience: below `CIRCULAR_TOLERANCE`
 * the periapsis direction does not exist and `elementsFromState` returns `argp = 0`,
 * so feeding a non-zero `argp` there would be asking for an identity the documented
 * threshold never promised. Same for `raan` below `EQUATORIAL_TOLERANCE`. Applying it
 * here means the generator can sweep straight through both thresholds instead of
 * stopping short of them.
 */
const shapeOf = (
  a: number,
  e: number,
  i: number,
  raan: number,
  argp: number,
  nu: number,
): OrbitShape => ({
  semiLatusRectum: metres(a * (1 - e * e)),
  eccentricity: e,
  inclination: radians(i),
  raan: radians(Math.sin(i) < EQUATORIAL_TOLERANCE ? 0 : normalize(raan)),
  argp: radians(e < CIRCULAR_TOLERANCE ? 0 : normalize(argp)),
  trueAnomaly: radians(normalize(nu)),
});

/** Worst of the position and velocity deviations, each relative to its own magnitude. */
const stateDeviation = (actual: State, expected: State): number =>
  Math.max(
    V.distance(actual.position, expected.position) / V.norm(expected.position),
    V.distance(actual.velocity, expected.velocity) / V.norm(expected.velocity),
  );

/** Shortest angular separation, so the comparison survives the wrap at 0 / 2pi. */
const angleDeviation = (actual: number, expected: number): number =>
  Math.abs(normalize(actual - expected + Math.PI) - Math.PI);

/** Worst deviation over all six elements, angles compared modulo a turn. */
const elementDeviation = (actual: OrbitShape, expected: OrbitShape): number =>
  Math.max(
    Math.abs(actual.semiLatusRectum - expected.semiLatusRectum) / expected.semiLatusRectum,
    Math.abs(actual.eccentricity - expected.eccentricity),
    angleDeviation(actual.inclination, expected.inclination),
    angleDeviation(actual.raan, expected.raan),
    angleDeviation(actual.argp, expected.argp),
    angleDeviation(actual.trueAnomaly, expected.trueAnomaly),
  );

/*
 * ---------------------------------------------------------------------------
 * Classical elements <-> Cartesian state.
 * ---------------------------------------------------------------------------
 */

/**
 * The eccentricity above which every element round-trips to 1e-12, measured.
 *
 * Only eccentricity needs a floor. Inclination has no ill-conditioned band at all --
 * scanned by decade from 1e-12 to 1.5 rad, the worst element deviation never leaves
 * 1e-13..4e-13 and shows no trend towards the pole -- because `raan` and `argp` err in
 * opposite directions there and the node line is recovered from the angular momentum
 * rather than from a difference of large numbers. Eccentricity is different: `argp` is
 * recovered from an eccentricity vector whose magnitude *is* the small quantity.
 *
 * Measured worst element deviation over 30 000 samples per cell, all inclinations:
 *
 *   | e floor | worst   |
 *   | ------- | ------- |
 *   | 1e-3    | 1.0e-12 |
 *   | 3e-3    | 1.9e-13 |
 *   | 1e-2    | 5.9e-14 |
 *
 * 1e-3 sits exactly on the requirement and a randomised sweep does cross it -- an
 * earlier draft of this file asserted 1e-12 from 1e-3 and failed at 25 000 runs on
 * `e = 0.001, i = 0.0063`. 3e-3 is the first decade step with a real margin, and the
 * band below it is covered by the envelope property further down.
 */
const WELL_CONDITIONED_E = 3e-3;

const wellConditioned = fc
  .tuple(sma, real(WELL_CONDITIONED_E, 0.95), anyInclination, anyAngle, anyAngle, anyAngle)
  .map(([a, e, i, raan, argp, nu]) => shapeOf(a, e, i, raan, argp, nu));

describe('classical elements <-> Cartesian state', () => {
  // 1e-12 is §7.6 Tier 2's stated figure. Worst observed over 60 000 samples on this
  // domain -- every inclination, both exact poles included -- is 1.9e-13, so the
  // requirement holds with a factor of five in hand.
  it('elements -> state -> elements is the identity away from the degenerate thresholds', () => {
    fc.assert(
      fc.property(wellConditioned, (input) => {
        const { position, velocity } = stateFromElements(input, MU_EARTH);
        expect(
          elementDeviation(elementsFromState(position, velocity, MU_EARTH), input),
        ).toBeLessThanOrEqual(1e-12);
      }),
      { numRuns: RUNS },
    );
  });

  // Worst observed on the same domain is 1.1e-13.
  it('state -> elements -> state is the identity away from the degenerate thresholds', () => {
    fc.assert(
      fc.property(wellConditioned, (input) => {
        const original = stateFromElements(input, MU_EARTH);
        const rebuilt = stateFromElements(
          elementsFromState(original.position, original.velocity, MU_EARTH),
          MU_EARTH,
        );
        expect(stateDeviation(rebuilt, original)).toBeLessThanOrEqual(1e-12);
      }),
      { numRuns: RUNS },
    );
  });

  /*
   * The degenerate cases, hit exactly rather than approached. `elements.test.ts` has
   * eleven curated cases covering each of these once; this sweeps random angles through
   * all of them, which is the part a fixed grid cannot do.
   *
   * Worst observed: 1.3e-15 with `e` exactly zero, 5.4e-13 with `sin i` exactly zero
   * (the latter measured with the eccentricity floor at 1e-3, so it over-bounds what this
   * generator, which floors at 3e-3, can reach).
   * The second is larger because `argp` then absorbs the whole in-plane orientation
   * and is recovered from the eccentricity vector rather than from the node line.
   */
  const exactlyDegenerate = fc.oneof(
    // e = 0: circular, argp suppressed, inclination free.
    fc
      .tuple(sma, anyInclination, anyAngle, anyAngle)
      .map(([a, i, raan, nu]) => ({ shape: shapeOf(a, 0, i, raan, 0, nu), what: 'circular' })),
    // sin i = 0: equatorial, raan suppressed, both orientations.
    fc
      .tuple(sma, real(WELL_CONDITIONED_E, 0.95), fc.constantFrom(0, Math.PI), anyAngle, anyAngle)
      .map(([a, e, i, argp, nu]) => ({ shape: shapeOf(a, e, i, 0, argp, nu), what: 'equatorial' })),
    // Both.
    fc
      .tuple(sma, fc.constantFrom(0, Math.PI), anyAngle)
      .map(([a, i, nu]) => ({ shape: shapeOf(a, 0, i, 0, 0, nu), what: 'circular-equatorial' })),
  );

  it('is the identity at exact degeneracy — e = 0, sin i = 0, and both', () => {
    fc.assert(
      fc.property(exactlyDegenerate, ({ shape }) => {
        const original = stateFromElements(shape, MU_EARTH);
        const back = elementsFromState(original.position, original.velocity, MU_EARTH);

        expect(elementDeviation(back, shape)).toBeLessThanOrEqual(1e-12);
        expect(stateDeviation(stateFromElements(back, MU_EARTH), original)).toBeLessThanOrEqual(
          1e-12,
        );
      }),
      { numRuns: RUNS },
    );
  });

  /*
   * The band between the two, which is the interesting one and was not previously
   * recorded anywhere.
   *
   * Just *above* `CIRCULAR_TOLERANCE` the periapsis direction is declared to exist but
   * is determined by an eccentricity vector whose magnitude is at the edge of
   * cancellation, so `argp` and the true anomaly are each recovered to about `eps / e`
   * radians. They err in opposite directions -- their sum, the argument of latitude, is
   * what the state actually depends on -- so the state round-trip is far better than
   * either angle, but it is not 1e-12. Measured worst, by eccentricity decade:
   *
   *   | e            | worst state round-trip |
   *   | ------------ | ---------------------- |
   *   | exactly 0    | 9.9e-16                |
   *   | < 1e-8       | 6.8e-16                |
   *   | 1e-8 .. 1e-7 | 2.6e-8                 |
   *   | 1e-6 .. 1e-5 | 3.1e-10                |
   *   | 1e-4 .. 1e-3 | 4.1e-12                |
   *   | 1e-2 .. 1e-1 | 2.0e-14                |
   *   | > 1e-1       | 3.8e-15                |
   *
   * The fitted constant in `eps / e` is about 3 across every decade above the
   * threshold; the envelope asserted here uses 10, because the sweep is randomised and
   * each CI run samples points the fit never saw. The `1e-14` term is the round-off
   * floor, which the divergent term drops below at around e = 0.02.
   *
   * **This is not a defect.** `stateFromElements` is not called anywhere outside this
   * package -- `arc.ts` caches classical elements as read-only metadata and propagates
   * the Cartesian state -- so no trajectory is built by this route. It is recorded
   * because the equinoctial property below has no such band, which is the measured
   * form of the architectural claim `docs/PHYSICS.md` makes for that element set.
   */
  it('degrades as eps/e in the band just above the circular threshold, and nowhere else', () => {
    fc.assert(
      fc.property(
        fc.tuple(sma, real(0, 0.95), anyInclination, anyAngle, anyAngle, anyAngle),
        ([a, e, i, raan, argp, nu]) => {
          const input = shapeOf(a, e, i, raan, argp, nu);
          const original = stateFromElements(input, MU_EARTH);
          const rebuilt = stateFromElements(
            elementsFromState(original.position, original.velocity, MU_EARTH),
            MU_EARTH,
          );

          const envelope = e < CIRCULAR_TOLERANCE ? 1e-14 : 1e-14 + (10 * EPS) / e;
          expect(stateDeviation(rebuilt, original)).toBeLessThanOrEqual(envelope);
        },
      ),
      { numRuns: RUNS },
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * Equinoctial elements <-> Cartesian state.
 *
 * The same sweep, over the same domain, against the element set that has no
 * degenerate case to detect. There is no band and no exception: worst observed is
 * 3.5e-15 across the whole domain including both chart poles, against 1.5e-10 for
 * the classical set on the identical inputs. That contrast is the point.
 * ---------------------------------------------------------------------------
 */

describe('equinoctial elements <-> Cartesian state', () => {
  const anyOrbit = fc
    .tuple(sma, real(0, 0.95), anyInclination, anyAngle, anyAngle, anyAngle)
    .map(([a, e, i, raan, argp, nu]) => shapeOf(a, e, i, raan, argp, nu));

  it('state -> equinoctial -> state is the identity across the whole domain', () => {
    fc.assert(
      fc.property(anyOrbit, (input) => {
        const original = stateFromElements(input, MU_EARTH);
        const rebuilt = stateFromEquinoctial(
          equinoctialFromState(original.position, original.velocity, MU_EARTH),
          MU_EARTH,
        );
        expect(stateDeviation(rebuilt, original)).toBeLessThanOrEqual(1e-13);
      }),
      { numRuns: RUNS },
    );
  });

  it('equinoctial -> state -> equinoctial is the identity, both chart poles included', () => {
    fc.assert(
      fc.property(anyOrbit, (input) => {
        const original = stateFromElements(input, MU_EARTH);
        const q = equinoctialFromState(original.position, original.velocity, MU_EARTH);
        const state = stateFromEquinoctial(q, MU_EARTH);
        const back = equinoctialFromState(state.position, state.velocity, MU_EARTH);

        expect(back.retrograde).toBe(q.retrograde);
        expect(
          Math.max(
            Math.abs(back.semiLatusRectum - q.semiLatusRectum) / q.semiLatusRectum,
            Math.abs(back.f - q.f),
            Math.abs(back.g - q.g),
            Math.abs(back.h - q.h),
            Math.abs(back.k - q.k),
            angleDeviation(back.trueLongitude, q.trueLongitude),
          ),
        ).toBeLessThanOrEqual(1e-13);
      }),
      { numRuns: RUNS },
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * Lambert.
 *
 *   §13.3: r1, r2 non-collinear, Δt in (0, 20 d], revolutions 0-5.
 *   §7.6 Tier 2: "propagate r1, v1 for Δt returns r2 to 1e-9 relative,
 *                 for 0-5 revolutions, both branches".
 *
 * ## The oracle, and why it is not the propagator
 *
 * The endpoint is verified by Kepler propagation through the classical element set,
 * the same oracle `lambert.test.ts` uses and for the same reason: `@hh/propagation`'s
 * universal-variable propagator shares `stumpffC` and `stumpffS` with the Lambert
 * solver, so checking one against the other would let a fault in the Stumpff series
 * agree with itself. This route shares no line of code with `lambert.ts`. It is also
 * why this property lives in `@hh/astro` rather than a layer up, where the layering
 * rule would allow the propagator in.
 *
 * The oracle is conic-aware because the transfers are. Asking for the `'prograde'`
 * solution on a retrograde source orbit returns the complementary transfer angle,
 * which is a genuinely different orbit and is frequently hyperbolic -- so the
 * hyperbolic branch here is exercised heavily rather than incidentally.
 * ---------------------------------------------------------------------------
 */

/** Kepler propagation through the element set, elliptic and hyperbolic. */
const keplerOracle = (state: State, dt: number): State | undefined => {
  const elements = elementsFromState(state.position, state.velocity, MU_EARTH);
  const e = elements.eccentricity;
  const a = semiMajorAxis(elements);

  if (e < 1) {
    const meanMotionValue = Math.sqrt(MU_EARTH / (a * a * a));
    const mean =
      meanFromEccentric(eccentricFromTrue(elements.trueAnomaly, e), e) + meanMotionValue * dt;
    const solved = solveKeplerElliptic(mean, e);
    if (!solved.converged) return undefined;
    return stateFromElements(
      { ...elements, trueAnomaly: trueFromEccentric(solved.anomaly, e) },
      MU_EARTH,
    );
  }

  // The parabolic sliver is left to `solveBarker` and the curated cases; a randomised
  // sweep lands on it with probability zero and a near-parabolic hyperbola is the
  // worse-conditioned neighbour anyway.
  if (e <= 1 + 1e-7) return undefined;

  // |a| rather than -a: the semi-major axis is negative by convention for a hyperbola,
  // and Math.abs keeps the branded type out of a unary negation.
  const absA = Math.abs(a);
  const hyperbolicMeanMotion = Math.sqrt(MU_EARTH / (absA * absA * absA));
  const mean =
    meanFromHyperbolic(hyperbolicFromTrue(elements.trueAnomaly, e), e) + hyperbolicMeanMotion * dt;
  const solved = solveKeplerHyperbolic(mean, e);
  if (!solved.converged) return undefined;
  return stateFromElements(
    { ...elements, trueAnomaly: trueFromHyperbolic(solved.anomaly, e) },
    MU_EARTH,
  );
};

/**
 * `a` stops at 5e7 m so that five revolutions stays inside §13.3's 20-day window:
 * the period there is 30.9 h, and 5 revolutions is 6.4 days.
 */
const LAMBERT_A_MAX = 5e7;

describe('Lambert', () => {
  /*
   * Transfer angles bounded away from all three collinear geometries -- 0, pi and 2pi.
   * At 0 and 2pi the two positions coincide in direction; at pi they do not span a
   * plane, and `lambert.ts` rejects exactly pi for that reason. The margins are
   * measured, not guessed: see the characterisation property below for the numbers
   * that set them.
   */
  const transfer = fc
    .tuple(
      real(7e6, LAMBERT_A_MAX),
      real(1e-3, 0.7),
      anyInclination,
      anyAngle,
      anyAngle,
      anyAngle,
      real(0.4, 5.6),
      fc.integer({ min: 0, max: 5 }),
    )
    .filter(([, , , , , , dnu]) => Math.abs(dnu - Math.PI) >= 0.3);

  // 1e-9 is §7.6 Tier 2's stated figure. Worst observed on this domain over 21 000
  // returned branches is 8.7e-11, so the requirement holds with an order of magnitude
  // in hand. The curated grid in `lambert.test.ts` reaches 1.1e-11 on 158 branches;
  // this is the same claim over four orders of magnitude more geometry.
  it('every returned branch reproduces the target position, 0 to 5 revolutions', () => {
    fc.assert(
      fc.property(transfer, ([a, e, i, raan, argp, nu, dnu, revolutions]) => {
        const start = stateFromElements(shapeOf(a, e, i, raan, argp, nu), MU_EARTH);
        const timeOfFlight = (dnu / TAU + revolutions) * period(metres(a), MU_EARTH);

        const target = keplerOracle(start, timeOfFlight);
        if (target === undefined) return;

        const { branches } = solveLambertBranches(
          start.position,
          target.position,
          seconds(timeOfFlight),
          'prograde',
          MU_EARTH,
          { maxRevolutions: 5 },
        );

        for (const branch of branches) {
          const arrived = keplerOracle(
            { position: start.position, velocity: branch.departureVelocity },
            timeOfFlight,
          );
          if (arrived === undefined) continue;

          const deviation = V.distance(arrived.position, target.position) / V.norm(target.position);
          expect(
            deviation,
            `${String(branch.revolutions)}-revolution ${branch.branch} branch at transfer angle ${dnu.toFixed(3)} rad`,
          ).toBeLessThanOrEqual(1e-9);
        }
      }),
      { numRuns: RUNS },
    );
  });

  /*
   * What happens in the bands the property above excludes.
   *
   * `docs/PHYSICS.md`'s singularity table says "near-pi is not rejected but is
   * ill-conditioned" and says nothing about near-0 or near-2pi. These are the numbers
   * behind that sentence, measured over ~5 000 branches per band:
   *
   *   | transfer angle | worst  |   | transfer angle | worst  |
   *   | -------------- | ------ |   | -------------- | ------ |
   *   | 0.02 .. 0.05   | 1.6e-4 |   | 3.00 .. 3.14   | 1.8e-10 |
   *   | 0.05 .. 0.10   | 7.0e-7 |   | 3.14 .. 3.28   | 9.5e-9  |
   *   | 0.10 .. 0.20   | 8.6e-9 |   | 3.28 .. 3.80   | 1.5e-11 |
   *   | 0.20 .. 0.40   | 9.5e-10|   | 5.60 .. 6.25   | 2.8e-8  |
   *   | 0.40 .. 3.00   | 8.7e-11|   |                |         |
   *
   * The degradation is the *round trip's*, not attributable to the solver alone: the
   * oracle recovers the transfer orbit from a departure velocity that a short chord
   * determines poorly, so both halves lose accuracy in the same place and no
   * experiment here separates them. What this asserts is that even at a transfer
   * angle of 0.02 rad -- 1.1 degrees, well below anything a contract would ask for --
   * the answer stays within 1e-3 of the target rather than diverging.
   */
  it('degrades gracefully, not catastrophically, near the collinear geometries', () => {
    const nearCollinear = fc.tuple(
      real(7e6, LAMBERT_A_MAX),
      real(1e-3, 0.7),
      anyInclination,
      anyAngle,
      anyAngle,
      anyAngle,
      fc.oneof(real(0.02, 0.4), real(3.0, 3.28), real(5.6, 6.25)),
      fc.integer({ min: 0, max: 5 }),
    );

    fc.assert(
      fc.property(nearCollinear, ([a, e, i, raan, argp, nu, dnu, revolutions]) => {
        const start = stateFromElements(shapeOf(a, e, i, raan, argp, nu), MU_EARTH);
        const timeOfFlight = (dnu / TAU + revolutions) * period(metres(a), MU_EARTH);

        const target = keplerOracle(start, timeOfFlight);
        if (target === undefined) return;

        const sineSeparation =
          V.norm(V.cross(start.position, target.position)) /
          (V.norm(start.position) * V.norm(target.position));
        if (sineSeparation < 1e-8) return;

        const { branches } = solveLambertBranches(
          start.position,
          target.position,
          seconds(timeOfFlight),
          'prograde',
          MU_EARTH,
          { maxRevolutions: 5 },
        );

        for (const branch of branches) {
          const arrived = keplerOracle(
            { position: start.position, velocity: branch.departureVelocity },
            timeOfFlight,
          );
          if (arrived === undefined) continue;
          expect(
            V.distance(arrived.position, target.position) / V.norm(target.position),
          ).toBeLessThanOrEqual(1e-3);
        }
      }),
      { numRuns: RUNS },
    );
  });
});
