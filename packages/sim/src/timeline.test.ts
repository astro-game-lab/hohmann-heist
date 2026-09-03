import type { Epoch, State } from '@hh/astro';
import type { MetresPerSec } from '@hh/math';
import { MU_EARTH, eci, epoch, rtn, stateFromElements } from '@hh/astro';
import { metres, metresPerSec, radians, V } from '@hh/math';
import { stateAt as stateOnArc } from '@hh/propagation';
import { describe, expect, it } from 'vitest';

import { applyImpulse } from './maneuver.js';
import type { ManeuverNode, Plan } from './plan.js';
import { createManeuverNode, createPlan, EMPTY_PLAN, maneuverNodeFromCounts } from './plan.js';
import { fromDeltaVCounts } from './quantise.js';
import type { Timeline, TimelineResult } from './timeline.js';
import {
  arcAt,
  arcIndexAt,
  buildTimeline,
  EpochOutOfHorizonError,
  stateAt,
  withPlan,
} from './timeline.js';

/**
 * Narrow away `undefined`, failing the test rather than asserting it away.
 *
 * `noUncheckedIndexedAccess` is on and the lint config forbids both `!` and the widening
 * cast, which is correct for source and merely noisy in a test that has just built the
 * array it is indexing.
 */
const definitely = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error('expected a value, got undefined');
  return value;
};

const START = epoch(0);
/** Six hours: long enough for several revolutions, short enough to stay quick. */
const HORIZON = epoch(6 * 3600);

/** A 400 km circular orbit at ISS inclination — the shape most contracts actually have. */
const LEO: State = stateFromElements(
  {
    semiLatusRectum: metres(6_778_137),
    eccentricity: 0,
    inclination: radians(0.9006),
    raan: radians(1.1),
    argp: radians(0),
    trueAnomaly: radians(0.6),
  },
  MU_EARTH,
);

const dv = (radial: number, transverse: number, normal: number) =>
  rtn(V.vec3<MetresPerSec>(metresPerSec(radial), metresPerSec(transverse), metresPerSec(normal)));

const nodeAt = (seconds: number, transverse = 25, radial = 0, normal = 0): ManeuverNode =>
  createManeuverNode({ epoch: epoch(seconds), deltaVRtn: dv(radial, transverse, normal) });

const built = (result: TimelineResult): Timeline => {
  if (!result.ok) {
    throw new Error(
      `expected a timeline, got ${result.reason} at node ${String(result.nodeIndex)}`,
    );
  }
  return result.timeline;
};

const timelineFor = (plan: Plan, horizon: Epoch = HORIZON): Timeline =>
  built(buildTimeline({ startEpoch: START, initialState: LEO, plan, horizon, mu: MU_EARTH }));

/**
 * Every number a timeline carries, flattened.
 *
 * Compared with `toStrictEqual`, which is exact on numbers — so "identical to a full
 * rebuild" is asserted as identity and not as closeness. A tolerance here would let a
 * genuinely different incremental answer through, which is the failure #69 exists to
 * catch.
 */
const fingerprint = (timeline: Timeline) => ({
  arcs: timeline.arcs.map((arc) => [
    arc.startEpoch,
    arc.endEpoch,
    ...V.toArray(arc.state.position),
    ...V.toArray(arc.state.velocity),
  ]),
  impulses: timeline.impulses.map((impulse) => [
    impulse.nodeIndex,
    impulse.epoch,
    ...V.toArray(impulse.before.position),
    ...V.toArray(impulse.before.velocity),
    ...V.toArray(impulse.after.velocity),
    ...V.toArray(impulse.deltaVEci),
  ]),
});

const THREE_NODES = createPlan([nodeAt(600), nodeAt(2400), nodeAt(5400)]);

