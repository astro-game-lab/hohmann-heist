import type { EciVector } from '@hh/astro';
import { R_EARTH_EQ, eci } from '@hh/astro';
import type { Metres } from '@hh/math';
import { V, metres } from '@hh/math';
import { describe, expect, it } from 'vitest';

import type { Camera, ViewBasis } from './camera.js';
import {
  AUTO_FRAME_MARGIN,
  EQUATORIAL_BASIS,
  MAX_ZOOM,
  MIN_ZOOM,
  basisLookingAlong,
  boundsOfPoints,
  boundsOfSphere,
  clampScale,
  createCamera,
  easeInOut,
  easeTo,
  frameBounds,
  isEmptyBounds,
  needsReframe,
  pan,
  projectInto,
  screenToWorld,
  unionOf,
  withViewport,
  worldToScreen,
  zoomAt,
  zoomFactor,
} from './camera.js';
import type { Viewport } from './renderer.js';

const VIEWPORT: Viewport = { width: 1000, height: 800, devicePixelRatio: 2 };

const at = (x: number, y: number, z = 0): EciVector<Metres> =>
  eci(V.vec3(metres(x), metres(y), metres(z)));

const cameraAt = (centre: EciVector<Metres>, scale: number, autoScale = scale): Camera =>
  createCamera({ centre, scale, autoScale, basis: EQUATORIAL_BASIS, viewport: VIEWPORT });

describe('createCamera', () => {
  it('rejects a scale that is not finite and positive', () => {
    expect(() => cameraAt(at(0, 0), 0)).toThrow(RangeError);
    expect(() => cameraAt(at(0, 0), Number.NaN)).toThrow(RangeError);
    expect(() => cameraAt(at(0, 0), -1)).toThrow(RangeError);
  });

  it('rejects a viewport with no area', () => {
    expect(() =>
      createCamera({
        centre: at(0, 0),
        scale: 1,
        autoScale: 1,
        basis: EQUATORIAL_BASIS,
        viewport: { width: 0, height: 100, devicePixelRatio: 1 },
      }),
    ).toThrow(RangeError);
  });

  it('rejects a basis that is not orthonormal', () => {
    const skewed: ViewBasis = { right: { x: 1, y: 0, z: 0 }, up: { x: 0.4, y: 1, z: 0 } };
    expect(() =>
      createCamera({
        centre: at(0, 0),
        scale: 1,
        autoScale: 1,
        basis: skewed,
        viewport: VIEWPORT,
      }),
    ).toThrow(RangeError);
  });

  it('freezes what it returns', () => {
    expect(Object.isFrozen(cameraAt(at(0, 0), 1))).toBe(true);
  });
});

describe('basisLookingAlong', () => {
  it('produces an orthonormal basis for an inclined orbit normal', () => {
    const basis = basisLookingAlong({ x: 0.3, y: -0.5, z: 0.81 });
    expect(V.norm(basis.right)).toBeCloseTo(1, 12);
    expect(V.norm(basis.up)).toBeCloseTo(1, 12);
    expect(V.dot(basis.right, basis.up)).toBeCloseTo(0, 12);
    // Usable as a camera basis, which is the point of validating it here.
    expect(() =>
      createCamera({
        centre: at(0, 0),
        scale: 1,
        autoScale: 1,
        basis,
        viewport: VIEWPORT,
      }),
    ).not.toThrow();
  });

  it('rejects a degenerate normal and a parallel preferred up', () => {
    expect(() => basisLookingAlong({ x: 0, y: 0, z: 0 })).toThrow(RangeError);
    expect(() => basisLookingAlong({ x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 1 })).toThrow(RangeError);
  });
});

