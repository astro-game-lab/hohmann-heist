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
 * **The browser-facing modules are deliberately absent from this barrel.** The Canvas2D
 * implementation lives behind `@hh/render/canvas2d` and the viewport observer behind
 * `@hh/render/resize`, because they are the only parts of this package that need a DOM: the `Renderer` interface, the camera and the tessellator are plain
 * geometry over plain numbers. Keeping them reachable without the DOM is what lets the
 * benchmark suite under `tools/` measure the tessellator, lets the geometry be tested
 * under Node, and would let it run in a Worker — and it is checked rather than asserted,
 * because the root TypeScript project has no DOM library and does compile everything
 * this barrel reaches. Re-exporting `createCanvas2DRenderer` here would break all three
 * at once, and the failure would be a type error in a file nobody had touched.
 *
 * `resize.ts` is a slightly different case worth naming: its platform types are
 * structural, so it would in fact compile without the DOM library. It stays behind a
 * subpath anyway, because `observeViewport` reaches for `globalThis.window` and
 * `globalThis.ResizeObserver` at run time when its defaults are taken. A module that
 * needs a browser to *work* belongs with the one that needs a browser to *compile*,
 * whatever the type checker can see.
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

export type { BackingStoreSize } from './viewport.js';
export {
  backingStoreSize,
  cssToDevice,
  deviceToCss,
  resized,
  sameViewport,
  withDevicePixelRatio,
} from './viewport.js';

export type { Coastlines } from './coastlines.js';
export { COASTLINES, decodeCoastlines } from './coastlines.js';

export type {
  Hit,
  HitIndex,
  HitKind,
  HitTarget,
  PathHitTarget,
  PointHitTarget,
} from './hit-test.js';
export {
  HIT_PRIORITY,
  MIN_HIT_TARGET_PX,
  buildHitIndex,
  distanceToTarget,
  hitRadius,
  hitTest,
  hitTestAll,
} from './hit-test.js';

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

export type { SceneColours } from './style.js';
export {
  DASH_CURRENT_ORBIT,
  DASH_PLANNED_FALLBACK,
  DASH_TARGET_ORBIT,
  PLANNED_DOT_RADIUS,
  TRAJECTORY_PATTERNS,
  WIDTH_CURRENT_ORBIT,
  WIDTH_PLANNED_TRAJECTORY,
  WIDTH_TARGET_ORBIT,
  currentOrbitStroke,
  plannedDotFill,
  targetOrbitStroke,
} from './style.js';

export type { EqualTimeDots, EqualTimeDotsRequest, KeplerianSampler } from './trajectory.js';
export {
  DEFAULT_DOTS_PER_REVOLUTION,
  MAX_DOTS,
  equalTimeDots,
  keplerianSampler,
  periodOfArc,
} from './trajectory.js';

export { coastlinePolylines, earthDisc, terminatorPolygon, viewDirection } from './earth.js';

export type { HazardShell, ShellState } from './shells.js';
export {
  HATCH_SPACING_PX,
  VIOLATED_HATCH_FACTOR,
  hatchTickCount,
  hazardShellPrimitives,
} from './shells.js';

export type { MarkerKind, MarkerSpec } from './markers.js';
export {
  MARKER_RADIUS_PX,
  TRAIL_SECONDS,
  TRAIL_SEGMENTS,
  markerCentre,
  markerPrimitive,
  markerWithTrail,
  shipMarker,
  targetMarker,
  trailPoints,
  trailPrimitives,
} from './markers.js';

export type { HandleAnchor, HandleAxisId, NodeGeometry, NodeSpec } from './nodes.js';
export {
  HANDLE_ARM_PX,
  HANDLE_AXES,
  NODE_RADIUS_PX,
  SELECTION_RING_PX,
  axisScreenDirection,
  handlePrimitives,
  nodeDiamond,
  nodeGeometry,
  nodePosition,
  nodePrimitives,
  nodeVelocity,
} from './nodes.js';

export type { ApsisKind, ApsisMarker, TieLine, TieLineRequest } from './apsis.js';
export {
  APSIS_LABEL_KEYS,
  APSIS_TICK_PX,
  TIE_LINE_LABEL_KEY,
  apsisMarkers,
  closestApproachTieLine,
  hasDistinctApsides,
} from './apsis.js';

export type { CacheStats, TessellationCache } from './cache.js';
export {
  BUCKETS_PER_OCTAVE,
  DEFAULT_CAPACITY,
  bucketScale,
  createTessellationCache,
  scaleBucket,
  tessellationKey,
} from './cache.js';
