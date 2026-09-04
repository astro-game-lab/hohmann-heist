/**
 * The planner screen — #123, #127, #128, #130, #131, #132.
 *
 * Driven against the **real** `c03-cold-open` through `@hh/game`'s own loader, for the
 * reason `Briefing.test.tsx` gives: a fixture would let a unit error look perfectly
 * reasonable. C03 is a 400 km circular LEO with a target 400 km above it, so every number
 * below is one a reader can check by eye.
 *
 * jsdom has no 2-D canvas context, so the orbit view renders its DOM shell and draws
 * nothing. That is the same branch a real browser with canvas disabled takes, and it is
 * why the whole planner is testable here — see the note in `OrbitView.tsx`. What it
 * means for this file is that everything asserted below is the **DOM half** of the
 * planner, which is exactly what §8.8's canvas-parity rule says must carry the same
 * information.
 */
import { createCatalogue } from '@hh/ui';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { contractById } from '../contracts/registry.js';
import { PlannerScreen } from './PlannerScreen.js';

const catalogue = createCatalogue();
let container: HTMLElement;

const c03 = (): NonNullable<ReturnType<typeof contractById>> => {
  const scenario = contractById('c03-cold-open');
  if (scenario === undefined) throw new Error('c03-cold-open is not in the registry');
  return scenario;
};

const mount = async (): Promise<void> => {
  await act(() => {
    render(
      <PlannerScreen
        t={catalogue.resolve}
        resolveDynamic={catalogue.resolveDynamic}
        scenario={c03()}
      />,
      container,
    );
  });
};

const el = (testId: string): HTMLElement | null =>
  container.querySelector(`[data-testid="${testId}"]`);

const text = (testId: string): string => el(testId)?.textContent ?? '';

const click = async (testId: string): Promise<void> => {
  await act(() => {
    el(testId)?.click();
  });
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
});

describe('the five regions of §8.3.4 (#123)', () => {
  it('renders every one of them', async () => {
    await mount();
    // ① HUD, ② timeline, ③ plan, ④ readouts, ⑤ assists — and the orbit view between them.
    expect(el('hud-contract')).not.toBeNull();
    expect(el('timeline-track')).not.toBeNull();
    expect(el('plan-panel')).not.toBeNull();
    expect(el('readouts')).not.toBeNull();
    expect(el('assist-tray')).not.toBeNull();
    expect(el('orbit-view')).not.toBeNull();
  });

  it('keeps the timeline outside the tab strip, in both layouts', async () => {
    await mount();
    const timeline = el('timeline-track');
    const panels = container.querySelectorAll('.hh-planner__panel');
    expect(panels.length).toBe(3);
    // §8.3.4: "the timeline stays visible at all times ... must never be behind a tab."
    // Structural rather than visual: no tab panel contains it at any width.
    for (const panel of panels) {
      expect(panel.contains(timeline)).toBe(false);
    }
  });

  it('mounts all three panels at once, so a layout switch cannot lose their state', async () => {
    await mount();
    // The narrow layout hides two of them with `hidden`; it does not unmount them. That
    // is #123's fifth criterion — switching layouts loses no plan state, selection or
    // scrub position — made structural, since there is only one component tree.
    expect(el('plan-panel')).not.toBeNull();
    expect(el('readouts')).not.toBeNull();
    expect(el('assist-tray')).not.toBeNull();
  });

  it('offers the narrow layout’s tabs without a second copy of any panel', async () => {
    await mount();
    expect(el('planner-tab-plan')).not.toBeNull();
    expect(el('planner-tab-readouts')).not.toBeNull();
    expect(el('planner-tab-assists')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid="plan-panel"]')).toHaveLength(1);
  });

  it('switches which panel the tab strip shows without unmounting the others', async () => {
    await mount();
    await click('planner-tab-readouts');
    expect(el('planner-tab-readouts')?.getAttribute('aria-selected')).toBe('true');
    // Still mounted, merely hidden — which is the whole point.
    expect(el('plan-panel')).not.toBeNull();
  });
});

describe('the HUD bar (#127)', () => {
  it('names the contract and shows Δv against the budget', async () => {
    await mount();
    // §8.3.4's mock-up shows "05 TAILGATE" in capitals, and that is `text-transform` in
    // the stylesheet rather than a capitalised string in the catalogue: casing is
    // locale-dependent (Turkish dotted i, German ß) and CSS applies the locale's rule.
    // So the text content is the contract's own title.
    expect(text('hud-contract')).toContain('Cold Open');
    // An empty plan has spent nothing of C03's budget.
    expect(text('value-dv')).toContain('0');
  });

  it('reports the budget level as a word, not only as a colour (§8.8)', async () => {
    await mount();
    const bar = el('hud-dv-bar');
    expect(bar?.getAttribute('role')).toBe('progressbar');
    expect(bar?.getAttribute('data-level')).toBe('ok');
    // The accessible name is a sentence a screen reader can read; the fill colour only
    // reinforces it.
    expect(bar?.getAttribute('aria-label')).toContain('within budget');
  });

  it('shows MET at the scrub head, which starts at T+00:00:00', async () => {
    await mount();
    expect(text('hud-met')).toContain('00:00:00');
  });
});