describe('world to screen', () => {
  it('puts the camera centre at the middle of the viewport', () => {
    const camera = cameraAt(at(7e6, -2e6), 1e-4);
    expect(worldToScreen(camera, camera.centre)).toEqual({ x: 500, y: 400 });
  });

  it('maps the basis right to screen +x and up to screen -y', () => {
    const camera = cameraAt(at(0, 0), 2);
    expect(worldToScreen(camera, at(10, 0)).x).toBeCloseTo(520, 12);
    expect(worldToScreen(camera, at(0, 10)).y).toBeCloseTo(380, 12);
  });

  it('projects orthographically along the view normal — out-of-plane offset does not move a point', () => {
    const camera = cameraAt(at(0, 0), 1);
    expect(worldToScreen(camera, at(3, 4, 1000))).toEqual(worldToScreen(camera, at(3, 4, 0)));
  });

  it('is a linear scale — §8.4 rejects logarithmic radial distortion (G3)', () => {
    const camera = cameraAt(at(0, 0), 1e-5);
    const near = worldToScreen(camera, at(R_EARTH_EQ, 0)).x - 500;
    const far = worldToScreen(camera, at(4 * R_EARTH_EQ, 0)).x - 500;
    // Four times the radius is four times the offset. Under any log mapping it is not.
    expect(far / near).toBeCloseTo(4, 12);
  });

  it('round-trips through screenToWorld on the camera plane', () => {
    const camera = cameraAt(at(1e7, 3e6), 3e-5);
    const point = { x: 812, y: 233 };
    const round = worldToScreen(camera, screenToWorld(camera, point));
    expect(round.x).toBeCloseTo(point.x, 9);
    expect(round.y).toBeCloseTo(point.y, 9);
  });
});

describe('float64 before float32 (NFR-010)', () => {
  /**
   * §8.4's precision case, made concrete.
   *
   * C11's target sits about 1e8 m out. A float32 carries ~24 bits of mantissa, so its
   * spacing at 1e8 is 8 m — the first assertion below shows two world points 2 m apart
   * landing on the *same* float32. Any pipeline that narrows a world coordinate before
   * subtracting the camera centre has therefore already destroyed sub-kilometre
   * structure, whatever it does afterwards.
   */
  const RADIUS = 1e8;
  const DETAIL_METRES = 100;
  // Zoomed in far enough that 100 m is 50 px: a tie line the player is reading a
  // distance off, not a hairline.
  const SCALE = 0.5;

  it('float32 cannot resolve metres at 1e8 m, which is why the order matters', () => {
    expect(Math.fround(RADIUS + 2)).toBe(Math.fround(RADIUS));
  });

  it('preserves sub-kilometre detail at 1e8 m', () => {
    const camera = cameraAt(at(RADIUS, 0), SCALE);
    const a = worldToScreen(camera, at(RADIUS, 0));
    const b = worldToScreen(camera, at(RADIUS + DETAIL_METRES, 0));
    expect(b.x - a.x).toBeCloseTo(DETAIL_METRES * SCALE, 9);
  });

  it('loses more than a pixel of it when the world coordinate is narrowed first', () => {
    const camera = cameraAt(at(RADIUS, 0), SCALE);
    // The forbidden order: narrow to float32 in world space, then transform.
    const narrowed = (x: number): EciVector<Metres> => at(Math.fround(x), 0);
    const a = worldToScreen(camera, narrowed(RADIUS));
    const b = worldToScreen(camera, narrowed(RADIUS + DETAIL_METRES));

    const error = Math.abs(b.x - a.x - DETAIL_METRES * SCALE);
    expect(error).toBeGreaterThan(1);
  });

  it('projectInto narrows only after the transform, so the float32 output is exact to well under a pixel', () => {
    const camera = cameraAt(at(RADIUS, 0), SCALE);
    const points = [
      at(RADIUS, 0),
      at(RADIUS + DETAIL_METRES, 0),
      at(RADIUS - DETAIL_METRES, 40),
      at(RADIUS, -250),
    ];

    const out = new Float32Array(points.length * 2);
    expect(projectInto(camera, points, out)).toBe(points.length);

    for (const [i, point] of points.entries()) {
      const expected = worldToScreen(camera, point);
      expect(Math.abs((out[i * 2] ?? 0) - expected.x)).toBeLessThan(1e-3);
      expect(Math.abs((out[i * 2 + 1] ?? 0) - expected.y)).toBeLessThan(1e-3);
    }
  });

  it('writes no more pairs than the output can hold', () => {
    const camera = cameraAt(at(0, 0), 1);
    const out = new Float32Array(4);
    expect(projectInto(camera, [at(1, 1), at(2, 2), at(3, 3)], out)).toBe(2);
  });
});

