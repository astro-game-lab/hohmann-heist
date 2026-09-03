/**
 * The golden-trajectory case set — `docs/PRODUCT.md` §7.6 Tier 4, issue #71.
 *
 * > A fixture set of ~30 plans with their evaluated states at fixed epochs, committed
 * > as JSON. Any change to the propagator that moves a golden value by more than 1e-9
 * > relative fails CI and requires a `docs/PHYSICS.md` update in the same PR.
 *
 * This module is the *specification* of that set: what each case is, why it is in the
 * set, and what is sampled from it. `generate.mjs` turns it into `fixtures.json`;
 * `goldens.test.ts` re-evaluates it and compares against that file. Both read the same
 * specs, which is the point — a spec edited without a regeneration fails loudly
 * instead of quietly re-baselining itself.
 *
 * ## What a golden is for, which is not what the other tests are for
 *
 * Every other physics test in this repository asserts that a number is *right*: against
 * a closed form, a textbook, or an independent oracle. A golden asserts something
 * weaker and completely different — that a number has not *changed*. It cannot tell you
 * the propagator is correct, and it must never be read as though it could. What it
 * catches is the class of change no other test in the suite is looking for: a
 * refactor that quietly alters a result, a solver tolerance nudged "harmlessly", a
 * convention drifting in a package three layers down. Those all keep every existing
 * test green, because every existing test was written against the same assumption that
 * moved.
 *
 * That is also why the gate is paired with a `docs/PHYSICS.md` requirement (§11.13):
 * the fixture file moving is not a failure, it is a *claim* — the model changed — and
 * the claim has to be written down where players and reviewers read it, in the same
 * pull request. `physics-doc-gate.mjs` is that half.
 *
 * ## Choosing the cases
 *
 * #71 asks for "every conic class and the degenerate cases, not only the common
 * circular LEO path", and the set below is built to that. Four groups:
 *
 * - **Conic classes.** Circular, low, moderate and high eccentricity, near-parabolic
 *   from below and above, exactly parabolic, and two hyperbolas. Parabolic and
 *   near-parabolic are where universal-variable formulations classically fall over,
 *   and `e = 1` exactly is the case a solver written around `a` cannot represent at all.
 * - **Degenerate geometry.** `e = 0`, `i = 0`, both together, `i = π` (retrograde
 *   equatorial, which the `sin i` test catches and an `i` test does not), and polar.
 *   §7.2 calls these the common case in this game rather than an edge case, because
 *   every v1.0 contract is equatorial-equivalent.
 * - **Degenerate plan structure.** A node exactly on the start epoch (arc 0 has zero
 *   length), a node exactly on the horizon (the last arc does), the minimum legal node
 *   spacing, a zero-Δv node, the empty plan, and §13.3's twelve-node maximum.
 * - **Trajectories that change class mid-timeline.** A burn that takes a circular orbit
 *   hyperbolic, and one that captures a hyperbolic arrival into an ellipse. These are
 *   the cases where a timeline holds arcs of different conic classes at once, which no
 *   single-arc test reaches.
 *
 * ## Units and quantisation
 *
 * Every epoch here is in **ticks** and every Δv component in **counts** — the integer
 * forms DEP-09 makes canonical — rather than in seconds and m/s. A fixture written in
 * SI would be quantised on the way in and the file would not say what was actually
 * evaluated. See `packages/sim/src/quantise.ts` on why the integer is the value.
 */
import type { OrbitShape } from '@hh/astro';
import { MU_EARTH } from '@hh/astro';
import { metres, radians } from '@hh/math';
import { EPOCH_TICKS_PER_SECOND, MINIMUM_NODE_SPACING_TICKS } from '@hh/sim';

/** ISS inclination, in radians. The shape most contracts start on. */
const ISS_INCLINATION = 0.9006;

