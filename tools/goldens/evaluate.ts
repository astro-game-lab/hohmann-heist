/**
 * Evaluating a golden case, and the record that comes out of it.
 *
 * Shared by `goldens.test.ts`, which re-evaluates every case and compares, and by the
 * writer the same file runs under `pnpm goldens:write`. One evaluation path, so the
 * file on disk and the file the test builds cannot be produced differently.
 *
 * ## What is recorded, and what is left out because it is derivable
 *
 * A timeline's arcs each carry a state, and every one of those states except the first
 * is also an impulse's `after`. Recording both would double the size of the fixture
 * file for no additional coverage — a change that moved one would move the other, and
 * a reviewer reading the diff would have to check the same numbers twice. So arcs
 * contribute their **boundaries** and nothing else, which is the part impulses do not
 * carry, and the states come from `initial`, the impulses, and the samples.
 *
 * ## Two comparisons, because there are two kinds of number here
 *
 * **Epochs are compared exactly.** Every epoch in a timeline comes from a tick count
 * divided by 1024, which is a binary exponent shift and therefore exact — see
 * `packages/sim/src/quantise.ts`. A difference of one ulp in an arc boundary is not
 * round-off, it is a change in how boundaries are computed, and a tolerance there
 * would hide exactly that.
 *
 * **States are compared on the norm of the difference, relative to the norm of the
 * vector**, not component by component. §7.6's "1e-9 relative" is a statement about a
 * position, and a position is a vector: an equatorial orbit's `z` is zero up to
 * cancellation, so a per-component relative test on it compares two kinds of noise and
 * fails on a number that carries no information. The norm-relative form asks the
 * question §7.6 means — *has this state moved* — and answers it in metres against
 * metres.
 */
import type { Epoch, State } from '@hh/astro';
import { stateFromElements } from '@hh/astro';
import type { Timeline } from '@hh/sim';
import {
  buildTimeline,
  createPlan,
  fromEpochTicks,
  maneuverNodeFromCounts,
  stateAt,
} from '@hh/sim';

import type { GoldenCase } from './cases.js';
import { sampleTicks } from './cases.js';

/** A 3-vector as it appears in the fixture file. */
export type Triple = readonly [number, number, number];

/** A state as it appears in the fixture file: position then velocity, both in SI. */
export interface RecordedState {
  readonly r: Triple;
  readonly v: Triple;
}

/** One impulse: the states either side of it and the inertial Δv between them. */
export interface RecordedImpulse {
  readonly epoch: number;
  readonly before: RecordedState;
  readonly after: RecordedState;
  readonly dvEci: Triple;
}

/** One `stateAt` lookup at a fixed epoch. */
export interface RecordedSample {
  readonly ticks: number;
  readonly r: Triple;
  readonly v: Triple;
}

/** Everything a golden case evaluates to. */
export interface GoldenRecord {
  readonly id: string;
  readonly description: string;
  readonly mu: number;
  readonly startTicks: number;
  readonly horizonTicks: number;
  readonly nodes: readonly (readonly number[])[];
  /** The state the timeline was evaluated from. */
  readonly initial: RecordedState;
  /** Arc boundaries, in seconds, in order. `arcs.length === nodes.length + 1`, always. */
  readonly arcs: readonly (readonly [start: number, end: number])[];
  readonly impulses: readonly RecordedImpulse[];
  readonly samples: readonly RecordedSample[];
}

const triple = (v: { readonly x: number; readonly y: number; readonly z: number }): Triple => [
  v.x,
  v.y,
  v.z,
];

const recordState = (state: State): RecordedState => ({
  r: triple(state.position),
  v: triple(state.velocity),
});

/** Build the timeline a case describes. Throws rather than returning, because a fixture that cannot be evaluated is a broken fixture. */
export const timelineFor = (test: GoldenCase): Timeline => {
  const plan = createPlan(
    test.nodes.map(([epochTicks, radial, transverse, normal]) =>
      maneuverNodeFromCounts(epochTicks, [radial, transverse, normal]),
    ),
  );

  const result = buildTimeline({
    startEpoch: fromEpochTicks(test.startTicks),
    initialState: stateFromElements(test.elements, test.mu),
    plan,
    horizon: fromEpochTicks(test.horizonTicks),
    mu: test.mu,
  });

  if (!result.ok) {
    throw new Error(
      `golden case "${test.id}" does not evaluate: ${result.reason} at node ${String(result.nodeIndex)}. ` +
        'A case in the set must be a plan the engine can evaluate; fix the case, not the tolerance.',
    );
  }
  return result.timeline;
};

/** Evaluate one case into the record that goes in — or is compared against — the fixture file. */
export const evaluateCase = (test: GoldenCase): GoldenRecord => {
  const timeline = timelineFor(test);

  const samples = sampleTicks(test).map((ticks): RecordedSample => {
    const at: Epoch = fromEpochTicks(ticks);
    const result = stateAtOrThrow(timeline, at, test.id);
    return { ticks, r: triple(result.position), v: triple(result.velocity) };
  });

  return {
    id: test.id,
    description: test.description,
    mu: test.mu,
    startTicks: test.startTicks,
    horizonTicks: test.horizonTicks,
    nodes: test.nodes.map((node) => [...node]),
    initial: recordState(timeline.initialState),
    arcs: timeline.arcs.map((arc) => [arc.startEpoch, arc.endEpoch] as const),
    impulses: timeline.impulses.map((impulse) => ({
      epoch: impulse.epoch,
      before: recordState(impulse.before),
      after: recordState(impulse.after),
      dvEci: triple(impulse.deltaVEci),
    })),
    samples,
  };
};

const stateAtOrThrow = (timeline: Timeline, at: Epoch, id: string): State => {
  const result = stateAt(timeline, at);
  if (!result.converged) {
    throw new Error(
      `golden case "${id}" failed to evaluate at epoch ${String(at)} s: the propagation did not ` +
        'converge. A non-convergent sample cannot be a golden value.',
    );
  }
  return result.state;
};

/**
 * `|a − b| / max(|a|, |b|)`, on whole vectors.
 *
 * Zero when both are the zero vector, which is the honest answer for a zero-Δv node's
 * inertial impulse: there is no relative difference between two exact zeroes, and a
 * division would say `NaN` and fail the case for being right.
 */
export const vectorDifference = (a: Triple, b: Triple): number => {
  const difference = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const scale = Math.max(Math.hypot(...a), Math.hypot(...b));
  if (scale === 0) return difference === 0 ? 0 : Number.POSITIVE_INFINITY;
  return difference / scale;
};
