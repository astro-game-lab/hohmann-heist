import { describe, expect, it } from 'vitest';

import type { Dragging, ScreenNode } from './drag.js';
import {
  COUNTS_PER_PIXEL,
  IDLE,
  MAX_COUNTS,
  MIN_COUNTS,
  PICK_RADIUS_PX,
  beginDrag,
  clampCounts,
  countsForDrag,
  currentCounts,
  pickNode,
  planForDrag,
  screenNodesOf,
} from './drag.js';
import { BASE_COUNTS, DRAGGED_NODE, cameraFor, planOf, timelineOf, VIEWPORT } from './scenario.js';

const nodes: readonly ScreenNode[] = [
  { nodeIndex: 0, x: 100, y: 100 },
  { nodeIndex: DRAGGED_NODE, x: 200, y: 200 },
];

const dragging = (grabY: number, grabCounts: number): Dragging => ({
  kind: 'dragging',
  nodeIndex: DRAGGED_NODE,
  grabY,
  grabCounts,
});

describe('pickNode', () => {
  it('finds a node under the pointer', () => {
    expect(pickNode(nodes, 200, 200)).toBe(DRAGGED_NODE);
    expect(pickNode(nodes, 100, 100)).toBe(0);
  });

  it('returns -1 when nothing is within the pick radius', () => {
    expect(pickNode(nodes, 400, 400)).toBe(-1);
  });

  it('picks the nearest when two are in range, not the first', () => {
    const close: readonly ScreenNode[] = [
      { nodeIndex: 0, x: 100, y: 100 },
      { nodeIndex: 1, x: 104, y: 100 },
    ];
    expect(pickNode(close, 103, 100)).toBe(1);
    expect(pickNode(close, 101, 100)).toBe(0);
  });

  it('treats the radius as inclusive on its boundary', () => {
    expect(pickNode(nodes, 200 + PICK_RADIUS_PX, 200)).toBe(DRAGGED_NODE);
    expect(pickNode(nodes, 200 + PICK_RADIUS_PX + 0.001, 200)).toBe(-1);
  });
});

describe('countsForDrag', () => {
  it('maps upward motion to more delta-v', () => {
    const state = dragging(300, BASE_COUNTS);
    expect(countsForDrag(state, 200)).toBe(BASE_COUNTS + 100 * COUNTS_PER_PIXEL);
    expect(countsForDrag(state, 400)).toBe(BASE_COUNTS - 100 * COUNTS_PER_PIXEL);
  });

  it('returns the grabbed value for no motion', () => {
    expect(countsForDrag(dragging(300, BASE_COUNTS), 300)).toBe(BASE_COUNTS);
  });

  it('clamps rather than letting a long drag leave the plan behind', () => {
    const state = dragging(300, BASE_COUNTS);
    expect(countsForDrag(state, -1e6)).toBe(MAX_COUNTS);
    expect(countsForDrag(state, 1e6)).toBe(MIN_COUNTS);
  });

  it('yields whole counts, because a node is quantised', () => {
    expect(Number.isInteger(countsForDrag(dragging(300.5, BASE_COUNTS), 100.25))).toBe(true);
    expect(clampCounts(12.6)).toBe(13);
  });
});

describe('beginDrag', () => {
  const plan = planOf(BASE_COUNTS);

  it('grabs the draggable node and remembers where it started', () => {
    const state = beginDrag(nodes, plan, 200, 200);
    expect(state.kind).toBe('dragging');
    if (state.kind !== 'dragging') return;
    expect(state.nodeIndex).toBe(DRAGGED_NODE);
    expect(state.grabY).toBe(200);
    expect(state.grabCounts).toBe(BASE_COUNTS);
  });

  it('stays idle on empty space', () => {
    expect(beginDrag(nodes, plan, 500, 500)).toBe(IDLE);
  });

  it('stays idle on a node this spike does not drag', () => {
    // Only the last node has a free parameter — the other seven are fixed by the
    // benchmark scenario, and grabbing one would silently do nothing.
    expect(beginDrag(nodes, plan, 100, 100)).toBe(IDLE);
  });
});

describe('planForDrag', () => {
  const plan = planOf(BASE_COUNTS);

  it('produces a plan whose dragged node carries the new delta-v', () => {
    const next = planForDrag(dragging(300, BASE_COUNTS), plan, 200);
    expect(next).toBeDefined();
    expect(currentCounts(next ?? plan)).toBe(BASE_COUNTS + 100 * COUNTS_PER_PIXEL);
  });

  it('leaves every other node alone', () => {
    const next = planForDrag(dragging(300, BASE_COUNTS), plan, 200);
    const before = plan.nodes.slice(0, DRAGGED_NODE);
    const after = (next ?? plan).nodes.slice(0, DRAGGED_NODE);
    expect(after.map((n) => n.deltaVCounts)).toEqual(before.map((n) => n.deltaVCounts));
    expect(after.map((n) => n.epochTicks)).toEqual(before.map((n) => n.epochTicks));
  });

  it('returns undefined when the pointer has not moved the node', () => {
    // Pointer events outrun frames, so this is the common case rather than an edge one:
    // skipping it is what stops a re-evaluation per event.
    expect(planForDrag(dragging(300, BASE_COUNTS), plan, 300)).toBeUndefined();
  });

  it('returns undefined when idle', () => {
    expect(planForDrag(IDLE, plan, 123)).toBeUndefined();
  });
});

describe('screenNodesOf', () => {
  it('projects one entry per impulse, tagged with its node index', () => {
    const timeline = timelineOf(planOf(BASE_COUNTS));
    const camera = cameraFor(VIEWPORT);
    const projected = screenNodesOf(timeline, (position) => ({
      x: position.x * camera.scale,
      y: position.y * camera.scale,
    }));

    expect(projected).toHaveLength(timeline.impulses.length);
    expect(projected.map((n) => n.nodeIndex)).toEqual(timeline.impulses.map((i) => i.nodeIndex));
    expect(projected.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y))).toBe(true);
  });
});
