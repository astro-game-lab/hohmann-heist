/**
 * The in-process determinism fuzz — FR-109, `docs/PRODUCT.md` §11.4, issue #72.
 *
 * > A fuzz test: 10 000 random plans, evaluated twice in-process, asserting
 * > bit-identical results (same-runtime determinism *is* required to be exact).
 *
 * §11.4 is careful to claim two different things, and this test exists because only
 * one of them is testable here. Across runtimes the specification claims agreement to
 * 1e-6 relative and nothing stronger, because `Math.sin`, `Math.cos` and `Math.sqrt`
 * are not required by IEEE 754 or by ECMAScript to be correctly rounded and do differ
 * between V8, SpiderMonkey and JavaScriptCore. **Within one runtime there is no such
 * excuse.** The same plan evaluated twice runs the same instructions on the same
 * inputs, so anything other than bit-identity means state leaked in from somewhere:
 * an accumulator that was not reset, a cache keyed on something that moved, an
 * iteration order that depended on insertion, a clock. Those are the bugs this looks
 * for, and every one of them would survive a tolerance.
 *
 * **Cross-runtime agreement is explicitly out of scope** — that is the Playwright and
 * Miniflare job in §11.4, issue #73, in M6. Nothing here should be read as evidence
 * for it.
 *
 * ## Bit-identity on the evaluated state, not on a score
 *
 * #72 is specific: "asserted on the full evaluated state, not only on scored outputs —
 * a scoring tolerance would mask exactly the bug this exists to catch". So the
 * comparison walks every float a timeline holds — every arc boundary, every arc's
 * state and cached elements, both sides of every impulse, the inertial Δv, and a
 * sweep of `stateAt` lookups across the horizon — and compares them with `Object.is`.
 *
 * `Object.is` rather than `===` is load-bearing twice over. It separates `-0` from
 * `+0`, which differ in their sign bit and are exactly the kind of difference a
 * refactor introduces and `===` calls equal; and it treats `NaN` as equal to itself,
 * so a plan that produces `NaN` twice is reported as *deterministic* — which it is —
 * rather than as a determinism failure, leaving the "is this a sensible number"
 * question to the tests that are actually about that.
 *
 * ## The seed varies, and is printed
 *
 * A fixed seed would test the same ten thousand plans forever, and the value of a fuzz
 * test is the plans nobody thought of. This repository already takes that position:
 * `fast-check`'s seed is deliberately not pinned in the property tests, and the note
 * in `CLAUDE.md` records that the exploration is what found a real bisection bug on
 * its first run.
 *
 * So the seed is drawn from the clock unless `HH_FUZZ_SEED` overrides it, and it is
 * printed on **every** run rather than only on failure. Printing it only on failure
 * loses it whenever a run is retried, cancelled, or read in a log that has been
 * truncated — and the whole point of the seed is that a failure can be reproduced.
 *
 * ## Running more of it
 *
 * Ten thousand plans is what fits comfortably in CI. Locally:
 *
 * ```
 * HH_FUZZ_PLANS=1000000 pnpm vitest run --project fuzz          # a long soak
 * HH_FUZZ_SEED=1234567 pnpm vitest run --project fuzz           # reproduce a failure
 * ```
 *
 * ## Why this is not in `packages/sim`
 *
 * It reads two environment variables and writes a line to stdout, and `process` is
 * banned in `packages/**` by the core guardrail block — correctly, since the
 * simulation must run unchanged in a browser and a Worker. `tools/` is where this
 * repository puts the things that need a host. The fuzz is not the simulation.
 */
import { env, stdout } from 'node:process';

import type { State } from '@hh/astro';
import { epoch, stateFromElements } from '@hh/astro';
import type { Rng } from '@hh/math';
import {
  TAU,
  createRng,
  metres,
  nextInt,
  nextRange,
  nextUint32,
  normalize,
  radians,
} from '@hh/math';
import type { Plan, Timeline, TimelineResult } from '@hh/sim';
import {
  MINIMUM_NODE_SPACING_TICKS,
  buildTimeline,
  createPlan,
  fromEpochTicks,
  maneuverNodeFromCounts,
  stateAt,
} from '@hh/sim';
import { describe, expect, it } from 'vitest';

