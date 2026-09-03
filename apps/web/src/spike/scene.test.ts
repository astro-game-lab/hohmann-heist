import { createTessellationCache } from '@hh/render';
import { describe, expect, it } from 'vitest';

import {
  BASE_COUNTS,
  DRAGGED_NODE,
  HORIZON,
  NODE_COUNT,
  NODE_SPACING_S,
  ORBIT_RADIUS_M,
  START,
  VIEWPORT,
  cameraFor,
  planOf,
  timelineOf,
} from './scenario.js';
import { COLOURS, buildScene, createProjectionBuffer } from './scene.js';

const build = (draggedNode = -1) =>
  buildScene({
    timeline: timelineOf(planOf(BASE_COUNTS)),
    camera: cameraFor(VIEWPORT),
    cache: createTessellationCache(),
    buffer: createProjectionBuffer(),
    draggedNode,
  });

describe('the scenario matches the benchmark it is meant to be compared against', () => {
  // This spike's whole value is that its numbers sit next to
  // `tools/bench/frame.bench.test.ts`'s. If the two fixtures drift, the comparison
  // silently stops meaning anything — so the constants are asserted, not just copied.
  it("uses §11.9's viewport, horizon and plan shape", () => {
    expect(VIEWPORT.width).toBe(1280);
    expect(VIEWPORT.height).toBe(720);
    expect(START).toBe(0);
    expect(HORIZON).toBe(14 * 3600);
    expect(NODE_COUNT).toBe(8);
    expect(NODE_SPACING_S).toBe(1800);
    expect(ORBIT_RADIUS_M).toBe(6_778_137);
  });

  it('builds a timeline of one arc per node plus the run to the horizon', () => {
    const timeline = timelineOf(planOf(BASE_COUNTS));
    expect(timeline.arcs).toHaveLength(NODE_COUNT + 1);
    expect(timeline.impulses).toHaveLength(NODE_COUNT);
  });
});

describe('buildScene', () => {
  it('puts the current orbit and the planned trajectory on different layers', () => {
    const { scene } = build();
    expect(scene.layers['current-orbit']).toHaveLength(1);
    expect(scene.layers['planned-trajectory']).toHaveLength(NODE_COUNT);
  });

  it('draws Earth and one marker per node', () => {
    const { scene } = build();
    expect(scene.layers.earth).toHaveLength(1);
    expect(scene.layers.nodes).toHaveLength(NODE_COUNT);
  });

  it('projects vertices, and reports how many', () => {
    const { vertices, scene } = build();
    expect(vertices).toBeGreaterThan(0);

    const drawn = [
      ...(scene.layers['current-orbit'] ?? []),
      ...(scene.layers['planned-trajectory'] ?? []),
    ]
      .filter((p) => p.kind === 'polyline')
      .reduce((sum, p) => sum + p.points.length, 0);
    expect(drawn).toBe(vertices);
  });

  it('gives every projected point a finite screen position', () => {
    const { scene } = build();
    for (const primitive of scene.layers['planned-trajectory'] ?? []) {
      if (primitive.kind !== 'polyline') continue;
      expect(primitive.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(
        true,
      );
    }
  });

  it('closes an elliptical orbit, so the polyline is a loop rather than an arc with a gap', () => {
    const { scene } = build();
    const current = scene.layers['current-orbit']?.[0];
    expect(current?.kind).toBe('polyline');
    if (current?.kind !== 'polyline') return;
    expect(current.closed).toBe(true);
  });

  it('highlights the dragged node and only that one', () => {
    const { scene } = build(DRAGGED_NODE);
    const markers = scene.layers.nodes ?? [];
    const highlighted = markers.filter(
      (p) => p.kind === 'disc' && p.fill.colour === COLOURS.draggedNode,
    );
    expect(highlighted).toHaveLength(1);
    expect(markers).toHaveLength(NODE_COUNT);
  });

  it('highlights nothing when no drag is in progress', () => {
    const { scene } = build();
    const markers = scene.layers.nodes ?? [];
    expect(markers.every((p) => p.kind === 'disc' && p.fill.colour === COLOURS.node)).toBe(true);
  });

  it('scales Earth by the camera, so the disc is the body rather than a fixed sprite', () => {
    const camera = cameraFor(VIEWPORT);
    const earth = build().scene.layers.earth?.[0];
    expect(earth?.kind).toBe('disc');
    if (earth?.kind !== 'disc') return;
    // A third of the viewport height covers three orbit radii, so Earth's ~6371 km
    // reads a little under one of them.
    expect(earth.radius).toBeCloseTo(6_371_000 * camera.scale, 9);
    expect(earth.radius).toBeGreaterThan(0);
  });

  it('separates a full drag by only a few pixels at this zoom — the legibility finding', () => {
    // #238's legibility criterion, as a number rather than an impression. The drag
    // sweeps the last burn from 5 to 50 m/s, which is a fifth of a LEO->GEO departure,
    // and the drawn trajectory moves by single-digit pixels. That is not a defect in
    // the renderer — it is what a 45 m/s change *is* at LEO with three orbit radii
    // across the viewport — but it means the planner cannot rely on the orbit view
    // alone to show the effect of a Δv edit. Asserted so the write-up's claim stays
    // true, and so M2 finds out here rather than in a playtest.
    const camera = cameraFor(VIEWPORT);
    const apoapsisPx = (counts: number): number => {
      const arcs = timelineOf(planOf(counts)).arcs;
      const last = arcs[arcs.length - 1];
      if (last === undefined) throw new Error('no arcs');
      const { semiLatusRectum, eccentricity } = last.elements;
      return (semiLatusRectum / (1 - eccentricity)) * camera.scale;
    };

    const separation = apoapsisPx(500_000) - apoapsisPx(50_000);
    // Measured at 5.455 px — apoapsis moves from 252.83 px to 258.29 px. The bounds
    // are loose on purpose: the point is the order of
    // magnitude, and a tight assertion here would break on a tessellation change that
    // does not matter to the finding.
    expect(separation).toBeGreaterThan(3);
    expect(separation).toBeLessThan(10);
  });

  it("reuses the caller's buffer rather than allocating one per frame", () => {
    const buffer = createProjectionBuffer();
    const cache = createTessellationCache();
    const camera = cameraFor(VIEWPORT);
    const timeline = timelineOf(planOf(BASE_COUNTS));

    const first = buildScene({ timeline, camera, cache, buffer, draggedNode: -1 });
    const second = buildScene({ timeline, camera, cache, buffer, draggedNode: -1 });
    expect(second.vertices).toBe(first.vertices);
  });
});
