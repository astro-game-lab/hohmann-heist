import { MU_EARTH, R_EARTH_EQ, semiMajorAxis } from '@hh/astro';
import type { OrbitShape } from '@hh/astro';
import { metres, radians } from '@hh/math';
import { describe, expect, it } from 'vitest';

import type { Camera } from './camera.js';
import { EQUATORIAL_BASIS, boundsOfSphere, frameBounds } from './camera.js';
import type { MarkerSpec } from './markers.js';
import {
  MARKER_RADIUS_PX,
  TRAIL_SECONDS,
  TRAIL_SEGMENTS,
  markerCentre,
  markerPrimitive,
  shipMarker,
  targetMarker,
  trailPoints,
  trailPrimitives,
} from './markers.js';
import type { Viewport } from './renderer.js';
import type { SceneColours } from './style.js';
import { keplerianSampler } from './trajectory.js';

const VIEWPORT: Viewport = { width: 800, height: 600, devicePixelRatio: 2 };

const COLOURS: SceneColours = {
  earthFill: '#12233f',
  earthCoastline: '#2b4766',
  earthNight: '#00000066',
  hazard: '#a33333',
  hazardViolated: '#ff4444',
  current: '#5bc0eb',
  planned: '#9bb1c9',
  target: '#c9a86b',
  ship: '#eeeeee',
  targetMarker: '#c9a86b',
  node: '#f5a623',
  nodeSelected: '#ffd479',
  annotation: '#8fa3bb',
};

const orbit = (semiLatusRectumM: number, eccentricity = 0.05): OrbitShape => ({
  semiLatusRectum: metres(semiLatusRectumM),
  eccentricity,
  inclination: radians(0),
  raan: radians(0),
  argp: radians(0),
  trueAnomaly: radians(0),
});

const spec = (kind: MarkerSpec['kind'], offsetSeconds = 3600): MarkerSpec => ({
  id: kind,
  kind,
  elements: orbit(7_000_000),
  mu: MU_EARTH,
  offsetSeconds,
});

const cameraFor = (radius = R_EARTH_EQ + 700_000): Camera =>
  frameBounds(boundsOfSphere(radius), VIEWPORT, EQUATORIAL_BASIS);

describe('marker shapes', () => {
  it('gives the ship three vertices and the target four', () => {
    // §9.3's triangle and diamond. The two markers are the only things a player must tell
    // apart instantly while dragging, they are a few pixels across, and rendezvous puts
    // them right next to each other — colour is the least reliable channel at that size.
    const centre = { x: 100, y: 100 };
    expect(shipMarker(centre, '#fff').points).toHaveLength(3);
    expect(targetMarker(centre, '#fff').points).toHaveLength(4);
  });

  it('distinguishes them without reference to colour', () => {
    const centre = { x: 100, y: 100 };
    const ship = shipMarker(centre, '#ffffff');
    const target = targetMarker(centre, '#ffffff');
    // Same colour, different silhouette: the shapes alone separate them.
    expect(ship.fill.colour).toBe(target.fill.colour);
    expect(ship.points.length).not.toBe(target.points.length);
  });

  it('keeps every vertex on the circumscribing circle', () => {
    const centre = { x: 100, y: 100 };
    for (const marker of [shipMarker(centre, '#fff'), targetMarker(centre, '#fff')]) {
      for (const p of marker.points) {
        expect(Math.hypot(p.x - centre.x, p.y - centre.y)).toBeCloseTo(MARKER_RADIUS_PX, 9);
      }
    }
  });
});

describe('constant screen size', () => {
  it('is the same size zoomed out as zoomed in', () => {
    // §8.5.2: markers "do not shrink when zoomed out". A marker sized in metres would be
    // sub-pixel at GEO framing and enormous at a 40x LEO zoom — the player would lose the
    // ship exactly when they zoomed out to find it.
    const near = cameraFor();
    const far: Camera = { ...near, scale: near.scale / 100 };

    const sizeOf = (camera: Camera): number => {
      const marker = markerPrimitive(camera, spec('ship'), COLOURS);
      const centre = markerCentre(camera, spec('ship'));
      const first = marker?.points[0];
      if (first === undefined || centre === undefined) return Number.NaN;
      return Math.hypot(first.x - centre.x, first.y - centre.y);
    };

    expect(sizeOf(near)).toBeCloseTo(MARKER_RADIUS_PX, 9);
    expect(sizeOf(far)).toBeCloseTo(MARKER_RADIUS_PX, 9);
  });
});