/** §11.4 and #72: ten thousand plans. Raise it locally with `HH_FUZZ_PLANS`. */
const DEFAULT_PLANS = 10_000;

const positiveInt = (raw: string | undefined, fallback: number): number => {
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new RangeError(`expected a positive integer, got ${raw}`);
  }
  return parsed;
};

const PLANS = positiveInt(env['HH_FUZZ_PLANS'], DEFAULT_PLANS);

/**
 * The seed. From the clock unless overridden — see the module docstring on why it is
 * not pinned. `Date.now()` is legal here and banned three directories away, which is
 * the whole reason this file lives under `tools/`.
 */
const SEED = positiveInt(env['HH_FUZZ_SEED'], Date.now() % Number.MAX_SAFE_INTEGER);

/** §13.3: "random plans, 1–12 nodes". */
const MIN_NODES = 1;
const MAX_NODES = 12;

/** `stateAt` lookups per plan, spread across the horizon. */
const SAMPLES_PER_PLAN = 5;

const MU_EARTH_M3_S2 = 3.986004418e14;

/** One in this many nodes takes each boundary case, so a 10 000-plan run sees thousands of them. */
const BOUNDARY_ODDS = 6;

/**
 * A true anomaly an open orbit can actually be at.
 *
 * A conic with `e >= 1` exists only where `1 + e·cos ν > 0` — outside the asymptotes
 * there is no point on the curve, and `stateFromElements` says so with a `RangeError`
 * rather than returning an infinite radius. So the angle is drawn through its cosine,
 * bounded by `-1/e` with a margin, and given a sign; a uniform draw on `[0, 2π)` would
 * spend most of a hyperbolic case's budget on angles that are not on the orbit.
 *
 * `atan2` rather than `acos`, which is banned in the core for losing the quadrant and
 * most of its precision near ±1 (NFR-006). This file is outside that block, but the
 * rule is right here for the same reason it is right there.
 */
const openTrueAnomaly = (rng: Rng, eccentricity: number): number => {
  const cosLimit = -1 / eccentricity;
  // Five percent of the way in from the asymptote. Closer would put the radius near
  // the far end of float64 and make the fuzz a test of overflow rather than of
  // determinism; the near-parabolic conditioning is covered by the goldens.
  const cosNu = nextRange(rng, cosLimit + 0.05 * (1 - cosLimit), 1);
  const sinNu = Math.sqrt(Math.max(0, 1 - cosNu * cosNu));
  return normalize(Math.atan2(nextUint32(rng) % 2 === 0 ? sinNu : -sinNu, cosNu));
};

/**
 * A random initial orbit, spanning every conic class including the degenerate ones.
 *
 * Weighted towards the shapes the game actually uses rather than uniformly over the
 * eccentricity line: a fuzz that spent most of its budget on hyperbolas would be
 * exploring the part of the domain no contract reaches.
 */
const randomState = (rng: Rng): State => {
  const roll = nextUint32(rng) % 100;
  const eccentricity =
    roll < 25
      ? 0 // circular, and the classical singularity with it
      : roll < 70
        ? nextRange(rng, 0, 0.95)
        : roll < 80
          ? nextRange(rng, 0.99, 1) // near-parabolic, from below
          : roll < 84
            ? 1 // exactly parabolic
            : roll < 92
              ? nextRange(rng, 1, 1.02) // near-parabolic, from above
              : nextRange(rng, 1.05, 3);

  const inclinationRoll = nextUint32(rng) % 100;
  const inclination =
    inclinationRoll < 15
      ? 0 // equatorial prograde
      : inclinationRoll < 25
        ? Math.PI // equatorial retrograde: sin i = 0 with i != 0
        : inclinationRoll < 32
          ? Math.PI / 2 // polar
          : nextRange(rng, 0, Math.PI);

  return stateFromElements(
    {
      semiLatusRectum: metres(nextRange(rng, 6.8e6, 4e8)),
      eccentricity,
      inclination: radians(inclination),
      raan: radians(nextRange(rng, 0, TAU)),
      argp: radians(nextRange(rng, 0, TAU)),
      trueAnomaly: radians(
        eccentricity < 1 ? nextRange(rng, 0, TAU) : openTrueAnomaly(rng, eccentricity),
      ),
    },
    MU_EARTH_M3_S2,
  );
};

