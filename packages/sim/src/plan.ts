/**
 * `Plan` and `ManeuverNode` — what the player actually authors.
 *
 * A plan is an ordered list of impulses. FR-101 fixes its shape: nodes are
 * `(epoch, Δv_rtn)`, epochs strictly increase, and consecutive nodes are at least one
 * second apart. FR-105 fixes when quantisation happens — **at the moment of entry**,
 * so that the stored plan is exactly what was played rather than a rounding of it
 * discovered later.
 *
 * ## A node holds its counts, not just its quantities
 *
 * Quantisation is only worth something if it cannot be undone by accident. If a node
 * stored `epoch: Epoch` and `deltaVRtn: RtnVector` alone, every later consumer would
 * have to re-derive the counts to serialise or compare, and every one of them would
 * be an opportunity to re-quantise a value that had drifted a half-ulp in the
 * meantime — which is precisely the "applied once at entry, never re-applied
 * downstream" failure FR-105 is written to prevent.
 *
 * So a node carries both, and they cannot disagree: the integer counts are computed
 * once in {@link createManeuverNode}, and the branded SI values are *derived from the
 * counts*, not from the caller's arguments. Handing in an epoch of 12.3456789 s
 * produces a node whose `epoch` reads 12.345703125 — the tick it actually is — rather
 * than politely remembering the number that was asked for. That is what makes
 * quantisation idempotent by construction: re-quantising a node's own `epoch` cannot
 * move it, because that value came out of the tick in the first place.
 *
 * ## Why the spacing rule is an integer comparison
 *
 * FR-101's "≥ 1 s apart" is checked on tick counts, not on seconds. Two nodes 1 s
 * apart differ by exactly 1024 ticks; the float subtraction `t₂ − t₁` for epochs near
 * 8.6e8 s loses roughly 1e-7 s to cancellation, which is enough to make a plan that
 * validates on one runtime fail on another. Integers do not have that problem, and
 * the boundary case — exactly 1 s — is the one a player editing a tight sequence will
 * actually land on.
 *
 * ## What a plan is not
 *
 * It is not a timeline. There are no arcs here, no propagation, and no state: a plan
 * is the input, and a timeline (#67–#69) is what evaluating it produces. It also
 * carries no start epoch — node epochs are absolute, per FR-101 — which is why
 * serialisation has to be told the scenario's origin explicitly rather than reading
 * it off the plan.
 */
import type { Epoch, RtnVector } from '@hh/astro';
import { rtn } from '@hh/astro';
import type { MetresPerSec } from '@hh/math';
import { V } from '@hh/math';

import {
  EPOCH_TICKS_PER_SECOND,
  fromDeltaVCounts,
  fromEpochTicks,
  toDeltaVCounts,
  toEpochTicks,
} from './quantise.js';

/**
 * Minimum separation between consecutive nodes, in seconds (FR-101).
 *
 * A game-facing floor rather than a physical one — nothing in the propagator objects
 * to two impulses 10 ms apart — so it belongs to the plan's contract, which is where
 * FR-101 puts it.
 */
export const MINIMUM_NODE_SPACING_S = 1;

/** {@link MINIMUM_NODE_SPACING_S} in epoch ticks. The form the check actually uses. */
export const MINIMUM_NODE_SPACING_TICKS = MINIMUM_NODE_SPACING_S * EPOCH_TICKS_PER_SECOND;

/**
 * Quantised delta-v, as integer counts of 1e-4 m/s in RTN order: radial, transverse,
 * normal. The same axis order as {@link RtnVector}'s `x`, `y`, `z`.
 *
 * Note this is *not* the order the replay format writes — §11.6 puts the transverse
 * component first and calls it `pr`. The reordering happens in `replay.ts`, once.
 */
export type DeltaVCounts = readonly [radial: number, transverse: number, normal: number];

/** One impulse in a plan. Frozen; derive a new one rather than reaching for a setter. */
export interface ManeuverNode {
  /** Epoch in whole ticks of 1/1024 s. The node's canonical identity (DEP-09). */
  readonly epochTicks: number;
  /** Delta-v in whole counts of 1e-4 m/s, RTN order. The node's canonical identity. */
  readonly deltaVCounts: DeltaVCounts;
  /** The epoch those ticks stand for. Derived, never independently supplied. */
  readonly epoch: Epoch;
  /** The delta-v those counts stand for, in the RTN frame of the state at `epoch`. */
  readonly deltaVRtn: RtnVector<MetresPerSec>;
}

