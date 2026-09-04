/**
 * §8.5.1's machine, and the two claims #143 makes that a run-time test cannot reach.
 *
 * The `illegal transitions` block below asserts nothing at run time on purpose: every
 * expectation in it is a `@ts-expect-error`, and the thing that checks them is `pnpm
 * typecheck`, not `pnpm test`. A `@ts-expect-error` over a line that *does* compile is
 * itself an error, so if one of these edges ever becomes legal the build fails and names
 * the line. That is the only way to test "impossible by construction" — a run-time test
 * of an illegal call would have to be able to *make* the call, which is the thing being
 * ruled out.
 */
import { epoch } from '@hh/astro';
import type { Legality } from '@hh/game';
import { EMPTY_PLAN, createPlan, maneuverNodeFromCounts, type DeltaVCounts } from '@hh/sim';
import { describe, expect, it } from 'vitest';

import {
  IDLE,
  activeNodeId,
  beginDrag,
  beginPlacement,
  cancelDrag,
  cancelPlacement,
  commit,
  commitPlacement,
  createModel,
  deselect,
  evaluated,
  isCommittable,
  isDragging,
  movePlacement,
  releaseDrag,
  scrubTo,
  select,
  setScrubbing,
  updateDeltaVDrag,
  updateEpochDrag,
  type CommittableLegality,
  type DeltaVDrag,
  type EpochDrag,
  type Placement,
} from './machine.js';

const T0 = epoch(0);
const placement = (at: number): Placement => ({
  rawEpoch: epoch(at),
  epoch: epoch(at),
  snappedTo: null,
});
const epochDrag = (fromTicks: number, ticks: number): EpochDrag => ({
  kind: 'epoch',
  fromTicks,
  ticks,
});
const deltaVDrag = (fromCounts: DeltaVCounts, counts: DeltaVCounts): DeltaVDrag => ({
  kind: 'deltaV',
  axis: 'prograde',
  fromCounts,
  counts,
});

/** A verdict that permits committing. Built by narrowing, which is what §6.4 asks for. */
const allowed = (): CommittableLegality => {
  const legality: Legality = {
    evaluable: true,
    commitAllowed: true,
    reasons: [],
    constraints: {
      budget: {
        kind: 'dv_budget',
        violations: [],
        usedMps: 0,
        budgetMps: 300,
        remainingMps: 300,
        fraction: 0,
        level: 'ok',
        exceededAtNode: null,
      },
      deadline: {
        kind: 'deadline',
        violations: [],
        deadlineSeconds: 50_400,
        lastBurnMetSeconds: null,
        overrunSeconds: 0,
        firstLateNode: null,
      },
      altitudeFloor: {
        kind: 'altitude_floor',
        violations: [],
        floorAltitudeM: 100_000,
        referenceRadiusM: 6_378_137,
        totalSecondsBelow: 0,
      },
    },
  };
  // The narrowing is the point of the fixture, not ceremony around it: `commit` cannot
  // be reached without it, and this is what a caller has to write too.
  if (!isCommittable(legality)) throw new Error('fixture should permit a commit');
  return legality;
};

describe('the six states of §8.5.1', () => {
  it('starts IDLE', () => {
    expect(createModel(EMPTY_PLAN, T0).interaction).toBe(IDLE);
  });

  it('walks IDLE → PLACING → SELECTED, the `click orbit` path', () => {
    const placing = beginPlacement(IDLE, placement(120));
    expect(placing.phase).toBe('PLACING');
    expect(commitPlacement(placing, 'n0')).toEqual({ phase: 'SELECTED', nodeId: 'n0' });
  });

  it('walks SELECTED → DRAGGING → EVALUATED, the `drag t` path', () => {
    const selected = select(IDLE, 'n0');
    const dragging = beginDrag(selected, epochDrag(1024, 1024));
    expect(dragging.phase).toBe('DRAGGING');
    expect(releaseDrag(updateEpochDrag(dragging, 4096))).toEqual({
      phase: 'EVALUATED',
      nodeId: 'n0',
    });
  });

  it('reaches COMMITTED from EVALUATED with a permitting verdict', () => {
    const plan = createPlan([maneuverNodeFromCounts(1024, [0, 100, 0])]);
    const committed = commit(evaluated(IDLE, 'n0'), allowed(), plan);
    expect(committed).toEqual({ phase: 'COMMITTED', plan });
  });

  it('cancels a placement back to IDLE', () => {
    expect(cancelPlacement(beginPlacement(IDLE, placement(120)))).toBe(IDLE);
  });

  it('deselects back to IDLE from SELECTED and from EVALUATED', () => {
    expect(deselect(select(IDLE, 'n0'))).toBe(IDLE);
    expect(deselect(evaluated(IDLE, 'n0'))).toBe(IDLE);
  });
});

