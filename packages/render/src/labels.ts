/**
 * The DOM label layer — D8, §11.8, #113.
 *
 * D8 puts **every** piece of text in the game in the DOM rather than on the canvas, and
 * `renderer.ts` enforces the negative half of that by giving the `Renderer` interface no
 * text primitive at all: a caller cannot draw text on the canvas because there is no way
 * to ask. This module is the positive half — the place the text actually goes.
 *
 * ## Why text is not on the canvas
 *
 * Canvas text is pixels. It cannot be selected, it is invisible to a screen reader, it
 * does not respond to the browser's own font-size setting, and it re-rasterises badly
 * under page zoom. §8.8's accessibility specification and NFR-016's "every action
 * reachable by keyboard" are not reachable from a canvas, and an apsis altitude a player
 * cannot select and copy is a worse readout than one they can.
 *
 * The cost is a DOM node per label and a transform per frame, and §11.8 bounds the
 * problem: at the working set of ≤ 40 labels this is cheap. `MAX_LABELS` states that
 * bound in code so that exceeding it is a visible decision rather than a slow frame.
 *
 * ## Transforms only, never `left` and `top`
 *
 * Every label is `position: absolute` at the container's origin and moved with
 * `transform: translate(...)`. Writing `left`/`top` instead would invalidate layout for
 * the whole container on every frame, and with 40 labels that is 40 reflows a frame — the
 * single most common way an overlay like this becomes the reason a drag drops frames.
 * `transform` skips layout entirely.
 *
 * **2-D `translate`, not `translate3d`.** The usual advice is to force a compositor layer
 * with a 3-D transform, and it is wrong at this count: 40 promoted layers is 40 textures
 * to allocate, rasterise and composite, which costs more memory and more compositing time
 * than it saves in paint. The requirement is only that positioning not trigger *layout*,
 * and a 2-D transform already satisfies it.
 *
 * `update` also never reads a layout property — no `offsetWidth`, no
 * `getBoundingClientRect` — so it cannot force a synchronous reflow. Where a label needs
 * to be placed relative to its own size, that is done in CSS with `translate(-50%, -50%)`
 * on the element, which the compositor resolves without telling JavaScript the number.
 *
 * ## Off-screen labels leave the accessibility tree
 *
 * A planner at LEO framing has most of its geometry off-screen, and the labels that go
 * with it would otherwise pile up in the accessibility tree as invisible text a screen
 * reader still walks. Three cases, and they are deliberately not the same:
 *
 * - **Never seen on screen: no element is created at all.** The cheapest way not to be in
 *   the accessibility tree is not to exist, and a scene may carry a hundred labels for
 *   geometry that is nowhere near the viewport.
 * - **On screen, then off: the element is kept and `hidden`.** `hidden` removes it from
 *   rendering and from the accessibility tree in one property, with no second attribute to
 *   keep in sync. Kept rather than destroyed because a label that crosses the viewport
 *   edge during a pan would otherwise be rebuilt every few frames, and because removing a
 *   node drops focus and any selection inside it.
 * - **Gone from the set entirely: removed.** This is the only path that deletes a node.
 *
 * ## Where the words come from
 *
 * `text` is a resolved string, and resolving it is the caller's job — `@hh/ui` owns the
 * catalogue (FR-910) and this package must not import it, since dependencies point one
 * way. That is the same division `renderer.ts` applies to colour: the mechanism is here,
 * the content and the palette belong to the layer that owns them. The scene harness in
 * `apps/web` resolves every label through the catalogue, which is what makes FR-910 true
 * in practice rather than merely intended.
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

/** What the layer needs of its container. A real `HTMLElement` satisfies it. */
export type LabelContainer = Pick<HTMLElement, 'appendChild' | 'removeChild' | 'ownerDocument'>;

interface LabelEntry {
  readonly element: HTMLElement;
  /** Last values written, so a frame that changes nothing writes nothing. */
  text: string;
  transform: string;
  className: string;
  ariaLabel: string | undefined;
  hidden: boolean;
  /** Marks survivors during reconciliation, avoiding a second pass to build a set. */
  seen: boolean;
}

