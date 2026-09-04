/**
 * What a label *is* — the data half of the DOM label layer (D8, §11.8, #113).
 *
 * Split out of `labels.ts` because of a layering rule this package enforces rather than
 * asserts: `index.ts` must stay importable without the DOM library, so the geometry can
 * be tested under Node and measured from `tools/bench`. `scene.ts` produces labels and is
 * in the barrel; `labels.ts` consumes them and names `HTMLElement`.
 *
 * Putting `LabelSpec` in the same file as the layer that renders it made the barrel drag
 * `HTMLElement` into the no-DOM project, and the root `tsc` said so immediately. That is
 * the guardrail described in `index.ts` doing its job, and the answer is the one it
 * implies: the description of a label is plain data, and only the thing that mounts one
 * needs a browser.
 *
 * So everything here is a function of numbers and strings. `labels.ts` re-exports it all,
 * so a consumer that wants both still has one import.
 */
import type { ScreenPoint, Viewport } from './renderer.js';

/**
 * §11.8's working set. Beyond this the per-frame cost stops being negligible.
 *
 * Not enforced by throwing — a scene that briefly wants 41 labels should degrade, not
 * fail — but reported in {@link LabelLayerStats} so a caller can assert it, and the
 * excess is culled so the frame budget holds regardless.
 */
export const MAX_LABELS = 40;

/**
 * How far outside the viewport a label may sit before it is culled, in CSS pixels.
 *
 * A little slack, so a label attached to something at the very edge does not flicker in
 * and out as the camera eases. Generous enough to cover a label's own width, since this
 * module deliberately never measures one.
 */
export const CULL_MARGIN_PX = 120;

/** Where the label's box sits relative to its anchor point. */
export type LabelAnchor =
  | 'centre'
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';

/** One label. `text` is already resolved through the catalogue by the caller. */
export interface LabelSpec {
  /** Stable across frames. Identity is what lets an element be reused rather than rebuilt. */
  readonly id: string;
  /** The resolved string. Never a key, never assembled from fragments here (FR-910). */
  readonly text: string;
  /** Where it points, in CSS pixels — the same space every primitive is in. */
  readonly at: ScreenPoint;
  /** Default `centre`. */
  readonly anchor?: LabelAnchor;
  /** Extra class names, for the palette and type scale that live in `@hh/ui`. */
  readonly className?: string;
  /**
   * An accessible name, when the visible text is not one.
   *
   * An apsis tick reading "412 km" means nothing announced on its own; `aria-label`
   * carries "apoapsis, 412 kilometres" while the visible text stays terse.
   */
  readonly ariaLabel?: string;
}

/** Counts for a test or a performance overlay. */
export interface LabelLayerStats {
  /** Labels currently in the layer, visible or hidden. */
  readonly total: number;
  /** Labels drawn this frame. */
  readonly visible: number;
  /** Labels culled for being outside the viewport. */
  readonly culled: number;
  /** Labels dropped for exceeding `MAX_LABELS`. */
  readonly dropped: number;
  /** Elements created since construction. */
  readonly created: number;
  /** Elements removed since construction. */
  readonly removed: number;
}

export interface LabelLayer {
  /** Reconcile the layer against this frame's labels. */
  update(labels: readonly LabelSpec[], viewport: Viewport): void;
  /** Remove every element and release the layer. */
  destroy(): void;
  readonly stats: LabelLayerStats;
}

/** Class applied to every label element, for `@hh/ui` to style. */
export const LABEL_CLASS = 'hh-label';

/**
 * The `transform` that places a label's box relative to its anchor point.
 *
 * Expressed as a percentage of the element's own size, so the browser resolves it
 * against a width this module never asks for. Asking would force a synchronous layout,
 * which is precisely what the transform-only rule exists to avoid.
 */
const anchorShift = (anchor: LabelAnchor): string => {
  switch (anchor) {
    case 'centre':
      return 'translate(-50%, -50%)';
    case 'top':
      return 'translate(-50%, -100%)';
    case 'bottom':
      return 'translate(-50%, 0)';
    case 'left':
      return 'translate(-100%, -50%)';
    case 'right':
      return 'translate(0, -50%)';
    case 'top-left':
      return 'translate(-100%, -100%)';
    case 'top-right':
      return 'translate(0, -100%)';
    case 'bottom-left':
      return 'translate(-100%, 0)';
    case 'bottom-right':
      return 'translate(0, 0)';
  }
};

/** Whether a point is near enough to the viewport to be worth drawing. */
export const isOnScreen = (
  point: ScreenPoint,
  viewport: Viewport,
  margin = CULL_MARGIN_PX,
): boolean =>
  point.x >= -margin &&
  point.y >= -margin &&
  point.x <= viewport.width + margin &&
  point.y <= viewport.height + margin;

/**
 * The full transform for a label: translate to the point, then shift by the anchor.
 *
 * Order matters — the translation is in the container's coordinate space and the anchor
 * shift is in the element's own, so the point translation has to come first.
 *
 * Exported because it is the one piece of arithmetic here worth asserting directly.
 */
export const labelTransform = (label: LabelSpec): string => {
  const x = Math.round(label.at.x * 100) / 100;
  const y = Math.round(label.at.y * 100) / 100;
  return `translate(${String(x)}px, ${String(y)}px) ${anchorShift(label.anchor ?? 'centre')}`;
};
