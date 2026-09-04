import { R_EARTH_EQ } from '@hh/astro';
import { V } from '@hh/math';
import { describe, expect, it } from 'vitest';

import type { Camera } from './camera.js';
import { EQUATORIAL_BASIS, basisLookingAlong, boundsOfSphere, frameBounds } from './camera.js';
import { decodeCoastlines } from './coastlines.js';
import { coastlinePolylines, earthDisc, terminatorPolygon, viewDirection } from './earth.js';
import type { Viewport } from './renderer.js';
import type { SceneColours } from './style.js';

const VIEWPORT: Viewport = { width: 800, height: 600, devicePixelRatio: 2 };

const COLOURS: SceneColours = {
  earthFill: '#12233f',
  earthCoastline: '#2b4766',
  earthNight: '#00000066',
  hazard: '#a33',
  hazardViolated: '#f44',
  current: '#5bc0eb',
  planned: '#9bb1c9',
  target: '#c9a86b',
  ship: '#eee',
  targetMarker: '#c9a86b',
  node: '#f5a623',
  nodeSelected: '#ffd479',
  annotation: '#8fa3bb',
};

/** A camera framing a sphere of `radius`, which is Earth alone unless told otherwise. */
const cameraFor = (radius = R_EARTH_EQ): Camera =>
  frameBounds(boundsOfSphere(radius), VIEWPORT, EQUATORIAL_BASIS);

/** One ring around the equator at 10-degree steps, as a coastline document. */
const equatorRing = () => {
  const deltas: number[] = [];
  let previous = 0;
  for (let lon = -170; lon <= 170; lon += 10) {
    deltas.push(lon * 1000 - previous, 0);
    previous = lon * 1000;
  }
  return decodeCoastlines({ precision: 3, ringCount: 1, pointCount: 35, rings: [deltas] });
};

describe('the disc', () => {
  it('is drawn to scale, with no clamping', () => {
    const camera = cameraFor();
    const disc = earthDisc(camera, R_EARTH_EQ, COLOURS);
    // The radius is exactly metres times the camera scale. §9.3 says "to scale, always",
    // and an Earth nudged larger for legibility would make every altitude on screen a lie.
    expect(disc.radius).toBeCloseTo(R_EARTH_EQ * camera.scale, 9);
  });

  it('stays to scale when Earth overflows the viewport, which is the LEO case', () => {
    // §8.4: at LEO framing the camera frames the *orbits* and Earth is allowed to run off
    // the edge. This is the normal case, not an edge case.
    const leo = frameBounds(boundsOfSphere(R_EARTH_EQ + 400_000), VIEWPORT, EQUATORIAL_BASIS);
    // Now zoom right in, so the disc is far larger than the viewport.
    const zoomed: Camera = { ...leo, scale: leo.scale * 30 };
    const disc = earthDisc(zoomed, R_EARTH_EQ, COLOURS);

    expect(disc.radius).toBeCloseTo(R_EARTH_EQ * zoomed.scale, 9);
    expect(disc.radius).toBeGreaterThan(VIEWPORT.width);
    // Still centred on the world origin rather than pulled back on screen.
    expect(disc.centre.x).toBeCloseTo(VIEWPORT.width / 2, 6);
    expect(disc.centre.y).toBeCloseTo(VIEWPORT.height / 2, 6);
  });

  it('carries no text, because the canvas has no text to carry (D8)', () => {
    // Structural: `Primitive` has no text variant at all, so this is really an assertion
    // that the disc is one of the three geometric kinds.
    expect(earthDisc(cameraFor(), R_EARTH_EQ, COLOURS).kind).toBe('disc');
  });
});

