/**
 * The DOM label layer — D8, §11.8, #113.
 *
 * D8 puts **every** piece of text in the game in the DOM rather than on the canvas, and
 * `renderer.ts` enforces the negative half of that by giving the `Renderer` interface no
 * text primitive at all: a caller cannot draw text on the canvas because there is no way
 * to ask. This module is the positive half — the place the text actually goes.
 *
 * Behind the `@hh/render/labels` subpath, alongside `canvas2d.ts`, because it names
 * `HTMLElement` and could not compile without the DOM library. What a label *is* lives in
 * `label-spec.ts` and stays in the barrel, so `scene.ts` can produce labels without
 * dragging a browser in behind it; everything from there is re-exported here.
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
 * problem: at the working set of ≤ 40 labels this is cheap.
 *
 * ## Transforms only, never `left` and `top`
 *
 * Every label is `position: absolute` at the container's origin and moved with
 * `transform: translate(...)`. Writing `left`/`top` instead would invalidate layout for
 * the whole container on every frame, and with 40 labels that is 40 reflows a frame — the
 * single most common way an overlay like this becomes the reason a drag drops frames.
 *
 * **2-D `translate`, not `translate3d`.** The usual advice is to force a compositor layer
 * with a 3-D transform, and it is wrong at this count: 40 promoted layers is 40 textures
 * to allocate, rasterise and composite, which costs more than the paint it saves. The
 * requirement is only that positioning not trigger *layout*, and a 2-D transform already
 * satisfies it.
 *
 * `update` also never reads a layout property — no `offsetWidth`, no
 * `getBoundingClientRect` — so it cannot force a synchronous reflow. Where a label needs
 * to be placed relative to its own size, that is done with a percentage in the transform,
 * which the compositor resolves without telling JavaScript the number.
 *
 * ## Off-screen labels leave the accessibility tree
 *
 * A planner at LEO framing has most of its geometry off-screen, and the labels that go
 * with it would otherwise pile up in the accessibility tree as invisible text a screen
 * reader still walks. Three cases, deliberately not the same:
 *
 * - **Never seen on screen: no element is created at all.** The cheapest way not to be in
 *   the accessibility tree is not to exist.
 * - **On screen, then off: the element is kept and `hidden`.** That removes it from
 *   rendering and from the accessibility tree in one property. Kept rather than destroyed
 *   because a label crossing the viewport edge during a pan would otherwise be rebuilt
 *   every few frames, and removing a node drops focus and any selection inside it.
 * - **Gone from the set entirely: removed.** The only path that deletes a node.
 *
 * ## Where the words come from
 *
 * `text` is a resolved string, and resolving it is the caller's job — `@hh/ui` owns the
 * catalogue (FR-910) and this package must not import it. That is the same division
 * `renderer.ts` applies to colour: the mechanism is here, the content and the palette
 * belong to the layer that owns them.
 */
import type { Viewport } from './renderer.js';
import type { LabelLayer, LabelLayerStats, LabelSpec } from './label-spec.js';
import { LABEL_CLASS, MAX_LABELS, isOnScreen, labelTransform } from './label-spec.js';

// Re-exported so a consumer that wants both the description and the layer has one import.
export type { LabelAnchor, LabelLayer, LabelLayerStats, LabelSpec } from './label-spec.js';
export {
  CULL_MARGIN_PX,
  LABEL_CLASS,
  MAX_LABELS,
  isOnScreen,
  labelTransform,
} from './label-spec.js';

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