describe('buildTimeline — structure (FR-102)', () => {
  it('turns an empty plan into a single coasting arc, not a special case', () => {
    const timeline = timelineFor(EMPTY_PLAN);

    expect(timeline.arcs).toHaveLength(1);
    expect(timeline.impulses).toHaveLength(0);

    const only = definitely(timeline.arcs[0]);
    expect(only.startEpoch).toBe(START);
    expect(only.endEpoch).toBe(HORIZON);
    expect(only.state).toBe(LEO);
  });

  it('alternates arcs and impulses, one more arc than nodes', () => {
    const timeline = timelineFor(THREE_NODES);

    expect(timeline.arcs).toHaveLength(THREE_NODES.nodes.length + 1);
    expect(timeline.impulses).toHaveLength(THREE_NODES.nodes.length);
    expect(timeline.impulses.map((impulse) => impulse.nodeIndex)).toStrictEqual([0, 1, 2]);
  });

  it('places arc boundaries exactly on node epochs', () => {
    const timeline = timelineFor(THREE_NODES);

    // `toBe`, not `toBeCloseTo`: a boundary that merely agrees to round-off would put
    // an epoch in two arcs or in neither, and the half-open rule would stop meaning
    // anything. Node epochs are ticks and arcs are built from them directly, so there
    // is no arithmetic here to lose.
    for (const [i, node] of THREE_NODES.nodes.entries()) {
      expect(definitely(timeline.arcs[i]).endEpoch).toBe(node.epoch);
      expect(definitely(timeline.arcs[i + 1]).startEpoch).toBe(node.epoch);
      expect(definitely(timeline.impulses[i]).epoch).toBe(node.epoch);
    }
    expect(definitely(timeline.arcs[0]).startEpoch).toBe(START);
  });

  it('runs the last arc out to the horizon', () => {
    const timeline = timelineFor(THREE_NODES);
    const last = definitely(timeline.arcs.at(-1));

    expect(last.endEpoch).toBe(HORIZON);
    expect(last.startEpoch).toBe(definitely(THREE_NODES.nodes.at(-1)).epoch);
  });

  it('starts each arc from the post-impulse state, by identity', () => {
    const timeline = timelineFor(THREE_NODES);

    for (const [i, impulse] of timeline.impulses.entries()) {
      expect(definitely(timeline.arcs[i + 1]).state).toBe(impulse.after);
    }
  });

  it('records the inertial delta-v the burn actually applied', () => {
    const timeline = timelineFor(THREE_NODES);

    for (const impulse of timeline.impulses) {
      // FR-006: an impulse changes velocity and nothing else, so the position either
      // side is the same object rather than the same number.
      expect(impulse.after.position).toBe(impulse.before.position);
      expect(V.toArray(impulse.deltaVEci)).toStrictEqual(
        V.toArray(V.sub(impulse.after.velocity, impulse.before.velocity)),
      );
      // The RTN burn was 25 m/s transverse; the inertial vector it became has the same
      // magnitude, because the RTN basis is orthonormal.
      expect(V.norm(impulse.deltaVEci)).toBeCloseTo(25, 9);
    }
  });

  it('accepts a node exactly on the start epoch, producing a zero-length first arc', () => {
    const timeline = timelineFor(createPlan([nodeAt(0), nodeAt(1200)]));
    const first = definitely(timeline.arcs[0]);

    expect(first.startEpoch).toBe(START);
    expect(first.endEpoch).toBe(START);
    expect(definitely(timeline.impulses[0]).before).toBe(LEO);
  });

  it('accepts a node exactly on the horizon, producing a zero-length last arc', () => {
    const timeline = timelineFor(createPlan([nodeAt(6 * 3600)]));
    const last = definitely(timeline.arcs.at(-1));

    expect(last.startEpoch).toBe(HORIZON);
    expect(last.endEpoch).toBe(HORIZON);
  });
});

describe('buildTimeline — purity and determinism (§11.4)', () => {
  it('produces bit-identical results when run twice in-process', () => {
    // Not "agrees to 1e-12". Construction reads no clock and no ambient randomness, so
    // the same inputs must give the same floats — and if they ever do not, something
    // has smuggled state into a fold that is supposed to be a pure function.
    expect(fingerprint(timelineFor(THREE_NODES))).toStrictEqual(
      fingerprint(timelineFor(THREE_NODES)),
    );
  });

  it('is a function of the plan values, not of the plan object', () => {
    const rebuilt = createPlan(
      THREE_NODES.nodes.map((node) => maneuverNodeFromCounts(node.epochTicks, node.deltaVCounts)),
    );

    expect(rebuilt).not.toBe(THREE_NODES);
    expect(fingerprint(timelineFor(rebuilt))).toStrictEqual(fingerprint(timelineFor(THREE_NODES)));
  });

  it('does not modify the plan or the initial state it was given', () => {
    const before = fingerprint(timelineFor(THREE_NODES));
    timelineFor(THREE_NODES);

    expect(THREE_NODES.nodes).toHaveLength(3);
    expect(V.toArray(LEO.position)).toStrictEqual(
      V.toArray(definitely(timelineFor(EMPTY_PLAN).arcs[0]).state.position),
    );
    expect(fingerprint(timelineFor(THREE_NODES))).toStrictEqual(before);
  });

  it('freezes what it returns', () => {
    const timeline = timelineFor(THREE_NODES);

    expect(Object.isFrozen(timeline)).toBe(true);
    expect(Object.isFrozen(timeline.arcs)).toBe(true);
    expect(Object.isFrozen(timeline.impulses)).toBe(true);
    expect(Object.isFrozen(definitely(timeline.impulses[0]))).toBe(true);
  });
});

