/**
 * The Canvas 2-D implementation of `Renderer` (D7, §11.8).
 *
 * Canvas 2-D rather than WebGL for v1.0 because the scene is a few thousand line
 * segments, which Canvas draws comfortably inside §11.9's 4 ms idle budget, and
 * because it costs no shader pipeline, no context-loss handling and no fallback path.
 * D7 keeps WebGL open as a v2 option; the point of the `Renderer` seam is that taking
 * it changes nothing above this file.
 *
 * ## Why the surface is structural rather than an `HTMLCanvasElement`
 *
 * `Canvas2DTarget` and `Canvas2DContext` name exactly the properties and methods this
 * renderer touches, derived from the real DOM types with `Pick` so they cannot drift
 * away from them. A real `HTMLCanvasElement` satisfies `Canvas2DTarget` structurally
 * and is what the application will pass.
 *
 * The gain is that a test can hand this a recording double and assert what was drawn,
 * under the `packages` Vitest project — which runs in Node, deliberately, because the
 * simulation must not need a browser to be tested. Drawing to a jsdom canvas would
 * test jsdom's canvas stub; recording the calls tests this renderer. It also means a
 * future `OffscreenCanvas` in a worker needs no change here.
 *
 * ## Backing store and the transform
 *
 * The backing store is sized in *device* pixels at `min(dpr, 2)` (§11.8), and every
 * frame begins with `setTransform` at that scale. So all primitive coordinates are
 * CSS pixels — the caller, and `camera.ts` behind it, never sees the device-pixel
 * ratio at all. Setting the transform per frame rather than once at resize matters:
 * `ctx.save()`/`restore()` around the frame leaves the context exactly as it was
 * found, so this renderer can share a canvas with something else without either
 * having to know.
 */
import type {
  DiscPrimitive,
  FillStyle,
  Layer,
  PolygonPrimitive,
  PolylinePrimitive,
  Primitive,
  Renderer,
  Scene,
  StrokeStyle,
  Viewport,
} from './renderer.js';
import { DRAW_ORDER, backingStoreScale } from './renderer.js';

/**
 * The part of `CanvasRenderingContext2D` this renderer uses.
 *
 * Derived from the DOM type with `Pick` rather than written out, so that a change in
 * the platform's signatures is a compile error here rather than a silent divergence.
 */
export type Canvas2DContext = Pick<
  CanvasRenderingContext2D,
  | 'save'
  | 'restore'
  | 'setTransform'
  | 'clearRect'
  | 'fillRect'
  | 'beginPath'
  | 'moveTo'
  | 'lineTo'
  | 'closePath'
  | 'arc'
  | 'stroke'
  | 'fill'
  | 'setLineDash'
  | 'lineWidth'
  | 'lineJoin'
  | 'lineCap'
  | 'strokeStyle'
  | 'fillStyle'
  | 'globalAlpha'
>;

/**
 * The part of a canvas element this renderer uses.
 *
 * `width` and `height` are the **backing store** in device pixels, which is what
 * setting them on a real canvas means. The CSS size is laid out by the page and is
 * none of this renderer's business.
 */
export interface Canvas2DTarget {
  width: number;
  height: number;
  getContext(contextId: '2d'): Canvas2DContext | null;
}

/** No dash pattern. Hoisted so a solid stroke does not allocate one per primitive. */
const SOLID: readonly number[] = Object.freeze([]);

const applyStroke = (ctx: Canvas2DContext, stroke: StrokeStyle): void => {
  ctx.strokeStyle = stroke.colour;
  ctx.lineWidth = stroke.width;
  ctx.globalAlpha = stroke.alpha ?? 1;
  // `setLineDash` copies its argument, and passing the frozen empty array resets a
  // dash left behind by the previous primitive. Forgetting this is the classic
  // "everything after the target orbit is dashed too" bug.
  ctx.setLineDash([...(stroke.dash ?? SOLID)]);
};

const applyFill = (ctx: Canvas2DContext, fill: FillStyle): void => {
  ctx.fillStyle = fill.colour;
  ctx.globalAlpha = fill.alpha ?? 1;
};

