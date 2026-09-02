/**
 * `@hh/render` — Canvas 2-D scene, camera, orbit tessellation, and hit-testing.
 *
 * **Layer: above the core.** May depend on the core packages; the core may never depend
 * on this one. Dependencies point one way: render → game → sim.
 *
 * This is the one package below `apps/web` that legitimately touches the browser, so it
 * compiles against its own `tsconfig.json` with the DOM library rather than the root
 * project's, which deliberately has none. `pnpm typecheck` runs both.
 *
 * **The Canvas2D implementation is deliberately absent from this barrel.** It lives
 * behind the `@hh/render/canvas2d` subpath, because it is the only part of this package
 * that needs a DOM: the `Renderer` interface, the camera and the tessellator are plain
 * geometry over plain numbers. Keeping them reachable without the DOM is what lets the
 * benchmark suite under `tools/` measure the tessellator, lets the geometry be tested
 * under Node, and would let it run in a Worker — and it is checked rather than asserted,
 * because the root TypeScript project has no DOM library and does compile everything
 * this barrel reaches. Re-exporting `createCanvas2DRenderer` here would break all three
 * at once, and the failure would be a type error in a file nobody had touched.
 *
 * It costs consumers nothing that D7 cares about. The interface a consumer writes
 * against is here; only the line that constructs the concrete renderer names the
 * implementation, which is exactly the line that would change for a WebGL one.
 *
 * See `docs/PRODUCT.md` §11.1 (architecture and the layering rule), §11.2 (package
 * responsibilities), §11.8 (the rendering pipeline) and §9.3 (the orbit rendering
 * language).
 */

/** Package identity. */
export const PACKAGE = '@hh/render' as const;

export type {
  DashPattern,
  DiscPrimitive,
  FillStyle,
  Layer,
  PolygonPrimitive,
  PolylinePrimitive,
  Primitive,
  Renderer,
  Scene,
  ScreenPoint,
  StrokeStyle,
  Viewport,
} from './renderer.js';
export {
  DRAW_ORDER,
  MAX_BACKING_STORE_SCALE,
  backingStoreScale,
  layersInDrawOrder,
} from './renderer.js';

export type { Camera, ViewBasis, ViewBounds } from './camera.js';
export {
  AUTO_FRAME_MARGIN,
  EMPTY_BOUNDS,
  EQUATORIAL_BASIS,
  MAX_ZOOM,
  MIN_ZOOM,
  REFRAME_DURATION_SECONDS,
  REFRAME_THRESHOLD,
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
  unionBounds,
  unionOf,
  withViewport,
  worldToScreen,
  zoomAt,
  zoomFactor,
} from './camera.js';

export type { ConicClass, Tessellation, TessellationRequest } from './tessellate.js';
export {
  MAX_VERTICES,
  NEAR_PARABOLIC_BAND,
  TOLERANCE_PX,
  conicClassOf,
  tessellate,
} from './tessellate.js';

export type { CacheStats, TessellationCache } from './cache.js';
export {
  BUCKETS_PER_OCTAVE,
  DEFAULT_CAPACITY,
  bucketScale,
  createTessellationCache,
  scaleBucket,
  tessellationKey,
} from './cache.js';