/** One Δv, in counts. Occasionally exactly zero (#72's boundary case), occasionally large. */
const randomDeltaV = (rng: Rng): readonly [number, number, number] => {
  if (nextUint32(rng) % BOUNDARY_ODDS === 0) return [0, 0, 0];
  const scale = nextUint32(rng) % 8 === 0 ? 3_000_000 : 200_000;
  return [
    nextInt(rng, -scale, scale + 1),
    nextInt(rng, -scale, scale + 1),
    nextInt(rng, -scale, scale + 1),
  ];
};

interface FuzzCase {
  readonly startTicks: number;
  readonly initialState: State;
  readonly plan: Plan;
  readonly horizonTicks: number;
}

/**
 * A random, legal plan and the state and horizon to evaluate it against.
 *
 * Node gaps take FR-101's exact floor about one time in six, because the minimum legal
 * spacing is the value most likely to be handled by a comparison that is off by one
 * and the least likely to be reached by a uniform draw.
 */
const randomCase = (rng: Rng): FuzzCase => {
  const startTicks = nextInt(rng, 0, 1_000_000);
  const nodeCount = nextInt(rng, MIN_NODES, MAX_NODES + 1);

  const nodes = [];
  let ticks = startTicks + nextInt(rng, 0, 100_000);
  for (let i = 0; i < nodeCount; i++) {
    nodes.push(maneuverNodeFromCounts(ticks, randomDeltaV(rng)));
    ticks +=
      nextUint32(rng) % BOUNDARY_ODDS === 0
        ? MINIMUM_NODE_SPACING_TICKS
        : nextInt(rng, MINIMUM_NODE_SPACING_TICKS, 40_000_000);
  }

  return {
    startTicks,
    initialState: randomState(rng),
    plan: createPlan(nodes),
    horizonTicks: ticks + nextInt(rng, 0, 10_000_000),
  };
};

const evaluate = (test: FuzzCase): TimelineResult =>
  buildTimeline({
    startEpoch: fromEpochTicks(test.startTicks),
    initialState: test.initialState,
    plan: test.plan,
    horizon: fromEpochTicks(test.horizonTicks),
    mu: MU_EARTH_M3_S2,
  });

/**
 * Every float a timeline holds, in a fixed order.
 *
 * Flattening rather than a recursive deep-equal, for two reasons. It is a stated,
 * readable list of what "the full evaluated state" means, which is the phrase #72
 * turns on — a deep-equal would silently stop covering a field the day one was added
 * to `Arc`. And it makes the comparison `Object.is` over a `number[]`, which is fast
 * enough to run ten thousand times twice without the comparison dominating the test.
 *
 * The cached `elements` are included deliberately. They are derived rather than
 * primary, so a difference there is either a difference in the state they came from —
 * caught anyway — or a difference in the derivation, which is a determinism bug in
 * `elementsFromState` that nothing else here would see.
 */
