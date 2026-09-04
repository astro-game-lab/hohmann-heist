import { beforeEach, describe, expect, it } from 'vitest';

import type { Viewport } from './renderer.js';
import type { LabelSpec } from './labels.js';
import {
  CULL_MARGIN_PX,
  LABEL_CLASS,
  MAX_LABELS,
  createLabelLayer,
  isOnScreen,
  labelTransform,
} from './labels.js';

/**
 * These run under the `render-dom` Vitest project, in jsdom — the browser-environment
 * testing story NFR-022 names as the condition for `@hh/render` joining the coverage
 * gate. The rest of the package stays under Node, deliberately.
 */
const VIEWPORT: Viewport = { width: 800, height: 600, devicePixelRatio: 2 };

const label = (id: string, x: number, y: number, text = id): LabelSpec => ({
  id,
  text,
  at: { x, y },
});

let container: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = '';
  container = document.createElement('div');
  document.body.appendChild(container);
});

const elements = (): HTMLElement[] => [...container.querySelectorAll<HTMLElement>('span')];
const visibleElements = (): HTMLElement[] => elements().filter((e) => !e.hidden);

describe('labelTransform', () => {
  it('translates to the point, then shifts by the anchor', () => {
    // Order matters: the point translation is in the container's space and the anchor
    // shift is in the element's own, so the point has to come first.
    expect(labelTransform(label('a', 100, 50))).toBe(
      'translate(100px, 50px) translate(-50%, -50%)',
    );
    expect(labelTransform({ ...label('a', 100, 50), anchor: 'top' })).toBe(
      'translate(100px, 50px) translate(-50%, -100%)',
    );
    expect(labelTransform({ ...label('a', 100, 50), anchor: 'bottom-right' })).toBe(
      'translate(100px, 50px) translate(0, 0)',
    );
  });

  it('expresses the anchor in percentages, never in measured pixels', () => {
    // Measuring the element would force a synchronous layout, which is exactly what the
    // transform-only rule exists to avoid. Percentages let the compositor resolve it
    // against a width JavaScript never asks for.
    expect(labelTransform(label('a', 0, 0))).toContain('%');
  });

  it('rounds to two decimals so a sub-pixel jitter does not rewrite the style', () => {
    expect(labelTransform(label('a', 100.004, 50.006))).toBe(
      'translate(100px, 50.01px) translate(-50%, -50%)',
    );
  });
});

describe('isOnScreen', () => {
  it('keeps a margin so an edge label does not flicker as the camera eases', () => {
    expect(isOnScreen({ x: -CULL_MARGIN_PX + 1, y: 300 }, VIEWPORT)).toBe(true);
    expect(isOnScreen({ x: -CULL_MARGIN_PX - 1, y: 300 }, VIEWPORT)).toBe(false);
    expect(isOnScreen({ x: 400, y: 600 + CULL_MARGIN_PX - 1 }, VIEWPORT)).toBe(true);
    expect(isOnScreen({ x: 400, y: 600 + CULL_MARGIN_PX + 1 }, VIEWPORT)).toBe(false);
  });
});