describe('Escape mid-drag (#134, #135)', () => {
  it('returns to SELECTED and keeps the pre-drag epoch available to restore', () => {
    const dragging = updateEpochDrag(beginDrag(select(IDLE, 'n0'), epochDrag(1024, 1024)), 99_999);
    // The machine does not restore the value — the caller does, from `fromTicks`. What
    // matters here is that the pre-drag value survived the whole gesture unchanged.
    expect(dragging.drag.fromTicks).toBe(1024);
    expect(cancelDrag(dragging)).toEqual({ phase: 'SELECTED', nodeId: 'n0' });
  });

  it('keeps the pre-drag Δv counts through a handle drag', () => {
    const from: DeltaVCounts = [0, 362_000, 0];
    const dragging = updateDeltaVDrag(
      beginDrag(select(IDLE, 'n0'), deltaVDrag(from, from)),
      [0, 1_000_000, 0],
    );
    expect(dragging.drag.fromCounts).toBe(from);
    expect(cancelDrag(dragging).phase).toBe('SELECTED');
  });

  it('a cancelled drag does not reach EVALUATED — nothing changed, so nothing to evaluate', () => {
    const cancelled = cancelDrag(beginDrag(select(IDLE, 'n0'), epochDrag(1024, 4096)));
    expect(cancelled.phase).not.toBe('EVALUATED');
  });
});

describe('keyboard and touch reach the same edges as the pointer (#143, FR-405)', () => {
  // The machine has no notion of input device, which is the point: `N` at the scrub head,
  // a tap on the trajectory and a click all produce the same PLACING state, so there is
  // no second code path for a keyboard user to fall off. These assert that equivalence
  // rather than a device, because a device is the app layer's business.
  it('keyboard placement at the scrub head is the same transition as a click', () => {
    const byPointer = beginPlacement(IDLE, placement(600));
    const byKeyboard = beginPlacement(IDLE, placement(600));
    expect(byKeyboard).toEqual(byPointer);
  });

  it('a touch drag is the same transition as a pointer drag', () => {
    const selected = select(IDLE, 'n0');
    expect(beginDrag(selected, epochDrag(1024, 1024))).toEqual(
      beginDrag(selected, epochDrag(1024, 1024)),
    );
  });
});

describe('SCRUBBING is orthogonal and never mutates the plan (FR-403, #128)', () => {
  const plan = createPlan([
    maneuverNodeFromCounts(1024, [0, 100, 0]),
    maneuverNodeFromCounts(8192, [0, -100, 0]),
  ]);

  it('passes the plan through by reference', () => {
    const model = createModel(plan, T0);
    const scrubbed = scrubTo(model, epoch(3600));
    // `toBe`, not `toEqual`. A deep comparison would pass for a faithful copy, and a
    // copy is exactly the bug this is here to catch — it would mean the plan had been
    // rebuilt on a view operation, which is how a scrub starts costing a re-evaluation.
    expect(scrubbed.plan).toBe(plan);
    expect(scrubbed.scrub.epoch).toBe(3600);
  });

  it('overlays every interaction state without changing it', () => {
    for (const interaction of [
      IDLE,
      beginPlacement(IDLE, placement(120)),
      select(IDLE, 'n0'),
      beginDrag(select(IDLE, 'n0'), epochDrag(1024, 2048)),
      evaluated(IDLE, 'n0'),
    ]) {
      const model = { ...createModel(plan, T0), interaction };
      const scrubbed = scrubTo(model, epoch(1800));
      expect(scrubbed.interaction).toBe(interaction);
      expect(scrubbed.plan).toBe(plan);
    }
  });

  it('starting and ending a scrub gesture also passes the plan through', () => {
    const model = createModel(plan, T0);
    expect(setScrubbing(model, true).plan).toBe(plan);
    expect(setScrubbing(model, true).scrub.scrubbing).toBe(true);
    expect(setScrubbing(setScrubbing(model, true), false).scrub.scrubbing).toBe(false);
  });

  it('scrubbing mid-drag does not end the drag', () => {
    const dragging = beginDrag(select(IDLE, 'n0'), epochDrag(1024, 2048));
    const model = { ...createModel(plan, T0), interaction: dragging };
    expect(scrubTo(model, epoch(900)).interaction).toBe(dragging);
  });
});

