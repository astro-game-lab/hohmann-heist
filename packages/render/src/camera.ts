/**
 * The camera: an orthographic projection from inertial world metres to screen pixels,
 * plus the auto-framing that makes orbital distances fit on a laptop.
 *
 * ## The scale problem, and what §8.4 decided
 *
 * Earth's radius is 6 378 km. A LEO orbit sits 400 km above it — 6% of a radius. GEO
 * is 6.6 radii out and C11's target is 17. One fixed scale makes either LEO invisible
 * or GEO off-screen, so §8.4 chose **linear scale, auto-framed, with manual zoom**,
 * and explicitly rejected a logarithmic radial mapping: it makes an ellipse not look
 * like an ellipse, and the visual intuition this game exists to build would then be
 * built on a lie (G3). There is exactly one multiplier from metres to pixels in this
 * module, `Camera.scale`, and it is applied to every coordinate equally.
 *
 * ## Why the transform is in float64 and where the float32 cast lives
 *
 * NFR-010: "coordinate transforms to camera space occur in float64 before any float32
 * cast". This is not a stylistic preference. A float32 has about 7 significant decimal
 * digits, so at GEO — 4.2e7 m — its spacing is roughly 4 m, and at C11's 1e8 m it is
 * about 8 m. Round the *world* coordinate to float32 and sub-kilometre structure is
 * gone before the camera ever sees it: two nodes 200 m apart collapse onto the same
 * point, and a closest-approach tie line that should read 300 m reads zero.
 *
 * Subtracting the camera centre first is what fixes it, and it is why this is called
 * camera-relative rendering. `r - centre` is a small number — an on-screen point is at
 * most a viewport-width of metres from the centre — so once the subtraction has
 * happened in float64, float32 has ample resolution for what remains. Hence the shape
 * of this module: `worldToScreen` returns float64, and `projectInto` is the only
 * function in the package that writes a `Float32Array`. NFR-001 says the renderer is
 * the sole float32 consumer; this is the one place it consumes it.
 *
 * ## Everything here is a pure function of state
 *
 * A `Camera` is an immutable value. `pan`, `zoomAt`, `frameBounds` and `easeTo` return
 * new cameras. There is no canvas, no clock and no DOM in this file — #102 asks for
 * pan and zoom "testable without a canvas", and easing takes normalised progress
 * rather than a duration so that the caller owns elapsed time. §9.4's 400 ms and its
 * `prefers-reduced-motion` override are the application's to apply, against
 * `REFRAME_DURATION_SECONDS`.
 */
import type { EciVector } from '@hh/astro';
import { eci } from '@hh/astro';
import type { Metres, Vec3 } from '@hh/math';
import { V, metres } from '@hh/math';

import type { ScreenPoint, Viewport } from './renderer.js';

/**
 * The plane the world is projected onto, as an orthonormal pair of inertial vectors.
 *
 * `right` maps to screen +x and `up` maps to screen −y, so the view direction is
 * `right × up`, pointing out of the screen toward the viewer.
 */
export interface ViewBasis {
  readonly right: Vec3;
  readonly up: Vec3;
}

/**
 * Looking down the inertial +z axis at the equatorial plane, with ECI +x to the right.
 *
 * The default, because every v1.0 contract is equatorial-equivalent (§6.8) so this is
 * the common case rather than a simplification. A prograde orbit runs counter-clockwise
 * on screen under this basis, which is the orientation every textbook diagram uses.
 */
export const EQUATORIAL_BASIS: ViewBasis = Object.freeze({
  right: Object.freeze({ x: 1, y: 0, z: 0 }),
  up: Object.freeze({ x: 0, y: 1, z: 0 }),
});

/** Tolerance on the orthonormality of a supplied basis. Generous: this catches mistakes, not rounding. */
const BASIS_TOLERANCE = 1e-9;

/** §8.4: the auto-frame fits the union with a 12% margin. */
export const AUTO_FRAME_MARGIN = 0.12;

/** §8.4: manual zoom is clamped to `[0.5x, 40x]` of the auto-frame scale. */
export const MIN_ZOOM = 0.5;
/** §8.4: manual zoom is clamped to `[0.5x, 40x]` of the auto-frame scale. */
export const MAX_ZOOM = 40;

/** §8.4: re-framing triggers only when the framed union changes by more than 20%. */
export const REFRAME_THRESHOLD = 0.2;