describe('pan (§8.4)', () => {
  it('moves the world by the screen delta it was given', () => {
    const camera = cameraAt(at(0, 0), 0.5);
    const before = worldToScreen(camera, at(100, 100));
    const after = worldToScreen(pan(camera, 30, -20), at(100, 100));
    expect(after.x - before.x).toBeCloseTo(30, 9);
    expect(after.y - before.y).toBeCloseTo(-20, 9);
  });

  it('is a pure state transform — the original camera is untouched', () => {
    const camera = cameraAt(at(0, 0), 0.5);
    const moved = pan(camera, 100, 100);
    expect(camera.centre).toEqual(at(0, 0));
    expect(moved).not.toBe(camera);
  });

  it('leaves the scale alone, so panning cannot escape the zoom clamp', () => {
    const camera = cameraAt(at(0, 0), 4, 1);
    expect(pan(camera, 1e4, -1e4).scale).toBe(4);
  });

  it('composes back to where it started', () => {
    const camera = cameraAt(at(5e6, 5e6), 1e-4);
    const round = pan(pan(camera, 137, -42), -137, 42);
    expect(V.distance(round.centre, camera.centre)).toBeLessThan(1e-6);
  });
});

describe('zoom (§8.4)', () => {
  it('keeps the world point under the anchor fixed', () => {
    const camera = cameraAt(at(0, 0), 1e-5, 1e-5);
    const anchor = { x: 820, y: 140 };
    const under = screenToWorld(camera, anchor);

    const zoomed = zoomAt(camera, 3, anchor);
    const after = worldToScreen(zoomed, under);
    expect(after.x).toBeCloseTo(anchor.x, 6);
    expect(after.y).toBeCloseTo(anchor.y, 6);
  });

  it('clamps to [0.5x, 40x] of the auto-frame scale', () => {
    const camera = cameraAt(at(0, 0), 1e-5, 1e-5);
    const centre = { x: 500, y: 400 };

    expect(zoomFactor(zoomAt(camera, 1000, centre))).toBeCloseTo(MAX_ZOOM, 12);
    expect(zoomFactor(zoomAt(camera, 1e-4, centre))).toBeCloseTo(MIN_ZOOM, 12);
    expect(MIN_ZOOM).toBe(0.5);
    expect(MAX_ZOOM).toBe(40);
  });

  it('stops at the limit rather than drifting the centre once clamped', () => {
    const camera = cameraAt(at(0, 0), 4e-4, 1e-5);
    const atLimit = zoomAt(camera, 2, { x: 900, y: 100 });
    expect(atLimit).toBe(camera);
  });

  it('rejects a factor that is not finite and positive', () => {
    const camera = cameraAt(at(0, 0), 1);
    expect(() => zoomAt(camera, 0, { x: 0, y: 0 })).toThrow(RangeError);
    expect(() => zoomAt(camera, -2, { x: 0, y: 0 })).toThrow(RangeError);
  });

  it('clampScale is the same band, stated directly', () => {
    expect(clampScale(1e-6, 1e-5)).toBe(5e-6);
    expect(clampScale(1, 1e-5)).toBeCloseTo(4e-4, 18);
    expect(clampScale(2e-5, 1e-5)).toBe(2e-5);
  });
});

