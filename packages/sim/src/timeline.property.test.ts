/**
 * Property tests for the timeline (section 13.3).
 *
 * Two rows of section 13.3's table land here — *"plan evaluation is deterministic
 * in-process"* over random plans of 1 to 12 nodes, and *"timeline `stateAt` is
 * continuous across arc boundaries"* — plus the claim #69 turns on, that an incremental
 * re-evaluation is the same answer as a rebuild rather than a nearby one.
 *
 * **The seed is deliberately not pinned**, for the reason `math.property.test.ts` gives:
 * a fixed seed is reproducible at the cost of never exploring anything new. fast-check
 * prints the seed and the counterexample on failure, so a red build here is reproducible
 * and is a defect, never noise.
 *
 * Plans are generated in **integer counts** rather than in SI quantities and fed through
 * `maneuverNodeFromCounts`. Generating seconds and metres per second would put every
 * case through the entry quantiser and explore the rounding rather than the timeline;
 * counts are what a plan actually is (DEP-09), so this generates plans instead of
 * generating numbers that become plans.
 */
import type { State } from '@hh/astro';
import { MU_EARTH, epoch, stateFromElements } from '@hh/astro';
import { metres, radians, TAU, V } from '@hh/math';
import { containsEpoch } from '@hh/propagation';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { DeltaVCounts, ManeuverNode, Plan } from './plan.js';
import { createPlan, maneuverNodeFromCounts } from './plan.js';
import { EPOCH_TICKS_PER_SECOND } from './quantise.js';
import type { Timeline } from './timeline.js';
import { arcAt, buildTimeline, stateAt, withPlan } from './timeline.js';

const START = epoch(0);
const HORIZON_S = 6 * 3600;
const HORIZON = epoch(HORIZON_S);

/**
 * Orbits from low to well above geostationary, circular to moderately eccentric.
 *
 * Bounded below section 13.3's full domain on purpose: the point here is the timeline,
 * and an orbit whose periapsis is deep inside the Earth would be exploring the
 * propagator's conditioning instead.
 */
const initialState = fc
  .record({
    semiLatusRectum: fc.double({ min: 8e6, max: 4.2e7, noNaN: true }),
    eccentricity: fc.double({ min: 0, max: 0.5, noNaN: true }),
    inclination: fc.double({ min: 0, max: Math.PI, noNaN: true }),
    raan: fc.double({ min: 0, max: TAU, noNaN: true }),
    argp: fc.double({ min: 0, max: TAU, noNaN: true }),
    trueAnomaly: fc.double({ min: 0, max: TAU, noNaN: true }),
  })
  .map((e): State =>
    stateFromElements(
      {
        semiLatusRectum: metres(e.semiLatusRectum),
        eccentricity: e.eccentricity,
        inclination: radians(e.inclination),
        raan: radians(e.raan),
        argp: radians(e.argp),
        trueAnomaly: radians(e.trueAnomaly),
      },
      MU_EARTH,
    ),
  );

/** Delta-v counts up to 100 m/s a component — a plausible budget, not a stress test. */
const deltaVCounts = fc.tuple(
  fc.integer({ min: -1_000_000, max: 1_000_000 }),
  fc.integer({ min: -1_000_000, max: 1_000_000 }),
  fc.integer({ min: -1_000_000, max: 1_000_000 }),
) as fc.Arbitrary<DeltaVCounts>;

/**
 * A plan of 1 to 12 nodes, generated as tick *gaps* so FR-101's ordering holds by
 * construction rather than by rejection sampling.
 *
 * The first gap is measured from the start epoch and may be zero, which is what puts a
 * node exactly on the start epoch and a zero-length arc 0 into the sample.
 */
const plan = fc
  .tuple(
    fc.integer({ min: 0, max: 600 * EPOCH_TICKS_PER_SECOND }),
    fc.array(
      fc.record({
        gapTicks: fc.integer({
          min: EPOCH_TICKS_PER_SECOND,
          max: 400 * EPOCH_TICKS_PER_SECOND,
        }),
        deltaVCounts,
      }),
      { minLength: 1, maxLength: 12 },
    ),
  )
  .map(([firstTicks, rest]): Plan => {
    const nodes: ManeuverNode[] = [];
    let ticks = firstTicks;

    for (const [i, entry] of rest.entries()) {
      if (i > 0) ticks += entry.gapTicks;
      nodes.push(maneuverNodeFromCounts(ticks, entry.deltaVCounts));
    }
    return createPlan(nodes);
  });