/**
 * Build a label layer over a container element.
 *
 * The container should be `position: relative`, cover the canvas, and be
 * `pointer-events: none` so labels never intercept a drag — all of which is `@hh/ui`'s
 * CSS to write, not this module's.
 */
export const createLabelLayer = (container: LabelContainer): LabelLayer => {
  const document = container.ownerDocument;
  const entries = new Map<string, LabelEntry>();
  let created = 0;
  let removed = 0;
  let visible = 0;
  let culled = 0;
  let dropped = 0;

  const create = (id: string): LabelEntry => {
    const element = document.createElement('span');
    element.className = LABEL_CLASS;
    element.dataset['labelId'] = id;
    // Absolute at the origin; everything after this is transform.
    element.style.position = 'absolute';
    element.style.left = '0';
    element.style.top = '0';
    container.appendChild(element);
    created++;
    return {
      element,
      text: '',
      transform: '',
      className: LABEL_CLASS,
      ariaLabel: undefined,
      hidden: false,
      seen: true,
    };
  };

  return {
    update(labels: readonly LabelSpec[], viewport: Viewport): void {
      visible = 0;
      culled = 0;
      dropped = 0;

      for (const entry of entries.values()) entry.seen = false;

      for (const label of labels) {
        // The cap is applied to what is *drawn*, after culling, so a scene with plenty
        // of off-screen labels is not penalised for geometry nobody can see.
        if (!isOnScreen(label.at, viewport)) {
          culled++;
          const existing = entries.get(label.id);
          if (existing !== undefined) {
            existing.seen = true;
            if (!existing.hidden) {
              // `hidden` takes it out of rendering *and* the accessibility tree, which
              // is the whole requirement in one property.
              existing.element.hidden = true;
              existing.hidden = true;
            }
          }
          continue;
        }

        if (visible >= MAX_LABELS) {
          dropped++;
          const existing = entries.get(label.id);
          if (existing !== undefined) {
            existing.seen = true;
            if (!existing.hidden) {
              existing.element.hidden = true;
              existing.hidden = true;
            }
          }
          continue;
        }

        let entry = entries.get(label.id);
        if (entry === undefined) {
          entry = create(label.id);
          entries.set(label.id, entry);
        }
        entry.seen = true;
        visible++;

        // Every write below is guarded. A scrub that moves one marker should not touch
        // the other 39 labels' text nodes, and an unguarded `textContent =` invalidates
        // a text node even when the string is identical.
        if (entry.hidden) {
          entry.element.hidden = false;
          entry.hidden = false;
        }
        if (entry.text !== label.text) {
          entry.element.textContent = label.text;
          entry.text = label.text;
        }

        const transform = labelTransform(label);
        if (entry.transform !== transform) {
          entry.element.style.transform = transform;
          entry.transform = transform;
        }

        const className =
          label.className === undefined ? LABEL_CLASS : `${LABEL_CLASS} ${label.className}`;
        if (entry.className !== className) {
          entry.element.className = className;
          entry.className = className;
        }

        if (entry.ariaLabel !== label.ariaLabel) {
          if (label.ariaLabel === undefined) {
            entry.element.removeAttribute('aria-label');
          } else {
            entry.element.setAttribute('aria-label', label.ariaLabel);
          }
          entry.ariaLabel = label.ariaLabel;
        }
      }

      // Only labels that left the set entirely are removed. One that merely went
      // off-screen is kept and hidden — rebuilding it every few frames during a pan
      // would churn the DOM and drop focus and selection with it.
      for (const [id, entry] of [...entries]) {
        if (entry.seen) continue;
        container.removeChild(entry.element);
        entries.delete(id);
        removed++;
      }
    },

    destroy(): void {
      for (const entry of entries.values()) {
        container.removeChild(entry.element);
        removed++;
      }
      entries.clear();
      visible = 0;
      culled = 0;
      dropped = 0;
    },

    get stats(): LabelLayerStats {
      return { total: entries.size, visible, culled, dropped, created, removed };
    },
  };
};