describe('buildTimeline — caller errors throw', () => {
  const build = (spec: {
    plan?: Plan;
    startEpoch?: Epoch;
    horizon?: Epoch;
    mu?: number;
    initialState?: State;
  }): TimelineResult =>
    buildTimeline({
      startEpoch: spec.startEpoch ?? START,
      initialState: spec.initialState ?? LEO,
      plan: spec.plan ?? EMPTY_PLAN,
      horizon: spec.horizon ?? HORIZON,
      mu: spec.mu ?? MU_EARTH,
    });

  it('rejects a horizon before the start epoch', () => {
    expect(() => build({ horizon: epoch(-1) })).toThrow(RangeError);
    expect(() => build({ horizon: epoch(-1) })).toThrow(/before its start epoch/);
  });

  it('rejects non-finite epochs', () => {
    expect(() => build({ horizon: epoch(Number.POSITIVE_INFINITY) })).toThrow(/must be finite/);
    expect(() => build({ startEpoch: epoch(Number.NaN) })).toThrow(/must be finite/);
  });

  it('rejects a node outside the horizon, naming the node', () => {
    expect(() => build({ plan: createPlan([nodeAt(-60)]) })).toThrow(
      /plan node 0 at -60 s lies outside/,
    );
    expect(() => build({ plan: createPlan([nodeAt(600), nodeAt(6 * 3600 + 1)]) })).toThrow(
      /plan node 1 .* lies outside/,
    );
  });

  it('rejects a gravitational parameter that is not finite and positive', () => {
    expect(() => build({ mu: 0 })).toThrow(RangeError);
    expect(() => build({ mu: Number.POSITIVE_INFINITY })).toThrow(RangeError);
  });

  it('rejects a rectilinear initial state', () => {
    const radial: State = {
      position: eci(V.vec3(metres(7e6), metres(0), metres(0))),
      velocity: eci(V.vec3(metresPerSec(1000), metresPerSec(0), metresPerSec(0))),
    };

    expect(() => build({ initialState: radial })).toThrow(/cannot be rectilinear/);
  });
});