/**
 * The Moon's gravitational parameter, in m³ s⁻².
 *
 * Present as a *scale*, not as a validated constant: two orders of magnitude below
 * `MU_EARTH` exercises the solvers where the anomaly-to-time mapping has a very
 * different conditioning, and nothing in this file asserts anything about the Moon.
 * A real lunar constant, if one is ever needed, belongs in `@hh/astro` with a source.
 */
const MU_SMALL_BODY = 4.9048695e12;

/** One impulse, as the integer counts DEP-09 makes canonical: `[ticks, radial, transverse, normal]`. */
export type GoldenNode = readonly [
  epochTicks: number,
  radialCounts: number,
  transverseCounts: number,
  normalCounts: number,
];

/** One golden case. Everything needed to evaluate it, and nothing derived. */
export interface GoldenCase {
  /** Stable identifier. Renaming one is a fixture change and shows up as such in the diff. */
  readonly id: string;
  /** Why this case is in the set. Carried into the fixture file so the JSON is readable alone. */
  readonly description: string;
  /** Central body, in m³ s⁻². */
  readonly mu: number;
  /** Orbit the timeline starts on. Converted to a Cartesian state by `stateFromElements`. */
  readonly elements: OrbitShape;
  /** Start of the timeline, in epoch ticks. */
  readonly startTicks: number;
  /** End of the timeline, in epoch ticks. */
  readonly horizonTicks: number;
  /** The plan, in epoch order. */
  readonly nodes: readonly GoldenNode[];
}

const ticks = (seconds: number): number => Math.round(seconds * EPOCH_TICKS_PER_SECOND);

/** An orbit, with the angles that rarely matter given one fixed non-trivial value. */
const orbit = (
  semiLatusRectum: number,
  eccentricity: number,
  inclination: number,
  overrides: { raan?: number; argp?: number; trueAnomaly?: number } = {},
): OrbitShape => ({
  semiLatusRectum: metres(semiLatusRectum),
  eccentricity,
  inclination: radians(inclination),
  raan: radians(overrides.raan ?? 1.1),
  argp: radians(overrides.argp ?? 0.4),
  trueAnomaly: radians(overrides.trueAnomaly ?? 0.6),
});

/** Semi-latus rectum of a closed orbit from its semi-major axis. `p = a(1 − e²)`. */
const pFromA = (a: number, e: number): number => a * (1 - e * e);

/** Semi-latus rectum of a hyperbola from the magnitude of its semi-major axis. `p = |a|(e² − 1)`. */
const pFromHyperbolicA = (absA: number, e: number): number => absA * (e * e - 1);

const LEO_RADIUS = 6_778_137;
const GEO_RADIUS = 42_164_172.9;
const HOUR = 3600;
const DAY = 86_400;

/**
 * The case set.
 *
 * Thirty-one cases. The count is not sacred — §7.6 says "~30" — but the *coverage*
 * is: removing a case means removing whatever it was the only one to reach, so a
 * deletion should say which of the four groups above it leaves thinner.
 */
