/**
 * Maneuver node markers and their two-axis handles — §9.3, §8.5.2, §7.2, DEP-10, #110.
 *
 * §9.3: *"◆ on the trajectory with a two-axis handle cross; selected nodes get a ring."*
 *
 * ## The handle cross follows the RTN basis, and that is the physics in this file
 *
 * §7.2 states the frame precisely:
 *
 * ```
 * R̂ = r / |r|                 radial, outward
 * N̂ = (r × v) / |r × v|       normal, along angular momentum
 * T̂ = N̂ × R̂                  transverse, completing the set
 * ```
 *
 * The handles are drawn along `R̂` and `T̂` **at that node's own epoch**, so the cross
 * rotates as the node moves around the orbit — which is not decoration. A player dragging
 * the transverse handle is adding Δv along `T̂`, and if the drawn axis pointed anywhere
 * else the mark would be lying about what the drag does. §8.5.2 puts the drag on the
 * handle's own axis, so the arrow the player pulls has to be the direction the burn goes.
 *
 * §7.2 also warns that `T̂` is *transverse*, not along-velocity: the two coincide only for
 * circular orbits, and differ by the flight-path angle otherwise. This module draws `T̂`,
 * the real one. Drawing the velocity direction instead would be right at e = 0 and
 * quietly wrong everywhere the game gets interesting.
 *
 * ## "Prograde" is a label, not a lie
 *
 * DEP-10: the transverse axis is *labelled* "prograde" because that is the word players
 * know. §7.5 files it as a **naming** departure rather than a physics one, and this
 * module keeps it that way — `HANDLE_AXES` carries an `axis` naming the real basis vector
 * and a `labelKey` naming the catalogue entry the player sees. The geometry uses the
 * first; only the text uses the second, and the text is resolved by `@hh/ui` (FR-910).
 *
 * Nothing here builds a sentence, and nothing here is misled by the word.
 *
 * ## This draws; #135 drags
 *
 * #110's fifth criterion asks that rendering be decoupled from interaction, and the seam
 * is the hit-test index (#114): this module emits handle *positions* and the ids that go
 * with them, `buildHitIndex` turns those into targets, and #135 reads the index. There is
 * no pointer event in this file and no mutable selection state — `selected` is a
 * parameter, so a frame is a pure function of the plan.
 *
 * ## Constant screen size, 32 px targets
 *
 * Handle arms are a fixed pixel length from the node, exactly like the markers in
 * `markers.ts` and for the same §8.5.2 reason. Their *hit* radius is `hit-test.ts`'s
 * business and is 16 px whatever they are drawn at, which is why the arms can be as short
 * as legibility wants without becoming hard to grab.
 */
import type { EciVector, State } from '@hh/astro';
import { fromRtn, rtn } from '@hh/astro';
import type { Metres, MetresPerSec } from '@hh/math';
import { V, metres } from '@hh/math';

import type { Camera } from './camera.js';
import { worldToScreen } from './camera.js';
import type { Primitive, PolygonPrimitive, PolylinePrimitive, ScreenPoint } from './renderer.js';
import type { SceneColours } from './style.js';

/** Length of a handle arm from the node, in CSS pixels. */
export const HANDLE_ARM_PX = 26;

/** Half-width of the node diamond, in CSS pixels. */
export const NODE_RADIUS_PX = 6;

/** Radius of the selection ring, in CSS pixels. Outside the diamond, inside the arms. */
export const SELECTION_RING_PX = 11;

/**
 * The two draggable axes, with the basis vector each really is and the label a player
 * really sees.
 *
 * Both halves are here on purpose. Separating the geometry's `axis` from the catalogue's
 * `labelKey` is what makes DEP-10 a naming departure that a reader can check, rather than
 * a comment claiming one.
 *
 * The normal axis `N̂` is deliberately absent: v1.0's contracts are equatorial-equivalent
 * (§6.8), a plane change is not a verb the player has (§6.2), and a third handle would be
 * a control that does nothing in every shipped contract.
 */
export const HANDLE_AXES = Object.freeze([
  Object.freeze({
    id: 'prograde',
    /** The transverse basis vector `T̂` — *not* the velocity direction. See the docstring. */
    axis: 'transverse',
    /** DEP-10. Resolved by `@hh/ui`; never a literal string in this package. */
    labelKey: 'planner.handle.prograde',
  }),
  Object.freeze({
    id: 'radial',
    axis: 'radial',
    labelKey: 'planner.handle.radial',
  }),
] as const);

/** One of the two handle axes. */
export type HandleAxisId = (typeof HANDLE_AXES)[number]['id'];

