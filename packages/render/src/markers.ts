/**
 * Ship and target markers, and the trails behind them — §9.3, §8.5.2, FR-602, #109.
 *
 * ## Shape carries the identity, not colour
 *
 * §9.3 gives the ship a triangle and the target a diamond, and that pairing is doing
 * accessibility work rather than decoration. The two markers are the only things on
 * screen a player has to tell apart *instantly* while dragging, they are a handful of
 * pixels across, and they are frequently close together — which is the whole point of a
 * rendezvous. Colour at that size, against a dark field, is the least reliable channel
 * available. The shapes differ in vertex count and in silhouette, so they separate in
 * greyscale and at a glance.
 *
 * ## Constant screen size
 *
 * §8.5.2: markers "do not shrink when zoomed out". They are built directly in screen
 * pixels around a projected centre rather than as world-space geometry, so the camera's
 * scale never enters their size. A marker sized in metres would be sub-pixel at GEO
 * framing and enormous at a 40x LEO zoom, and the player would lose the ship exactly when
 * they zoomed out to find it.
 *
 * ## The trail is measured in simulation time — the whole of FR-602
 *
 * FR-602: *"Playback speed MUST be selectable up to 100 000x and MUST NOT affect the
 * outcome."* §9.3 asks for "roughly the last 10 minutes".
 *
 * The tempting implementation keeps the last N *frames* of positions in a ring buffer.
 * It is wrong in both directions and the failure is invisible in development. At 1x, 60
 * frames of a LEO orbit covers one second of flight and the trail is a dot. At 100 000x
 * the same 60 frames covers 27 hours and the trail wraps the orbit several times over.
 * Same code, same buffer, and the trail means something different at every speed —
 * which is exactly what FR-602 forbids, because it makes the presentation carry
 * information about the playback rate rather than about the trajectory.
 *
 * So the trail is **sampled**, not accumulated: given the arc and the scrub epoch, it
 * evaluates positions at fixed intervals of *simulation* time going backwards. The result
 * is a pure function of (elements, epoch) and is bit-for-bit identical at 1x and at
 * 100 000x, which `markers.test.ts` asserts by constructing both and comparing.
 *
 * It also means no per-frame state at all. Nothing to reset when the player scrubs
 * backwards, nothing to invalidate when a node moves, and no way for a dropped frame to
 * leave a gap in the trail.
 *
 * ## Fading
 *
 * A `PolylinePrimitive` carries one stroke, so a gradient along a path needs several
 * primitives. The trail is emitted as short segments with alpha ramping from nothing at
 * the tail to full at the head. `TRAIL_SEGMENTS` is what bounds the cost: two markers at
 * 24 segments is 48 primitives a frame, which sits comfortably inside §11.9's 8 ms drag
 * budget beside a few thousand orbit vertices.
 */
import type { OrbitShape } from '@hh/astro';
import type { EciVector } from '@hh/astro';
import type { Metres } from '@hh/math';

import type { Camera } from './camera.js';
import { worldToScreen } from './camera.js';
import type { Primitive, PolygonPrimitive, PolylinePrimitive, ScreenPoint } from './renderer.js';
import type { SceneColours } from './style.js';
import { keplerianSampler } from './trajectory.js';

/** §9.3: "a 10-minute fading trail". Simulation seconds, never frames. */
export const TRAIL_SECONDS = 600;

/**
 * Segments the trail is drawn in.
 *
 * Each is one primitive with its own alpha, because a polyline carries a single stroke.
 * 24 is enough that the fade reads as continuous and few enough that two trails cost 48
 * primitives a frame.
 */
export const TRAIL_SEGMENTS = 24;

/** Marker size in CSS pixels, measured as the radius of the circumscribing circle. */
export const MARKER_RADIUS_PX = 7;

/** Which body a marker is. The shape follows from this, and so does §9.3's glyph. */
export type MarkerKind = 'ship' | 'target';

export interface MarkerSpec {
  /** Stable identity, for the hit-test index. */
  readonly id: string;
  readonly kind: MarkerKind;
  /** The arc the body is on at the scrub epoch. */
  readonly elements: OrbitShape;
  /** Gravitational parameter, m³/s². */
  readonly mu: number;
  /**
   * Seconds from the arc's start to the scrub epoch.
   *
   * The marker sits here and the trail runs backwards from it, clipped at the arc's
   * start so a trail never runs back through a burn that has not happened on this arc.
   */
  readonly offsetSeconds: number;
}

/**
 * The ship's triangle, pointing along `heading`.
 *
 * Three vertices at 120 degrees, in screen pixels. A caller with no heading gets an
 * upright triangle, which is §9.3's glyph as printed.
 */