describe('the label layer', () => {
  it('creates one absolutely positioned element per label', () => {
    const layer = createLabelLayer(container);
    layer.update([label('a', 100, 100), label('b', 200, 200)], VIEWPORT);

    const spans = elements();
    expect(spans).toHaveLength(2);
    for (const span of spans) {
      expect(span.style.position).toBe('absolute');
      expect(span.style.left).toBe('0px');
      expect(span.style.top).toBe('0px');
      expect(span.className).toContain(LABEL_CLASS);
    }
  });

  it('positions with transform and never with left or top', () => {
    // Writing left/top invalidates layout for the whole container every frame; with 40
    // labels that is 40 reflows a frame, and the single most common way an overlay like
    // this becomes the reason a drag drops frames.
    const layer = createLabelLayer(container);
    layer.update([label('a', 100, 100)], VIEWPORT);
    layer.update([label('a', 250, 175)], VIEWPORT);

    const span = elements()[0];
    expect(span?.style.transform).toBe('translate(250px, 175px) translate(-50%, -50%)');
    // The offsets stay pinned at the origin across every update.
    expect(span?.style.left).toBe('0px');
    expect(span?.style.top).toBe('0px');
  });

  it('uses a 2-D translate rather than promoting 40 compositor layers', () => {
    // The usual advice is translate3d to force a layer, and it is wrong at this count:
    // 40 promoted layers is 40 textures to allocate, rasterise and composite. The
    // requirement is only that positioning not trigger layout, which 2-D already meets.
    const layer = createLabelLayer(container);
    layer.update([label('a', 10, 20)], VIEWPORT);
    expect(elements()[0]?.style.transform).not.toContain('translate3d');
  });

  it('reuses the element for a label that keeps its id', () => {
    // Identity across frames is what makes this cheap, and what keeps focus and text
    // selection alive while the scene moves under them.
    const layer = createLabelLayer(container);
    layer.update([label('a', 100, 100)], VIEWPORT);
    const first = elements()[0];

    layer.update([label('a', 120, 100)], VIEWPORT);
    expect(elements()[0]).toBe(first);
    expect(layer.stats.created).toBe(1);
  });

  it('writes nothing for a frame that changed nothing', () => {
    // An unguarded `textContent =` invalidates a text node even when the string is
    // identical, so a scrub that moves one marker must not touch the other labels.
    const layer = createLabelLayer(container);
    layer.update([label('a', 100, 100, 'apoapsis 412 km')], VIEWPORT);

    const span = elements()[0];
    const textNode = span?.firstChild;
    layer.update([label('a', 100, 100, 'apoapsis 412 km')], VIEWPORT);

    // Same text node object: the string was never reassigned.
    expect(elements()[0]?.firstChild).toBe(textNode);
  });

  it('updates the text when it actually changes', () => {
    const layer = createLabelLayer(container);
    layer.update([label('a', 0, 0, 'apoapsis 412 km')], VIEWPORT);
    layer.update([label('a', 0, 0, 'apoapsis 415 km')], VIEWPORT);
    expect(elements()[0]?.textContent).toBe('apoapsis 415 km');
  });

  it('removes a label that leaves the set', () => {
    const layer = createLabelLayer(container);
    layer.update([label('a', 100, 100), label('b', 200, 200)], VIEWPORT);
    layer.update([label('a', 100, 100)], VIEWPORT);

    expect(elements()).toHaveLength(1);
    expect(layer.stats.removed).toBe(1);
    expect(layer.stats.total).toBe(1);
  });
});

describe('off-screen labels', () => {
  it('never creates an element for a label that has only ever been off-screen', () => {
    // A planner at LEO framing has most of its geometry off-screen, and those labels
    // would otherwise pile up as invisible text a screen reader still walks. The
    // cheapest way not to be in the accessibility tree is not to exist.
    const layer = createLabelLayer(container);
    layer.update([label('on', 400, 300), label('off', -5000, 300)], VIEWPORT);

    expect(container.querySelector('[data-label-id="off"]')).toBeNull();
    expect(container.querySelector<HTMLElement>('[data-label-id="on"]')?.hidden).toBe(false);
    expect(layer.stats.culled).toBe(1);
    expect(layer.stats.visible).toBe(1);
    expect(layer.stats.created).toBe(1);
  });

  it('hides an existing element when it leaves the viewport', () => {
    // Once an element exists it is hidden rather than destroyed, and `hidden` is the
    // one property that removes it from rendering and from the accessibility tree
    // together, with no second attribute to keep in sync.
    const layer = createLabelLayer(container);
    layer.update([label('a', 400, 300)], VIEWPORT);
    layer.update([label('a', -5000, 300)], VIEWPORT);

    const span = container.querySelector<HTMLElement>('[data-label-id="a"]');
    expect(span?.hidden).toBe(true);
    expect(layer.stats.culled).toBe(1);
    expect(layer.stats.visible).toBe(0);
  });

  it('keeps the element so a pan does not churn the DOM', () => {
    // Destroying and rebuilding a label every few frames during a pan would also drop
    // focus and any selection inside it.
    const layer = createLabelLayer(container);
    layer.update([label('a', 400, 300)], VIEWPORT);
    const span = elements()[0];

    layer.update([label('a', -5000, 300)], VIEWPORT);
    expect(layer.stats.removed).toBe(0);

    layer.update([label('a', 400, 300)], VIEWPORT);
    expect(elements()[0]).toBe(span);
    expect(layer.stats.created).toBe(1);
  });
});

