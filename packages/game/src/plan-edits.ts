/**
 * Editing a plan without ever producing an invalid one — #133, #134, #135, FR-101, FR-105.
 *
 * `@hh/sim`'s `createPlan` enforces FR-101 by **throwing**: epochs must strictly increase
 * and consecutive nodes must be at least a second apart, and a plan value that breaks
 * either cannot be constructed. That is exactly right for the core — a `Plan` is a
 * guarantee, not a suggestion — and exactly wrong at a pointer.
 *
 * A player dragging one node past another is not making a programming error. §6.4 gives
 * that situation a code, `L5`, and a message — *"Merge these burns"* — which is a
 * statement that the planner is expected to **show** it. A thrown `RangeError` inside a
 * pointer handler is an unhandled rejection and a blank screen.
 *
 * So this is the seam: it attempts the edit, and returns either the new plan or the
 * reason it refused. The reason is a {@link LegalityReason} carrying the same `L5`
 * catalogue key `evaluateLegality` emits, so the message a player sees when a placement
 * is refused is the same sentence they would see if such a plan somehow existed. There is
 * no second wording and no second rule — this module decides *when* to ask, and `@hh/sim`
 * decides what is legal.
 *
 * ## Why it does not pre-check
 *
 * The obvious implementation walks the node list looking for a gap under a second before
 * calling `createPlan`. That is a second copy of FR-101, and the two would eventually
 * disagree — the interesting way being over the boundary case, since `plan.ts` compares
 * *tick counts* and a seconds comparison loses about 1e-7 s to cancellation at mission
 * epochs. So this calls the constructor and converts its refusal, which means the rule
 * has exactly one implementation and the boundary is wherever `plan.ts` says it is.
 *
 * `createPlan` distinguishes its two failures in the message, and both are `L5` to a
 * player: "these two burns are too close together to be separate burns". The distinction
 * matters to a programmer and not to anyone holding a mouse.
 *
 * ## Quantisation happens here, once
 *
 * Every edit goes through `createManeuverNode`, which quantises at entry (FR-105) and
 * derives the node's epoch and Δv *from the counts* rather than from the caller's
 * arguments. So a dragged epoch becomes a tick at the moment it is committed to the plan
 * and never again — which is what #134's "quantised on release rather than continuously"
 * asks for, given that release is the only moment this module is called.
 */
import type { Epoch, RtnVector } from '@hh/astro';
import { rtn } from '@hh/astro';
import type { MetresPerSec } from '@hh/math';
import { V, metresPerSec } from '@hh/math';
import type { DeltaVCounts, ManeuverNode, Plan } from '@hh/sim';
import { MINIMUM_NODE_SPACING_S, createManeuverNode, createPlan, fromDeltaVCounts } from '@hh/sim';

import type { LegalityReason } from './legality.js';
import { gameMessage } from './messages.js';

/** An edit that produced a plan, or the reason it did not. */
export type PlanEdit =
  | { readonly ok: true; readonly plan: Plan; readonly nodeIndex: number }
  | { readonly ok: false; readonly reason: LegalityReason };

/** Nodes in epoch order. `createPlan` requires it, and every edit here can disturb it. */
const byEpoch = (nodes: readonly ManeuverNode[]): ManeuverNode[] =>
  [...nodes].sort((a, b) => a.epochTicks - b.epochTicks);

/**
 * `L5`, as the reason a refused edit carries.
 *
 * The same key, blocking flag and parameter names `legality.ts` uses, so the two cannot
 * word the same situation differently. `firstIndex`/`secondIndex` describe the pair that
 * collided; the gap is reported from the ticks, which is the unit the rule is applied in.
 */
const tooClose = (nodes: readonly ManeuverNode[]): LegalityReason => {
  const sorted = byEpoch(nodes);
  let firstIndex = 0;
  let gapSeconds = 0;
  for (let i = 1; i < sorted.length; i++) {
    const previous = sorted[i - 1];
    const current = sorted[i];
    if (previous === undefined || current === undefined) continue;
    const gap = current.epoch - previous.epoch;
    if (gap < MINIMUM_NODE_SPACING_S) {
      firstIndex = i - 1;
      gapSeconds = gap;
      break;
    }
  }
  return {
    code: 'L5',
    blocking: true,
    message: gameMessage('legality.l5.nodesTooClose', {
      firstIndex,
      secondIndex: firstIndex + 1,
      gapSeconds,
      minimumSeconds: MINIMUM_NODE_SPACING_S,
    }),
    epoch: sorted[firstIndex]?.epoch ?? null,
    intervals: [],
  };
};

/**
 * Build a plan from nodes, converting `createPlan`'s refusal into a reason.
 *
 * The one place this module catches. Everything else routes through here, so a new edit
 * cannot forget to.
 */