describe('bounds', () => {
  it('projects a sphere to a disc of the same radius, whatever the basis', () => {
    expect(boundsOfSphere(R_EARTH_EQ)).toEqual({
      minU: -R_EARTH_EQ,
      maxU: R_EARTH_EQ,
      minV: -R_EARTH_EQ,
      maxV: R_EARTH_EQ,
    });
  });

  it('bounds a set of points in the projection plane', () => {
    const bounds = boundsOfPoints([at(-3, 7), at(11, -2), at(4, 4)], EQUATORIAL_BASIS);
    expect(bounds).toEqual({ minU: -3, maxU: 11, minV: -2, maxV: 7 });
  });

  it('ignores the out-of-plane component', () => {
    const bounds = boundsOfPoints([at(1, 1, 1e9)], EQUATORIAL_BASIS);
    expect(bounds).toEqual({ minU: 1, maxU: 1, minV: 1, maxV: 1 });
  });

  it('unions, with an empty union as the identity', () => {
    const a = { minU: 0, maxU: 1, minV: 0, maxV: 1 };
    const b = { minU: -5, maxU: 0.5, minV: 2, maxV: 3 };
    expect(unionOf([a, b])).toEqual({ minU: -5, maxU: 1, minV: 0, maxV: 3 });
    expect(isEmptyBounds(unionOf([]))).toBe(true);
    expect(unionOf([a])).toEqual(a);
  });
});

describe('auto-frame (§8.4)', () => {
  const R = 7e6;
  const bounds = boundsOfSphere(R);

  it('fits the union with a 12% margin on each side of the content', () => {
    const camera = frameBounds(bounds, VIEWPORT);
    expect(AUTO_FRAME_MARGIN).toBe(0.12);

    // The tighter axis is height: 800 px over 2R padded by 1.24.
    expect(camera.scale).toBeCloseTo(VIEWPORT.height / (2 * R * 1.24), 18);

    const edge = worldToScreen(camera, at(0, R));
    const contentHalfHeight = VIEWPORT.height / 2 - edge.y;
    const marginPx = VIEWPORT.height / 2 - contentHalfHeight;
    expect(marginPx / (2 * contentHalfHeight)).toBeCloseTo(AUTO_FRAME_MARGIN, 12);
  });

  it('centres on the union rather than on the origin', () => {
    const offset = { minU: 1e6, maxU: 3e6, minV: -2e6, maxV: 0 };
    const camera = frameBounds(offset, VIEWPORT);
    expect(camera.centre.x).toBeCloseTo(2e6, 6);
    expect(camera.centre.y).toBeCloseTo(-1e6, 6);
  });

  it('frames the union of ship, target, plan and Earth', () => {
    const ship = boundsOfPoints([at(R, 0), at(-R, 0), at(0, R), at(0, -R)], EQUATORIAL_BASIS);
    const target = boundsOfPoints([at(4.2e7, 0), at(-4.2e7, 0)], EQUATORIAL_BASIS);
    const earth = boundsOfSphere(R_EARTH_EQ);
    const camera = frameBounds(unionOf([ship, target, earth]), VIEWPORT);

    // GEO is the widest thing in the union, so it sets the scale and is on screen.
    const geo = worldToScreen(camera, at(4.2e7, 0));
    expect(geo.x).toBeGreaterThan(0);
    expect(geo.x).toBeLessThan(VIEWPORT.width);
    expect(camera.scale).toBeCloseTo(VIEWPORT.width / (2 * 4.2e7 * 1.24), 20);
  });

  it('returns a camera whose zoom is exactly 1x, which is what the clamp is measured against', () => {
    expect(zoomFactor(frameBounds(bounds, VIEWPORT))).toBe(1);
  });

  it('survives a degenerate extent rather than returning an infinite scale', () => {
    const line = { minU: -R, maxU: R, minV: 0, maxV: 0 };
    expect(Number.isFinite(frameBounds(line, VIEWPORT).scale)).toBe(true);

    const point = { minU: 0, maxU: 0, minV: 0, maxV: 0 };
    expect(Number.isFinite(frameBounds(point, VIEWPORT).scale)).toBe(true);
  });

  it('refuses to frame empty bounds', () => {
    expect(() => frameBounds(unionOf([]), VIEWPORT)).toThrow(RangeError);
  });

  it('re-viewports without moving the world or the scale', () => {
    const camera = frameBounds(bounds, VIEWPORT);
    const wide = withViewport(camera, { width: 1600, height: 800, devicePixelRatio: 1 });
    expect(wide.scale).toBe(camera.scale);
    expect(wide.centre).toEqual(camera.centre);
  });
});