const flatten = (timeline: Timeline): number[] => {
  const out: number[] = [timeline.startEpoch, timeline.horizon, timeline.mu];

  for (const arc of timeline.arcs) {
    out.push(
      arc.startEpoch,
      arc.endEpoch,
      arc.mu,
      arc.state.position.x,
      arc.state.position.y,
      arc.state.position.z,
      arc.state.velocity.x,
      arc.state.velocity.y,
      arc.state.velocity.z,
      arc.elements.semiLatusRectum,
      arc.elements.eccentricity,
      arc.elements.inclination,
      arc.elements.raan,
      arc.elements.argp,
      arc.elements.trueAnomaly,
    );
  }

  for (const impulse of timeline.impulses) {
    out.push(
      impulse.nodeIndex,
      impulse.epoch,
      impulse.before.position.x,
      impulse.before.position.y,
      impulse.before.position.z,
      impulse.before.velocity.x,
      impulse.before.velocity.y,
      impulse.before.velocity.z,
      impulse.after.position.x,
      impulse.after.position.y,
      impulse.after.position.z,
      impulse.after.velocity.x,
      impulse.after.velocity.y,
      impulse.after.velocity.z,
      impulse.deltaVEci.x,
      impulse.deltaVEci.y,
      impulse.deltaVEci.z,
    );
  }

  // A sweep of lookups, so the binary search and the per-arc solve are exercised at
  // epochs the construction never visited. Fractions rather than absolute offsets, so
  // the sweep covers the horizon whatever its length.
  const span = timeline.horizon - timeline.startEpoch;
  for (let i = 0; i < SAMPLES_PER_PLAN; i++) {
    const at = epoch(timeline.startEpoch + (span * (i + 0.5)) / SAMPLES_PER_PLAN);
    const result = stateAt(timeline, at);
    out.push(
      result.converged ? 1 : 0,
      result.converged ? result.state.position.x : Number.NaN,
      result.converged ? result.state.position.y : Number.NaN,
      result.converged ? result.state.position.z : Number.NaN,
      result.converged ? result.state.velocity.x : Number.NaN,
      result.converged ? result.state.velocity.y : Number.NaN,
      result.converged ? result.state.velocity.z : Number.NaN,
    );
  }

  return out;
};

/** Index of the first bit-level difference, or `-1`. `Object.is`, for `-0` and `NaN`. */
const firstDifference = (a: readonly number[], b: readonly number[]): number => {
  if (a.length !== b.length) return Math.min(a.length, b.length);
  for (const [i, value] of a.entries()) {
    if (!Object.is(value, b[i])) return i;
  }
  return -1;
};

