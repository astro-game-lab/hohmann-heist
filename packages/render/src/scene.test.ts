import { MU_EARTH, R_EARTH_EQ, eci, epoch, stateFromElements } from '@hh/astro';
import type { OrbitShape } from '@hh/astro';
import { V, metres, radians } from '@hh/math';
import { buildTimeline, createPlan, maneuverNodeFromCounts } from '@hh/sim';
import type { Timeline } from '@hh/sim';
import { describe, expect, it } from 'vitest';

import { createTessellationCache } from './cache.js';
import type { Camera } from './camera.js';
import { EQUATORIAL_BASIS, boundsOfSphere, frameBounds } from './camera.js';
import { buildHitIndex, hitTest } from './hit-test.js';
import { MAX_LABELS } from './labels.js';
import { DRAW_ORDER } from './renderer.js';
import type { Viewport } from './renderer.js';
import { buildScene } from './scene.js';
import type { SceneRequest } from './scene.js';
import type { SceneColours } from './style.js';

const VIEWPORT: Viewport = { width: 800, height: 600, devicePixelRatio: 2 };

const COLOURS: SceneColours = {
  background: '#05070d',
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

const orbit = (semiLatusRectumM: number, eccentricity = 0.02): OrbitShape => ({
  semiLatusRectum: metres(semiLatusRectumM),
  eccentricity,
  inclination: radians(0),
  raan: radians(0),
  argp: radians(0),
  trueAnomaly: radians(0),
});

/** A two-burn plan, which is the shape every Act I contract has. */
const timelineOf = (): Timeline => {
  // Built from quantised counts, which is the constructor that does not need an
  // `RtnVector` brand at the call site. DEP-09 quantises Δv to 1e-4 m/s, so 400 000
  // counts is 40 m/s.
  const plan = createPlan([
    maneuverNodeFromCounts(Math.round(1200 * 1024), [0, 400_000, 0]),
    maneuverNodeFromCounts(Math.round(4000 * 1024), [0, 350_000, 0]),
  ]);
  const result = buildTimeline({
    startEpoch: epoch(0),
    initialState: stateFromElements(orbit(7_000_000), MU_EARTH),
    plan,
    horizon: epoch(14 * 3600),
    mu: MU_EARTH,
  });
  if (!result.ok) throw new Error(`fixture timeline failed to build: ${JSON.stringify(result)}`);
  return result.timeline;
};

const camera: Camera = frameBounds(
  boundsOfSphere(R_EARTH_EQ + 3_000_000),
  VIEWPORT,
  EQUATORIAL_BASIS,
);

/** A resolver that echoes its key, so a test can see which key was asked for. */
const echo = (key: string, params: Record<string, number>): string =>
  `${key}(${Object.keys(params).sort().join(',')})`;

const request = (overrides: Partial<SceneRequest> = {}): SceneRequest => {
  const timeline = timelineOf();
  return {
    camera,
    colours: COLOURS,
    timeline,
    scrubEpoch: epoch(3000),
    cache: createTessellationCache(),
    maxRadiusMetres: 60_000_000,
    earthRadiusMetres: R_EARTH_EQ,
    earthRotationAngle: 0.4,
    sunDirection: { x: 1, y: 0, z: 0 },
    shells: [
      {
        id: 'altitude-floor',
        innerRadiusMetres: R_EARTH_EQ,
        outerRadiusMetres: R_EARTH_EQ + 100_000,
        state: 'clear',
      },
    ],
    ship: {
      id: 'ship',
      kind: 'ship',
      elements: timeline.arcs[0]?.elements ?? orbit(7_000_000),
      mu: MU_EARTH,
      offsetSeconds: 900,
    },
    targetOrbit: {
      id: 'target',
      kind: 'target',
      elements: orbit(9_000_000, 0.05),
      mu: MU_EARTH,
      offsetSeconds: 900,
    },
    nodes: timeline.impulses.map((impulse, index) => ({
      id: `node-${String(index)}`,
      state: impulse.after,
      selected: index === 0,
    })),
    closestApproach: {
      shipPosition: eci(V.vec3(metres(7_000_000), metres(0), metres(0))),
      targetPosition: eci(V.vec3(metres(7_050_000), metres(80_000), metres(0))),
      separationMetres: 311.4,
      relativeSpeedMps: 0.02,
      assistEnabled: true,
    },
    resolve: echo,
    ...overrides,
  };
};

describe('the composed scene', () => {
  it('fills every layer §11.8 names, and only those', () => {
    const { scene } = buildScene(request());
    for (const layer of Object.keys(scene.layers)) {
      expect(DRAW_ORDER).toContain(layer);
    }
    // The scene this PR builds populates all ten.
    for (const layer of DRAW_ORDER) {
      expect(scene.layers[layer]?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it('carries no text primitive anywhere, because there is no such primitive (D8)', () => {
    const { scene } = buildScene(request());
    for (const layer of DRAW_ORDER) {
      for (const primitive of scene.layers[layer] ?? []) {
        expect(['polyline', 'polygon', 'disc']).toContain(primitive.kind);
      }
    }
  });

  it('is a pure function of its request', () => {
    // No clock, no randomness, no mutation. Two frames built from equal requests are
    // identical, which is what lets a replay be checked frame by frame.
    const a = buildScene(request());
    const b = buildScene(request());
    expect(JSON.stringify(a.scene)).toBe(JSON.stringify(b.scene));
    expect(JSON.stringify(a.labels)).toBe(JSON.stringify(b.labels));
  });

  it('draws the current orbit solid and the plan as dots', () => {
    // §9.3, and the distinction #108 exists for: the plan is positioned marks, not a
    // dashed line, because a dash array spaces by distance.
    const { scene } = buildScene(request());
    const current = scene.layers['current-orbit'] ?? [];
    const planned = scene.layers['planned-trajectory'] ?? [];

    expect(current[0]?.kind).toBe('polyline');
    expect(current[0]?.kind === 'polyline' ? current[0].stroke.dash : ['x']).toEqual([]);
    // Every planned mark is a disc placed at an equal-time sample.
    expect(planned.length).toBeGreaterThan(10);
    for (const primitive of planned) expect(primitive.kind).toBe('disc');
  });

  it('dashes the target orbit', () => {
    const { scene } = buildScene(request());
    const target = (scene.layers['target-orbit'] ?? [])[0];
    const dash = target?.kind === 'polyline' ? target.stroke.dash : undefined;
    expect(dash?.length).toBeGreaterThan(0);
  });
});

describe('labels', () => {
  it('are resolved through the caller’s catalogue, never built here', () => {
    // FR-910. The echo resolver shows which key was asked for and with what parameters.
    const { labels } = buildScene(request());
    const keys = labels.map((l) => l.text);
    expect(keys).toContain('planner.apsis.periapsis(altitudeMetres)');
    expect(keys).toContain('planner.closestApproach(relativeSpeedMps,separationMetres)');
    expect(keys).toContain('planner.handle.prograde()');
  });

  it('stay inside §11.8’s working set of forty', () => {
    // The label layer culls beyond this anyway, but a scene that routinely asked for more
    // would be relying on the cull rather than on a budget.
    expect(buildScene(request()).labels.length).toBeLessThanOrEqual(MAX_LABELS);
  });

  it('labels handle axes only on the selected node', () => {
    // Two handles on every node would swamp forty labels on an eight-node plan.
    const withNone = buildScene(
      request({
        nodes: timelineOf().impulses.map((impulse, index) => ({
          id: `node-${String(index)}`,
          state: impulse.after,
          selected: false,
        })),
      }),
    );
    const handleLabels = withNone.labels.filter((l) => l.text.startsWith('planner.handle'));
    expect(handleLabels).toHaveLength(0);
  });

  it('gives every label a stable, unique id', () => {
    // Identity is what lets the DOM layer reuse an element rather than rebuild it.
    const { labels } = buildScene(request());
    const ids = labels.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('hit targets', () => {
  it('are ordered so a handle beats the node and the trajectory beneath it', () => {
    const { targets } = buildScene(request());
    const index = buildHitIndex(targets);

    const handle = targets.find((t) => t.kind === 'handle');
    expect(handle).toBeDefined();
    const at = handle?.shape === 'point' ? handle.at : { x: 0, y: 0 };
    expect(hitTest(index, at)?.kind).toBe('handle');
  });

  it('include the planned arcs, so §8.5.2 can place a node by clicking one', () => {
    const { targets } = buildScene(request());
    expect(targets.some((t) => t.kind === 'trajectory')).toBe(true);
  });

  it('put a node target at the same point the node is drawn at', () => {
    // The three outputs are built in one pass precisely so they cannot drift; a target two
    // pixels off the mark is a click that selects nothing.
    const { scene, targets } = buildScene(request());
    const nodeTarget = targets.find((t) => t.kind === 'node');
    const at = nodeTarget?.shape === 'point' ? nodeTarget.at : undefined;
    expect(at).toBeDefined();

    const diamond = (scene.layers.nodes ?? [])[0];
    const points = diamond?.kind === 'polygon' ? diamond.points : [];
    const centroid = points.reduce(
      (acc, p) => ({ x: acc.x + p.x / points.length, y: acc.y + p.y / points.length }),
      { x: 0, y: 0 },
    );
    expect(centroid.x).toBeCloseTo(at?.x ?? 0, 6);
    expect(centroid.y).toBeCloseTo(at?.y ?? 0, 6);
  });
});

describe('the assists and the departures stay above this layer', () => {
  it('omits the tie line entirely when the assist is off', () => {
    const off = buildScene(
      request({
        closestApproach: {
          shipPosition: eci(V.vec3(metres(7_000_000), metres(0), metres(0))),
          targetPosition: eci(V.vec3(metres(7_050_000), metres(80_000), metres(0))),
          separationMetres: 311.4,
          relativeSpeedMps: 0.02,
          assistEnabled: false,
        },
      }),
    );
    expect(off.labels.some((l) => l.text.startsWith('planner.closestApproach'))).toBe(false);
  });

  it('takes the hazard state as given rather than deciding it', () => {
    // DEP-08 lives in `@hh/game/legality`; the renderer is told whether the floor is
    // violated and draws accordingly.
    const violated = buildScene(
      request({
        shells: [
          {
            id: 'altitude-floor',
            innerRadiusMetres: R_EARTH_EQ,
            outerRadiusMetres: R_EARTH_EQ + 100_000,
            state: 'violated',
          },
        ],
      }),
    );
    const band = (violated.scene.layers['hazard-shells'] ?? []).find((p) => p.kind === 'polygon');
    expect(band?.kind === 'polygon' ? band.fill.colour : '').toBe(COLOURS.hazardViolated);
  });

  it('takes the Sun direction as given, so DEP-06 stays in the game layer', () => {
    const a = buildScene(request({ sunDirection: { x: 1, y: 0, z: 0 } }));
    const b = buildScene(request({ sunDirection: { x: 0, y: 1, z: 0 } }));
    expect(JSON.stringify(a.scene.layers.earth)).not.toBe(JSON.stringify(b.scene.layers.earth));
  });
});

describe('the tessellation cache', () => {
  it('is used, so dragging one node does not re-tessellate every orbit', () => {
    // NFR-011's requirement is stated as a behaviour: a second frame with the same orbits
    // must hit rather than recompute.
    const cache = createTessellationCache();
    buildScene(request({ cache }));
    const afterFirst = cache.stats.misses;
    buildScene(request({ cache }));

    expect(cache.stats.hits).toBeGreaterThan(0);
    expect(cache.stats.misses).toBe(afterFirst);
  });
});