export const GOLDEN_CASES: readonly GoldenCase[] = Object.freeze([
  // ── Conic classes ────────────────────────────────────────────────────────────
  {
    id: 'leo-circular-inclined-coast',
    description: 'A 400 km circular orbit at ISS inclination, coasting. The baseline shape.',
    mu: MU_EARTH,
    elements: orbit(LEO_RADIUS, 0, ISS_INCLINATION),
    startTicks: 0,
    horizonTicks: ticks(6 * HOUR),
    nodes: [],
  },
  {
    id: 'leo-e001-eight-nodes',
    description: '§11.9’s own scenario: a near-circular LEO, eight nodes over 14 h.',
    mu: MU_EARTH,
    elements: orbit(pFromA(LEO_RADIUS, 0.001), 0.001, ISS_INCLINATION),
    startTicks: 0,
    horizonTicks: ticks(14 * HOUR),
    nodes: Array.from({ length: 8 }, (_, i): GoldenNode => [ticks((i + 1) * 1800), 0, 250_000, 0]),
  },
  {
    id: 'meo-e030-three-nodes',
    description:
      'Moderate eccentricity, where neither the circular nor the near-parabolic conventions apply.',
    mu: MU_EARTH,
    elements: orbit(pFromA(1.2e7, 0.3), 0.3, 0.5),
    startTicks: ticks(1000),
    horizonTicks: ticks(1000 + 8 * HOUR),
    nodes: [
      [ticks(2400), 120_000, 40_000, 0],
      [ticks(9000), 0, -180_000, 30_000],
      [ticks(20_000), -50_000, 90_000, 0],
    ],
  },
  {
    id: 'gto-e073-two-nodes',
    description:
      'A GTO-like transfer. High enough eccentricity that periapsis and apoapsis behave very differently.',
    mu: MU_EARTH,
    elements: orbit(1.5e7, 0.73, ISS_INCLINATION),
    startTicks: 0,
    horizonTicks: ticks(12 * HOUR),
    nodes: [
      [ticks(3600), 0, 300_000, 0],
      [ticks(25_000), 0, -150_000, 80_000],
    ],
  },
  {
    id: 'heo-e095-two-nodes',
    description:
      'A Molniya-like eccentricity, where the anomaly-to-time map is most strongly non-linear.',
    mu: MU_EARTH,
    elements: orbit(pFromA(2.65e7, 0.95), 0.95, 1.1071, { argp: 4.712 }),
    startTicks: 0,
    horizonTicks: ticks(16 * HOUR),
    nodes: [
      [ticks(2 * HOUR), 0, 120_000, 0],
      [ticks(9 * HOUR), 40_000, -60_000, 0],
    ],
  },
  {
    id: 'near-parabolic-below-one-node',
    description: 'e = 0.9999 — closed, but only just. The elliptic side of the parabolic boundary.',
    mu: MU_EARTH,
    elements: orbit(1.2e7, 0.9999, 0.4, { trueAnomaly: 0.2 }),
    startTicks: 0,
    horizonTicks: ticks(4 * HOUR),
    nodes: [[ticks(3600), 0, 50_000, 0]],
  },
  {
    id: 'parabolic-exact-coast',
    description:
      'e = 1 exactly. Representable only because the element set is built on p rather than a (FR-002).',
    mu: MU_EARTH,
    elements: orbit(1.2e7, 1, 0.4, { trueAnomaly: 0.2 }),
    startTicks: 0,
    horizonTicks: ticks(3 * HOUR),
    nodes: [],
  },
  {
    id: 'near-parabolic-above-one-node',
    description: 'e = 1.0001 — open, but only just. The hyperbolic side of the same boundary.',
    mu: MU_EARTH,
    elements: orbit(1.2e7, 1.0001, 0.4, { trueAnomaly: 0.2 }),
    startTicks: 0,
    horizonTicks: ticks(3 * HOUR),
    nodes: [[ticks(1800), 0, -40_000, 0]],
  },
  {
    id: 'hyperbolic-e140-one-node',
    description: 'A moderate hyperbola, with a burn on the outbound leg.',
    mu: MU_EARTH,
    elements: orbit(pFromHyperbolicA(8.0e6, 1.4), 1.4, ISS_INCLINATION, { trueAnomaly: 0.3 }),
    startTicks: 0,
    horizonTicks: ticks(3 * HOUR),
    nodes: [[ticks(1200), 60_000, -90_000, 20_000]],
  },
  {
    id: 'hyperbolic-e300-coast',
    description:
      'A fast flyby. Far from the parabolic boundary, where the universal formulation is least stiff.',
    mu: MU_EARTH,
    elements: orbit(pFromHyperbolicA(6.0e6, 3.0), 3.0, 0.7, { trueAnomaly: 5.9 }),
    startTicks: 0,
    horizonTicks: ticks(2 * HOUR),
    nodes: [],
  },
  {
    id: 'geo-circular-coast',
    description:
      'A geostationary-radius circular orbit — the other end of every contract in the campaign.',
    mu: MU_EARTH,
    elements: orbit(GEO_RADIUS, 0, 0.01),
    startTicks: 0,
    horizonTicks: ticks(DAY),
    nodes: [],
  },

  // ── Degenerate geometry ──────────────────────────────────────────────────────
  {
    id: 'circular-equatorial-coast',
    description:
      'e = 0 and i = 0 together: both classical singularities at once, and the v1.0 common case.',
    mu: MU_EARTH,
    elements: orbit(LEO_RADIUS, 0, 0, { raan: 0, argp: 0 }),
    startTicks: 0,
    horizonTicks: ticks(4 * HOUR),
    nodes: [],
  },
  {
    id: 'circular-equatorial-two-nodes',
    description:
      'The same degenerate geometry with impulses on it, so the RTN basis is built at e = 0, i = 0.',
    mu: MU_EARTH,
    elements: orbit(LEO_RADIUS, 0, 0, { raan: 0, argp: 0 }),
    startTicks: 0,
    horizonTicks: ticks(6 * HOUR),
    nodes: [
      [ticks(1800), 0, 200_000, 0],
      [ticks(10_000), 0, 150_000, 0],
    ],
  },
  {
    id: 'circular-inclined-two-nodes',
    description: 'e = 0 with a real inclination: the eccentricity singularity alone.',
    mu: MU_EARTH,
    elements: orbit(LEO_RADIUS, 0, ISS_INCLINATION),
    startTicks: 0,
    horizonTicks: ticks(6 * HOUR),
    nodes: [
      [ticks(2000), 0, 180_000, 0],
      [ticks(12_000), -30_000, 60_000, 0],
    ],
  },
  {
    id: 'equatorial-eccentric-one-node',
    description:
      'i = 0 with a real eccentricity: the node singularity alone, where argp is measured from x̂.',
    mu: MU_EARTH,
    elements: orbit(pFromA(9.0e6, 0.25), 0.25, 0, { raan: 0 }),
    startTicks: 0,
    horizonTicks: ticks(6 * HOUR),
    nodes: [[ticks(4000), 0, 100_000, 0]],
  },
  {
    id: 'retrograde-equatorial-two-nodes',
    description:
      'i = π. Caught by the sin i test and missed by an i test — §7.2 says so, and this is where it is checked.',
    mu: MU_EARTH,
    elements: orbit(LEO_RADIUS, 0, Math.PI, { raan: 0, argp: 0 }),
    startTicks: 0,
    horizonTicks: ticks(5 * HOUR),
    nodes: [
      [ticks(1500), 0, 120_000, 0],
      [ticks(9000), 0, -80_000, 0],
    ],
  },
  {
    id: 'retrograde-inclined-one-node',
    description:
      'A retrograde orbit away from the pole, where the normal direction flips but nothing is degenerate.',
    mu: MU_EARTH,
    elements: orbit(pFromA(8.5e6, 0.1), 0.1, 2.6),
    startTicks: 0,
    horizonTicks: ticks(5 * HOUR),
    nodes: [[ticks(3000), 20_000, 90_000, -40_000]],
  },
  {
    id: 'polar-circular-two-nodes',
    description:
      'i = π/2, where the ascending node is well defined but the orbit passes over both poles.',
    mu: MU_EARTH,
    elements: orbit(LEO_RADIUS, 0, Math.PI / 2),
    startTicks: 0,
    horizonTicks: ticks(5 * HOUR),
    nodes: [
      [ticks(2500), 0, 140_000, 0],
      [ticks(11_000), 0, 0, 120_000],
    ],
  },

  // ── Degenerate plan structure ────────────────────────────────────────────────
  {
    id: 'empty-plan-seven-days',
    description:
      'No nodes at all, over a horizon long enough for the revolution reduction to matter.',
    mu: MU_EARTH,
    elements: orbit(pFromA(LEO_RADIUS, 0.01), 0.01, ISS_INCLINATION),
    startTicks: 0,
    horizonTicks: ticks(7 * DAY),
    nodes: [],
  },
  {
    id: 'node-on-start-epoch',
    description:
      'A node exactly at the start epoch, so arc 0 has zero length and must never be selected.',
    mu: MU_EARTH,
    elements: orbit(LEO_RADIUS, 0, ISS_INCLINATION),
    startTicks: 0,
    horizonTicks: ticks(4 * HOUR),
    nodes: [
      [0, 0, 200_000, 0],
      [ticks(3600), 0, 100_000, 0],
    ],
  },
  {
    id: 'node-on-horizon',
    description: 'A node exactly at the horizon, so the last arc has zero length.',
    mu: MU_EARTH,
    elements: orbit(LEO_RADIUS, 0, ISS_INCLINATION),
    startTicks: 0,
    horizonTicks: ticks(4 * HOUR),
    nodes: [
      [ticks(1800), 0, 150_000, 0],
      [ticks(4 * HOUR), 0, 90_000, 0],
    ],
  },
  {
    id: 'minimum-node-spacing',
    description:
      'Three nodes at FR-101’s floor — exactly one second apart, checked on ticks and not on seconds.',
    mu: MU_EARTH,
    elements: orbit(LEO_RADIUS, 0, ISS_INCLINATION),
    startTicks: 0,
    horizonTicks: ticks(2 * HOUR),
    nodes: [
      [ticks(600), 0, 40_000, 0],
      [ticks(600) + MINIMUM_NODE_SPACING_TICKS, 0, 40_000, 0],
      [ticks(600) + 2 * MINIMUM_NODE_SPACING_TICKS, 0, 40_000, 0],
    ],
  },
  {
    id: 'zero-delta-v-node',
    description:
      'A node that changes nothing. Legal, and the arc split it forces must still land on the same trajectory.',
    mu: MU_EARTH,
    elements: orbit(pFromA(LEO_RADIUS, 0.02), 0.02, ISS_INCLINATION),
    startTicks: 0,
    horizonTicks: ticks(4 * HOUR),
    nodes: [
      [ticks(2000), 0, 0, 0],
      [ticks(8000), 0, 120_000, 0],
    ],
  },
  {
    id: 'twelve-nodes',
    description:
      '§13.3’s upper bound on plan size, with the Δv varying so no two arcs are the same.',
    mu: MU_EARTH,
    elements: orbit(pFromA(LEO_RADIUS, 0.005), 0.005, ISS_INCLINATION),
    startTicks: 0,
    horizonTicks: ticks(14 * HOUR),
    nodes: Array.from({ length: 12 }, (_, i): GoldenNode => [
      ticks(1200 + i * 1500),
      (i % 3) * 15_000,
      60_000 + i * 7_000,
      i % 2 === 0 ? 0 : -12_000,
    ]),
  },
  {
    id: 'pure-radial-burn',
    description:
      'Radial only. Changes the shape without changing the specific angular momentum much.',
    mu: MU_EARTH,
    elements: orbit(LEO_RADIUS, 0, ISS_INCLINATION),
    startTicks: 0,
    horizonTicks: ticks(4 * HOUR),
    nodes: [[ticks(2000), 400_000, 0, 0]],
  },
  {
    id: 'pure-normal-burn',
    description:
      'Normal only — a plane change, which rotates the RTN basis for everything after it.',
    mu: MU_EARTH,
    elements: orbit(LEO_RADIUS, 0, ISS_INCLINATION),
    startTicks: 0,
    horizonTicks: ticks(4 * HOUR),
    nodes: [[ticks(2000), 0, 0, 900_000]],
  },

  // ── Class changes and the campaign's own transfers ───────────────────────────
  {
    id: 'hohmann-leo-to-geo',
    description:
      'The transfer the game is named after: two prograde burns from 400 km to geostationary radius.',
    mu: MU_EARTH,
    elements: orbit(LEO_RADIUS, 0, 0, { raan: 0, argp: 0, trueAnomaly: 0 }),
    startTicks: 0,
    horizonTicks: ticks(12 * HOUR),
    // 2 397.5 m/s then 1 456.5 m/s, from §7.6's Hohmann row. Written as counts, and
    // present as a *shape* rather than as an assertion — the closed-form check on those
    // numbers is `twobody.test.ts`'s job, not a golden's.
    nodes: [
      [ticks(600), 0, 23_975_000, 0],
      [ticks(600) + ticks(19_048.6), 0, 14_565_000, 0],
    ],
  },
  {
    id: 'circular-to-escape',
    description:
      'A burn large enough to take a closed orbit hyperbolic, so one timeline holds two conic classes.',
    mu: MU_EARTH,
    elements: orbit(LEO_RADIUS, 0, ISS_INCLINATION),
    startTicks: 0,
    horizonTicks: ticks(6 * HOUR),
    nodes: [[ticks(1800), 0, 32_000_000, 0]],
  },
  {
    id: 'escape-to-capture',
    description:
      'The reverse: a retrograde burn that captures a hyperbolic arrival into an ellipse.',
    mu: MU_EARTH,
    elements: orbit(pFromHyperbolicA(9.0e6, 1.2), 1.2, 0.6, { trueAnomaly: 5.8 }),
    startTicks: 0,
    horizonTicks: ticks(8 * HOUR),
    nodes: [[ticks(2400), 0, -35_000_000, 0]],
  },
  {
    id: 'apoapsis-circularisation',
    description:
      'A single prograde burn at apoapsis of an eccentric orbit, which is what a transfer ends with.',
    mu: MU_EARTH,
    elements: orbit(pFromA(1.5e7, 0.4), 0.4, 0.3, { trueAnomaly: Math.PI }),
    startTicks: 0,
    horizonTicks: ticks(10 * HOUR),
    nodes: [[ticks(60), 0, 12_000_000, 0]],
  },
  {
    id: 'small-body-two-nodes',
    description:
      'The same evaluation two orders of magnitude down in μ, where the time scales are entirely different.',
    mu: MU_SMALL_BODY,
    elements: orbit(2.0e6, 0.1, 0.5),
    startTicks: 0,
    horizonTicks: ticks(12 * HOUR),
    nodes: [
      [ticks(3600), 0, 3_000, 0],
      [ticks(20_000), 1_000, -2_000, 500],
    ],
  },
]);

