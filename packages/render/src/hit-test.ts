/**
 * Hit-testing: what the player meant when they clicked — §8.5.2, §11.8, #114.
 *
 * ## Everything here is CSS pixels, and that is the whole of the DPR requirement
 *
 * §8.5.2 asks for a **32 px hit target regardless of visual size**, and #114 is careful
 * to say 32 *CSS* pixels rather than device pixels. On a 2x display those are 64 device
 * pixels; a constant that quietly meant device pixels would give a 16 CSS px target on
 * every retina laptop — half the accessible minimum, on the machines most players use.
 *
 * The handling is structural rather than a conversion: pointer events arrive in CSS
 * pixels, the camera projects to CSS pixels, primitives are in CSS pixels, and so are
 * the targets below. Nothing in this module has a device pixel in it, and the one place
 * that converts is `viewport.ts` (#115). A test pins that by checking the same target
 * behaves identically at 1x, 2x and 3x.
 *
 * ## Why a built index rather than testing the scene
 *
 * §11.8 step 6: "hit-test index rebuilt only on layout change". A `Scene` is rebuilt
 * every frame and holds a few thousand points; walking it per pointer event would tie
 * the cost of a mouse move to the cost of a frame. The index is a small, flat list with
 * precomputed bounds, rebuilt when the layout changes — a node added or removed, the
 * camera moved, the window resized — and not when the scrub head moves.
 *
 * ## The priority order, and why overlap needs one at all
 *
 * A maneuver node draws as a diamond with a handle cross through it, so the handle
 * targets *always* overlap the node target, and both sit on the trajectory. Every click
 * near a handle is therefore ambiguous, and resolving it by "whichever is nearest" gets
 * it wrong: the node's centre is closer to the handle's root than the handle's grab
 * point is, so dragging a handle inward would select the node instead.
 *
 * So kind beats distance:
 *
 * ```
 * handle  >  node  >  marker  >  trajectory
 * ```
 *
 * Read it as specificity. A handle is a smaller, more deliberate target than the node
 * it belongs to; a node is more specific than the trajectory it sits on. Distance only
 * breaks ties *within* a kind, and input order breaks ties within that — so the result
 * is a pure function of the index and the point, with no dependence on iteration order
 * that could vary between runs (NFR-009).
 *
 * ## One index for pointer, touch and keyboard
 *
 * FR-405 requires every node be creatable, selectable, movable and deletable by pointer,
 * keyboard and touch. Two hit-test paths would be two sets of rounding, and the touch one
 * would be the one nobody tested. There is one index; a tap and a click ask it the same
 * question. Keyboard focus does not hit-test at all — it walks the same target list in
 * order, which is why the list is ordered rather than a map.
 */
import type { ScreenPoint } from './renderer.js';

/**
 * §8.5.2's minimum interactive target, in CSS pixels.
 *
 * The full target is this wide, so the radius a hit is measured against is half of it.
 * WCAG 2.2's Target Size (Minimum) asks for 24 CSS px; 32 clears that with room, and is
 * the number §8.5.2 states.
 */
export const MIN_HIT_TARGET_PX = 32;

/** What kind of thing a target is. The order in {@link HIT_PRIORITY} is the tiebreak. */
export type HitKind = 'handle' | 'node' | 'marker' | 'trajectory';

/**
 * Most specific first. A target of an earlier kind beats any target of a later one,
 * however much closer the later one is.
 *
 * Exported so the rule is checkable rather than implied by a chain of comparisons, and
 * so a test can assert the documented order rather than transcribe it.
 */
export const HIT_PRIORITY: readonly HitKind[] = Object.freeze([
  'handle',
  'node',
  'marker',
  'trajectory',
] as const);

/** A point-like target: a marker, a node diamond, the grab point of a handle. */
export interface PointHitTarget {
  readonly shape: 'point';
  readonly kind: HitKind;
  /** The caller's identity for this thing. Opaque here. */
  readonly id: string;
  readonly at: ScreenPoint;
  /**
   * The drawn radius in CSS pixels, when it is larger than the minimum target.
   *
   * Absent means "drawn smaller than it is clickable", which is the normal case and the
   * point of §8.5.2: a 4 px node marker still has a 32 px target.
   */
  readonly visualRadius?: number;
}

/** A path-like target: a trajectory a click can place a node on (§8.5.2). */
export interface PathHitTarget {
  readonly shape: 'path';
  readonly kind: HitKind;
  readonly id: string;
  readonly points: readonly ScreenPoint[];
  /** The drawn stroke width in CSS pixels, when wider than the minimum target. */
  readonly visualWidth?: number;
}

export type HitTarget = PointHitTarget | PathHitTarget;

/** What the index found. `distance` is in CSS pixels, from the point to the target. */
export interface Hit {
  readonly kind: HitKind;
  readonly id: string;
  readonly distance: number;
  /** Index of the target in the list the index was built from. */
  readonly target: number;
}