/** Every number a timeline carries, flattened. Compared exactly. */
const fingerprint = (timeline: Timeline) =>
  timeline.arcs
    .map((arc) => [
      arc.startEpoch,
      arc.endEpoch,
      ...V.toArray(arc.state.position),
      ...V.toArray(arc.state.velocity),
    ])
    .concat(
      timeline.impulses.map((impulse) => [
        impulse.epoch,
        ...V.toArray(impulse.before.velocity),
        ...V.toArray(impulse.after.velocity),
      ]),
    );

/**
 * Build, or skip the case.
 *
 * A generated plan can legitimately fail to evaluate — a burn that cancels the
 * transverse velocity leaves a rectilinear state — and that is a result, not a defect.
 * `fc.pre` discards the case rather than asserting a property of a timeline that does
 * not exist.
 */
const timelineOf = (initial: State, p: Plan): Timeline => {
  const result = buildTimeline({
    startEpoch: START,
    initialState: initial,
    plan: p,
    horizon: HORIZON,
    mu: MU_EARTH,
  });
  fc.pre(result.ok);
  return result.timeline;
};

describe('plan evaluation is deterministic in-process', () => {
  it('produces the same floats when the same plan is evaluated twice', () => {
    fc.assert(
      fc.property(initialState, plan, (initial, p) => {
        const once = timelineOf(initial, p);
        const twice = timelineOf(initial, p);

        expect(fingerprint(twice)).toStrictEqual(fingerprint(once));
      }),
    );
  });

  it('produces one more arc than nodes, with boundaries exactly on node epochs', () => {
    fc.assert(
      fc.property(initialState, plan, (initial, p) => {
        const timeline = timelineOf(initial, p);

        expect(timeline.arcs).toHaveLength(p.nodes.length + 1);
        expect(timeline.impulses).toHaveLength(p.nodes.length);
        expect(timeline.arcs.map((arc) => arc.endEpoch)).toStrictEqual([
          ...p.nodes.map((node) => node.epoch),
          HORIZON,
        ]);
        expect(timeline.arcs.map((arc) => arc.startEpoch)).toStrictEqual([
          START,
          ...p.nodes.map((node) => node.epoch),
        ]);
      }),
    );
  });
});

describe('timeline stateAt is continuous across arc boundaries', () => {
  it('approaches the pre-impulse state from the left and returns the post-impulse state at the boundary', () => {
    const offset = 1e-6;

    fc.assert(
      fc.property(initialState, plan, (initial, p) => {
        const timeline = timelineOf(initial, p);

        for (const impulse of timeline.impulses) {
          // At the boundary the answer is exact, not close: the half-open rule hands the
          // instant to the arc that starts there, and that arc's own start epoch is
          // answered by identity.
          const at = stateAt(timeline, impulse.epoch);
          expect(at.converged).toBe(true);
          if (!at.converged) return;
          expect(at.state).toBe(impulse.after);

          // A node may sit on the start epoch, where there is nothing to the left.
          if (impulse.epoch - offset < START) continue;

          const justBefore = stateAt(timeline, epoch(impulse.epoch - offset));
          expect(justBefore.converged).toBe(true);
          if (!justBefore.converged) return;

          // Derived, not tuned: over `offset` seconds the position moves by at most the
          // speed times the offset, and the velocity by the local gravitational
          // acceleration times it. The factor of four is slack for the second-order
          // terms and for a case generated near periapsis.
          const radius = V.norm(impulse.before.position);
          const speed = V.norm(impulse.before.velocity);
          const acceleration = MU_EARTH / (radius * radius);

          expect(V.distance(justBefore.state.position, impulse.before.position)).toBeLessThan(
            4 * speed * offset,
          );
          expect(V.distance(justBefore.state.velocity, impulse.before.velocity)).toBeLessThan(
            4 * acceleration * offset,
          );
        }
      }),
    );
  });

  it('always resolves an epoch to an arc that contains it', () => {
    fc.assert(
      fc.property(
        initialState,
        plan,
        fc.double({ min: 0, max: HORIZON_S, noNaN: true }),
        (initial, p, seconds) => {
          const timeline = timelineOf(initial, p);
          const at = epoch(seconds);

          expect(containsEpoch(arcAt(timeline, at), at)).toBe(true);
        },
      ),
    );
  });
});