/**
 * Epochs, in ticks, at which a case's state is recorded.
 *
 * A fixed rule rather than a per-case list, so that adding a case cannot accidentally
 * sample it more thinly than the rest. Three kinds of instant, each for a reason:
 *
 * - **The bounds and five interior fractions.** Ordinary lookups, spread over the
 *   horizon so a change that only shows up late in a long propagation is caught.
 * - **Every node epoch.** FR-103's endpoint rule says this returns the *post*-impulse
 *   state, which is exactly the convention a refactor could invert without failing
 *   anything that only samples the interior of an arc.
 * - **One tick before every node.** The other side of that boundary. The pair is what
 *   pins the rule down; either alone is satisfied by getting it backwards.
 *
 * Changing this rule moves every golden in the file, which is a regeneration and a
 * `docs/PHYSICS.md` note like any other.
 */
export const sampleTicks = (test: GoldenCase): readonly number[] => {
  const span = test.horizonTicks - test.startTicks;
  const sampled = new Set<number>([test.startTicks, test.horizonTicks]);

  for (const fraction of [0.1, 0.25, 0.5, 0.75, 0.9]) {
    sampled.add(test.startTicks + Math.round(span * fraction));
  }
  for (const [nodeTicks] of test.nodes) {
    sampled.add(nodeTicks);
    if (nodeTicks - 1 >= test.startTicks) sampled.add(nodeTicks - 1);
  }

  return [...sampled].sort((a, b) => a - b);
};