export interface NodeSpec {
  /** Stable identity, for the hit-test index and the plan panel. */
  readonly id: string;
  /** The state at the node's epoch: position and velocity, which is what defines RTN. */
  readonly state: State;
  /** Whether this node carries the selection ring. */
  readonly selected: boolean;
  /**
   * Which apsis DEP-07 snapped this burn to, or `null` — #136.
   *
   * The snap moves a burn to an epoch the player did not choose, and §8.5.2 asks for that
   * to be visible on the marker as well as in the plan panel. Optional so that a caller
   * that does not know — the scene harness, a test building a bare spec — draws an
   * unmarked node rather than having to say "not snapped" in every fixture.
   */
  readonly snappedTo?: 'periapsis' | 'apoapsis' | null;
}

/** Where a handle's grab point is, and which axis it belongs to. */
export interface HandleAnchor {
  readonly nodeId: string;
  readonly axisId: HandleAxisId;
  /** Positive and negative ends of the axis. Both are draggable (#135). */
  readonly positive: ScreenPoint;
  readonly negative: ScreenPoint;
  /** The label's anchor, at the positive end. */
  readonly labelAt: ScreenPoint;
  /** The catalogue key for the axis name. Resolved by the caller (FR-910, DEP-10). */
  readonly labelKey: string;
}

/** A node's screen geometry, ready to be turned into primitives and hit targets. */
export interface NodeGeometry {
  readonly nodeId: string;
  readonly centre: ScreenPoint;
  readonly handles: readonly HandleAnchor[];
}

/** A diamond of `radiusPx` about `centre`. §9.3's ◆. */
export const nodeDiamond = (
  centre: ScreenPoint,
  colour: string,
  radiusPx = NODE_RADIUS_PX,
): PolygonPrimitive => ({
  kind: 'polygon',
  points: [
    { x: centre.x, y: centre.y - radiusPx },
    { x: centre.x + radiusPx, y: centre.y },
    { x: centre.x, y: centre.y + radiusPx },
    { x: centre.x - radiusPx, y: centre.y },
  ],
  fill: { colour },
});

/**
 * The screen direction of an RTN basis vector at a node's state.
 *
 * Built by asking `@hh/astro` for the RTN rotation and mapping a unit vector back into
 * the inertial frame, rather than by rebuilding `r/|r|` and `N̂ × R̂` here. The frame has
 * one definition (§7.2) and one implementation; a second one in the renderer is a second
 * thing to get wrong, and the way it would be wrong — a sign, or transverse confused with
 * velocity — is invisible on a circular orbit and wrong on every other.
 *
 * The result is a **screen-space direction**, normalised, because the handle's length is
 * in pixels. `undefined` when the direction projects to nothing, which happens when the
 * axis points straight at the viewer.
 */
export const axisScreenDirection = (
  camera: Camera,
  state: State,
  axis: 'radial' | 'transverse',
): ScreenPoint | undefined => {
  // Components are ordered `(radial, transverse, normal)` — the order `eciToRtnMatrix`
  // builds its rows in, and the order the letters in "RTN" are in. Worth naming rather
  // than indexing blind: putting the transverse unit in the third slot would draw the
  // *normal* axis, which for an equatorial orbit points straight at the viewer and
  // projects to a dot, so the handle would simply vanish rather than look wrong.
  const unit = rtn(
    V.vec3(metres(axis === 'radial' ? 1 : 0), metres(axis === 'transverse' ? 1 : 0), metres(0)),
  );
  const inertial = fromRtn(unit, state.position, state.velocity);

  const { right, up } = camera.basis;
  const dx = V.dot(inertial, right);
  const dy = -V.dot(inertial, up);
  const length = Math.hypot(dx, dy);
  if (!(length > 1e-12)) return undefined;
  return { x: dx / length, y: dy / length };
};

/**
 * A node's screen geometry: where it sits and where its handles reach.
 *
 * Separated from the primitives so that the hit-test index (#114) and the label layer
 * (#113) can be built from the same numbers the drawing uses. Two sources for a handle's
 * position would be two chances for the target to drift off the mark.
 */
export const nodeGeometry = (
  camera: Camera,
  node: NodeSpec,
  armPx = HANDLE_ARM_PX,
): NodeGeometry => {
  const centre = worldToScreen(camera, node.state.position);

  const handles: HandleAnchor[] = [];
  for (const axis of HANDLE_AXES) {
    const direction = axisScreenDirection(camera, node.state, axis.axis);
    if (direction === undefined) continue;
    const positive = { x: centre.x + direction.x * armPx, y: centre.y + direction.y * armPx };
    const negative = { x: centre.x - direction.x * armPx, y: centre.y - direction.y * armPx };
    handles.push({
      nodeId: node.id,
      axisId: axis.id,
      positive,
      negative,
      // A little beyond the arm, so the text clears the arrowhead.
      labelAt: {
        x: centre.x + direction.x * (armPx + 10),
        y: centre.y + direction.y * (armPx + 10),
      },
      labelKey: axis.labelKey,
    });
  }

  return { nodeId: node.id, centre, handles };
};

