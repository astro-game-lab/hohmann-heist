import { MU_EARTH, R_EARTH_EQ, stateFromElements } from '@hh/astro';
import type { OrbitShape, State } from '@hh/astro';
import { V, metres, radians } from '@hh/math';
import { describe, expect, it } from 'vitest';

import type { Camera } from './camera.js';
import { EQUATORIAL_BASIS, boundsOfSphere, frameBounds } from './camera.js';
import {
  HANDLE_ARM_PX,
  HANDLE_AXES,
  SELECTION_RING_PX,
  axisScreenDirection,
  handlePrimitives,
  nodeDiamond,
  nodeGeometry,
  nodePrimitives,
} from './nodes.js';
import type { NodeSpec } from './nodes.js';
import type { Viewport } from './renderer.js';
import { buildHitIndex, hitTest } from './hit-test.js';
import type { HitTarget } from './hit-test.js';
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
  boundsOfSphere(R_EARTH_EQ + 1_000_000),
  VIEWPORT,
  EQUATORIAL_BASIS,
);

const orbit = (eccentricity: number, trueAnomaly: number): OrbitShape => ({
  semiLatusRectum: metres(7_000_000),
  eccentricity,
  inclination: radians(0),
  raan: radians(0),
  argp: radians(0),
  trueAnomaly: radians(trueAnomaly),
});

const stateAt = (eccentricity: number, trueAnomaly: number): State =>
  stateFromElements(orbit(eccentricity, trueAnomaly), MU_EARTH);

const node = (
  eccentricity: number,
  trueAnomaly: number,
  selected = false,
  id = 'node-1',
): NodeSpec => ({ id, state: stateAt(eccentricity, trueAnomaly), selected });

describe('the node marker', () => {
  it('is a diamond', () => {
    // §9.3's ◆.
    expect(nodeDiamond({ x: 0, y: 0 }, '#fff').points).toHaveLength(4);
  });

  it('gets a ring only when selected', () => {
    const plain = nodePrimitives(nodeGeometry(camera, node(0.1, 0)), node(0.1, 0), COLOURS);
    const chosen = nodePrimitives(
      nodeGeometry(camera, node(0.1, 0, true)),
      node(0.1, 0, true),
      COLOURS,
    );

    expect(plain).toHaveLength(1);
    expect(chosen).toHaveLength(2);
    const ring = chosen[1];
    expect(ring?.kind).toBe('polyline');
    expect(ring?.kind === 'polyline' ? ring.closed : false).toBe(true);
  });

  it('places the ring outside the diamond and inside the arms', () => {
    // Otherwise it either hides the marker or collides with the grab points.
    expect(SELECTION_RING_PX).toBeGreaterThan(6);
    expect(SELECTION_RING_PX).toBeLessThan(HANDLE_ARM_PX);
  });
});

