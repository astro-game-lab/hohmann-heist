import { epoch } from '@hh/astro';
import { EMPTY_PLAN, MINIMUM_NODE_SPACING_S, fromDeltaVCounts } from '@hh/sim';
import { describe, expect, it } from 'vitest';

import { addNode, componentsOf, deleteNode, moveNode, setNodeDeltaV } from './plan-edits.js';
import { planOf } from './test-support.js';

/** Unwrap a successful edit, failing loudly rather than asserting the variant away. */
const ok = (edit: ReturnType<typeof addNode>) => {
  if (!edit.ok) throw new Error(`expected an edit, got ${edit.reason.code}`);
  return edit;
};

describe('adding a node (#133)', () => {
  it('places it and reports where it landed', () => {
    const edit = ok(addNode(EMPTY_PLAN, epoch(600), -36.2));
    expect(edit.plan.nodes).toHaveLength(1);
    expect(edit.nodeIndex).toBe(0);
    expect(componentsOf(edit.plan.nodes[0]?.deltaVCounts ?? [0, 0, 0]).progradeMps).toBeCloseTo(
      -36.2,
      4,
    );
  });

  it('keeps the plan in epoch order however it is added', () => {
    const edit = ok(addNode(planOf([600, 25], [2400, 25]), epoch(1200)));
    expect(edit.plan.nodes.map((node) => node.epoch)).toEqual([600, 1200, 2400]);
    // And the reported index is where the new node *ended up*, not where it was appended.
    expect(edit.nodeIndex).toBe(1);
  });

  it('refuses a placement inside the minimum spacing with L5, never merging it', () => {
    // #133's fourth criterion. Merging is the tempting alternative and is worse: the
    // player asked for a burn at 600.5 s and folding it into the one at 600 s changes a
    // plan they did not author, with nothing on screen to say so.
    const edit = addNode(planOf([600, 25]), epoch(600.5));
    expect(edit.ok).toBe(false);
    if (edit.ok) return;
    expect(edit.reason.code).toBe('L5');
    expect(edit.reason.blocking).toBe(true);
    expect(edit.reason.message.key).toBe('legality.l5.nodesTooClose');
  });

  it('accepts a placement exactly at the minimum spacing', () => {
    // The boundary case a player editing a tight sequence actually lands on. `plan.ts`
    // compares tick counts, so exactly 1 s is exactly 1024 ticks and is legal.
    const edit = addNode(planOf([600, 25]), epoch(600 + MINIMUM_NODE_SPACING_S));
    expect(edit.ok).toBe(true);
  });
});

describe('moving a node (#134)', () => {
  it('changes its epoch', () => {
    const edit = ok(moveNode(planOf([600, 25], [2400, 25]), 0, epoch(900)));
    expect(edit.plan.nodes.map((node) => node.epoch)).toEqual([900, 2400]);
  });

  it('reorders rather than clamping when dragged past a neighbour', () => {
    // The documented behaviour, and the one #134 asks be consistent. The node keeps its
    // Δv and the list re-sorts, so dragging burn 1 past burn 2 leaves the same two burns
    // with their numbers swapped — which is what the player was plainly trying to do.
    const plan = planOf([600, 10], [2400, 90]);
    const edit = ok(moveNode(plan, 0, epoch(3000)));
    expect(edit.plan.nodes.map((node) => node.epoch)).toEqual([2400, 3000]);
    // The moved node is still the 10 m/s one, and it is now second.
    expect(edit.nodeIndex).toBe(1);
    expect(fromDeltaVCounts(edit.plan.nodes[1]?.deltaVCounts[1] ?? 0)).toBeCloseTo(10, 4);
  });

  it('still refuses a move that lands within the minimum spacing', () => {
    // Reordering does not make two burns 300 ms apart legal — the caller restores the
    // pre-drag epoch on this.
    const edit = moveNode(planOf([600, 25], [2400, 25]), 0, epoch(2399.7));
    expect(edit.ok).toBe(false);
    if (!edit.ok) expect(edit.reason.code).toBe('L5');
  });

  it('quantises the new epoch at entry (FR-105)', () => {
    const edit = ok(moveNode(planOf([600, 25]), 0, epoch(612.3456789)));
    // 612.3456789 s is 627042.05... ticks; the stored epoch is the tick, not the ask.
    expect(edit.plan.nodes[0]?.epochTicks).toBe(Math.round(612.3456789 * 1024));
    expect(edit.plan.nodes[0]?.epoch).toBe(Math.round(612.3456789 * 1024) / 1024);
  });
});

describe('setting Δv (#135, #137)', () => {
  it('replaces both components and leaves the epoch alone', () => {
    const edit = ok(setNodeDeltaV(planOf([600, 25]), 0, -36.2, 1.5));
    expect(edit.plan.nodes[0]?.epoch).toBe(600);
    const components = componentsOf(edit.plan.nodes[0]?.deltaVCounts ?? [0, 0, 0]);
    expect(components.progradeMps).toBeCloseTo(-36.2, 4);
    expect(components.radialMps).toBeCloseTo(1.5, 4);
  });

  it('quantises to 1e-4 m/s (DEP-09)', () => {
    const edit = ok(setNodeDeltaV(planOf([600, 25]), 0, 36.200_049, 0));
    expect(edit.plan.nodes[0]?.deltaVCounts[1]).toBe(362_000);
  });

  it('is idempotent — re-applying a node’s own components cannot drift it', () => {
    // The FR-105 property: values are derived from counts, so a round trip is exact. A
    // planner that re-set a node's Δv on every frame of a drag would otherwise walk it.
    let plan = planOf([600, 25]);
    for (let i = 0; i < 5; i++) {
      const components = componentsOf(plan.nodes[0]?.deltaVCounts ?? [0, 0, 0]);
      plan = ok(setNodeDeltaV(plan, 0, components.progradeMps, components.radialMps)).plan;
    }
    expect(plan.nodes[0]?.deltaVCounts).toEqual([0, 250_000, 0]);
  });

  it('leaves the normal component at zero — §8.3.5 marks it v1.1', () => {
    const edit = ok(setNodeDeltaV(planOf([600, 25]), 0, 10, 10));
    expect(edit.plan.nodes[0]?.deltaVCounts[2]).toBe(0);
  });
});

describe('deleting a node', () => {
  it('removes it and keeps the rest', () => {
    const edit = ok(deleteNode(planOf([600, 25], [2400, 25], [4800, 25]), 1));
    expect(edit.plan.nodes.map((node) => node.epoch)).toEqual([600, 4800]);
  });

  it('cannot fail, and reports a selectable index after the last one goes', () => {
    const edit = ok(deleteNode(planOf([600, 25]), 0));
    expect(edit.plan.nodes).toHaveLength(0);
    expect(edit.nodeIndex).toBe(-1);
  });
});

describe('the read side', () => {
  it('reads prograde from the transverse slot and radial from the radial one', () => {
    // RTN order is (radial, transverse, normal) and DEP-10 calls the transverse one
    // "prograde". Getting this pair the wrong way round is invisible on a circular orbit
    // and wrong on every other, which is why it has its own assertion.
    expect(componentsOf([15_000, -362_000, 0])).toEqual({
      progradeMps: -36.2,
      radialMps: 1.5,
    });
  });
});