const tracePath = (ctx: Canvas2DContext, points: readonly { x: number; y: number }[]): boolean => {
  const first = points[0];
  if (first === undefined) return false;
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < points.length; i++) {
    // `noUncheckedIndexedAccess` is on, and a hot loop should not pay for an
    // undefined check the loop bound already rules out.
    const p = points[i] as { x: number; y: number };
    ctx.lineTo(p.x, p.y);
  }
  return true;
};

const drawPolyline = (ctx: Canvas2DContext, primitive: PolylinePrimitive): void => {
  // A single point has no segment to stroke; `lineCap` would render it as a dot,
  // which is a mark the caller did not ask for.
  if (primitive.points.length < 2) return;
  if (!tracePath(ctx, primitive.points)) return;
  if (primitive.closed === true) ctx.closePath();
  applyStroke(ctx, primitive.stroke);
  ctx.stroke();
};

const drawPolygon = (ctx: Canvas2DContext, primitive: PolygonPrimitive): void => {
  if (primitive.points.length < 3) return;
  if (!tracePath(ctx, primitive.points)) return;
  ctx.closePath();
  applyFill(ctx, primitive.fill);
  ctx.fill();
  if (primitive.stroke !== undefined) {
    applyStroke(ctx, primitive.stroke);
    ctx.stroke();
  }
};

const drawDisc = (ctx: Canvas2DContext, primitive: DiscPrimitive): void => {
  if (!(primitive.radius > 0)) return;
  ctx.beginPath();
  ctx.arc(primitive.centre.x, primitive.centre.y, primitive.radius, 0, Math.PI * 2);
  applyFill(ctx, primitive.fill);
  ctx.fill();
  if (primitive.stroke !== undefined) {
    applyStroke(ctx, primitive.stroke);
    ctx.stroke();
  }
};

const drawPrimitive = (ctx: Canvas2DContext, primitive: Primitive): void => {
  switch (primitive.kind) {
    case 'polyline':
      drawPolyline(ctx, primitive);
      return;
    case 'polygon':
      drawPolygon(ctx, primitive);
      return;
    case 'disc':
      drawDisc(ctx, primitive);
      return;
  }
};

/**
 * A `Renderer` drawing to a 2-D canvas context.
 *
 * @throws TypeError when the target yields no 2-D context. That happens for a canvas
 * already bound to another context type, and failing here beats a renderer that
 * silently draws nothing for the life of the session.
 */
export const createCanvas2DRenderer = (
  target: Canvas2DTarget,
  viewport: Viewport,
): Renderer & { readonly backingStoreScale: number } => {
  const ctx = target.getContext('2d');
  if (ctx === null) {
    throw new TypeError('canvas has no 2-D context; it may already be bound to another context');
  }

  let current: Viewport = viewport;
  let scale = backingStoreScale(viewport.devicePixelRatio);

  const sizeBackingStore = (): void => {
    // Round rather than truncate: a 1439.6 CSS-pixel viewport at 2x is 2879.2 device
    // pixels, and flooring loses the last column to the page background.
    target.width = Math.max(1, Math.round(current.width * scale));
    target.height = Math.max(1, Math.round(current.height * scale));
  };

  sizeBackingStore();

  return {
    get viewport(): Viewport {
      return current;
    },

    get backingStoreScale(): number {
      return scale;
    },

    resize(next: Viewport): void {
      if (
        next.width === current.width &&
        next.height === current.height &&
        next.devicePixelRatio === current.devicePixelRatio
      ) {
        // Assigning `canvas.width` clears the canvas even when the value is
        // unchanged, so a no-op resize has to actually do nothing.
        return;
      }
      current = next;
      scale = backingStoreScale(next.devicePixelRatio);
      sizeBackingStore();
    },

    draw(scene: Scene): void {
      ctx.save();
      // Absolute, not `ctx.scale`, so a frame never compounds the previous frame's
      // transform if `restore` was somehow missed.
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';

      ctx.clearRect(0, 0, current.width, current.height);
      if (scene.background !== undefined) {
        applyFill(ctx, scene.background);
        ctx.fillRect(0, 0, current.width, current.height);
      }

      // §11.8's order comes from `DRAW_ORDER`, never from the scene's own keys.
      for (const layer of DRAW_ORDER) {
        const primitives: readonly Primitive[] | undefined = scene.layers[layer satisfies Layer];
        if (primitives === undefined) continue;
        for (const primitive of primitives) drawPrimitive(ctx, primitive);
      }

      ctx.restore();
    },
  };
};