describe('the handle cross follows the RTN basis', () => {
  it('draws radial along the position vector', () => {
    // R̂ = r / |r|, §7.2. At true anomaly 0 on an equatorial orbit the position is along
    // +x, which the equatorial basis maps to screen +x.
    const direction = axisScreenDirection(camera, stateAt(0.2, 0), 'radial');
    expect(direction?.x).toBeCloseTo(1, 9);
    expect(direction?.y).toBeCloseTo(0, 9);
  });

  it('draws transverse perpendicular to radial', () => {
    // T̂ = N̂ × R̂ is perpendicular to R̂ by construction, at every point of every orbit.
    for (const nu of [0, 0.7, 1.9, 3.4, 5.2]) {
      for (const e of [0, 0.3, 0.7]) {
        const radial = axisScreenDirection(camera, stateAt(e, nu), 'radial');
        const transverse = axisScreenDirection(camera, stateAt(e, nu), 'transverse');
        const dot =
          (radial?.x ?? 0) * (transverse?.x ?? 0) + (radial?.y ?? 0) * (transverse?.y ?? 0);
        expect(dot).toBeCloseTo(0, 9);
      }
    }
  });

  it('rotates as the node moves around the orbit', () => {
    // The cross is not decoration: a player dragging the transverse handle adds Δv along
    // T̂, so the drawn axis has to be the direction the burn goes.
    const atStart = axisScreenDirection(camera, stateAt(0.2, 0), 'radial');
    const atQuarter = axisScreenDirection(camera, stateAt(0.2, Math.PI / 2), 'radial');
    expect(atQuarter?.x).not.toBeCloseTo(atStart?.x ?? 0, 3);
  });

  it('is transverse, not along-velocity, on an eccentric orbit', () => {
    // §7.2 is explicit that the two coincide only for circular orbits. Drawing the
    // velocity direction would be right at e = 0 and quietly wrong everywhere the game
    // gets interesting — so the difference is asserted where it exists, and its absence
    // asserted where it does not.
    const eccentric = stateAt(0.6, 1.0);
    const transverse = axisScreenDirection(camera, eccentric, 'transverse');

    const velocity = V.normalize(eccentric.velocity);
    const velocityScreen = {
      x: V.dot(velocity, camera.basis.right),
      y: -V.dot(velocity, camera.basis.up),
    };
    const alignment =
      (transverse?.x ?? 0) * velocityScreen.x + (transverse?.y ?? 0) * velocityScreen.y;

    // Off by the flight-path angle: close to parallel, but measurably not parallel.
    expect(alignment).toBeLessThan(0.999);
    expect(alignment).toBeGreaterThan(0.8);
  });

  it('coincides with velocity on a circular orbit, where it should', () => {
    const circular = stateAt(0, 1.0);
    const transverse = axisScreenDirection(camera, circular, 'transverse');
    const velocity = V.normalize(circular.velocity);
    const alignment =
      (transverse?.x ?? 0) * V.dot(velocity, camera.basis.right) +
      (transverse?.y ?? 0) * -V.dot(velocity, camera.basis.up);
    expect(alignment).toBeCloseTo(1, 9);
  });

  it('has no normal handle, because v1.0 has no plane-change verb', () => {
    // §6.8's contracts are equatorial-equivalent and §6.2 gives the player no plane
    // change, so a third handle would be a control that does nothing in every contract
    // that ships.
    expect(HANDLE_AXES.map((a) => a.id)).toEqual(['prograde', 'radial']);
  });
});

describe('DEP-10 is a naming departure, and stays one', () => {
  it('separates the axis it draws from the word it shows', () => {
    // The geometry uses `axis`; only the text uses `labelKey`. That split is what makes
    // the departure checkable rather than merely claimed in a comment.
    // `HANDLE_AXES` is a frozen tuple, so index 0 is genuinely non-nullable here.
    const [prograde, radial] = HANDLE_AXES;
    expect(prograde.axis).toBe('transverse');
    expect(prograde.labelKey).toBe('planner.handle.prograde');
    expect(radial.axis).toBe('radial');
  });

  it('emits a catalogue key rather than a sentence', () => {
    // FR-910: nothing in this package builds user-facing text.
    const geometry = nodeGeometry(camera, node(0.2, 0));
    for (const handle of geometry.handles) {
      expect(handle.labelKey).toMatch(/^planner\.handle\./);
      // A key, not prose: no spaces.
      expect(handle.labelKey).not.toContain(' ');
    }
  });
});

describe('handle geometry', () => {
  it('puts the grab points a fixed pixel distance from the node', () => {
    // §8.5.2's constant screen size: the arms do not shrink when zoomed out.
    const geometry = nodeGeometry(camera, node(0.2, 0.6));
    for (const handle of geometry.handles) {
      const armLength = Math.hypot(
        handle.positive.x - geometry.centre.x,
        handle.positive.y - geometry.centre.y,
      );
      expect(armLength).toBeCloseTo(HANDLE_ARM_PX, 9);
    }
  });

  it('is the same size at any zoom', () => {
    const zoomedOut: Camera = { ...camera, scale: camera.scale / 500 };
    const geometry = nodeGeometry(zoomedOut, node(0.2, 0.6));
    const first = geometry.handles[0];
    expect(
      Math.hypot(
        (first?.positive.x ?? 0) - geometry.centre.x,
        (first?.positive.y ?? 0) - geometry.centre.y,
      ),
    ).toBeCloseTo(HANDLE_ARM_PX, 9);
  });

  it('draws a cross through the node, because a burn is signed', () => {
    // The player can pull prograde or retrograde on the same axis; two separate arms
    // would not say that.
    const geometry = nodeGeometry(camera, node(0.2, 0));
    for (const handle of geometry.handles) {
      expect(handle.positive.x + handle.negative.x).toBeCloseTo(2 * geometry.centre.x, 6);
      expect(handle.positive.y + handle.negative.y).toBeCloseTo(2 * geometry.centre.y, 6);
    }
  });

  it('emits one line and two end caps per axis', () => {
    const spec = node(0.2, 0);
    const primitives = handlePrimitives(nodeGeometry(camera, spec), spec, COLOURS);
    expect(primitives.filter((p) => p.kind === 'polyline')).toHaveLength(2);
    expect(primitives.filter((p) => p.kind === 'polygon')).toHaveLength(4);
  });
});

