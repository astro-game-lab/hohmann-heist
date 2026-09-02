/**
 * The `Renderer` seam — what a drawing device is, and in what order it draws.
 *
 * D7 asks for "a `Renderer` interface with a Canvas2D implementation. A WebGL
 * implementation is a v2 option and **requires no consumer changes**." That last
 * clause is the whole design constraint, and it rules out the obvious shape. An
 * interface of imperative primitives — `moveTo`, `stroke`, `setLineDash` — would let
 * a caller decide the order things are drawn in, and then the order would live in
 * the caller rather than in the renderer. Swapping the implementation would preserve
 * the *drawing*, but a second implementation that batches by material, as a WebGL one
 * would, could not reorder anything without changing what appears on screen.
 *
 * So the interface takes a **`Scene`**: a whole frame's geometry, bucketed by layer.
 * The renderer walks `DRAW_ORDER` and draws each bucket. §11.8's draw order is then a
 * constant in this module rather than an emergent property of call sites, which is
 * what #101 asks for when it says the order must be "expressed in code rather than
 * left implicit in call order". A WebGL implementation is free to sort within a
 * layer, upload buffers, or draw the whole frame in one pass, because the contract is
 * "these layers, in this order", not "these calls, in this sequence".
 *
 * ## What is deliberately not here
 *
 * **No text.** D8 and §11.8 put every label in the DOM, absolutely positioned and
 * updated per frame, so that it stays selectable and announceable to a screen reader.
 * There is no `drawText` primitive, and that is the enforcement: a caller cannot draw
 * text on the canvas because the interface gives it no way to. `labels` is the last
 * entry in §11.8's list and is the one entry absent from `DRAW_ORDER` below, for that
 * reason and only that reason.
 *
 * **No game concepts.** Primitives carry points and styles. Nothing in this module
 * knows what an orbit, a maneuver node or a hazard is; the layer names are the only
 * place those words appear, and they are labels for buckets rather than types with
 * behaviour. §11.2: this package never contains game rules.
 *
 * **No colours of its own.** Every style carries a CSS colour string supplied by the
 * caller, because the palette is `@hh/ui`'s (§11.2) and there are five of them
 * (NFR-018).
 *
 * ## Coordinates
 *
 * Every primitive is in **CSS pixels**, origin top-left, y down. The camera has
 * already projected world metres to screen pixels in float64 by the time a scene
 * reaches a renderer — that is step 4 of §11.8's pipeline and this is step 5. The
 * device-pixel-ratio scaling of the backing store is the implementation's business
 * and is invisible here.
 */

/** A point in CSS pixels, origin top-left, y increasing downward. */
export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

/** The drawing surface's size in CSS pixels, and the display's pixel density. */
export interface Viewport {
  /** Width in CSS pixels. */
  readonly width: number;
  /** Height in CSS pixels. */
  readonly height: number;
  /**
   * The display's device pixel ratio, as reported — *not* clamped.
   *
   * The cap belongs to the renderer, not to the caller: a caller that clamped
   * before handing the value over would leave the renderer unable to tell a 3× phone
   * from a 2× laptop, and `MAX_BACKING_STORE_SCALE` is a battery policy that every
   * implementation should apply identically. See `backingStoreScale`.
   */
  readonly devicePixelRatio: number;
}

/**
 * The backing store is never sized above 2× (§11.8, "capped at 2 for battery").
 *
 * A 3× phone display renders 2.25 times the pixels of a 2× one for a difference
 * essentially nobody can see on orbit lines a couple of pixels wide, and the cost is
 * paid on every frame of a game that is meant to run for a whole commute.
 */
export const MAX_BACKING_STORE_SCALE = 2;

/**
 * Device pixels per CSS pixel for the backing store: `dpr`, capped at 2.
 *
 * Values below 1 are raised to 1 — a fractional backing store would resample the
 * whole scene to save nothing, and a zero or negative one is a caller bug that would
 * otherwise surface as an invisible canvas.
 */
export const backingStoreScale = (devicePixelRatio: number): number => {
  if (!Number.isFinite(devicePixelRatio)) return 1;
  return Math.min(Math.max(devicePixelRatio, 1), MAX_BACKING_STORE_SCALE);
};

/**
 * A dash pattern in CSS pixels, alternating on and off lengths.
 *
 * Empty means solid. §9.3 gives the trajectory vocabulary — current orbit solid,
 * target orbit dashed, planned trajectory dotted — and this is how the caller says
 * which, without this package having an opinion about which orbit is which.
 */
export type DashPattern = readonly number[];

