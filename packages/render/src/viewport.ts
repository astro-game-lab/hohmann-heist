/**
 * The CSS-pixel / device-pixel boundary — §11.8, #115.
 *
 * #115 asks that "CSS pixels and device pixels are converted at exactly one place, and
 * that conversion is tested". This module is that place. Everything above it — the
 * camera, every primitive, every hit target — is in **CSS pixels**, and the only code
 * that has any business knowing what a device pixel is lives here and in the renderer
 * that sizes a backing store from it.
 *
 * That boundary is not bookkeeping. A ratio applied twice is a scene at 4x, a ratio
 * applied nowhere is a blurry canvas on every laptop sold since 2015, and both failures
 * look like "the renderer is wrong" rather than like a unit error. Keeping the
 * conversion in one named function means there is exactly one thing to test and exactly
 * one place for it to be wrong.
 *
 * ## Why the cap is here and not at the call site
 *
 * `backingStoreScale` (in `renderer.ts`, where the `Viewport` type lives) clamps to
 * `MAX_BACKING_STORE_SCALE`. A caller must hand over the ratio the display *reports*,
 * unclamped, because a renderer that receives a pre-clamped 2 cannot tell a 2x laptop
 * from a 3x phone — and the cap is a battery policy every implementation should apply
 * identically, not a preference each caller gets to hold.
 *
 * ## No DOM here
 *
 * These are functions of numbers. Reading `window.devicePixelRatio` and watching it
 * change is `resize.ts`, behind the `@hh/render/resize` subpath, for the same reason
 * `canvas2d.ts` is behind its own: this package's barrel must stay importable under Node
 * so the geometry can be tested and benchmarked without a browser.
 */
import type { Viewport } from './renderer.js';
import { backingStoreScale } from './renderer.js';

/** A size in whole device pixels — what a canvas's `width`/`height` attributes mean. */
export interface BackingStoreSize {
  readonly width: number;
  readonly height: number;
}

/**
 * The backing store a viewport needs, in device pixels.
 *
 * **Rounded, not truncated.** A 1439.6 CSS-pixel viewport at 2x is 2879.2 device
 * pixels, and flooring drops the last column to the page background — a one-pixel seam
 * down the edge of the canvas that is maddening to track down and trivial to avoid.
 *
 * Floored at 1 in each axis: a zero-sized backing store makes a canvas that throws on
 * some engines and silently draws nothing on others, and a collapsed viewport is a real
 * transient state during layout rather than a caller bug.
 */
export const backingStoreSize = (viewport: Viewport): BackingStoreSize => {
  const scale = backingStoreScale(viewport.devicePixelRatio);
  return {
    width: Math.max(1, Math.round(viewport.width * scale)),
    height: Math.max(1, Math.round(viewport.height * scale)),
  };
};

/** CSS pixels to device pixels, at a viewport's capped ratio. */
export const cssToDevice = (cssPixels: number, viewport: Viewport): number =>
  cssPixels * backingStoreScale(viewport.devicePixelRatio);

/**
 * Device pixels to CSS pixels, at a viewport's capped ratio.
 *
 * The exact inverse of {@link cssToDevice} — including above the cap, where both use the
 * clamped ratio rather than the reported one. A pointer event arrives in CSS pixels and
 * a hit target is specified in CSS pixels (#114), so in practice nothing in the
 * interaction path needs this; it exists so that the round trip is expressible and
 * therefore testable, which is what makes "converted in exactly one place" checkable
 * rather than merely claimed.
 */
export const deviceToCss = (devicePixels: number, viewport: Viewport): number =>
  devicePixels / backingStoreScale(viewport.devicePixelRatio);

/**
 * Whether two viewports would produce the same frame.
 *
 * Used to make resizing idempotent. That matters more than it looks: assigning
 * `canvas.width` clears the canvas *even when the value is unchanged*, so a renderer
 * that re-sizes on every `ResizeObserver` callback flashes the scene away on any layout
 * change that did not actually resize it.
 */
export const sameViewport = (a: Viewport, b: Viewport): boolean =>
  a.width === b.width && a.height === b.height && a.devicePixelRatio === b.devicePixelRatio;

/**
 * A viewport with a different size, keeping the pixel ratio.
 *
 * Aspect ratio is not preserved and must not be: the viewport *is* whatever the layout
 * gives it, and #115's "without distorting aspect ratio" is a statement about the
 * camera, which holds one scale for both axes (`camera.ts`), not about forcing a
 * letterbox here.
 */
export const resized = (viewport: Viewport, width: number, height: number): Viewport => ({
  width,
  height,
  devicePixelRatio: viewport.devicePixelRatio,
});

/** A viewport with a different pixel ratio, keeping the CSS size. */
export const withDevicePixelRatio = (viewport: Viewport, devicePixelRatio: number): Viewport => ({
  width: viewport.width,
  height: viewport.height,
  devicePixelRatio,
});