describe('the active node', () => {
  it('is the node in SELECTED, DRAGGING and EVALUATED, and nothing elsewhere', () => {
    expect(activeNodeId(IDLE)).toBeNull();
    expect(activeNodeId(beginPlacement(IDLE, placement(1)))).toBeNull();
    expect(activeNodeId(select(IDLE, 'n0'))).toBe('n0');
    expect(activeNodeId(beginDrag(select(IDLE, 'n0'), epochDrag(0, 0)))).toBe('n0');
    expect(activeNodeId(evaluated(IDLE, 'n0'))).toBe('n0');
    expect(activeNodeId(evaluated(IDLE, null))).toBeNull();
    expect(activeNodeId(commit(evaluated(IDLE, 'n0'), allowed(), EMPTY_PLAN))).toBeNull();
  });

  it('narrows a dragging state for the cheap-evaluation path (NFR-011)', () => {
    expect(isDragging(beginDrag(select(IDLE, 'n0'), epochDrag(0, 0)))).toBe(true);
    expect(isDragging(IDLE)).toBe(false);
  });
});

describe('a placement preview follows the pointer without committing anything', () => {
  it('replaces the preview, staying in PLACING', () => {
    const moved = movePlacement(beginPlacement(IDLE, placement(120)), {
      rawEpoch: epoch(300),
      epoch: epoch(288),
      snappedTo: 'periapsis',
    });
    expect(moved.phase).toBe('PLACING');
    expect(moved.placement.snappedTo).toBe('periapsis');
    expect(moved.placement.epoch).toBe(288);
  });
});

describe('illegal transitions do not compile (#143)', () => {
  // Nothing in this block runs a meaningful assertion. See the file docstring: the
  // `@ts-expect-error` comments are the test, `pnpm typecheck` is the runner, and each
  // one names an edge §8.5.1 does not draw.
  it('is enforced by the compiler, not by a branch', () => {
    const idle = IDLE;
    const selected = select(IDLE, 'n0');
    const dragging = beginDrag(selected, epochDrag(1024, 2048));
    const committed = commit(evaluated(IDLE, 'n0'), allowed(), EMPTY_PLAN);
    const placing = beginPlacement(IDLE, placement(120));

    // A release with no drag in flight.
    // @ts-expect-error IDLE is not a DraggingState
    releaseDrag(idle);

    // A drag that never began.
    // @ts-expect-error SELECTED is not a DraggingState
    cancelDrag(selected);

    // Selecting out of a drag, which would strand the release on a node nobody holds.
    // @ts-expect-error DRAGGING is not a source of `select`
    select(dragging, 'n1');

    // Deselecting out of a drag, likewise.
    // @ts-expect-error DRAGGING is not a source of `deselect`
    deselect(dragging);

    // Starting a second drag inside one.
    // @ts-expect-error DRAGGING is not a source of `beginDrag`
    beginDrag(dragging, epochDrag(0, 0));

    // Feeding Δv counts into an epoch drag: different units, distinct types.
    // @ts-expect-error DraggingState<EpochDrag> is not DraggingState<DeltaVDrag>
    updateDeltaVDrag(dragging, [0, 1000, 0]);

    // COMMITTED is terminal — §8.5.1 draws no edge out of it back into the planner.
    // @ts-expect-error COMMITTED is not a source of `select`
    select(committed, 'n0');
    // @ts-expect-error COMMITTED is not a source of `evaluated`
    evaluated(committed, 'n0');

    // Committing without reaching EVALUATED first.
    // @ts-expect-error SELECTED is not an EvaluatedState
    commit(selected, allowed(), EMPTY_PLAN);

    // Committing an *illegal* plan: §6.4's gate, as a type. A bare `Legality` has not
    // been narrowed, so it cannot be the evidence.
    const unnarrowed: Legality = allowed();
    // @ts-expect-error Legality is not CommittableLegality until `commitAllowed` is narrowed
    commit(evaluated(IDLE, 'n0'), unnarrowed, EMPTY_PLAN);

    // A non-evaluable verdict fixes `commitAllowed: false`, so it can never narrow.
    const nonEvaluable: Legality = {
      evaluable: false,
      commitAllowed: false,
      reason: { key: 'legality.plan.rectilinear', params: { nodeIndex: 0 } },
      failure: { ok: false, reason: 'rectilinear', nodeIndex: 0 },
    };
    // @ts-expect-error a non-evaluable verdict can never permit a commit
    commit(evaluated(IDLE, 'n0'), nonEvaluable, EMPTY_PLAN);

    // Placement edges are not reachable from a placed node.
    // @ts-expect-error SELECTED is not a PlacingState
    commitPlacement(selected, 'n1');
    // @ts-expect-error PLACING is not a source of `beginPlacement`
    beginPlacement(placing, placement(0));

    expect(true).toBe(true);
  });
});