const attempt = (nodes: readonly ManeuverNode[], nodeIndex: number): PlanEdit => {
  const sorted = byEpoch(nodes);
  try {
    return { ok: true, plan: createPlan(sorted), nodeIndex };
  } catch (error) {
    // `createPlan` throws `RangeError` for both of FR-101's conditions and nothing else.
    // Anything that is not one is a bug here rather than a player action, and rethrowing
    // it is what makes that visible instead of reporting it as a spacing problem.
    if (!(error instanceof RangeError)) throw error;
    return { ok: false, reason: tooClose(sorted) };
  }
};

/** Where a node ended up after the sort, so the caller can keep it selected. */
const indexOfEpoch = (nodes: readonly ManeuverNode[], epochTicks: number): number =>
  byEpoch(nodes).findIndex((node) => node.epochTicks === epochTicks);

/** A Δv vector from components, in the order the planner thinks in. */
const deltaV = (progradeMps: number, radialMps: number): RtnVector<MetresPerSec> =>
  rtn(V.vec3(metresPerSec(radialMps), metresPerSec(progradeMps), metresPerSec(0)));

/**
 * Add a node at `epoch` — #133.
 *
 * A placement too close to an existing burn comes back as `L5` *"rather than silently
 * merged"*, which is #133's fourth criterion and the reason this function exists at all.
 * Merging would be the tempting alternative and is worse: the player asked for a burn
 * somewhere, and quietly folding it into a neighbour changes a plan they did not author.
 */
export const addNode = (plan: Plan, epoch: Epoch, progradeMps = 0, radialMps = 0): PlanEdit => {
  const node = createManeuverNode({ epoch, deltaVRtn: deltaV(progradeMps, radialMps) });
  const nodes = [...plan.nodes, node];
  const result = attempt(nodes, indexOfEpoch(nodes, node.epochTicks));
  return result;
};

/**
 * Move a node to a new epoch — #134.
 *
 * §8.5.2 lets a drag carry a node past its neighbours, and #134 asks for the behaviour to
 * be *"documented and consistent, and never producing a silently invalid plan"*. The
 * behaviour is **reorder, not clamp**: the node keeps its identity and the list is sorted
 * by epoch, so dragging burn 1 past burn 2 leaves the same two burns with their numbers
 * swapped.
 *
 * Clamping was the alternative and is worse in the case that actually happens. A player
 * refining a transfer drags the first burn later, hits the second, and a clamp stops them
 * a second short of where they were aiming with no explanation; a reorder does the thing
 * they were plainly trying to do. Clamping also produces a plan they did not ask for and
 * cannot see is different, which is the "silently invalid" failure inverted.
 *
 * A drag that lands *within a second* of a neighbour is still `L5` — reordering does not
 * make two burns 300 ms apart legal — and the caller restores the pre-drag epoch.
 */
export const moveNode = (plan: Plan, index: number, epoch: Epoch): PlanEdit => {
  const existing = plan.nodes[index];
  if (existing === undefined) throw new RangeError(`no node at index ${String(index)}`);

  const moved = createManeuverNode({ epoch, deltaVRtn: existing.deltaVRtn });
  const nodes = plan.nodes.map((node, i) => (i === index ? moved : node));
  return attempt(nodes, indexOfEpoch(nodes, moved.epochTicks));
};

/**
 * Set a node's Δv components — #135, #137.
 *
 * Quantised to 1e-4 m/s by `createManeuverNode` (DEP-09), and the node's epoch is reused
 * from its *counts* rather than from its `epoch` field, so a value that has been through
 * this function any number of times cannot drift.
 *
 * The normal component is not a parameter: §8.3.5 marks it v1.1, and offering it here
 * would put it in the plan before there is any way to author it.
 */
export const setNodeDeltaV = (
  plan: Plan,
  index: number,
  progradeMps: number,
  radialMps: number,
): PlanEdit => {
  const existing = plan.nodes[index];
  if (existing === undefined) throw new RangeError(`no node at index ${String(index)}`);

  const updated = createManeuverNode({
    epoch: existing.epoch,
    deltaVRtn: deltaV(progradeMps, radialMps),
  });
  const nodes = plan.nodes.map((node, i) => (i === index ? updated : node));
  return attempt(nodes, index);
};

/**
 * Remove a node.
 *
 * Cannot fail: dropping a node from an ordered, adequately-spaced list leaves one. The
 * return type is still `PlanEdit` so that every edit in the planner has one shape and no
 * call site has to know which of them can refuse.
 */
export const deleteNode = (plan: Plan, index: number): PlanEdit => {
  if (plan.nodes[index] === undefined) throw new RangeError(`no node at index ${String(index)}`);
  const nodes = plan.nodes.filter((_node, i) => i !== index);
  return attempt(nodes, Math.min(index, nodes.length - 1));
};

/** A node's Δv components in the planner's order, in m/s. The read side of {@link setNodeDeltaV}. */
export const componentsOf = (
  counts: DeltaVCounts,
): { readonly progradeMps: number; readonly radialMps: number } => ({
  progradeMps: fromDeltaVCounts(counts[1]),
  radialMps: fromDeltaVCounts(counts[0]),
});