/** §8.4 and §9.4: a re-frame eases over 400 ms. Zero under `prefers-reduced-motion` (§9.4). */
export const REFRAME_DURATION_SECONDS = 0.4;

/**
 * An orthographic camera over the inertial frame.
 *
 * Immutable. Derive a new one rather than reaching for a setter — every function in
 * this module returns a fresh camera, which is what makes an eased re-frame a pure
 * interpolation between two values rather than a mutation schedule.
 */
export interface Camera {
  /** The world point at the centre of the viewport, in inertial metres. */
  readonly centre: EciVector<Metres>;
  /** CSS pixels per metre. Strictly positive. Applied linearly to every coordinate. */
  readonly scale: number;
  /**
   * The auto-frame scale this camera's zoom is measured against.
   *
   * `scale / autoScale` is the zoom factor §8.4 clamps to `[0.5, 40]`. Kept as its own
   * field rather than recomputed because the clamp has to survive a pan — panning does
   * not change what the auto-frame *would* be, and recomputing it from the current
   * bounds on every pan would let the clamp drift under the player's hand.
   */
  readonly autoScale: number;
  /** The projection plane. */
  readonly basis: ViewBasis;
  /** Viewport size in CSS pixels. */
  readonly viewport: Viewport;
}

/** An axis-aligned box in the camera's projection plane, in metres from the world origin. */
export interface ViewBounds {
  readonly minU: number;
  readonly maxU: number;
  readonly minV: number;
  readonly maxV: number;
}

/**
 * Build an orthonormal basis looking along `normal`, with `preferredUp` projected into
 * the plane to fix the roll.
 *
 * Worth having as a function rather than leaving to call sites: a basis that is merely
 * *nearly* orthonormal skews every projection slightly, and the failure looks like a
 * subtly wrong orbit rather than like a bug in a basis.
 *
 * @throws RangeError when `normal` is degenerate, or when `preferredUp` is parallel to
 * it and so fixes no roll.
 */
export const basisLookingAlong = (
  normal: Vec3,
  preferredUp: Vec3 = { x: 0, y: 0, z: 1 },
): ViewBasis => {
  if (V.normSq(normal) === 0) throw new RangeError('view normal must be non-zero');
  const forward = V.normalize(normal);
  const right = V.cross(preferredUp, forward);
  if (V.normSq(right) < BASIS_TOLERANCE) {
    throw new RangeError('preferred up is parallel to the view normal; roll is undefined');
  }
  const r = V.normalize(right);
  return { right: r, up: V.normalize(V.cross(forward, r)) };
};

const isOrthonormal = ({ right, up }: ViewBasis): boolean =>
  Math.abs(V.normSq(right) - 1) < BASIS_TOLERANCE &&
  Math.abs(V.normSq(up) - 1) < BASIS_TOLERANCE &&
  Math.abs(V.dot(right, up)) < BASIS_TOLERANCE;

/**
 * Build a camera.
 *
 * @throws RangeError when the scale is not finite and positive, when the viewport has
 * no area, or when the basis is not orthonormal.
 */
export const createCamera = (camera: Camera): Camera => {
  if (!(camera.scale > 0) || !Number.isFinite(camera.scale)) {
    throw new RangeError(`scale must be finite and positive, got ${String(camera.scale)}`);
  }
  if (!(camera.autoScale > 0) || !Number.isFinite(camera.autoScale)) {
    throw new RangeError(`autoScale must be finite and positive, got ${String(camera.autoScale)}`);
  }
  if (!(camera.viewport.width > 0) || !(camera.viewport.height > 0)) {
    throw new RangeError('viewport must have a positive width and height');
  }
  if (!isOrthonormal(camera.basis)) {
    throw new RangeError('view basis must be orthonormal; build one with basisLookingAlong');
  }
  return Object.freeze({ ...camera });
};

/** The zoom factor relative to the auto-frame, which §8.4 clamps to `[0.5, 40]`. */
export const zoomFactor = (camera: Camera): number => camera.scale / camera.autoScale;

/** Clamp a scale into §8.4's `[0.5x, 40x]` band around an auto-frame scale. */
export const clampScale = (scale: number, autoScale: number): number =>
  Math.min(Math.max(scale, autoScale * MIN_ZOOM), autoScale * MAX_ZOOM);

