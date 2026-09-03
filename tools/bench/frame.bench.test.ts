/**
 * The two frame-time budgets from `docs/PRODUCT.md` §11.9.
 *
 * > Frame time, planner idle — target 4 ms, hard limit 16.7 ms.
 * > Frame time, dragging a node (8-node plan, 14 h horizon) — target 8 ms, hard limit 16.7 ms.
 *
 * These are the two §11.9 rows #74 names that nothing measured before. They are also
 * the two that need the most care about what is being claimed, so this is stated
 * before any number is:
 *
 * ## What is measured here, and what is not
 *
 * A frame on the reference device is scene assembly *plus* rasterisation plus
 * compositing plus whatever else the browser does with the main thread. None of the
 * last three exist under Node, and inventing a stand-in for them would produce a
 * number that looks like §11.9's row and is not it.
 *
 * **What is measured is the geometry pipeline: the per-frame work owned by `@hh/sim`
 * and `@hh/render`.** For an idle frame that is a tessellation lookup per conic and
 * the projection of every vertex to screen space; for a drag frame it is that plus the
 * incremental re-evaluation the edit forces and the one conic that has to be
 * re-tessellated because of it. That is the whole of the frame these two packages are
 * accountable for, and it is the whole of what NFR-021 can ask them for — the rest of
 * the budget belongs to the renderer's canvas calls (#88) and to the browser, and is
 * a Playwright measurement on a real device (#188, #189).
 *
 * So the assertion here is against §11.9's numbers **as a ceiling on this package's
 * share**, not as a verification of the row. Passing does not mean the frame budget is
 * met; failing definitely means it is not. `docs/PHYSICS.md` says the same thing in
 * the same words, so a reader of either cannot come away with the stronger claim.
 *
 * Scene assembly into `Primitive`s is deliberately absent too, because there is no
 * scene builder yet — nothing turns a timeline into a `Scene`, that is a later issue,
 * and benchmarking a construction invented here would measure this file.
 *
 * ## Why the projection goes through `projectInto`
 *
 * `worldToScreen` allocates a `ScreenPoint` per vertex, which at 512 vertices across
 * ten conics is five thousand short-lived objects per frame and would make this a
 * measurement of the garbage collector. `projectInto` writes into a caller-owned
 * `Float32Array`, which is what a renderer that cares about a 60 Hz frame does and
 * what §11.8's pipeline describes. The buffer is allocated once, outside the loop.
 */
import { performance } from 'node:perf_hooks';
import { stdout } from 'node:process';

import type { State } from '@hh/astro';
import { MU_EARTH, epoch, stateFromElements } from '@hh/astro';
import { metres, radians } from '@hh/math';
import type { Camera, TessellationCache } from '@hh/render';
import {
  EQUATORIAL_BASIS,
  MAX_VERTICES,
  createCamera,
  createTessellationCache,
  projectInto,
} from '@hh/render';
import type { Plan, Timeline } from '@hh/sim';
import { buildTimeline, createPlan, maneuverNodeFromCounts, withPlan } from '@hh/sim';
import { describe, expect, it } from 'vitest';

import type { Statistic } from './record.js';
import { createRecorder } from './record.js';

/** Results for the gate in `compare.mjs`; see `record.ts` for what a ratio is. */
const record = createRecorder('frame');

/** §11.9: planner idle, target 4 ms; dragging a node, target 8 ms. Both hard-limited at one frame. */
const IDLE_TARGET_MS = 4;
const DRAG_TARGET_MS = 8;
const HARD_LIMIT_MS = 1000 / 60;

const BATCHES = 7;
/** One call is tens of microseconds, so a few hundred puts milliseconds in every batch. */
const ITERATIONS = 400;

/** A planner-sized window. §11.9's reference device is a laptop, not a phone. */
const VIEWPORT = { width: 1280, height: 720, devicePixelRatio: 1 };

/** A 400 km circular orbit at ISS inclination — §11.9's own drag scenario starts here. */
const INITIAL: State = stateFromElements(
  {
    semiLatusRectum: metres(6_778_137),
    eccentricity: 0,
    inclination: radians(0.9006),
    raan: radians(1.1),
    argp: radians(0),
    trueAnomaly: radians(0.6),
  },
  MU_EARTH,
);

const START = epoch(0);
/** §11.9's row says 14 h. */
const HORIZON = epoch(14 * 3600);

/**
 * Framed so a LEO orbit fills most of the viewport, which is where the vertex count is
 * highest and therefore where the frame costs most. Zooming out would be cheaper and
 * would flatter the measurement.
 */
const camera: Camera = createCamera({
  centre: INITIAL.position,
  scale: VIEWPORT.height / (3 * 6_778_137),
  autoScale: VIEWPORT.height / (3 * 6_778_137),
  basis: EQUATORIAL_BASIS,
  viewport: VIEWPORT,
});

const MAX_RADIUS = 1e9;

/** §11.9's plan: eight nodes over the horizon, each a small prograde burn. */
const NODE_SPACING_S = 1800;
const BASE_COUNTS = 250_000;