describe('the frame budget', () => {
  it('draws at most MAX_LABELS, and drops the excess rather than slowing the frame', () => {
    expect(MAX_LABELS).toBe(40);
    const layer = createLabelLayer(container);
    const many = Array.from({ length: 60 }, (_, i) => label(`l${String(i)}`, 10 + i, 300));

    layer.update(many, VIEWPORT);
    expect(layer.stats.visible).toBe(MAX_LABELS);
    expect(layer.stats.dropped).toBe(20);
    expect(visibleElements()).toHaveLength(MAX_LABELS);
  });

  it('counts the cap against drawn labels, not against culled ones', () => {
    // A scene with plenty of off-screen geometry should not be penalised for labels
    // nobody can see.
    const layer = createLabelLayer(container);
    const offScreen = Array.from({ length: 100 }, (_, i) => label(`off${String(i)}`, -9999, 300));
    const onScreen = Array.from({ length: 10 }, (_, i) => label(`on${String(i)}`, 10 + i, 300));

    layer.update([...offScreen, ...onScreen], VIEWPORT);
    expect(layer.stats.visible).toBe(10);
    expect(layer.stats.dropped).toBe(0);
  });
});

describe('accessibility', () => {
  it('keeps labels as real, selectable text rather than canvas pixels', () => {
    // The reason D8 exists: canvas text cannot be selected, is invisible to a screen
    // reader, and ignores the browser's own font-size setting.
    const layer = createLabelLayer(container);
    layer.update([label('a', 100, 100, '412 km')], VIEWPORT);
    expect(container.textContent).toContain('412 km');
  });

  it('carries an accessible name when the visible text is not one', () => {
    // "412 km" means nothing announced on its own; the visible text stays terse while
    // the announced name says what it is.
    const layer = createLabelLayer(container);
    layer.update(
      [{ ...label('apo', 100, 100, '412 km'), ariaLabel: 'apoapsis, 412 kilometres' }],
      VIEWPORT,
    );
    expect(elements()[0]?.getAttribute('aria-label')).toBe('apoapsis, 412 kilometres');
  });

  it('drops the accessible name when it is no longer supplied', () => {
    const layer = createLabelLayer(container);
    layer.update([{ ...label('a', 0, 0), ariaLabel: 'named' }], VIEWPORT);
    layer.update([label('a', 0, 0)], VIEWPORT);
    expect(elements()[0]?.hasAttribute('aria-label')).toBe(false);
  });

  it('applies the caller’s class names alongside the base class', () => {
    // The palette and type scale are `@hh/ui`'s; this package supplies the hook and no
    // colours of its own.
    const layer = createLabelLayer(container);
    layer.update([{ ...label('a', 0, 0), className: 'hh-label--apsis' }], VIEWPORT);
    expect(elements()[0]?.className).toBe(`${LABEL_CLASS} hh-label--apsis`);
  });
});

describe('destroy', () => {
  it('removes every element', () => {
    const layer = createLabelLayer(container);
    layer.update([label('a', 100, 100), label('b', 200, 200)], VIEWPORT);
    layer.destroy();

    expect(elements()).toHaveLength(0);
    expect(layer.stats.total).toBe(0);
  });
});
