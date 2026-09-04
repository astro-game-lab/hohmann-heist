import { describe, expect, it } from 'vitest';

import { MAX_BACKING_STORE_SCALE, backingStoreScale } from './renderer.js';
import type { Viewport } from './renderer.js';
import {
  backingStoreSize,
  cssToDevice,
  deviceToCss,
  resized,
  sameViewport,
  withDevicePixelRatio,
} from './viewport.js';

const viewport = (width: number, height: number, devicePixelRatio: number): Viewport => ({
  width,
  height,
  devicePixelRatio,
});

describe('backingStoreScale', () => {
  it('is the reported ratio between 1 and the cap', () => {
    expect(backingStoreScale(1)).toBe(1);
    expect(backingStoreScale(1.5)).toBe(1.5);
    expect(backingStoreScale(2)).toBe(2);
  });

  it('caps at 2 for battery, so a 3x display is not rendered at 2.25x the pixels', () => {
    // §11.8: "backing store at devicePixelRatio, capped at 2 for battery". A 3x phone
    // would otherwise render 2.25 times the pixels of a 2x one, for a difference
    // nobody can see on a two-pixel orbit line.
    expect(backingStoreScale(3)).toBe(MAX_BACKING_STORE_SCALE);
    expect(backingStoreScale(4)).toBe(MAX_BACKING_STORE_SCALE);
  });

  it('raises a sub-unit ratio to 1 rather than resampling the scene to save nothing', () => {
    expect(backingStoreScale(0.5)).toBe(1);
    expect(backingStoreScale(0)).toBe(1);
    expect(backingStoreScale(-2)).toBe(1);
  });

  it('falls back to 1 for a non-finite ratio rather than clamping it to the cap', () => {
    // `NaN` and `Infinity` are not a display, they are a caller bug. 1 is the reading
    // that cannot make things worse: it costs sharpness on a display that may not
    // exist, where clamping `Infinity` to the cap would silently double the pixel
    // count on the strength of a nonsense input.
    expect(backingStoreScale(Number.NaN)).toBe(1);
    expect(backingStoreScale(Number.POSITIVE_INFINITY)).toBe(1);
    expect(MAX_BACKING_STORE_SCALE).toBe(2);
  });
});

describe('backingStoreSize', () => {
  it('scales the CSS size by the capped ratio', () => {
    expect(backingStoreSize(viewport(800, 600, 1))).toEqual({ width: 800, height: 600 });
    expect(backingStoreSize(viewport(800, 600, 2))).toEqual({ width: 1600, height: 1200 });
    // Capped: a 3x display gets the same store as a 2x one.
    expect(backingStoreSize(viewport(800, 600, 3))).toEqual({ width: 1600, height: 1200 });
  });

  it('rounds rather than truncating, so no column is lost to the page background', () => {
    // 1439.6 CSS px at 2x is 2879.2 device px. Flooring leaves a one-pixel seam down
    // the edge of the canvas; rounding does not.
    expect(backingStoreSize(viewport(1439.6, 100, 2)).width).toBe(2879);
    expect(backingStoreSize(viewport(1439.8, 100, 2)).width).toBe(2880);
  });

  it('never produces a zero-sized store for a collapsed viewport', () => {
    // A collapsed element is a real transient during layout, and a zero-sized canvas
    // throws on some engines and silently draws nothing on others.
    expect(backingStoreSize(viewport(0, 0, 2))).toEqual({ width: 1, height: 1 });
  });
});

describe('the CSS/device conversion', () => {
  it('round-trips at every ratio, including above the cap', () => {
    // #115: "CSS pixels and device pixels are converted at exactly one place, and that
    // conversion is tested". Both directions use the *clamped* ratio, so the round trip
    // holds at 3x as well — which is the case that would otherwise drift.
    for (const dpr of [1, 1.5, 2, 3]) {
      const v = viewport(800, 600, dpr);
      for (const css of [0, 1, 32, 733.25]) {
        expect(deviceToCss(cssToDevice(css, v), v)).toBeCloseTo(css, 12);
      }
    }
  });

  it('converts a 32 CSS px hit target to device pixels, not the other way round', () => {
    // §8.5.2's targets are 32 *CSS* px (#114). At 2x that is 64 device px; a renderer
    // that treated the constant as device pixels would give a 16 CSS px target on a
    // retina display, which is half the accessible minimum.
    const v = viewport(800, 600, 2);
    expect(cssToDevice(32, v)).toBe(64);
    expect(deviceToCss(32, v)).toBe(16);
  });

  it('is the identity at 1x', () => {
    const v = viewport(800, 600, 1);
    expect(cssToDevice(32, v)).toBe(32);
    expect(deviceToCss(32, v)).toBe(32);
  });
});

describe('sameViewport', () => {
  it('separates a real change from a layout event that changed nothing', () => {
    const a = viewport(800, 600, 2);
    expect(sameViewport(a, viewport(800, 600, 2))).toBe(true);
    expect(sameViewport(a, viewport(801, 600, 2))).toBe(false);
    expect(sameViewport(a, viewport(800, 601, 2))).toBe(false);
  });

  it('treats a pixel-ratio change as a change even at an identical CSS size', () => {
    // This is the display-move case: the element does not move, every device pixel
    // under it changes meaning. A comparison on size alone would miss it entirely.
    expect(sameViewport(viewport(800, 600, 2), viewport(800, 600, 1))).toBe(false);
  });
});

describe('deriving viewports', () => {
  it('resizes without touching the ratio, and does not force an aspect', () => {
    // "Without distorting aspect ratio" is a statement about the camera, which holds
    // one scale for both axes; the viewport is whatever the layout gives it.
    const next = resized(viewport(800, 600, 2), 1024, 300);
    expect(next).toEqual({ width: 1024, height: 300, devicePixelRatio: 2 });
  });

  it('changes the ratio without touching the CSS size', () => {
    const next = withDevicePixelRatio(viewport(800, 600, 2), 1);
    expect(next).toEqual({ width: 800, height: 600, devicePixelRatio: 1 });
  });
});
