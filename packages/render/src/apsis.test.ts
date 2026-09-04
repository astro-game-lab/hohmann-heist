import {
  MU_EARTH,
  R_EARTH_EQ,
  apoapsisRadius,
  eci,
  epoch,
  periapsisRadius,
  stateFromElements,
} from '@hh/astro';
import type { OrbitShape } from '@hh/astro';
import { APSIS_ECCENTRICITY_FLOOR, createArc, findApsisCrossings } from '@hh/propagation';
import { V, metres, radians } from '@hh/math';
import { describe, expect, it } from 'vitest';

import {
  APSIS_LABEL_KEYS,
  APSIS_TICK_PX,
  TIE_LINE_LABEL_KEY,
  apsisMarkers,
  closestApproachTieLine,
  hasDistinctApsides,
} from './apsis.js';
import type { Camera } from './camera.js';
import { EQUATORIAL_BASIS, boundsOfSphere, frameBounds } from './camera.js';
import type { Viewport } from './renderer.js';
import type { SceneColours } from './style.js';

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

const camera: Camera = frameBounds(
  boundsOfSphere(R_EARTH_EQ + 2_000_000),
  VIEWPORT,
  EQUATORIAL_BASIS,
);

const orbit = (eccentricity: number, trueAnomaly = 0): OrbitShape => ({
  semiLatusRectum: metres(7_000_000),
  eccentricity,
  inclination: radians(0),
  raan: radians(0),
  argp: radians(0),
  trueAnomaly: radians(trueAnomaly),
});

const markers = (eccentricity: number, trueAnomaly = 0) =>
  apsisMarkers(camera, orbit(eccentricity, trueAnomaly), MU_EARTH, R_EARTH_EQ, COLOURS);

describe('the suppression threshold', () => {
  it('is the apsis finder’s own constant, not a copy of it', () => {
    // #111: the renderer and the physics "must not disagree about whether an apsis
    // exists". One number, imported, is the only way to guarantee that — a local `1e-3`
    // would compile, pass, and then drift the first time either side was tuned, leaving a
    // band of eccentricities where the planner draws a periapsis the solver says is not
    // there. That would look like a bug in the solver.
    expect(APSIS_ECCENTRICITY_FLOOR).toBe(1e-3);
    expect(hasDistinctApsides(APSIS_ECCENTRICITY_FLOOR)).toBe(true);
    expect(hasDistinctApsides(APSIS_ECCENTRICITY_FLOOR - 1e-12)).toBe(false);
  });

  it('agrees with the finder either side of the floor, which is the real claim', () => {
    // Checked against #60 itself rather than against the constant: the finder reports no
    // crossings below the floor, and the renderer must draw nothing in exactly that band.
    const below = orbit(APSIS_ECCENTRICITY_FLOOR / 2);
    const above = orbit(APSIS_ECCENTRICITY_FLOOR * 10);

    expect(markers(APSIS_ECCENTRICITY_FLOOR / 2)).toEqual([]);
    expect(markers(APSIS_ECCENTRICITY_FLOOR * 10)).toHaveLength(2);

    // And the finder says the same thing about the same two orbits — checked against #60
    // itself, through a real arc, rather than against the shared constant.
    const arcOf = (shape: OrbitShape) =>
      createArc({
        startEpoch: epoch(0),
        endEpoch: epoch(20_000),
        state: stateFromElements(shape, MU_EARTH),
        mu: MU_EARTH,
      });

    expect(findApsisCrossings(arcOf(below), epoch(0), epoch(20_000))).toHaveLength(0);
    expect(findApsisCrossings(arcOf(above), epoch(0), epoch(20_000)).length).toBeGreaterThan(0);
  });

  it('draws nothing for a perfectly circular orbit', () => {
    // The common case, not an edge case: §6.8's contracts are equatorial-equivalent and
    // several start circular.
    expect(markers(0)).toEqual([]);
  });

  it('draws nothing for an open orbit, which has no apoapsis', () => {
    expect(markers(1.4)).toEqual([]);
    expect(markers(1)).toEqual([]);
  });
});