/** How a line is stroked. */
export interface StrokeStyle {
  /** A CSS colour string. The palette belongs to `@hh/ui`, not here. */
  readonly colour: string;
  /** Line width in CSS pixels. */
  readonly width: number;
  /** Dash pattern in CSS pixels. Absent or empty means solid. */
  readonly dash?: DashPattern;
  /** Opacity in `[0, 1]`. Absent means fully opaque. */
  readonly alpha?: number;
}

/** How a shape is filled. */
export interface FillStyle {
  /** A CSS colour string. */
  readonly colour: string;
  /** Opacity in `[0, 1]`. Absent means fully opaque. */
  readonly alpha?: number;
}

/** An open or closed run of line segments — every trajectory in §9.3 is one of these. */
export interface PolylinePrimitive {
  readonly kind: 'polyline';
  readonly points: readonly ScreenPoint[];
  readonly stroke: StrokeStyle;
  /** Join the last point back to the first. A closed ellipse rather than an arc. */
  readonly closed?: boolean;
}

/** A filled area, optionally outlined — hazard shells, ground-station cones, the umbra. */
export interface PolygonPrimitive {
  readonly kind: 'polygon';
  readonly points: readonly ScreenPoint[];
  readonly fill: FillStyle;
  readonly stroke?: StrokeStyle;
}

/** A filled circle, optionally outlined — Earth, markers, the ring on a selected node. */
export interface DiscPrimitive {
  readonly kind: 'disc';
  readonly centre: ScreenPoint;
  /** Radius in CSS pixels. */
  readonly radius: number;
  readonly fill: FillStyle;
  readonly stroke?: StrokeStyle;
}

/** Everything a renderer can be asked to draw. Note the absence of text. */
export type Primitive = PolylinePrimitive | PolygonPrimitive | DiscPrimitive;

/**
 * The canvas layers of §11.8's draw order.
 *
 * ```
 * earth → hazard shells → constraint geometry → target orbit
 *       → current orbit → planned trajectory → trails → markers
 *       → nodes → handles → labels
 * ```
 *
 * `labels` is absent because labels are not drawn on the canvas at all (D8) — see the
 * module docstring.
 */
export type Layer =
  | 'earth'
  | 'hazard-shells'
  | 'constraint-geometry'
  | 'target-orbit'
  | 'current-orbit'
  | 'planned-trajectory'
  | 'trails'
  | 'markers'
  | 'nodes'
  | 'handles';

/**
 * §11.8's draw order, back to front.
 *
 * Exported so that a test can assert a renderer honoured it, and so that a second
 * implementation reuses this array rather than transcribing it. Iterating this rather
 * than the scene's own keys is also what keeps a frame independent of the order a
 * caller happened to populate its layers in (NFR-009).
 */
export const DRAW_ORDER: readonly Layer[] = Object.freeze([
  'earth',
  'hazard-shells',
  'constraint-geometry',
  'target-orbit',
  'current-orbit',
  'planned-trajectory',
  'trails',
  'markers',
  'nodes',
  'handles',
] as const);

/** One frame's geometry, bucketed by layer. */
export interface Scene {
  /**
   * Layers to draw. A layer may be absent or empty; both mean "nothing here".
   *
   * Keys are not iterated — `DRAW_ORDER` is — so the insertion order of this object
   * has no effect on the frame.
   */
  readonly layers: Partial<Readonly<Record<Layer, readonly Primitive[]>>>;
  /**
   * Fill painted over the whole viewport before any layer.
   *
   * Absent leaves the surface transparent, which is what lets the page's own
   * background show through under `prefers-color-scheme`.
   */
  readonly background?: FillStyle;
}

/**
 * A drawing device.
 *
 * Implementations are constructed with a surface and a viewport, so this interface
 * covers only what a consumer does per frame and on resize. `@hh/render` ships
 * `createCanvas2DRenderer`; D7's WebGL implementation would add a second factory and
 * nothing else.
 */
export interface Renderer {
  /** The viewport most recently set, in CSS pixels. */
  readonly viewport: Viewport;
  /**
   * Resize the surface. Idempotent — resizing to the current viewport is a no-op, so
   * a caller may hand this a `ResizeObserver` entry on every callback.
   */
  resize(viewport: Viewport): void;
  /** Draw one frame, layer by layer, in `DRAW_ORDER`. */
  draw(scene: Scene): void;
}

/** The layers of a scene, in draw order, skipping the empty ones. */
export const layersInDrawOrder = (scene: Scene): readonly (readonly Primitive[])[] => {
  const out: (readonly Primitive[])[] = [];
  for (const layer of DRAW_ORDER) {
    const primitives = scene.layers[layer];
    if (primitives !== undefined && primitives.length > 0) out.push(primitives);
  }
  return out;
};