describe('the trail is measured in simulation time', () => {
  it('is identical at 1x and at 100 000x, where a frame buffer would not be', () => {
    // FR-602: speed "MUST NOT affect the outcome". The tempting implementation keeps the
    // last N *frames* of positions, and it is wrong in both directions: at 1x, 60 frames
    // of a LEO orbit covers one second of flight and the trail is a dot; at 100 000x the
    // same 60 frames covers 27 hours and wraps the orbit several times.
    //
    // Comparing `trailPoints` to itself would prove nothing, so the counter-example is
    // built explicitly: this is what a 60-frame buffer would cover at each speed.
    const s = spec('ship', 7200);
    const frameBufferSpan = (speed: number): number => (60 / 60) * speed;
    expect(frameBufferSpan(1)).toBe(1);
    expect(frameBufferSpan(100_000)).toBe(100_000);

    const asFrameBuffer = (speed: number): string =>
      JSON.stringify(trailPoints(s, frameBufferSpan(speed), TRAIL_SEGMENTS));
    // The frame-buffer trail is a different curve at each speed — the failure FR-602
    // forbids, reproduced here so the assertion below is not vacuous.
    expect(asFrameBuffer(100_000)).not.toBe(asFrameBuffer(1));

    // The shipped trail takes no speed and no frame rate at all: its span is
    // `TRAIL_SECONDS` of simulation time, so there is no argument a playback rate could
    // arrive through, and the result is a pure function of (elements, epoch).
    expect(JSON.stringify(trailPoints(s))).toBe(JSON.stringify(trailPoints(s)));
    expect(trailPoints(s)).toHaveLength(TRAIL_SEGMENTS + 1);
  });

  it('spans ten minutes of flight, ending at the scrub epoch', () => {
    // The span is checked against the sampler directly rather than against the trail's
    // own arithmetic, so the test cannot agree with a bug by sharing it.
    const s = spec('ship', 7200);
    const points = trailPoints(s);
    expect(points).toHaveLength(TRAIL_SEGMENTS + 1);
    expect(TRAIL_SECONDS).toBe(600);

    const sample = keplerianSampler(s.elements, s.mu);
    const expectedTail = sample(s.offsetSeconds - TRAIL_SECONDS);
    const expectedHead = sample(s.offsetSeconds);

    expect(points[0]?.x).toBeCloseTo(expectedTail?.x ?? Number.NaN, 6);
    expect(points[0]?.y).toBeCloseTo(expectedTail?.y ?? Number.NaN, 6);
    expect(points[TRAIL_SEGMENTS]?.x).toBeCloseTo(expectedHead?.x ?? Number.NaN, 6);
    expect(points[TRAIL_SEGMENTS]?.y).toBeCloseTo(expectedHead?.y ?? Number.NaN, 6);
  });

  it('runs backwards from the marker, ending at it', () => {
    const s = spec('ship', 3600);
    const points = trailPoints(s);
    const camera = cameraFor();

    const head = points[points.length - 1];
    const markerAt = markerCentre(camera, s);
    expect(head).toBeDefined();
    expect(markerAt).toBeDefined();
    // The last trail point and the marker are the same position, to float64.
    const projected = trailPrimitives(camera, s, COLOURS);
    const lastSegment = projected[projected.length - 1];
    const lastPoint = lastSegment?.points[1];
    expect(lastPoint?.x).toBeCloseTo(markerAt?.x ?? 0, 9);
    expect(lastPoint?.y).toBeCloseTo(markerAt?.y ?? 0, 9);
  });

  it('is clipped at the arc’s start rather than extrapolating through a burn', () => {
    // A trail longer than the time spent on this arc would run the conic back through an
    // impulse the spacecraft actually made, drawing a path it never flew.
    const early = trailPoints(spec('ship', 60));
    expect(early.length).toBe(TRAIL_SEGMENTS + 1);

    // At the very start of an arc there is no trail at all.
    expect(trailPoints(spec('ship', 0))).toEqual([]);
    expect(trailPoints(spec('ship', -5))).toEqual([]);
  });

  it('samples by time, so it does not degenerate at high speed', () => {
    // #109: "Trail sampling is by time, so at high playback speed it does not degenerate
    // into a frame-rate artefact." The sample count is fixed by `segments` and the span
    // by simulation seconds; neither can be reached by a frame rate.
    const coarse = trailPoints(spec('ship'), TRAIL_SECONDS, 4);
    const fine = trailPoints(spec('ship'), TRAIL_SECONDS, 64);
    expect(coarse).toHaveLength(5);
    expect(fine).toHaveLength(65);
    // Both cover the same stretch of flight: the tails coincide.
    expect(coarse[0]?.x).toBeCloseTo(fine[0]?.x ?? 0, 6);
  });
});