/**
 * Project a world point to screen pixels, entirely in float64.
 *
 * The subtraction happens before the multiply, which is the whole of NFR-010: see the
 * module docstring for what goes wrong when it does not.
 */
export const worldToScreen = (camera: Camera, world: EciVector<Metres>): ScreenPoint => {
  const dx = world.x - camera.centre.x;
  const dy = world.y - camera.centre.y;
  const dz = world.z - camera.centre.z;
  const { right, up } = camera.basis;
  const u = dx * right.x + dy * right.y + dz * right.z;
  const v = dx * up.x + dy * up.y + dz * up.z;
  return {
    x: camera.viewport.width / 2 + u * camera.scale,
    // Screen y grows downward; the projection plane's v grows upward.
    y: camera.viewport.height / 2 - v * camera.scale,
  };
};

/**
 * The inverse of `worldToScreen`: the point on the camera's projection plane, through
 * the camera centre, that appears at `point`.
 *
 * The plane matters — an orthographic projection is not invertible in three
 * dimensions, so this recovers the one pre-image that lies in the plane the camera is
 * looking at. That is what a pointer position means: hit-testing against anything with
 * depth compares in screen space, not here.
 */
export const screenToWorld = (camera: Camera, point: ScreenPoint): EciVector<Metres> => {
  const u = (point.x - camera.viewport.width / 2) / camera.scale;
  const v = (camera.viewport.height / 2 - point.y) / camera.scale;
  const { right, up } = camera.basis;
  return eci(
    V.vec3(
      metres(camera.centre.x + u * right.x + v * up.x),
      metres(camera.centre.y + u * right.y + v * up.y),
      metres(camera.centre.z + u * right.z + v * up.z),
    ),
  );
};

/**
 * Project many world points into a `Float32Array` as interleaved `x, y` pairs.
 *
 * **This is the only float32 in the package** (NFR-001, NFR-010). Each coordinate is
 * fully reduced to camera space in float64 and the narrowing happens on the store into
 * the typed array, after the subtraction that made the value small enough to survive
 * it.
 *
 * @returns the number of points written — `min(points.length, out.length / 2)`.
 */
export const projectInto = (
  camera: Camera,
  points: readonly EciVector<Metres>[],
  out: Float32Array,
): number => {
  const { right, up } = camera.basis;
  const { scale } = camera;
  const halfWidth = camera.viewport.width / 2;
  const halfHeight = camera.viewport.height / 2;
  const capacity = Math.floor(out.length / 2);

  let count = 0;
  for (const p of points) {
    if (count >= capacity) break;
    const dx = p.x - camera.centre.x;
    const dy = p.y - camera.centre.y;
    const dz = p.z - camera.centre.z;
    out[count * 2] = halfWidth + (dx * right.x + dy * right.y + dz * right.z) * scale;
    out[count * 2 + 1] = halfHeight - (dx * up.x + dy * up.y + dz * up.z) * scale;
    count++;
  }
  return count;
};

/**
 * Pan by a screen-pixel delta: the world appears to move by `(dx, dy)`.
 *
 * A pure state transform — no pointer, no canvas, no accumulated drag state. The
 * scale is untouched, so the zoom clamp cannot be violated by panning.
 */
export const pan = (camera: Camera, dx: number, dy: number): Camera => {
  const { right, up } = camera.basis;
  const du = -dx / camera.scale;
  const dv = dy / camera.scale;
  return Object.freeze({
    ...camera,
    centre: eci(
      V.vec3(
        metres(camera.centre.x + du * right.x + dv * up.x),
        metres(camera.centre.y + du * right.y + dv * up.y),
        metres(camera.centre.z + du * right.z + dv * up.z),
      ),
    ),
  });
};

/**
 * Zoom by `factor` about a screen anchor, keeping the world point under the anchor
 * fixed.
 *
 * Anchoring is why this takes a point rather than just a factor: zooming about the
 * viewport centre while the pointer is elsewhere slides the thing the player is
 * looking at out from under them. The scale is clamped to §8.4's band first, and the
 * centre is then solved against the *clamped* scale — so at the limit the view stops
 * rather than continuing to drift.
 */