const planOf = (lastTransverseCounts: number): Plan =>
  createPlan(
    Array.from({ length: 8 }, (_, i) =>
      maneuverNodeFromCounts(Math.round((i + 1) * NODE_SPACING_S * 1024), [
        0,
        i === 7 ? lastTransverseCounts : BASE_COUNTS,
        0,
      ]),
    ),
  );

const timelineOf = (plan: Plan): Timeline => {
  const result = buildTimeline({
    startEpoch: START,
    initialState: INITIAL,
    plan,
    horizon: HORIZON,
    mu: MU_EARTH,
  });
  if (!result.ok) throw new Error(`benchmark fixture failed to build: ${result.reason}`);
  return result.timeline;
};

/**
 * The geometry half of one frame: every conic tessellated (through the cache) and
 * projected into `buffer`.
 *
 * Returns the vertex total so the optimiser cannot delete the work, and so a caller can
 * assert the frame actually drew something.
 */
const drawFrame = (timeline: Timeline, cache: TessellationCache, buffer: Float32Array): number => {
  let vertices = 0;
  for (const arc of timeline.arcs) {
    const tessellation = cache.get({
      elements: arc.elements,
      scale: camera.scale,
      maxRadius: MAX_RADIUS,
    });
    vertices += projectInto(camera, tessellation.points, buffer);
  }
  return vertices;
};

/**
 * Median milliseconds per frame over `BATCHES` batches.
 *
 * The median rather than the mean, for the reason the other benchmarks in this
 * directory give: one garbage collection inside one batch should not decide the number.
 */
const measure = (call: () => number): { median: number; min: number; sink: number } => {
  let sink = 0;
  for (let i = 0; i < ITERATIONS; i++) sink += call();

  const timings: number[] = [];
  for (let batch = 0; batch < BATCHES; batch++) {
    const start = performance.now();
    for (let i = 0; i < ITERATIONS; i++) sink += call();
    timings.push((performance.now() - start) / ITERATIONS);
  }

  timings.sort((a, b) => a - b);
  return {
    median: timings[(BATCHES - 1) / 2] ?? Number.POSITIVE_INFINITY,
    min: timings[0] ?? Number.POSITIVE_INFINITY,
    sink,
  };
};

const report = (key: string, label: string, stat: Statistic, target: number): void => {
  const { median } = stat;
  stdout.write(
    `  §11.9 frame ${label}: ${median.toFixed(4)} ms/frame ` +
      `(target ${String(target)}, hard limit ${HARD_LIMIT_MS.toFixed(1)}) ` +
      `— ${median <= target ? 'within target' : 'OVER TARGET'}\n`,
  );
  record({
    key,
    label: `frame ${label}`,
    unit: 'ms',
    stat,
    target,
    hardLimit: HARD_LIMIT_MS,
    note: 'geometry pipeline only; rasterisation is the browser and is not measured here',
  });
};

describe('§11.9 — frame time, planner idle', () => {
  it('meets the hard limit with the whole plan cached', () => {
    const timeline = timelineOf(planOf(BASE_COUNTS));
    const cache = createTessellationCache();
    const buffer = new Float32Array(MAX_VERTICES * 2);

    // Warm the cache the way an idle frame finds it: the plan has not changed since
    // the last frame, so every conic is a hit. That is what makes this row *idle*.
    const vertices = drawFrame(timeline, cache, buffer);
    expect(vertices).toBeGreaterThan(0);

    const { median, min, sink } = measure(() => drawFrame(timeline, cache, buffer));

    expect(Number.isFinite(sink)).toBe(true);
    report('render/frame/idle', 'idle (9 conics, all cached)', { median, min }, IDLE_TARGET_MS);
    expect(median).toBeLessThan(HARD_LIMIT_MS);
  }, 60_000);
});

describe('§11.9 — frame time, dragging a node', () => {
  it('meets the hard limit for an 8-node plan over a 14 h horizon', () => {
    const timeline = timelineOf(planOf(BASE_COUNTS));
    const cache = createTessellationCache();
    const buffer = new Float32Array(MAX_VERTICES * 2);

    /**
     * The plans a drag actually produces: the same eight nodes with the last one's Δv
     * moving a count at a time. Precomputed so the frame measures re-evaluation and
     * drawing rather than `createPlan`'s validation, which a real drag does once per
     * pointer event and not per frame.
     */
    const dragged = Array.from({ length: 256 }, (_, i) => planOf(BASE_COUNTS + i));

    let index = 0;
    const frame = (): number => {
      index = (index + 1) % dragged.length;
      const result = withPlan(timeline, dragged[index] ?? timeline.plan);
      if (!result.ok) throw new Error(`drag frame failed to evaluate: ${result.reason}`);
      return drawFrame(result.timeline, cache, buffer);
    };

    expect(frame()).toBeGreaterThan(0);
    const { median, min, sink } = measure(frame);

    expect(Number.isFinite(sink)).toBe(true);
    report(
      'sim+render/frame/drag',
      'dragging the last node (8 nodes, 14 h)',
      { median, min },
      DRAG_TARGET_MS,
    );
    expect(median).toBeLessThan(HARD_LIMIT_MS);
  }, 60_000);
});