describe('apsis markers', () => {
  it('places a tick at each apse, at the right radius', () => {
    const found = markers(0.3);
    expect(found.map((m) => m.kind)).toEqual(['periapsis', 'apoapsis']);

    const centre = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
    const radiusOf = (at: { x: number; y: number }): number =>
      Math.hypot(at.x - centre.x, at.y - centre.y) / camera.scale;

    expect(radiusOf(found[0]?.at ?? centre)).toBeCloseTo(periapsisRadius(orbit(0.3)), 1);
    expect(radiusOf(found[1]?.at ?? centre)).toBeCloseTo(apoapsisRadius(orbit(0.3)), 1);
  });

  it('finds the same apses whatever point of the orbit the arc starts from', () => {
    // The offset is computed from the arc's own starting mean anomaly, so an arc that
    // begins at apoapsis must still put periapsis in the same place.
    const fromPeriapsis = markers(0.3, 0);
    const fromApoapsis = markers(0.3, Math.PI);
    const fromElsewhere = markers(0.3, 1.234);

    for (const index of [0, 1]) {
      expect(fromApoapsis[index]?.at.x).toBeCloseTo(fromPeriapsis[index]?.at.x ?? 0, 6);
      expect(fromElsewhere[index]?.at.x).toBeCloseTo(fromPeriapsis[index]?.at.x ?? 0, 6);
    }
  });

  it('orients the tick along the radius, so it crosses the orbit square-on', () => {
    const found = markers(0.3);
    const centre = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };

    for (const marker of found) {
      const points = marker.tick.points;
      const along = {
        x: (points[1]?.x ?? 0) - (points[0]?.x ?? 0),
        y: (points[1]?.y ?? 0) - (points[0]?.y ?? 0),
      };
      const radial = { x: marker.at.x - centre.x, y: marker.at.y - centre.y };
      const cross = along.x * radial.y - along.y * radial.x;
      // Parallel to the radius: the cross product vanishes.
      expect(Math.abs(cross)).toBeLessThan(1e-6);
      expect(Math.hypot(along.x, along.y)).toBeCloseTo(2 * APSIS_TICK_PX, 9);
    }
  });

  it('carries altitude as a number and a key, never as formatted text', () => {
    // FR-910: formatting a length is locale work and `Intl` lives with the catalogue.
    const found = markers(0.3);
    expect(found[0]?.altitudeMetres).toBeCloseTo(periapsisRadius(orbit(0.3)) - R_EARTH_EQ, 6);
    expect(found[1]?.altitudeMetres).toBeCloseTo(apoapsisRadius(orbit(0.3)) - R_EARTH_EQ, 6);
    expect(found[0]?.labelKey).toBe(APSIS_LABEL_KEYS.periapsis);
    expect(found[1]?.labelKey).toBe(APSIS_LABEL_KEYS.apoapsis);
    for (const marker of found) {
      expect(typeof marker.altitudeMetres).toBe('number');
    }
  });

  it('puts the label off the orbit, so it survives the tight LEO case', () => {
    // §8.4: at LEO framing two orbits are a few pixels apart, and the altitude label is
    // that section's stated answer — which only works if the text is not sitting on the
    // curve it is labelling.
    for (const marker of markers(0.3)) {
      const offset = Math.hypot(marker.labelAt.x - marker.at.x, marker.labelAt.y - marker.at.y);
      expect(offset).toBeGreaterThan(APSIS_TICK_PX);
    }
  });

  it('measures altitude above a reference radius the caller supplies', () => {
    // The renderer has no business owning a planet.
    const aboveZero = apsisMarkers(camera, orbit(0.3), MU_EARTH, 0, COLOURS);
    expect(aboveZero[0]?.altitudeMetres).toBeCloseTo(periapsisRadius(orbit(0.3)), 6);
  });
});

describe('the closest-approach tie line', () => {
  const ship = eci(V.vec3(metres(7_000_000), metres(0), metres(0)));
  const target = eci(V.vec3(metres(7_050_000), metres(100_000), metres(0)));

  const request = (assistEnabled: boolean) => ({
    shipPosition: ship,
    targetPosition: target,
    separationMetres: 311.4,
    relativeSpeedMps: 0.02,
    assistEnabled,
  });

  it('is absent when the assist is off, not merely faint', () => {
    // §6.6 makes closest-approach markers an assist; disabling it earns the *Blind*
    // modifier, so it has to be genuinely gone. `undefined` rather than an empty array,
    // so a caller cannot mistake "nothing to draw" for "assist off".
    expect(closestApproachTieLine(camera, request(false), COLOURS)).toBeUndefined();
  });

  it('connects the two positions when the assist is on', () => {
    const tie = closestApproachTieLine(camera, request(true), COLOURS);
    expect(tie).toBeDefined();
    const line = tie?.line;
    expect(line?.kind).toBe('polyline');
    expect(line?.kind === 'polyline' ? line.points : []).toHaveLength(2);
  });

  it('is dashed, so it reads as an annotation rather than a flown path', () => {
    const tie = closestApproachTieLine(camera, request(true), COLOURS);
    const line = tie?.line;
    const dash = line?.kind === 'polyline' ? line.stroke.dash : undefined;
    expect(dash?.length).toBeGreaterThan(0);
  });

  it('carries distance and relative speed as numbers, with a catalogue key', () => {
    // §9.3 labels it "with distance and Δv_rel"; the words are `@hh/ui`'s.
    const tie = closestApproachTieLine(camera, request(true), COLOURS);
    expect(tie?.separationMetres).toBe(311.4);
    expect(tie?.relativeSpeedMps).toBe(0.02);
    expect(tie?.labelKey).toBe(TIE_LINE_LABEL_KEY);
  });

  it('anchors the label between the two positions', () => {
    const tie = closestApproachTieLine(camera, request(true), COLOURS);
    const line = tie?.line;
    const points = line?.kind === 'polyline' ? line.points : [];
    const midX = ((points[0]?.x ?? 0) + (points[1]?.x ?? 0)) / 2;
    expect(tie?.labelAt.x).toBeCloseTo(midX, 9);
  });
});