/** What a node is authored from, before quantisation. */
export interface ManeuverNodeSpec {
  readonly epoch: Epoch;
  readonly deltaVRtn: RtnVector<MetresPerSec>;
}

/** A plan: an ordered list of impulses. Frozen. */
export interface Plan {
  readonly nodes: readonly ManeuverNode[];
}

const node = (epochTicks: number, deltaVCounts: DeltaVCounts): ManeuverNode =>
  Object.freeze({
    epochTicks,
    deltaVCounts,
    epoch: fromEpochTicks(epochTicks),
    deltaVRtn: rtn(
      V.vec3(
        fromDeltaVCounts(deltaVCounts[0]),
        fromDeltaVCounts(deltaVCounts[1]),
        fromDeltaVCounts(deltaVCounts[2]),
      ),
    ),
  });

/**
 * Build a node, quantising at entry (FR-105).
 *
 * The returned node's `epoch` and `deltaVRtn` are derived from the counts, so they
 * are the quantised values and not the arguments. A caller that needs to know what
 * was rounded should compare against what it passed in.
 *
 * @throws RangeError when the epoch or any delta-v component is not finite, or falls
 * outside the representable count range.
 */
export const createManeuverNode = (spec: ManeuverNodeSpec): ManeuverNode =>
  node(toEpochTicks(spec.epoch), [
    toDeltaVCounts(spec.deltaVRtn.x),
    toDeltaVCounts(spec.deltaVRtn.y),
    toDeltaVCounts(spec.deltaVRtn.z),
  ]);

/**
 * Rebuild a node from counts that are already quantised.
 *
 * This is the deserialisation path, and it deliberately does not round: the counts
 * came out of a replay code, they are already exactly what was played, and passing
 * them back through quantisation would be the "re-applied downstream" mistake FR-105
 * rules out. What it does instead is *validate* — a non-integer count means a
 * corrupted or hand-edited replay, and that should fail here rather than become a
 * trajectory nobody can reproduce.
 *
 * @throws RangeError when any count is not a safe integer.
 */
export const maneuverNodeFromCounts = (
  epochTicks: number,
  deltaVCounts: DeltaVCounts,
): ManeuverNode => {
  // `fromEpochTicks` and `fromDeltaVCounts` validate; call them before freezing so a
  // bad count cannot produce a half-built node.
  fromEpochTicks(epochTicks);
  for (const count of deltaVCounts) {
    fromDeltaVCounts(count);
  }
  return node(epochTicks, deltaVCounts);
};

/** The empty plan. Valid: FR-101's ordering constraints hold vacuously. */
export const EMPTY_PLAN: Plan = Object.freeze({ nodes: Object.freeze([]) });

/**
 * Build a plan from nodes, enforcing FR-101's ordering.
 *
 * @throws RangeError when epochs are not strictly increasing, or when two consecutive
 * nodes are less than {@link MINIMUM_NODE_SPACING_S} apart. The two are reported
 * separately because they are different mistakes: out-of-order nodes usually mean an
 * unsorted list, while too-close nodes mean a plan that was authored deliberately and
 * is simply not legal.
 */
export const createPlan = (nodes: readonly ManeuverNode[]): Plan => {
  // Carried rather than indexed: `noUncheckedIndexedAccess` makes `nodes[i - 1]`
  // possibly-undefined and the lint config forbids both ways of asserting that away.
  // Walking consecutive pairs is what the rule actually means anyway.
  let previous: ManeuverNode | undefined;

  for (const [i, current] of nodes.entries()) {
    if (previous === undefined) {
      previous = current;
      continue;
    }
    const gap = current.epochTicks - previous.epochTicks;

    if (gap <= 0) {
      throw new RangeError(
        `plan node epochs must strictly increase: node ${String(i)} at ${String(current.epoch)} s ` +
          `does not follow node ${String(i - 1)} at ${String(previous.epoch)} s. See FR-101.`,
      );
    }
    if (gap < MINIMUM_NODE_SPACING_TICKS) {
      throw new RangeError(
        `plan nodes must be at least ${String(MINIMUM_NODE_SPACING_S)} s apart: nodes ` +
          `${String(i - 1)} and ${String(i)} are ${String(gap / EPOCH_TICKS_PER_SECOND)} s apart. ` +
          'See FR-101.',
      );
    }
    previous = current;
  }
  return Object.freeze({ nodes: Object.freeze([...nodes]) });
};