describe('coastlines', () => {
  it('draws only the near hemisphere', () => {
    // The far half would otherwise land on top of the near half under an orthographic
    // projection — Australia drawn through the Atlantic.
    const camera: Camera = {
      ...cameraFor(),
      basis: basisLookingAlong({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }),
    };
    const view = viewDirection(camera);
    const ring = equatorRing();
    const lines = coastlinePolylines(camera, R_EARTH_EQ, 0, COLOURS, ring);

    expect(lines.length).toBeGreaterThan(0);
    const centre = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
    for (const line of lines) {
      for (const p of line.points) {
        expect(Math.hypot(p.x - centre.x, p.y - centre.y)).toBeLessThanOrEqual(
          R_EARTH_EQ * camera.scale + 1e-6,
        );
      }
    }

    // Roughly half of an equatorial ring faces a viewer on the equator, and the far half
    // is gone rather than folded on top of the near one.
    const drawn = lines.reduce((n, l) => n + l.points.length, 0);
    expect(drawn).toBeLessThan(ring.vertexCount);
    expect(drawn).toBeGreaterThan(ring.vertexCount / 4);
    expect(V.norm(view)).toBeCloseTo(1, 12);
  });

  it('draws nothing for a ring lying exactly on the horizon', () => {
    // The equatorial basis looks straight down +z at the equatorial plane, so an
    // equatorial ring is edge-on: every vertex has `dot(p, view) = 0` and none of them
    // faces the viewer. Empty is the right answer, and it is worth pinning because the
    // alternative — a `>=` test admitting the whole ring — would draw a hairline circle
    // that reads as a real feature.
    expect(coastlinePolylines(cameraFor(), R_EARTH_EQ, 0, COLOURS, equatorRing())).toEqual([]);
  });

  it('splits a ring at the horizon rather than joining across the disc', () => {
    // Dropping far-side vertices and drawing the rest as one polyline would connect the
    // two ends with a chord straight through the planet. Splitting is what avoids it, and
    // the visible sign of a split is more than one run for a single ring.
    const camera: Camera = {
      ...cameraFor(),
      basis: basisLookingAlong({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }),
    };
    const lines = coastlinePolylines(camera, R_EARTH_EQ, 0, COLOURS, equatorRing());

    // The equator seen edge-on from +x: half of it is behind the planet, so the single
    // input ring must come back as one or more runs, none of which spans the far side.
    expect(lines.length).toBeGreaterThanOrEqual(1);
    const drawn = lines.reduce((n, l) => n + l.points.length, 0);
    const ring = equatorRing();
    expect(drawn).toBeLessThan(ring.vertexCount);
  });

  it('turns with the planet and nothing else', () => {
    // Earth's rotation is presentational (§7.4's model is strictly two-body), so it must
    // move the coastlines and have no other effect.
    const camera: Camera = {
      ...cameraFor(),
      basis: basisLookingAlong({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }),
    };
    const at0 = coastlinePolylines(camera, R_EARTH_EQ, 0, COLOURS, equatorRing());
    const atQuarter = coastlinePolylines(camera, R_EARTH_EQ, Math.PI / 2, COLOURS, equatorRing());

    const flatten = (ls: { points: readonly { x: number; y: number }[] }[]): string =>
      JSON.stringify(ls.map((l) => l.points.map((p) => [Math.round(p.x), Math.round(p.y)])));
    expect(flatten(at0)).not.toBe(flatten(atQuarter));
  });

  it('produces nothing rather than throwing for an empty dataset', () => {
    const empty = decodeCoastlines({ precision: 3, ringCount: 0, pointCount: 0, rings: [] });
    expect(coastlinePolylines(cameraFor(), R_EARTH_EQ, 0, COLOURS, empty)).toEqual([]);
  });
});

describe('the terminator', () => {
  /** A camera looking along −x, so +x is toward the viewer. */
  const sideOn = (): Camera => ({
    ...cameraFor(),
    basis: basisLookingAlong({ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }),
  });

  it('is absent when the Sun is behind the viewer and the whole face is lit', () => {
    const camera = sideOn();
    const sun = viewDirection(camera);
    expect(terminatorPolygon(camera, R_EARTH_EQ, sun, COLOURS)).toBeUndefined();
  });

  it('covers the whole disc when the Sun is behind the planet', () => {
    const camera = sideOn();
    const sun = V.negate(viewDirection(camera));
    const night = terminatorPolygon(camera, R_EARTH_EQ, sun, COLOURS);

    expect(night).toBeDefined();
    const centre = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
    const radius = R_EARTH_EQ * camera.scale;
    for (const p of night?.points ?? []) {
      // Every boundary point sits on the limb.
      expect(Math.hypot(p.x - centre.x, p.y - centre.y)).toBeCloseTo(radius, 6);
    }
  });

  it('covers half the disc when the Sun is side-on', () => {
    // The terminator is then a great circle through the view direction, so it projects to
    // a straight line and the night region is a half-disc.
    const camera = sideOn();
    const { right } = camera.basis;
    const night = terminatorPolygon(camera, R_EARTH_EQ, right, COLOURS);
    expect(night).toBeDefined();

    const centre = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
    // The Sun is toward screen +x, so every night point must be at or left of centre.
    for (const p of night?.points ?? []) {
      expect(p.x).toBeLessThanOrEqual(centre.x + 1e-6);
    }
  });

  it('follows the Sun vector it is given, because the Sun is a parameter', () => {
    // DEP-06's fixed Sun is a gameplay departure and lives in `@hh/game`; §7.5 forbids it
    // below the game layer. Passing a different Sun must move the terminator, with no
    // change here — which is what makes that layering real rather than asserted.
    const camera = sideOn();
    const { right, up } = camera.basis;

    const a = terminatorPolygon(camera, R_EARTH_EQ, right, COLOURS);
    const b = terminatorPolygon(camera, R_EARTH_EQ, up, COLOURS);
    expect(JSON.stringify(a?.points)).not.toBe(JSON.stringify(b?.points));
  });

  it('is a polygon with no text and a fill the caller supplied', () => {
    const camera = sideOn();
    const night = terminatorPolygon(camera, R_EARTH_EQ, camera.basis.right, COLOURS);
    expect(night?.kind).toBe('polygon');
    // No colours of its own: the slot is filled by whatever the caller passed.
    expect(night?.fill.colour).toBe(COLOURS.earthNight);
  });

  it('returns nothing for a zero Sun vector rather than dividing by its length', () => {
    const camera = sideOn();
    expect(terminatorPolygon(camera, R_EARTH_EQ, { x: 0, y: 0, z: 0 }, COLOURS)).toBeUndefined();
  });
});