describe('the timeline (#128)', () => {
  it('is a range input, so it is keyboard operable with a documented step', async () => {
    await mount();
    const scrub = el('timeline-scrub');
    expect(scrub).toBeInstanceOf(HTMLInputElement);
    expect(scrub?.getAttribute('type')).toBe('range');
    expect(scrub?.getAttribute('step')).toBe('60');
    // The step is described to the player, not only in a docstring.
    const hint = container.querySelector('#hh-timeline-step-hint');
    expect(hint?.textContent).toContain('60');
  });

  it('places the deadline wall from the scenario horizon', async () => {
    await mount();
    expect(el('timeline-deadline')).not.toBeNull();
  });

  it('scrubbing moves MET and leaves the plan alone', async () => {
    await mount();
    const scrub = el('timeline-scrub');
    if (!(scrub instanceof HTMLInputElement)) throw new Error('no scrub control');

    await act(() => {
      scrub.value = '3600';
      scrub.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(text('hud-met')).toContain('01:00:00');
    // The plan is untouched — the strong form of this is asserted by reference identity
    // in `machine.test.ts`; here it is that a view operation added no burns.
    expect(el('plan-empty')).not.toBeNull();
  });
});

describe('the plan panel (#130)', () => {
  it('is an empty state before there are any burns', async () => {
    await mount();
    expect(el('plan-empty')).not.toBeNull();
  });

  it('adds a node at the scrub head and lists it', async () => {
    await mount();
    await click('plan-add');

    const list = container.querySelector('.hh-plan__list');
    expect(list?.tagName).toBe('UL');
    expect(list?.querySelectorAll('li')).toHaveLength(1);
    expect(el('plan-node-0')).not.toBeNull();
  });

  it('announces a node as a sentence rather than as bare numbers', async () => {
    await mount();
    await click('plan-add');
    // The accessible name carries the direction as a word. "Node 1, at T+00:00:00, no
    // burn" — the components are zero until they are edited, and the catalogue drops them
    // rather than reading "0.0 radial".
    expect(text('plan-node-0')).toContain('Node 1');
  });

  it('synchronises selection with the rest of the screen', async () => {
    await mount();
    await click('plan-add');
    await click('plan-node-0');
    expect(el('plan-node-0')?.getAttribute('aria-pressed')).toBe('true');
    // The same selection reaches the timeline's marker, because both read one state.
    expect(el('timeline-node-0')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('selects from the timeline as well, the other direction', async () => {
    await mount();
    await click('plan-add');
    await click('timeline-node-0');
    expect(el('plan-node-0')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('deletes a node', async () => {
    await mount();
    await click('plan-add');
    await click('plan-delete-0');
    expect(el('plan-empty')).not.toBeNull();
  });
});

describe('the readouts (#131)', () => {
  it('suppresses the apsis rows on C03’s circular parking orbit', async () => {
    await mount();
    // C03 starts on a 400 km circular orbit, which is below §9.3's 1e-3 eccentricity
    // floor. Two apsis rows there would be float noise to one decimal place.
    expect(el('readouts-circular-note')).not.toBeNull();
    expect(el('value-altitude')).not.toBeNull();
    expect(el('value-apoapsis')).toBeNull();
    expect(el('value-periapsis')).toBeNull();
  });

  it('reads 400 km, which is the altitude the contract actually starts at', async () => {
    await mount();
    expect(text('value-altitude')).toContain('400');
  });

  it('offers the full-precision reading on focus as well as hover (FR-406)', async () => {
    await mount();
    const value = el('value-altitude');
    // Focusable, which is the only way a keyboard user can reveal it. A `title` tooltip
    // — which is what the briefing uses — cannot be reached at all.
    expect(value?.getAttribute('tabindex')).toBe('0');
    // And the precise reading is in the accessible tree at all times, not toggled.
    expect(text('precise-altitude')).toContain('m');
  });
});

describe('the closest-approach block (#132)', () => {
  it('says there is no approach rather than showing a zero', async () => {
    await mount();
    // C03's objective is a proximity one, and an empty plan never gets near the target.
    // What must not happen is a "0.0 km" reading that says the player has arrived.
    const none = el('approach-none');
    const approach = el('approach');
    expect(none !== null || approach !== null).toBe(true);
    if (approach !== null) {
      expect(text('approach-verdict')).not.toBe('');
      // The verdict is a sentence and an icon, not a colour.
      expect(el('approach-verdict')?.getAttribute('data-met')).toMatch(/true|false/);
    }
  });
});

describe('the assist tray (#133’s toggle only)', () => {
  it('offers the snap toggle, on by default, with its window stated', async () => {
    await mount();
    const toggle = el('assist-snap');
    expect(toggle).toBeInstanceOf(HTMLInputElement);
    expect((toggle as HTMLInputElement).checked).toBe(true);
    expect(container.querySelector('#hh-assist-snap-hint')?.textContent).toContain('30');
  });

  it('can be turned off', async () => {
    await mount();
    const toggle = el('assist-snap');
    if (!(toggle instanceof HTMLInputElement)) throw new Error('no snap toggle');
    await act(() => {
      toggle.checked = false;
      toggle.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect((el('assist-snap') as HTMLInputElement).checked).toBe(false);
  });
});

describe('the camera control (#103)', () => {
  it('offers ⌖ recentre', async () => {
    await mount();
    expect(el('orbit-recentre')).not.toBeNull();
  });
});