describe('the fade', () => {
  it('ramps alpha from the tail to the head', () => {
    const segments = trailPrimitives(cameraFor(), spec('ship'), COLOURS);
    expect(segments.length).toBe(TRAIL_SEGMENTS);

    const alphas = segments.map((s) => s.stroke.alpha ?? 1);
    for (let i = 1; i < alphas.length; i++) {
      expect(alphas[i] ?? 0).toBeGreaterThan(alphas[i - 1] ?? 0);
    }
    // Faintest at the tail, strongest at the head.
    expect(alphas[0] ?? 1).toBeLessThan(0.1);
    expect(alphas[alphas.length - 1] ?? 0).toBeCloseTo(0.7, 9);
  });

  it('ramps linearly, because the trail is a time axis', () => {
    // A non-linear ramp would make equal intervals of time look unequal — the same
    // mistake in the alpha channel that equal-distance dots make in the spatial one.
    const alphas = trailPrimitives(cameraFor(), spec('ship'), COLOURS).map(
      (s) => s.stroke.alpha ?? 1,
    );
    for (let i = 2; i < alphas.length; i++) {
      const first = (alphas[i] ?? 0) - (alphas[i - 1] ?? 0);
      const second = (alphas[i - 1] ?? 0) - (alphas[i - 2] ?? 0);
      expect(first).toBeCloseTo(second, 12);
    }
  });

  it('stays inside the frame budget: two trails are 48 primitives', () => {
    // §11.9's drag budget is 8 ms for the whole frame beside a few thousand orbit
    // vertices, so the trail's cost has to be bounded by construction rather than by
    // hoping the sampling stays coarse.
    const ship = trailPrimitives(cameraFor(), spec('ship'), COLOURS);
    const target = trailPrimitives(cameraFor(), spec('target'), COLOURS);
    expect(ship.length + target.length).toBe(2 * TRAIL_SEGMENTS);
    expect(ship.length + target.length).toBeLessThanOrEqual(64);
  });

  it('draws nothing rather than a stub for a trail with no span', () => {
    expect(trailPrimitives(cameraFor(), spec('ship', 0), COLOURS)).toEqual([]);
  });
});

describe('colours come from the caller', () => {
  it('takes the ship and target colours from the supplied slots', () => {
    const camera = cameraFor();
    expect(markerPrimitive(camera, spec('ship'), COLOURS)?.fill.colour).toBe(COLOURS.ship);
    expect(markerPrimitive(camera, spec('target'), COLOURS)?.fill.colour).toBe(
      COLOURS.targetMarker,
    );
  });
});

describe('an orbit that cannot be sampled', () => {
  it('reports it rather than placing a marker at NaN', () => {
    const open: MarkerSpec = {
      id: 'ship',
      kind: 'ship',
      elements: orbit(7_000_000, 1.5),
      mu: MU_EARTH,
      offsetSeconds: 100,
    };
    // §6.4's L4 makes this illegal anyway, so the planner has a bigger problem — but a
    // marker at a NaN position would draw as a missing ship, which looks like a renderer
    // bug rather than an illegal plan.
    expect(() => markerCentre(cameraFor(), open)).toThrow(RangeError);
  });

  it('places a marker on a valid orbit', () => {
    expect(markerCentre(cameraFor(), spec('ship'))).toBeDefined();
    // Sanity: the marker sits at the orbit's radius from the world centre on screen.
    const camera = cameraFor();
    const centre = markerCentre(camera, spec('ship'));
    const a = semiMajorAxis(orbit(7_000_000));
    const screenCentre = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
    const r = Math.hypot((centre?.x ?? 0) - screenCentre.x, (centre?.y ?? 0) - screenCentre.y);
    // Periapsis radius is p / (1 + e); the marker is an hour along from there, so its
    // radius sits between periapsis and apoapsis.
    expect(r / camera.scale).toBeGreaterThan((a as number) * 0.9);
    expect(r / camera.scale).toBeLessThan((a as number) * 1.1);
  });
});