describe('the 20% re-frame rule (§8.4)', () => {
  const base = frameBounds(boundsOfSphere(1e7), VIEWPORT);

  it('does not re-frame for a union that grew less than 20%', () => {
    const target = frameBounds(boundsOfSphere(1.15e7), VIEWPORT);
    expect(needsReframe(base, target)).toBe(false);
  });

  it('re-frames for a union that grew more than 20%', () => {
    const target = frameBounds(boundsOfSphere(1.3e7), VIEWPORT);
    expect(needsReframe(base, target)).toBe(true);
  });

  it('is symmetric — shrinking by the same proportion also triggers', () => {
    const target = frameBounds(boundsOfSphere(1e7 / 1.3), VIEWPORT);
    expect(needsReframe(base, target)).toBe(true);
  });

  it('re-frames when the union moves without changing size, which a scale test cannot see', () => {
    const field = Math.min(VIEWPORT.width, VIEWPORT.height);
    const shift = (0.25 * field) / base.autoScale;
    const moved = frameBounds(
      { minU: -1e7 + shift, maxU: 1e7 + shift, minV: -1e7, maxV: 1e7 },
      VIEWPORT,
    );
    expect(moved.autoScale).toBeCloseTo(base.autoScale, 20);
    expect(needsReframe(base, moved)).toBe(true);
  });

  it('measures against the auto-frame scale, so a zoomed-in player is not dragged out', () => {
    const zoomed = zoomAt(base, 30, { x: 500, y: 400 });
    const sameUnion = frameBounds(boundsOfSphere(1e7), VIEWPORT);
    expect(needsReframe(zoomed, sameUnion)).toBe(false);
  });
});

describe('re-frame easing (§9.4)', () => {
  it('is a cubic ease-in-out, clamped outside [0, 1]', () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 12);
    expect(easeInOut(-1)).toBe(0);
    expect(easeInOut(4)).toBe(1);
    // Eased, not linear: a quarter of the way through, less than a quarter of the way.
    expect(easeInOut(0.25)).toBeLessThan(0.25);
    expect(easeInOut(0.75)).toBeGreaterThan(0.75);
  });

  it('lands exactly on the endpoints', () => {
    const from = frameBounds(boundsOfSphere(7e6), VIEWPORT);
    const to = frameBounds(boundsOfSphere(4.2e7), VIEWPORT);
    expect(easeTo(from, to, 0)).toBe(from);
    expect(easeTo(from, to, 1)).toBe(to);
    // A caller honouring prefers-reduced-motion passes t = 1 on the first frame.
    expect(easeTo(from, to, 1)).toEqual(to);
  });

  it('interpolates scale geometrically, so a 1x-to-100x zoom is at 10x halfway', () => {
    const from = cameraAt(at(0, 0), 1, 1);
    const to = cameraAt(at(0, 0), 100, 100);
    expect(easeTo(from, to, 0.5).scale).toBeCloseTo(10, 9);
  });

  it('interpolates the centre linearly', () => {
    const from = cameraAt(at(0, 0), 1);
    const to = cameraAt(at(1000, -400), 1);
    const half = easeTo(from, to, 0.5);
    expect(half.centre.x).toBeCloseTo(500, 9);
    expect(half.centre.y).toBeCloseTo(-200, 9);
  });

  it('is monotone in scale across the transition', () => {
    const from = frameBounds(boundsOfSphere(7e6), VIEWPORT);
    const to = frameBounds(boundsOfSphere(4.2e7), VIEWPORT);
    let previous = from.scale;
    for (let i = 1; i <= 20; i++) {
      const scale = easeTo(from, to, i / 20).scale;
      expect(scale).toBeLessThanOrEqual(previous);
      previous = scale;
    }
    expect(previous).toBeCloseTo(to.scale, 20);
  });
});