describe('buildTimeline — data-dependent failures come back as values', () => {
  it('reports a burn that leaves the state rectilinear', () => {
    // Built so the cancellation is exact rather than nearly so: the node sits on the
    // start epoch, so the burn is applied to `state` itself with no propagation in
    // between, and the RTN basis for a state along +x moving along +y is a permutation
    // of the identity — every product in the rotation is with 0 or 1. The transverse
    // speed and the burn come from the same count, so their sum is exactly zero.
    const transverse = fromDeltaVCounts(75_000_000);
    const state: State = {
      position: eci(V.vec3(metres(7e6), metres(0), metres(0))),
      velocity: eci(V.vec3(metresPerSec(0), transverse, metresPerSec(0))),
    };

    const result = buildTimeline({
      startEpoch: START,
      initialState: state,
      plan: createPlan([maneuverNodeFromCounts(0, [0, -75_000_000, 0])]),
      horizon: HORIZON,
      mu: MU_EARTH,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('rectilinear');
    expect(result.nodeIndex).toBe(0);
  });

  it('reports a propagation that did not converge, rather than a plausible state', () => {
    // No plan reaches this — see the module docstring for what was tried. A central
    // body this light does: `v^2 / mu` overflows in the energy integral, the residual
    // stops being finite, and the bracketed fallback has nothing to straddle. What is
    // asserted here is the handling, not the physics.
    const result = buildTimeline({
      startEpoch: START,
      initialState: LEO,
      plan: createPlan([nodeAt(600)]),
      horizon: HORIZON,
      mu: 1e-200,
    });

    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== 'non-convergent') {
      throw new Error('expected a non-convergent failure');
    }
    expect(result.nodeIndex).toBe(0);
    expect(result.propagation.converged).toBe(false);
    expect(result.propagation.reason).toBe('out-of-domain');
  });
});

describe('arcIndexAt and stateAt (FR-103)', () => {
  const timeline = timelineFor(THREE_NODES);

  it('returns the initial state at the start epoch, by identity', () => {
    const result = stateAt(timeline, START);

    expect(result.converged).toBe(true);
    if (!result.converged) return;
    // Zero elapsed time is answered by identity, not to within round-off.
    expect(result.state).toBe(LEO);
  });

  it('finds the owning arc for epochs strictly inside each span', () => {
    expect(arcIndexAt(timeline, epoch(1))).toBe(0);
    expect(arcIndexAt(timeline, epoch(1200))).toBe(1);
    expect(arcIndexAt(timeline, epoch(3000))).toBe(2);
    expect(arcIndexAt(timeline, epoch(20_000))).toBe(3);
  });

  it('gives a node epoch to the arc that starts there, not the one that ends there', () => {
    // The half-open rule `[start, end)` that `events.ts` fixes for exactly this
    // structure. Stated as an outcome: evaluating at a node returns the post-impulse
    // state.
    for (const [i, node] of THREE_NODES.nodes.entries()) {
      expect(arcIndexAt(timeline, node.epoch)).toBe(i + 1);

      const result = stateAt(timeline, node.epoch);
      expect(result.converged).toBe(true);
      if (!result.converged) return;
      expect(result.state).toBe(definitely(timeline.impulses[i]).after);
    }
  });

  it('never selects a zero-length first arc', () => {
    const degenerate = timelineFor(createPlan([nodeAt(0), nodeAt(1200)]));

    expect(arcIndexAt(degenerate, START)).toBe(1);
    const result = stateAt(degenerate, START);
    expect(result.converged).toBe(true);
    if (!result.converged) return;
    expect(result.state).toBe(definitely(degenerate.impulses[0]).after);
  });

  it('evaluates at the horizon, which the last arc closes over', () => {
    expect(arcIndexAt(timeline, HORIZON)).toBe(timeline.arcs.length - 1);
    expect(stateAt(timeline, HORIZON).converged).toBe(true);
  });

  it('is exactly the owning arc propagated to that epoch, and nothing else', () => {
    // A timeline lookup adds a search to a propagation; it must not add arithmetic.
    // Compared bit-for-bit against `@hh/propagation` doing the same call on the arc the
    // search found.
    for (const at of [epoch(1), epoch(1200), epoch(3000), epoch(20_000)]) {
      const arc = arcAt(timeline, at);
      expect(arc).toBe(definitely(timeline.arcs[arcIndexAt(timeline, at)]));

      const viaTimeline = stateAt(timeline, at);
      const viaArc = stateOnArc(arc, at, timeline.options);
      expect(viaTimeline.converged).toBe(true);
      expect(viaArc.converged).toBe(true);
      if (!viaTimeline.converged || !viaArc.converged) return;

      expect(V.toArray(viaTimeline.state.position)).toStrictEqual(V.toArray(viaArc.state.position));
      expect(V.toArray(viaTimeline.state.velocity)).toStrictEqual(V.toArray(viaArc.state.velocity));
    }
  });

  it('is continuous across an arc boundary, to the bound the geometry sets', () => {
    const node = definitely(THREE_NODES.nodes[1]);
    const impulse = definitely(timeline.impulses[1]);
    const offset = 1e-6;

    const justBefore = stateAt(timeline, epoch(node.epoch - offset));
    expect(justBefore.converged).toBe(true);
    if (!justBefore.converged) return;

    // The tolerance is derived, not tuned. Over `offset` seconds the position can move
    // by at most the speed times the offset and the velocity by the local gravitational
    // acceleration times it; the factor of two is slack for the second-order terms.
    const radius = V.norm(impulse.before.position);
    const speed = V.norm(impulse.before.velocity);
    const acceleration = MU_EARTH / (radius * radius);

    expect(V.distance(justBefore.state.position, impulse.before.position)).toBeLessThan(
      2 * speed * offset,
    );
    expect(V.distance(justBefore.state.velocity, impulse.before.velocity)).toBeLessThan(
      2 * acceleration * offset,
    );
  });

  it('rejects epochs outside the horizon rather than extrapolating', () => {
    for (const outside of [epoch(-1), epoch(6 * 3600 + 1), epoch(Number.NaN)]) {
      expect(() => stateAt(timeline, outside)).toThrow(EpochOutOfHorizonError);
      expect(() => arcIndexAt(timeline, outside)).toThrow(EpochOutOfHorizonError);
    }
  });

  it('carries the bounds on the error, so a caller can clamp without parsing a message', () => {
    // The reason this is its own class rather than a bare `RangeError`: a scrubber that
    // ran past the deadline needs to know where the wall is.
    try {
      stateAt(timeline, epoch(6 * 3600 + 5));
      throw new Error('expected a throw');
    } catch (error) {
      expect(error).toBeInstanceOf(EpochOutOfHorizonError);
      // Still a RangeError, so anything already catching one is not surprised.
      expect(error).toBeInstanceOf(RangeError);
      if (!(error instanceof EpochOutOfHorizonError)) return;
      expect(error.name).toBe('EpochOutOfHorizonError');
      expect(error.epoch).toBe(6 * 3600 + 5);
      expect(error.startEpoch).toBe(START);
      expect(error.horizon).toBe(HORIZON);
    }
  });
});

describe('withPlan — incremental re-evaluation (FR-104)', () => {
  const original = timelineFor(THREE_NODES);

  /** The arcs and impulses that survived the edit, as reference identities. */
  const reused = (before: Timeline, after: Timeline): number => {
    let count = 0;
    for (const [i, arc] of before.arcs.entries()) {
      if (after.arcs[i] !== arc) break;
      count += 1;
    }
    return count;
  };

  it('returns the very same timeline when nothing changed', () => {
    const result = withPlan(original, THREE_NODES);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.timeline).toBe(original);
  });

  it('recognises an equal plan built from different objects', () => {
    const equal = createPlan(
      THREE_NODES.nodes.map((node) => maneuverNodeFromCounts(node.epochTicks, node.deltaVCounts)),
    );
    const result = withPlan(original, equal);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.timeline).toBe(original);
  });

  it('reuses arcs before k by reference and recomputes k through n', () => {
    // The assertion FR-104 actually asks for: not "the answer is right", but "these
    // arcs were not touched". Reference identity is the only way to observe that
    // without instrumenting the fold, and it is stronger than a counter — a rebuilt
    // arc with equal values would still fail it.
    const edited = createPlan([nodeAt(600), nodeAt(2400, 60), nodeAt(5400)]);
    const result = built(withPlan(original, edited));

    expect(definitely(result.arcs[0])).toBe(definitely(original.arcs[0]));
    expect(definitely(result.impulses[0])).toBe(definitely(original.impulses[0]));

    for (const k of [1, 2, 3]) {
      expect(definitely(result.arcs[k])).not.toBe(definitely(original.arcs[k]));
    }
    for (const k of [1, 2]) {
      expect(definitely(result.impulses[k])).not.toBe(definitely(original.impulses[k]));
    }
    expect(reused(original, result)).toBe(1);
  });

  it('reuses everything before the last node when the last node moves', () => {
    const edited = createPlan([nodeAt(600), nodeAt(2400), nodeAt(5400, 90)]);
    const result = built(withPlan(original, edited));

    expect(reused(original, result)).toBe(2);
    expect(definitely(result.arcs[3])).not.toBe(definitely(original.arcs[3]));
  });

  it('recomputes everything when the first node changes', () => {
    const edited = createPlan([nodeAt(600, 40), nodeAt(2400), nodeAt(5400)]);
    const result = built(withPlan(original, edited));

    expect(reused(original, result)).toBe(0);
  });

  it.each([
    ['a node moved in time', createPlan([nodeAt(600), nodeAt(3000), nodeAt(5400)])],
    ['a node changed in delta-v', createPlan([nodeAt(600), nodeAt(2400, 60), nodeAt(5400)])],
    ['a node inserted', createPlan([nodeAt(600), nodeAt(1500), nodeAt(2400), nodeAt(5400)])],
    ['a node deleted', createPlan([nodeAt(600), nodeAt(5400)])],
    ['the last node deleted', createPlan([nodeAt(600), nodeAt(2400)])],
    ['a node appended', createPlan([nodeAt(600), nodeAt(2400), nodeAt(5400), nodeAt(9000)])],
    ['every node deleted', EMPTY_PLAN],
  ])('is identical to a full rebuild after %s', (_label, edited) => {
    // The failure mode #69 exists to prevent is a *fast wrong answer*. Only this
    // comparison catches it, which is why it runs against every edit shape rather than
    // against one.
    const incremental = built(withPlan(original, edited));

    expect(fingerprint(incremental)).toStrictEqual(fingerprint(timelineFor(edited)));
    expect(incremental.plan).toBe(edited);
    expect(incremental.arcs).toHaveLength(edited.nodes.length + 1);
    expect(incremental.impulses).toHaveLength(edited.nodes.length);
  });

  it('takes the same incremental path for insert and delete as for a move', () => {
    // Insert at index 1 and delete at index 1 both diverge at 1, so both keep exactly
    // arc 0. Nothing in the implementation asks which edit happened, and this is what
    // says so.
    const inserted = built(
      withPlan(original, createPlan([nodeAt(600), nodeAt(1500), nodeAt(2400), nodeAt(5400)])),
    );
    const deleted = built(withPlan(original, createPlan([nodeAt(600), nodeAt(5400)])));

    expect(reused(original, inserted)).toBe(1);
    expect(reused(original, deleted)).toBe(1);
    expect(definitely(inserted.impulses[0])).toBe(definitely(original.impulses[0]));
    expect(definitely(deleted.impulses[0])).toBe(definitely(original.impulses[0]));
  });

  it('leaves the original timeline untouched', () => {
    const before = fingerprint(original);
    built(withPlan(original, createPlan([nodeAt(600, 99), nodeAt(2400), nodeAt(5400)])));

    expect(fingerprint(original)).toStrictEqual(before);
    expect(original.plan).toBe(THREE_NODES);
  });

  it('carries the horizon, initial state and tuning through unchanged', () => {
    const result = built(withPlan(original, createPlan([nodeAt(900)])));

    expect(result.startEpoch).toBe(original.startEpoch);
    expect(result.horizon).toBe(original.horizon);
    expect(result.initialState).toBe(original.initialState);
    expect(result.mu).toBe(original.mu);
    expect(result.options).toBe(original.options);
  });

  it('rejects an edited node that has left the horizon', () => {
    expect(() => withPlan(original, createPlan([nodeAt(600), nodeAt(6 * 3600 + 60)]))).toThrow(
      /lies outside/,
    );
  });

  it('reports a failure from the recomputed part without corrupting the original', () => {
    const transverse = fromDeltaVCounts(75_000_000);
    const state: State = {
      position: eci(V.vec3(metres(7e6), metres(0), metres(0))),
      velocity: eci(V.vec3(metresPerSec(0), transverse, metresPerSec(0))),
    };
    const seed = built(
      buildTimeline({
        startEpoch: START,
        initialState: state,
        plan: createPlan([maneuverNodeFromCounts(0, [0, 1000, 0])]),
        horizon: HORIZON,
        mu: MU_EARTH,
      }),
    );

    const result = withPlan(seed, createPlan([maneuverNodeFromCounts(0, [0, -75_000_000, 0])]));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('rectilinear');
    expect(seed.arcs).toHaveLength(2);
  });
});

