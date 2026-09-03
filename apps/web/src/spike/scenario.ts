/**
 * The spike's fixture — deliberately identical to `tools/bench/frame.bench.test.ts`.
 *
 * The point of this page is a *comparison*, not an absolute number. Node already
 * reports §11.9's scenario at 0.008–0.010 ms idle and 0.041–0.048 ms dragging, and
 * `docs/PHYSICS.md` says of those figures:
 *
 * > Rasterisation, compositing and everything else the browser does with the main
 * > thread are not measured and cannot be from here.
 *
 * Running a *different* scenario in the browser would leave that gap exactly where it
 * was, because the difference between the two numbers would confound the scenario with
 * the environment. Running the same one makes the difference mean one thing: what the
 * browser adds. So every constant below is copied from the benchmark rather than chosen,
 * and the two files should be changed together or not at all.
 */
import type { Epoch, State } from '@hh/astro';
import { MU_EARTH, eci, epoch, stateFromElements } from '@hh/astro';
import { V, metres, radians } from '@hh/math';
import type { Camera, Viewport } from '@hh/render';
import { EQUATORIAL_BASIS, createCamera } from '@hh/render';
import type { Plan } from '@hh/sim';
import { buildTimeline, createPlan, maneuverNodeFromCounts } from '@hh/sim';
import type { Timeline } from '@hh/sim';

/** §11.9's own viewport. The page letterboxes to this rather than filling the window. */
export const VIEWPORT: Viewport = Object.freeze({
  width: 1280,
  height: 720,
  devicePixelRatio: 1,
});

/** Radius of the 400 km circular orbit the scenario starts on, in metres. */
export const ORBIT_RADIUS_M = 6_778_137;

/** A 400 km circular orbit at ISS inclination. */
export const INITIAL: State = stateFromElements(
  {
    semiLatusRectum: metres(ORBIT_RADIUS_M),
    eccentricity: 0,
    inclination: radians(0.9006),
    raan: radians(1.1),
    argp: radians(0),
    trueAnomaly: radians(0.6),
  },
  MU_EARTH,
);

export const START: Epoch = epoch(0);

/** §11.9's row says 14 h. */
export const HORIZON: Epoch = epoch(14 * 3600);

/** §11.9's plan: eight nodes over the horizon, each a small prograde burn. */
export const NODE_SPACING_S = 1800;
export const NODE_COUNT = 8;
export const BASE_COUNTS = 250_000;

/** The node the drag moves — the last one, as in the benchmark. */
export const DRAGGED_NODE = NODE_COUNT - 1;

/**
 * Earth's mean radius, for the disc under the orbit.
 *
 * Hard-coded rather than imported because `@hh/astro`'s constant is the equatorial
 * radius and this is a flat 2-D disc; the distinction is 21 km on a body drawn at
 * about 240 px, which is a third of a pixel. #106 owns the real Earth.
 */
export const EARTH_RADIUS_M = 6_371_000;

/**
 * The plan, with the last node's transverse delta-v as the only free parameter.
 *
 * One parameter because that is what a drag changes: §11.9's drag row moves one node's
 * handle, and `withPlan` then re-evaluates from that node onward and reuses every arc
 * before it by reference.
 */
export const planOf = (lastTransverseCounts: number): Plan =>
  createPlan(
    Array.from({ length: NODE_COUNT }, (_, i) =>
      maneuverNodeFromCounts(Math.round((i + 1) * NODE_SPACING_S * 1024), [
        0,
        i === DRAGGED_NODE ? lastTransverseCounts : BASE_COUNTS,
        0,
      ]),
    ),
  );

/** Build a timeline from a plan, or throw — a fixture that will not build is a bug here. */
export const timelineOf = (plan: Plan): Timeline => {
  const result = buildTimeline({
    startEpoch: START,
    initialState: INITIAL,
    plan,
    horizon: HORIZON,
    mu: MU_EARTH,
  });
  if (!result.ok) throw new Error(`spike fixture failed to build: ${result.reason}`);
  return result.timeline;
};

/**
 * The camera, fixed for the whole run.
 *
 * Deliberately *not* auto-framed. Auto-framing is #103, and a camera that moves while
 * the plan changes would fold a re-frame into every drag frame — which is a thing to
 * measure once it exists, but not the thing this spike is measuring.
 *
 * `scale` is the benchmark's, to the character, because every cost that varies with the
 * camera varies with the *scale*: tessellation refines to a screen-space sagitta, and
 * the cache buckets on it. The **centre** is the one thing changed — the benchmark
 * centres on the ship, which is fine when nothing is drawn, but puts a third of the
 * orbit outside a viewport that now has pixels in it. Translating the camera changes no
 * cost at all: `projectInto` subtracts the centre before scaling, so it is one
 * subtraction either way.
 */
export const cameraFor = (viewport: Viewport): Camera =>
  createCamera({
    centre: eci(V.vec3(metres(0), metres(0), metres(0))),
    scale: viewport.height / (3 * ORBIT_RADIUS_M),
    autoScale: viewport.height / (3 * ORBIT_RADIUS_M),
    basis: EQUATORIAL_BASIS,
    viewport,
  });

/** The tessellator's clip radius. Large enough that nothing in this scenario reaches it. */
export const MAX_RADIUS_M = 1e9;