describe('this draws, #135 drags', () => {
  it('gives the hit-test index the same positions it draws', () => {
    // The seam between drawing and interaction is the index: two sources for a handle's
    // position would be two chances for the target to drift off the mark.
    const spec = node(0.2, 0.5, true);
    const geometry = nodeGeometry(camera, spec);

    const targets: HitTarget[] = [
      { shape: 'point', kind: 'node', id: spec.id, at: geometry.centre },
      ...geometry.handles.map((h): HitTarget => ({
        shape: 'point',
        kind: 'handle',
        id: `${h.nodeId}:${h.axisId}`,
        at: h.positive,
      })),
    ];
    const index = buildHitIndex(targets);

    // Clicking a handle's grab point selects that handle, not the node it belongs to.
    const first = geometry.handles[0];
    const hit = hitTest(index, first?.positive ?? { x: 0, y: 0 });
    expect(hit?.kind).toBe('handle');
    expect(hit?.id).toBe(`${spec.id}:prograde`);
  });

  it('holds no interaction state: a frame is a pure function of the plan', () => {
    // `selected` is a parameter, and there is no pointer event in the module.
    const a = nodeGeometry(camera, node(0.2, 0.5, false));
    const b = nodeGeometry(camera, node(0.2, 0.5, true));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('two nodes close together', () => {
  it('stays legible and separately selectable', () => {
    // #110's last criterion. Their 32 px targets overlap heavily; the nearer wins.
    const a = node(0.05, 0.0, false, 'a');
    const b = node(0.05, 0.02, false, 'b');
    const ga = nodeGeometry(camera, a);
    const gb = nodeGeometry(camera, b);

    const separation = Math.hypot(ga.centre.x - gb.centre.x, ga.centre.y - gb.centre.y);
    expect(separation).toBeGreaterThan(0);
    expect(separation).toBeLessThan(32);

    const index = buildHitIndex([
      { shape: 'point', kind: 'node', id: 'a', at: ga.centre },
      { shape: 'point', kind: 'node', id: 'b', at: gb.centre },
    ]);
    expect(hitTest(index, ga.centre)?.id).toBe('a');
    expect(hitTest(index, gb.centre)?.id).toBe('b');
  });
});

describe('an axis pointing at the viewer', () => {
  it('is dropped rather than drawn as a zero-length arm', () => {
    // The normal axis of an equatorial orbit points straight along the view direction, so
    // it projects to nothing. A zero-length arm would be an unclickable stub sitting on
    // the node.
    const equatorial = stateAt(0.2, 0);
    // Build a state whose radial direction is along the view axis by looking down the
    // radial direction itself.
    const alongRadial: Camera = {
      ...camera,
      basis: {
        right: { x: 0, y: 1, z: 0 },
        up: { x: 0, y: 0, z: 1 },
      },
    };
    expect(axisScreenDirection(alongRadial, equatorial, 'radial')).toBeUndefined();
    // And the geometry simply omits it rather than emitting a degenerate handle.
    const geometry = nodeGeometry(alongRadial, {
      id: 'n',
      state: equatorial,
      selected: false,
    });
    expect(geometry.handles.length).toBeLessThan(HANDLE_AXES.length);
  });
});

describe('no text on the canvas', () => {
  it('emits only geometric primitives', () => {
    const spec = node(0.2, 0, true);
    const geometry = nodeGeometry(camera, spec);
    const all = [
      ...nodePrimitives(geometry, spec, COLOURS),
      ...handlePrimitives(geometry, spec, COLOURS),
    ];
    for (const primitive of all) {
      expect(['polyline', 'polygon', 'disc']).toContain(primitive.kind);
    }
    // The label is an anchor plus a key; turning it into text is `@hh/ui`'s job (D8).
    expect(geometry.handles[0]?.labelAt).toBeDefined();
  });
});