describe('FR-109 — the same plan evaluated twice, in-process', () => {
  it(
    `is bit-identical over ${PLANS.toLocaleString('en-GB')} random plans`,
    () => {
      stdout.write(
        `  FR-109 fuzz: ${String(PLANS)} plans, seed ${String(SEED)} ` +
          `(reproduce with HH_FUZZ_SEED=${String(SEED)})\n`,
      );

      // Two generators from the same seed rather than one replayed: the second
      // evaluation must see the *same* case, and rebuilding it from an independent
      // generator proves the case itself is a pure function of the seed. Sharing one
      // object would make the plan a shared mutable input, which is the thing under
      // test.
      const first = createRng(BigInt(SEED));
      const second = createRng(BigInt(SEED));

      let evaluated = 0;
      let refused = 0;
      let nodes = 0;

      for (let i = 0; i < PLANS; i++) {
        const a = randomCase(first);
        const b = randomCase(second);
        nodes += a.plan.nodes.length;

        const resultA = evaluate(a);
        const resultB = evaluate(b);

        if (!resultA.ok || !resultB.ok) {
          // A refusal is a result too, and it has to be the same result.
          //
          // In practice random plans do not reach either refusal, and the honest thing
          // is to say so rather than to imply this branch carries weight it does not.
          // `rectilinear` needs a burn that cancels the transverse *and* normal
          // velocity components exactly, and Δv is quantised to counts of 1e-4 m/s, so
          // a random plan hitting it has probability near zero — a 200 000-plan soak
          // refused none. `timeline.test.ts` constructs both refusals deliberately,
          // which is where they are actually covered. This branch is here so that a
          // change which *does* make them reachable finds the assertion already
          // waiting, rather than silently skipping ten thousand comparisons.
          expect(
            { ok: resultA.ok, reason: resultA.ok ? null : resultA.reason },
            `plan ${String(i)} (seed ${String(SEED)}) was refused inconsistently`,
          ).toEqual({ ok: resultB.ok, reason: resultB.ok ? null : resultB.reason });
          refused += 1;
          continue;
        }

        const flatA = flatten(resultA.timeline);
        const flatB = flatten(resultB.timeline);
        const at = firstDifference(flatA, flatB);

        if (at !== -1) {
          throw new Error(
            `plan ${String(i)} of the fuzz run is not deterministic in-process.\n` +
              `  seed:          ${String(SEED)} (HH_FUZZ_SEED=${String(SEED)} reproduces this run)\n` +
              `  nodes:         ${String(a.plan.nodes.length)}\n` +
              `  first differs: index ${String(at)} of ${String(flatA.length)}\n` +
              `  values:        ${String(flatA[at])} vs ${String(flatB[at])}\n\n` +
              '§11.4 requires same-runtime determinism to be exact. A difference here means ' +
              'state leaked into the evaluation — a clock, an unreset accumulator, an ' +
              'order-dependent iteration, or a cache keyed on something that moved.',
          );
        }
        evaluated += 1;
      }

      stdout.write(
        `  FR-109 fuzz: ${String(evaluated)} evaluated, ${String(refused)} refused, ` +
          `${(nodes / PLANS).toFixed(1)} nodes/plan average\n`,
      );

      // A run in which nothing evaluated would pass every assertion above and prove
      // nothing at all. The generator is meant to produce mostly-valid plans, so this
      // is the check that it still does.
      expect(evaluated).toBeGreaterThan(PLANS * 0.5);
    },
    // Ten thousand plans take a couple of seconds; a local soak of a million should
    // not need the timeout raised as well.
    30 * 60_000,
  );
});

describe('FR-101 — the boundary cases #72 names', () => {
  it('accepts nodes at exactly the minimum spacing', () => {
    const plan = createPlan([
      maneuverNodeFromCounts(1024, [0, 100, 0]),
      maneuverNodeFromCounts(1024 + MINIMUM_NODE_SPACING_TICKS, [0, 100, 0]),
    ]);
    expect(plan.nodes).toHaveLength(2);
  });

  it('rejects coincident epochs', () => {
    expect(() =>
      createPlan([
        maneuverNodeFromCounts(2048, [0, 100, 0]),
        maneuverNodeFromCounts(2048, [0, -100, 0]),
      ]),
    ).toThrow(RangeError);
  });

  it('rejects a gap one tick below the minimum', () => {
    expect(() =>
      createPlan([
        maneuverNodeFromCounts(2048, [0, 100, 0]),
        maneuverNodeFromCounts(2048 + MINIMUM_NODE_SPACING_TICKS - 1, [0, 100, 0]),
      ]),
    ).toThrow(RangeError);
  });

  it('evaluates a zero-Δv node to an impulse that changes nothing', () => {
    const result = buildTimeline({
      startEpoch: epoch(0),
      initialState: stateFromElements(
        {
          semiLatusRectum: metres(6_778_137),
          eccentricity: 0,
          inclination: radians(0.9),
          raan: radians(0),
          argp: radians(0),
          trueAnomaly: radians(0),
        },
        MU_EARTH_M3_S2,
      ),
      plan: createPlan([maneuverNodeFromCounts(1024 * 600, [0, 0, 0])]),
      horizon: epoch(3600),
      mu: MU_EARTH_M3_S2,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [impulse] = result.timeline.impulses;
    expect(impulse).toBeDefined();
    // Exact, not close: rotating the zero vector is exact and adding zero to a float
    // is exact, so anything else would mean the impulse path is doing arithmetic it
    // should not.
    expect(impulse?.after).toEqual(impulse?.before);
  });
});
