/**
 * The drag: pointer position in, a new plan out.
 *
 * ## What this is deliberately not
 *
 * Node picking here is nearest-marker-within-a-radius, computed by walking every node.
 * The real thing is #114's hit-testing index with 32 px targets, and this is not a
 * draft of it — eight nodes is small enough that a linear scan is the *correct*
 * implementation, and building an index the planner will replace would violate this
 * issue's throwaway criterion for no measurable gain.
 *
 * The gesture is also only one of the two §8.5.2 describes. Dragging a node's delta-v
 * handle changes the burn; dragging the node itself changes its epoch. This spike does
 * the first, because that is the gesture §11.9's drag row budgets and the one whose
 * cost `withPlan` bounds — an epoch change moves a node across the arc boundaries and
 * is a different measurement, which #134 owns.
 *
 * ## Why the mapping is vertical pixels to counts
 *
 * The handle is not drawn, so there is no handle axis to project onto. Screen-vertical
 * is used instead: it is monotone, it is reversible, and it makes a drag of a few
 * hundred pixels sweep the plan through a visibly different family of trajectories,
 * which is what the legibility criterion needs. A real two-axis handle in the orbital
 * plane is #110.
 */
import type { EciVector } from '@hh/astro';
import type { Metres } from '@hh/math';
import type { ScreenPoint } from '@hh/render';
import type { Plan, Timeline } from '@hh/sim';

import { BASE_COUNTS, DRAGGED_NODE, planOf } from './scenario.js';

/** Nothing is being dragged. */
export interface Idle {
  readonly kind: 'idle';
}

/** A node is being dragged. */
export interface Dragging {
  readonly kind: 'dragging';
  readonly nodeIndex: number;
  /** Pointer y at grab time, in CSS pixels. */
  readonly grabY: number;
  /** The node's transverse counts at grab time. */
  readonly grabCounts: number;
}

export type DragState = Idle | Dragging;

export const IDLE: DragState = Object.freeze({ kind: 'idle' });

/** §8.5.2's target size is 32 px; half of it is the pick radius. */
export const PICK_RADIUS_PX = 16;

/**
 * Counts of delta-v per pixel dragged.
 *
 * 1 200 counts is 0.12 m/s per pixel, so a 300 px drag sweeps ±36 m/s about the base
 * burn — enough to change the trajectory's shape obviously without leaving the frame.
 */
export const COUNTS_PER_PIXEL = 1200;

/** Delta-v counts are clamped so a drag cannot push the plan out of the horizon. */
export const MIN_COUNTS = 0;
export const MAX_COUNTS = 600_000;

export interface ScreenNode {
  readonly nodeIndex: number;
  readonly x: number;
  readonly y: number;
}

/**
 * The node whose marker is nearest the pointer, if one is inside `PICK_RADIUS_PX`.
 *
 * Compared by squared distance: the square root is monotone, so it cannot change which
 * node wins, and the radius is squared once instead.
 */
export const pickNode = (
  nodes: readonly ScreenNode[],
  x: number,
  y: number,
  radiusPx: number = PICK_RADIUS_PX,
): number => {
  const limit = radiusPx * radiusPx;
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const node of nodes) {
    const dx = node.x - x;
    const dy = node.y - y;
    const distance = dx * dx + dy * dy;
    if (distance <= limit && distance < bestDistance) {
      best = node.nodeIndex;
      bestDistance = distance;
    }
  }
  return best;
};

/** Clamp to the range a drag may reach. */
export const clampCounts = (counts: number): number =>
  Math.min(MAX_COUNTS, Math.max(MIN_COUNTS, Math.round(counts)));

/**
 * The transverse counts a drag from `grabY` to `y` implies.
 *
 * Upward is more delta-v, because up is faster in every other instrument a player has
 * ever used. Screen y grows downward, hence the subtraction.
 */
export const countsForDrag = (state: Dragging, y: number): number =>
  clampCounts(state.grabCounts + (state.grabY - y) * COUNTS_PER_PIXEL);

/**
 * The counts currently on the dragged node of a plan.
 *
 * Reads the plan rather than tracking a shadow copy, so the pointer and the simulation
 * cannot disagree about what the node holds.
 */
export const currentCounts = (plan: Plan): number =>
  plan.nodes[DRAGGED_NODE]?.deltaVCounts[1] ?? BASE_COUNTS;

/** Begin a drag, or stay idle if the pointer did not land on a node. */
export const beginDrag = (
  nodes: readonly ScreenNode[],
  plan: Plan,
  x: number,
  y: number,
): DragState => {
  const nodeIndex = pickNode(nodes, x, y);
  if (nodeIndex !== DRAGGED_NODE) return IDLE;
  return { kind: 'dragging', nodeIndex, grabY: y, grabCounts: currentCounts(plan) };
};

/**
 * The plan a drag to `y` produces, or `undefined` when nothing changed.
 *
 * `undefined` rather than the same plan so the caller can skip re-evaluation entirely
 * on a pointer move that quantises to the node it already has — which is most of them,
 * since pointer events outrun frames.
 */
export const planForDrag = (state: DragState, plan: Plan, y: number): Plan | undefined => {
  if (state.kind !== 'dragging') return undefined;
  const counts = countsForDrag(state, y);
  if (counts === currentCounts(plan)) return undefined;
  return planOf(counts);
};

/**
 * Screen positions of the nodes on a timeline, for picking.
 *
 * Takes the projection as a function rather than a camera so this module never imports
 * the renderer's implementation — the branded vector goes through untouched, which is
 * what keeps the frame tag on it all the way to the projection.
 */
export const screenNodesOf = (
  timeline: Timeline,
  project: (position: EciVector<Metres>) => ScreenPoint,
): ScreenNode[] =>
  timeline.impulses.map((impulse) => {
    const point = project(impulse.after.position);
    return { nodeIndex: impulse.nodeIndex, x: point.x, y: point.y };
  });
