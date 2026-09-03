/**
 * Turning a `Timeline` into a `Scene` — the part of a frame that is neither simulation
 * nor rasterisation.
 *
 * `tools/bench/frame.bench.test.ts` stops at `projectInto`: it counts vertices into a
 * `Float32Array` and never builds a primitive. That is the right boundary for a
 * benchmark of the geometry, but it means **the allocation this file does has never
 * been measured anywhere.** `Scene` is a tree of `ScreenPoint` objects (§11.8), so a
 * frame that draws ten conics of up to 512 vertices allocates a few thousand small
 * objects, and a garbage collector that runs during a drag is exactly the kind of thing
 * R1 is about. Measuring it is half the point of the spike, so the conversion is done
 * here, in the frame, rather than hoisted into a fixture.
 *
 * The projection buffer *is* reused across frames, because that part is a genuine
 * per-frame cost the renderer would pay too, and re-allocating it would measure the
 * allocator instead of the pipeline.
 */
import type { EciVector } from '@hh/astro';
import { eci } from '@hh/astro';
import type { Metres } from '@hh/math';
import { V, metres } from '@hh/math';
import type { Camera, Layer, Primitive, Scene, ScreenPoint, TessellationCache } from '@hh/render';
import { MAX_VERTICES, projectInto, worldToScreen } from '@hh/render';
import type { Timeline } from '@hh/sim';

import { EARTH_RADIUS_M, MAX_RADIUS_M } from './scenario.js';

/**
 * A local palette.
 *
 * Not design tokens — those are #116 and land in M3. Hard-coded here so the spike owns
 * nothing the real planner will want to inherit, per this issue's throwaway criterion.
 */
export const COLOURS = Object.freeze({
  background: '#05070d',
  earth: '#12233f',
  earthEdge: '#2b4766',
  currentOrbit: '#5bc0eb',
  plannedTrajectory: '#9bb1c9',
  node: '#f5a623',
  draggedNode: '#ffd479',
});

/** The world origin, for the Earth disc's centre. */
const ORIGIN: EciVector<Metres> = eci(V.vec3(metres(0), metres(0), metres(0)));

/** Two floats per vertex, sized for the tessellator's own cap. */
export const createProjectionBuffer = (): Float32Array => new Float32Array(MAX_VERTICES * 2);

/**
 * Copy `count` projected vertices out of the buffer as `ScreenPoint`s.
 *
 * Points behind nothing and clipped by nothing: this spike draws whole conics and lets
 * the canvas clip. Real culling is the renderer's, and it is not this issue's.
 */
const pointsFrom = (buffer: Float32Array, count: number): ScreenPoint[] => {
  const points: ScreenPoint[] = new Array<ScreenPoint>(count);
  for (let i = 0; i < count; i++) {
    points[i] = { x: buffer[i * 2] ?? 0, y: buffer[i * 2 + 1] ?? 0 };
  }
  return points;
};

export interface SceneRequest {
  readonly timeline: Timeline;
  readonly camera: Camera;
  readonly cache: TessellationCache;
  readonly buffer: Float32Array;
  /** Index of the node being dragged, highlighted differently. `-1` for none. */
  readonly draggedNode: number;
}

export interface SceneResult {
  readonly scene: Scene;
  /** Vertices projected this frame, summed over every conic. Reported, not asserted. */
  readonly vertices: number;
}

/**
 * Build the frame's scene.
 *
 * Arc 0 is the orbit the ship is on now; every later arc is a consequence of the plan,
 * so they land on different layers and read differently. That distinction is §9.3's and
 * it costs nothing to honour here.
 */
export const buildScene = (request: SceneRequest): SceneResult => {
  const { timeline, camera, cache, buffer, draggedNode } = request;

  const current: Primitive[] = [];
  const planned: Primitive[] = [];
  let vertices = 0;

  for (const [index, arc] of timeline.arcs.entries()) {
    const tessellation = cache.get({
      elements: arc.elements,
      scale: camera.scale,
      maxRadius: MAX_RADIUS_M,
    });
    const count = projectInto(camera, tessellation.points, buffer);
    vertices += count;

    const primitive: Primitive = {
      kind: 'polyline',
      points: pointsFrom(buffer, count),
      closed: tessellation.closed,
      stroke:
        index === 0
          ? { colour: COLOURS.currentOrbit, width: 2 }
          : { colour: COLOURS.plannedTrajectory, width: 1.5, alpha: 0.85 },
    };
    (index === 0 ? current : planned).push(primitive);
  }

  const nodes: Primitive[] = timeline.impulses.map((impulse) => ({
    kind: 'disc',
    centre: worldToScreen(camera, impulse.after.position),
    radius: impulse.nodeIndex === draggedNode ? 7 : 5,
    fill: {
      colour: impulse.nodeIndex === draggedNode ? COLOURS.draggedNode : COLOURS.node,
    },
  }));

  const earth: Primitive = {
    kind: 'disc',
    centre: worldToScreen(camera, ORIGIN),
    radius: EARTH_RADIUS_M * camera.scale,
    fill: { colour: COLOURS.earth },
    stroke: { colour: COLOURS.earthEdge, width: 1 },
  };

  const layers: Partial<Record<Layer, readonly Primitive[]>> = {
    earth: [earth],
    'current-orbit': current,
    'planned-trajectory': planned,
    nodes,
  };

  return {
    scene: { layers, background: { colour: COLOURS.background } },
    vertices,
  };
};