describe('incremental re-evaluation equals a full rebuild', () => {
  /** Edits that keep FR-101's ordering without rejection sampling. */
  type Edit =
    | { readonly kind: 'delta-v'; readonly index: number; readonly deltaVCounts: DeltaVCounts }
    | { readonly kind: 'delete'; readonly index: number }
    | { readonly kind: 'append'; readonly deltaVCounts: DeltaVCounts };

  const edit: fc.Arbitrary<Edit> = fc.oneof<fc.Arbitrary<Edit>[]>(
    fc.record({ kind: fc.constant('delta-v' as const), index: fc.nat(), deltaVCounts }),
    fc.record({ kind: fc.constant('delete' as const), index: fc.nat() }),
    fc.record({ kind: fc.constant('append' as const), deltaVCounts }),
  );

  /** `Array.prototype.toSpliced` is ES2023 and the compiler targets ES2022. */
  const spliced = (
    nodes: readonly ManeuverNode[],
    index: number,
    deleteCount: number,
    ...inserted: ManeuverNode[]
  ): ManeuverNode[] => {
    const copy = [...nodes];
    copy.splice(index, deleteCount, ...inserted);
    return copy;
  };

  const applyEdit = (p: Plan, e: Edit): Plan => {
    if (e.kind === 'append') {
      const last = p.nodes.at(-1);
      const ticks = (last?.epochTicks ?? 0) + 600 * EPOCH_TICKS_PER_SECOND;
      fc.pre(ticks <= HORIZON_S * EPOCH_TICKS_PER_SECOND);
      return createPlan([...p.nodes, maneuverNodeFromCounts(ticks, e.deltaVCounts)]);
    }

    const index = e.index % p.nodes.length;
    const target = p.nodes[index];
    if (target === undefined) throw new Error('unreachable: index is taken modulo the length');

    return e.kind === 'delete'
      ? createPlan(spliced(p.nodes, index, 1))
      : createPlan(
          spliced(p.nodes, index, 1, maneuverNodeFromCounts(target.epochTicks, e.deltaVCounts)),
        );
  };

  /** The first index at which two plans differ, or their common length if they do not. */
  const divergence = (a: Plan, b: Plan): number => {
    const common = Math.min(a.nodes.length, b.nodes.length);
    let k = 0;

    while (k < common) {
      const left = a.nodes[k];
      const right = b.nodes[k];
      if (left === undefined || right === undefined) break;
      if (
        left.epochTicks !== right.epochTicks ||
        left.deltaVCounts.some((count, axis) => count !== right.deltaVCounts[axis])
      ) {
        break;
      }
      k += 1;
    }
    return k;
  };

  it('gives the same floats as rebuilding the edited plan from scratch', () => {
    fc.assert(
      fc.property(initialState, plan, edit, (initial, p, e) => {
        const original = timelineOf(initial, p);
        const edited = applyEdit(p, e);

        const incremental = withPlan(original, edited);
        const rebuilt = buildTimeline({
          startEpoch: START,
          initialState: initial,
          plan: edited,
          horizon: HORIZON,
          mu: MU_EARTH,
        });

        // The two must agree about *whether* the edit is evaluable, as well as about the
        // answer. An incremental path that succeeded where a rebuild failed would be
        // reusing something it should have recomputed.
        expect(incremental.ok).toBe(rebuilt.ok);
        if (!incremental.ok || !rebuilt.ok) return;

        expect(fingerprint(incremental.timeline)).toStrictEqual(fingerprint(rebuilt.timeline));
      }),
    );
  });

  it('never rebuilds an arc before the first changed node', () => {
    fc.assert(
      fc.property(initialState, plan, edit, (initial, p, e) => {
        const original = timelineOf(initial, p);
        const edited = applyEdit(p, e);
        const result = withPlan(original, edited);
        fc.pre(result.ok);

        // Everything before the first changed node must be the same object, not merely
        // an equal one — that is what "did not recompute" means.
        for (let i = 0; i < divergence(p, edited); i++) {
          expect(result.timeline.arcs[i]).toBe(original.arcs[i]);
          expect(result.timeline.impulses[i]).toBe(original.impulses[i]);
        }
      }),
    );
  });
});