/** A ring of `radiusPx`, as a closed polyline. §9.3's selection ring. */
const ring = (centre: ScreenPoint, radiusPx: number, colour: string): PolylinePrimitive => {
  const points: ScreenPoint[] = [];
  for (let i = 0; i < 48; i++) {
    const angle = (2 * Math.PI * i) / 48;
    points.push({
      x: centre.x + radiusPx * Math.cos(angle),
      y: centre.y + radiusPx * Math.sin(angle),
    });
  }
  return { kind: 'polyline', points, closed: true, stroke: { colour, width: 1.5 } };
};

/**
 * How far above or below the diamond DEP-07's caret sits.
 *
 * Outside `NODE_RADIUS_PX` so it reads as a mark *on* the node rather than as part of the
 * diamond, and inside `SELECTION_RING_PX` so a selected snapped node does not draw the
 * caret on top of its own ring.
 */
const SNAP_CARET_OFFSET_PX = 8;

/** Half the caret's width. Small: it is a tick, not a chevron. */
const SNAP_CARET_HALF_PX = 3.5;

/**
 * DEP-07's mark on the marker — #136.
 *
 * A caret above for apoapsis and below for periapsis, pointing the way the orbit does:
 * apoapsis is the high point and periapsis the low one, so "up" and "down" carry the
 * meaning rather than being an arbitrary pairing a player has to memorise.
 *
 * **The same glyphs the plan panel's row uses**, deliberately. A snapped burn is marked in
 * two places and a player should not have to learn that they are the same statement.
 *
 * It is never the only channel (NFR-019): the plan panel says "snapped to apoapsis" in
 * words for the same node, which is §8.8's canvas-parity rule met by the region that
 * already exists rather than by a label competing for §11.8's budget of forty.
 */
const snapCaret = (
  centre: ScreenPoint,
  kind: 'periapsis' | 'apoapsis',
  colour: string,
): PolylinePrimitive => {
  // Screen y grows downward, so apoapsis — drawn above — is the negative offset.
  const tipY =
    kind === 'apoapsis' ? centre.y - SNAP_CARET_OFFSET_PX : centre.y + SNAP_CARET_OFFSET_PX;
  const baseY = kind === 'apoapsis' ? tipY + SNAP_CARET_HALF_PX : tipY - SNAP_CARET_HALF_PX;
  return {
    kind: 'polyline',
    points: [
      { x: centre.x - SNAP_CARET_HALF_PX, y: baseY },
      { x: centre.x, y: tipY },
      { x: centre.x + SNAP_CARET_HALF_PX, y: baseY },
    ],
    stroke: { colour, width: 1.5 },
  };
};

/** The node's own marks: diamond, the ring when selected, and DEP-07's caret when snapped. */
export const nodePrimitives = (
  geometry: NodeGeometry,
  node: NodeSpec,
  colours: SceneColours,
): Primitive[] => {
  const colour = node.selected ? colours.nodeSelected : colours.node;
  const out: Primitive[] = [nodeDiamond(geometry.centre, colour)];
  if (node.selected) out.push(ring(geometry.centre, SELECTION_RING_PX, colours.nodeSelected));
  const snapped = node.snappedTo ?? null;
  if (snapped !== null) out.push(snapCaret(geometry.centre, snapped, colour));
  return out;
};

/**
 * The handle cross: one line through the node per axis, with a tick at each end.
 *
 * Drawn through the node rather than as two half-arms, because a burn is signed — the
 * player can pull prograde or retrograde on the same axis, and a cross says that where
 * two separate arms would not.
 */
export const handlePrimitives = (
  geometry: NodeGeometry,
  node: NodeSpec,
  colours: SceneColours,
): Primitive[] => {
  const colour = node.selected ? colours.nodeSelected : colours.node;
  const out: Primitive[] = [];
  for (const handle of geometry.handles) {
    out.push({
      kind: 'polyline',
      points: [handle.negative, handle.positive],
      stroke: { colour, width: 1.25, alpha: 0.9 },
    });
    // A small square at each end, so the grabbable point is visible as well as reachable.
    for (const end of [handle.positive, handle.negative]) {
      out.push({
        kind: 'polygon',
        points: [
          { x: end.x - 2.5, y: end.y - 2.5 },
          { x: end.x + 2.5, y: end.y - 2.5 },
          { x: end.x + 2.5, y: end.y + 2.5 },
          { x: end.x - 2.5, y: end.y + 2.5 },
        ],
        fill: { colour },
      });
    }
  }
  return out;
};

/** The world position of a node, for anything that needs it un-projected. */
export const nodePosition = (node: NodeSpec): EciVector<Metres> => node.state.position;

/** The velocity at a node, kept distinct from `T̂` — see the docstring on §7.2. */
export const nodeVelocity = (node: NodeSpec): EciVector<MetresPerSec> => node.state.velocity;