export const shipMarker = (
  centre: ScreenPoint,
  colour: string,
  radiusPx = MARKER_RADIUS_PX,
  heading = -Math.PI / 2,
): PolygonPrimitive => ({
  kind: 'polygon',
  points: [0, 1, 2].map((i) => {
    const angle = heading + (2 * Math.PI * i) / 3;
    return { x: centre.x + radiusPx * Math.cos(angle), y: centre.y + radiusPx * Math.sin(angle) };
  }),
  fill: { colour },
});

/** The target's diamond: four vertices on the axes. */
export const targetMarker = (
  centre: ScreenPoint,
  colour: string,
  radiusPx = MARKER_RADIUS_PX,
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
 * The positions behind a body over the last {@link TRAIL_SECONDS} of *simulation* time.
 *
 * Oldest first, so the caller can ramp alpha upward along the array. Sampling backwards
 * rather than accumulating is what makes this identical at every playback speed; see the
 * module docstring.
 *
 * Clipped at the arc's start: the marker is `offsetSeconds` into its arc, and a trail
 * longer than that would be extrapolating this conic back through an impulse the
 * spacecraft actually made, drawing a path it never flew.
 */
export const trailPoints = (
  spec: MarkerSpec,
  trailSeconds = TRAIL_SECONDS,
  segments = TRAIL_SEGMENTS,
): EciVector<Metres>[] => {
  const sample = keplerianSampler(spec.elements, spec.mu);
  const span = Math.min(trailSeconds, Math.max(spec.offsetSeconds, 0));
  if (!(span > 0)) return [];

  const points: EciVector<Metres>[] = [];
  for (let i = 0; i <= segments; i++) {
    // From the tail (oldest) forward to the marker, so index order is time order.
    const offset = spec.offsetSeconds - span + (span * i) / segments;
    const point = sample(offset);
    if (point !== undefined) points.push(point);
  }
  return points;
};

/**
 * The trail as fading segments, oldest and faintest first.
 *
 * Alpha ramps linearly from nearly nothing at the tail to `maxAlpha` at the head. Linear
 * rather than eased, because the trail is a time axis and a non-linear ramp would make
 * equal intervals of time look unequal — the same mistake, in the alpha channel, that
 * equal-distance dots make in the spatial one (#108).
 */
export const trailPrimitives = (
  camera: Camera,
  spec: MarkerSpec,
  colours: SceneColours,
  trailSeconds = TRAIL_SECONDS,
  segments = TRAIL_SEGMENTS,
): PolylinePrimitive[] => {
  const world = trailPoints(spec, trailSeconds, segments);
  if (world.length < 2) return [];

  const screen = world.map((p) => worldToScreen(camera, p));
  const colour = spec.kind === 'ship' ? colours.ship : colours.targetMarker;
  const maxAlpha = 0.7;

  const out: PolylinePrimitive[] = [];
  for (let i = 1; i < screen.length; i++) {
    const from = screen[i - 1];
    const to = screen[i];
    if (from === undefined || to === undefined) continue;
    out.push({
      kind: 'polyline',
      points: [from, to],
      stroke: { colour, width: 1.5, alpha: (maxAlpha * i) / (screen.length - 1) },
    });
  }
  return out;
};

/** Where a marker sits on screen at the scrub epoch, or `undefined` if it cannot be placed. */
export const markerCentre = (camera: Camera, spec: MarkerSpec): ScreenPoint | undefined => {
  const world = keplerianSampler(spec.elements, spec.mu)(spec.offsetSeconds);
  return world === undefined ? undefined : worldToScreen(camera, world);
};

/** The marker glyph alone, at constant screen size. */
export const markerPrimitive = (
  camera: Camera,
  spec: MarkerSpec,
  colours: SceneColours,
  radiusPx = MARKER_RADIUS_PX,
): PolygonPrimitive | undefined => {
  const centre = markerCentre(camera, spec);
  if (centre === undefined) return undefined;
  return spec.kind === 'ship'
    ? shipMarker(centre, colours.ship, radiusPx)
    : targetMarker(centre, colours.targetMarker, radiusPx);
};

/** A body's trail and its marker, in draw order — trail behind, marker in front. */
export const markerWithTrail = (
  camera: Camera,
  spec: MarkerSpec,
  colours: SceneColours,
): { readonly trail: readonly Primitive[]; readonly marker: Primitive | undefined } => ({
  trail: trailPrimitives(camera, spec, colours),
  marker: markerPrimitive(camera, spec, colours),
});