export const zoomAt = (camera: Camera, factor: number, anchor: ScreenPoint): Camera => {
  if (!(factor > 0) || !Number.isFinite(factor)) {
    throw new RangeError(`zoom factor must be finite and positive, got ${String(factor)}`);
  }
  const scale = clampScale(camera.scale * factor, camera.autoScale);
  if (scale === camera.scale) return camera;

  const { right, up } = camera.basis;
  const shift = 1 / camera.scale - 1 / scale;
  const du = (anchor.x - camera.viewport.width / 2) * shift;
  const dv = (camera.viewport.height / 2 - anchor.y) * shift;

  return Object.freeze({
    ...camera,
    scale,
    centre: eci(
      V.vec3(
        metres(camera.centre.x + du * right.x + dv * up.x),
        metres(camera.centre.y + du * right.y + dv * up.y),
        metres(camera.centre.z + du * right.z + dv * up.z),
      ),
    ),
  });
};

/** Re-viewport a camera, holding the world at the centre and the scale fixed. */
export const withViewport = (camera: Camera, viewport: Viewport): Camera =>
  Object.freeze({ ...camera, viewport });

/** Bounds containing nothing. The identity for `unionBounds`. */
export const EMPTY_BOUNDS: ViewBounds = Object.freeze({
  minU: Number.POSITIVE_INFINITY,
  maxU: Number.NEGATIVE_INFINITY,
  minV: Number.POSITIVE_INFINITY,
  maxV: Number.NEGATIVE_INFINITY,
});

/** Whether bounds contain anything at all. */
export const isEmptyBounds = (bounds: ViewBounds): boolean =>
  !(bounds.maxU >= bounds.minU) || !(bounds.maxV >= bounds.minV);

/** Bounds of a set of world points, projected onto the camera plane. */
export const boundsOfPoints = (
  points: readonly EciVector<Metres>[],
  basis: ViewBasis,
): ViewBounds => {
  let minU = Number.POSITIVE_INFINITY;
  let maxU = Number.NEGATIVE_INFINITY;
  let minV = Number.POSITIVE_INFINITY;
  let maxV = Number.NEGATIVE_INFINITY;
  const { right, up } = basis;

  for (const p of points) {
    const u = p.x * right.x + p.y * right.y + p.z * right.z;
    const v = p.x * up.x + p.y * up.y + p.z * up.z;
    if (u < minU) minU = u;
    if (u > maxU) maxU = u;
    if (v < minV) minV = v;
    if (v > maxV) maxV = v;
  }
  return { minU, maxU, minV, maxV };
};

/**
 * Bounds of a sphere of `radius` centred on the world origin.
 *
 * Earth, in other words. A sphere projects to a disc of the same radius under an
 * orthographic projection whatever the basis, which is why this needs no basis
 * argument.
 */
export const boundsOfSphere = (radius: number): ViewBounds => ({
  minU: -radius,
  maxU: radius,
  minV: -radius,
  maxV: radius,
});

/** The smallest bounds containing both. */
export const unionBounds = (a: ViewBounds, b: ViewBounds): ViewBounds => ({
  minU: Math.min(a.minU, b.minU),
  maxU: Math.max(a.maxU, b.maxU),
  minV: Math.min(a.minV, b.minV),
  maxV: Math.max(a.maxV, b.maxV),
});

/** The union of any number of bounds. §8.4 frames ship ∪ target ∪ plan ∪ Earth. */
export const unionOf = (bounds: readonly ViewBounds[]): ViewBounds =>
  bounds.reduce(unionBounds, EMPTY_BOUNDS);

/**
 * The camera that fits `bounds` in `viewport` with §8.4's 12% margin.
 *
 * The margin is 12% of the *content's* extent on each side, so the union occupies
 * `1 / 1.24` of the tighter axis. Stating it against the content rather than against
 * the viewport keeps the framing scale-free: the same orbits fill the same fraction of
 * the screen whether the window is 600 px or 2 000 px wide.
 *
 * The returned camera has `scale === autoScale`, which is what makes it the reference
 * the zoom clamp is measured against.
 *
 * @throws RangeError when the bounds are empty.
 */