/** A target with everything precomputed that does not depend on the query point. */
interface IndexedTarget {
  readonly target: HitTarget;
  readonly order: number;
  readonly priority: number;
  readonly radius: number;
  /** Bounds already expanded by `radius`, so a miss costs four comparisons. */
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

/** A built index. Rebuild it on layout change, never per frame. */
export interface HitIndex {
  /** The targets, in the order they were supplied. */
  readonly targets: readonly HitTarget[];
  /** Precomputed entries. Not part of the public shape; exposed for tests. */
  readonly entries: readonly IndexedTarget[];
}

/**
 * The radius a hit is measured against, in CSS pixels.
 *
 * `max(visual, 16)` — never smaller than half of §8.5.2's 32 px target, and larger when
 * the thing is actually drawn larger, because a target smaller than the mark it
 * represents is its own kind of wrong.
 */
export const hitRadius = (target: HitTarget): number => {
  const minimum = MIN_HIT_TARGET_PX / 2;
  const visual =
    target.shape === 'point' ? (target.visualRadius ?? 0) : (target.visualWidth ?? 0) / 2;
  return Math.max(minimum, visual);
};

const priorityOf = (kind: HitKind): number => {
  const index = HIT_PRIORITY.indexOf(kind);
  // An unknown kind sorts last rather than throwing: a new kind added upstream should
  // degrade to "least specific", not break every click on the screen.
  return index < 0 ? HIT_PRIORITY.length : index;
};

/**
 * Squared distance from `p` to the segment `a`–`b`.
 *
 * Squared, and the caller takes the root once at the end: the inner loop over a
 * 512-vertex trajectory runs per pointer event, and a square root per segment is the
 * only expensive operation in it.
 */
const distanceSqToSegment = (p: ScreenPoint, a: ScreenPoint, b: ScreenPoint): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) {
    const px = p.x - a.x;
    const py = p.y - a.y;
    return px * px + py * py;
  }
  // Projection parameter, clamped to the segment: an unclamped projection measures to
  // the infinite line, which reports a hit on a trajectory the click was nowhere near.
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = a.x + t * dx - p.x;
  const cy = a.y + t * dy - p.y;
  return cx * cx + cy * cy;
};

/** Distance from a point to a target, in CSS pixels. `Infinity` for an empty path. */
export const distanceToTarget = (target: HitTarget, point: ScreenPoint): number => {
  if (target.shape === 'point') {
    return Math.hypot(point.x - target.at.x, point.y - target.at.y);
  }

  let best = Number.POSITIVE_INFINITY;
  const { points } = target;
  if (points.length === 1) {
    const only = points[0];
    if (only === undefined) return Number.POSITIVE_INFINITY;
    return Math.hypot(point.x - only.x, point.y - only.y);
  }
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    if (a === undefined || b === undefined) continue;
    const d = distanceSqToSegment(point, a, b);
    if (d < best) best = d;
  }
  return best === Number.POSITIVE_INFINITY ? best : Math.sqrt(best);
};

const boundsOf = (
  target: HitTarget,
  radius: number,
): Omit<IndexedTarget, 'target' | 'order' | 'priority' | 'radius'> => {
  if (target.shape === 'point') {
    return {
      minX: target.at.x - radius,
      maxX: target.at.x + radius,
      minY: target.at.y - radius,
      maxY: target.at.y + radius,
    };
  }

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const p of target.points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return {
    minX: minX - radius,
    maxX: maxX + radius,
    minY: minY - radius,
    maxY: maxY + radius,
  };
};

/**
 * Build the index.
 *
 * Cheap enough to do on any layout change and far too expensive to do per frame, which
 * is the distinction §11.8 is drawing. Bounds are expanded by the hit radius here so
 * that rejecting a target during a query is four comparisons and no arithmetic.
 */
export const buildHitIndex = (targets: readonly HitTarget[]): HitIndex => {
  const entries = targets.map((target, order) => {
    const radius = hitRadius(target);
    return {
      target,
      order,
      priority: priorityOf(target.kind),
      radius,
      ...boundsOf(target, radius),
    };
  });
  return { targets, entries };
};

/**
 * What the player hit, or `undefined` for empty space.
 *
 * A pure function of the index and the point — no canvas, no DOM, no event object — which
 * is what #114 asks for and what lets every case in `hit-test.test.ts` be written as an
 * arrangement of coordinates.
 *
 * Resolution, in order: **kind first** (see `HIT_PRIORITY` and the module docstring),
 * then distance, then the order the target was supplied in. The last is what makes the
 * result independent of anything that could vary between runs.
 */
export const hitTest = (index: HitIndex, point: ScreenPoint): Hit | undefined => {
  let best: Hit | undefined;
  let bestPriority = Number.POSITIVE_INFINITY;

  for (const entry of index.entries) {
    // A target already beaten on kind cannot win on distance, so skip the geometry.
    if (entry.priority > bestPriority) continue;
    if (
      point.x < entry.minX ||
      point.x > entry.maxX ||
      point.y < entry.minY ||
      point.y > entry.maxY
    ) {
      continue;
    }

    const distance = distanceToTarget(entry.target, point);
    if (distance > entry.radius) continue;

    if (
      best === undefined ||
      entry.priority < bestPriority ||
      (entry.priority === bestPriority && distance < best.distance)
    ) {
      best = {
        kind: entry.target.kind,
        id: entry.target.id,
        distance,
        target: entry.order,
      };
      bestPriority = entry.priority;
    }
  }

  return best;
};

/**
 * Every target under a point, most specific first.
 *
 * The context menu of §8.5.2 and the keyboard's "cycle what is here" both want the whole
 * stack rather than the winner. Sorted by the same rule {@link hitTest} applies, so the
 * first entry is always what a click would have selected.
 */
export const hitTestAll = (index: HitIndex, point: ScreenPoint): readonly Hit[] => {
  const hits: { hit: Hit; priority: number }[] = [];
  for (const entry of index.entries) {
    if (
      point.x < entry.minX ||
      point.x > entry.maxX ||
      point.y < entry.minY ||
      point.y > entry.maxY
    ) {
      continue;
    }
    const distance = distanceToTarget(entry.target, point);
    if (distance > entry.radius) continue;
    hits.push({
      hit: { kind: entry.target.kind, id: entry.target.id, distance, target: entry.order },
      priority: entry.priority,
    });
  }

  hits.sort(
    (a, b) =>
      a.priority - b.priority || a.hit.distance - b.hit.distance || a.hit.target - b.hit.target,
  );
  return hits.map((h) => h.hit);
};