describe('withPlan — the states it produces', () => {
  it('applies the edited burn to the state the earlier arcs left', () => {
    const original = timelineFor(THREE_NODES);
    const edited = createPlan([nodeAt(600), nodeAt(2400, 60), nodeAt(5400)]);
    const result = built(withPlan(original, edited));

    // Arc 1 is untouched by an edit at node 1, so the pre-impulse state is the same
    // state the original computed — and the post-impulse one is that state with the new
    // burn on it, which is checkable without going through the timeline at all.
    const impulse = definitely(result.impulses[1]);
    expect(V.toArray(impulse.before.velocity)).toStrictEqual(
      V.toArray(definitely(original.impulses[1]).before.velocity),
    );
    expect(V.toArray(impulse.after.velocity)).toStrictEqual(
      V.toArray(applyImpulse(impulse.before, definitely(edited.nodes[1]).deltaVRtn).velocity),
    );
  });

  it('scrubbing an edited timeline agrees with scrubbing a rebuilt one', () => {
    const original = timelineFor(THREE_NODES);
    const edited = createPlan([nodeAt(600), nodeAt(3000, 40), nodeAt(5400)]);
    const incremental = built(withPlan(original, edited));
    const rebuilt = timelineFor(edited);

    for (const at of [0, 601, 2999, 3000, 5400, 12_000, 21_600]) {
      const a = stateAt(incremental, epoch(at));
      const b = stateAt(rebuilt, epoch(at));
      expect(a.converged).toBe(true);
      expect(b.converged).toBe(true);
      if (!a.converged || !b.converged) return;
      expect(V.toArray(a.state.position)).toStrictEqual(V.toArray(b.state.position));
      expect(V.toArray(a.state.velocity)).toStrictEqual(V.toArray(b.state.velocity));
    }
  });
});