export const frameBounds = (
  bounds: ViewBounds,
  viewport: Viewport,
  basis: ViewBasis = EQUATORIAL_BASIS,
  margin: number = AUTO_FRAME_MARGIN,
): Camera => {
  if (isEmptyBounds(bounds)) throw new RangeError('cannot frame empty bounds');

  const padding = 1 + 2 * margin;
  // A degenerate extent is real: a perfectly circular orbit seen edge-on, or a single
  // point before a plan exists. Fall back to the other axis, and to a metre if both
  // collapse, rather than dividing by zero and returning an infinite scale.
  const extentU = (bounds.maxU - bounds.minU) * padding;
  const extentV = (bounds.maxV - bounds.minV) * padding;
  const scaleU = extentU > 0 ? viewport.width / extentU : Number.POSITIVE_INFINITY;
  const scaleV = extentV > 0 ? viewport.height / extentV : Number.POSITIVE_INFINITY;
  const fitted = Math.min(scaleU, scaleV);
  const scale = Number.isFinite(fitted) ? fitted : Math.min(viewport.width, viewport.height);

  const { right, up } = basis;
  const u = (bounds.minU + bounds.maxU) / 2;
  const v = (bounds.minV + bounds.maxV) / 2;

  return createCamera({
    centre: eci(
      V.vec3(
        metres(u * right.x + v * up.x),
        metres(u * right.y + v * up.y),
        metres(u * right.z + v * up.z),
      ),
    ),
    scale,
    autoScale: scale,
    basis,
    viewport,
  });
};

/**
 * Whether §8.4's 20% rule says to re-frame.
 *
 * "The union changes by more than 20%" has two ways of being true, and both are
 * checked because either alone lets a case through. The union can change **size** —
 * compared as a relative change in the auto-frame scale, symmetric so that shrinking by
 * a third counts the same as growing by a half. Or it can **move** without changing
 * size, which a scale comparison cannot see at all: a transfer that raises apoapsis on
 * the far side of Earth slides the framed centre a long way while the extent barely
 * moves. The displacement is measured in screen pixels at the target scale, against the
 * shorter viewport axis, so "moved by 20%" means a fifth of the visible field.
 *
 * Comparing against `current.autoScale` rather than `current.scale` is deliberate: a
 * player zoomed in by 30x has not changed the union, and should not be dragged back out
 * by a re-frame they did not ask for.
 */
export const needsReframe = (
  current: Camera,
  target: Camera,
  threshold: number = REFRAME_THRESHOLD,
): boolean => {
  const ratio = target.autoScale / current.autoScale;
  if (Math.max(ratio, 1 / ratio) - 1 > threshold) return true;

  const shift = V.distance(current.centre, target.centre);
  const field = Math.min(current.viewport.width, current.viewport.height);
  return (shift * target.autoScale) / field > threshold;
};

/**
 * Cubic ease-in-out, §9.4's easing for a camera re-frame.
 *
 * `t` is normalised progress. Values outside `[0, 1]` are clamped, so a caller that
 * overshoots its 400 ms with a long frame lands exactly on the target rather than past
 * it.
 */
export const easeInOut = (t: number): number => {
  if (!(t > 0)) return 0;
  if (t >= 1) return 1;
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};

/**
 * Interpolate between two cameras at eased progress `t`.
 *
 * **Scale interpolates geometrically, position linearly.** Zoom is multiplicative —
 * halfway between 1x and 100x is 10x, not 50.5x — and a linear interpolation of scale
 * spends most of its time near the wider view and then lurches, which reads as a
 * camera that cannot make up its mind. This is not in tension with §8.4's "scale is
 * linear": that governs the mapping from metres to pixels within a frame, which stays
 * strictly linear here. This governs how the multiplier changes between frames.
 *
 * Pure, and takes progress rather than a duration, so §9.4's 400 ms lives in the caller
 * and `prefers-reduced-motion` is served by passing `t = 1` on the first frame.
 */
export const easeTo = (from: Camera, to: Camera, t: number): Camera => {
  const e = easeInOut(t);
  if (e === 0) return from;
  if (e === 1) return to;

  const lerp = (a: number, b: number): number => a + (b - a) * e;
  const geometric = (a: number, b: number): number => a * Math.pow(b / a, e);

  return Object.freeze({
    centre: eci(
      V.vec3(
        metres(lerp(from.centre.x, to.centre.x)),
        metres(lerp(from.centre.y, to.centre.y)),
        metres(lerp(from.centre.z, to.centre.z)),
      ),
    ),
    scale: geometric(from.scale, to.scale),
    autoScale: geometric(from.autoScale, to.autoScale),
    basis: to.basis,
    viewport: to.viewport,
  });
};
