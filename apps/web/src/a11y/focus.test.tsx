/**
 * The focus policy as the app actually applies it — §8.8, NFR-016, #169.
 *
 * `overlay.test.tsx` checks the hook against a harness. This checks the three things the
 * hook cannot: what happens on a screen change that is not a route change, whether the
 * canvas is a hole a keyboard user falls into, and whether the fallback fires where #169
 * says it must — in the real planner, with a real opener that a real action removed.
 *
 * Driven through `App` rather than through the components, because every one of these is a
 * property of the assembled application. A test that mounted `ContractScreen` on its own
 * would be testing a screen with no shell above it — which is exactly how the board's
 * focus bug got past the suite once already (see `shellMovesFocus` in `app.tsx`).
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { App } from '../app.js';
import { installCanvasHarness, type RemoveCanvasHarness } from '../planner/test-canvas.js';
import { SAVE_KEY } from '../save/index.js';
import { CONTENT_HEADING_ID } from './focus.js';

let container: HTMLElement;
let removeHarness: RemoveCanvasHarness;

const mount = async (hash: string): Promise<void> => {
  window.location.hash = hash;
  await act(() => {
    render(<App />, container);
  });
};

const press = async (key: string, modifiers: Partial<KeyboardEventInit> = {}): Promise<void> => {
  await act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...modifiers }));
  });
};

const el = (testId: string): HTMLElement | null =>
  document.body.querySelector(`[data-testid="${testId}"]`);

const heading = (): HTMLElement | null => document.getElementById(CONTENT_HEADING_ID);

beforeEach(() => {
  removeHarness = installCanvasHarness();
  window.location.hash = '';
  localStorage.removeItem(SAVE_KEY);
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
  removeHarness();
});

describe('a contract phase change moves focus to the heading', () => {
  /**
   * §8.2 puts all four contract screens behind one route, so `Screen` never unmounts and
   * its mount effect never re-runs — the mechanism that handles a route change cannot see
   * a phase change at all. To the player they are the same event: the whole body is
   * replaced. A keyboard user who pressed ACCEPT was left holding a button that no longer
   * exists, which the browser resolves by dropping focus on `<body>`.
   */
  it('follows briefing → planner → execution → debrief', async () => {
    await mount('#/contract/c01-shakedown');
    expect(el('brief')).not.toBeNull();

    await press('Enter');
    expect(el('planner')).not.toBeNull();
    expect(document.activeElement, 'accepting the briefing').toBe(heading());

    await press('n');
    for (let i = 0; i < 5; i++) await press('ArrowUp');
    await press('Enter');
    expect(el('execution')).not.toBeNull();
    expect(document.activeElement, 'committing the plan').toBe(heading());

    await press('s');
    expect(el('debrief')).not.toBeNull();
    expect(document.activeElement, 'reaching the debrief').toBe(heading());
  });

  it('does not steal focus on the first render of a cold load', async () => {
    // The existing rule, still true: there is no previous screen to have stranded anyone
    // on, and taking focus off the document's start moves a keyboard user past the
    // browser's own controls for nothing. Entering a contract is `null → briefing`, which
    // the phase effect deliberately ignores.
    await mount('#/contract/c01-shakedown');
    expect(document.activeElement).not.toBe(heading());
  });
});

describe('the canvas is not a focus hole', () => {
  /**
   * §8.8's canvas rule has two halves and this is the one #169 owns: a keyboard user must
   * be able to reach the planner's controls *without tabbing through the canvas and
   * without getting stuck in it*. (The other half — whether the canvas says what it draws
   * — is #167, at M4.)
   */
  const expectCanvasesUnfocusable = (where: string): void => {
    const canvases = [...document.body.querySelectorAll('canvas')];
    expect(
      canvases.length,
      `${where} draws no canvas — this case is checking nothing`,
    ).toBeGreaterThan(0);
    for (const canvas of canvases) {
      // Not focusable, so `Tab` passes over it rather than into it. `role="img"` with a
      // label is what makes it announced without being a stop.
      expect(canvas.tabIndex, where).toBeLessThan(0);
    }
  };

  it('leaves the title screen’s canvas out of the tab order', async () => {
    await mount('#/');
    expectCanvasesUnfocusable('the title screen');
  });

  it('leaves the planner’s and the execution screen’s canvases out of it too', async () => {
    // Through the phases rather than at `#/contract/:id`, because that route opens on the
    // *briefing*, which draws nothing — a canvas check there would pass by finding none.
    await mount('#/contract/c01-shakedown');
    await press('Enter');
    expect(el('planner')).not.toBeNull();
    expectCanvasesUnfocusable('the planner');

    await press('n');
    for (let i = 0; i < 5; i++) await press('ArrowUp');
    await press('Enter');
    expect(el('execution')).not.toBeNull();
    expectCanvasesUnfocusable('the execution screen');
  });

  it('keeps the orbit view’s own controls reachable', async () => {
    // §8.3.4's ⊕ ⊖ ⌖ are buttons beside the canvas rather than affordances drawn on it,
    // which is what makes them reachable at all. If these ever moved onto the canvas the
    // camera would become pointer-only.
    await mount('#/contract/c01-shakedown');
    await press('Enter');
    for (const id of ['orbit-zoom-in', 'orbit-zoom-out', 'orbit-recentre']) {
      const control = el(id);
      expect(control, id).not.toBeNull();
      control?.focus();
      expect(document.activeElement, id).toBe(control);
    }
  });
});

describe('tab order is logical', () => {
  /**
   * No positive `tabindex` anywhere. A positive value lifts an element out of document
   * order and in front of everything with a `0`, so one of them reorders the whole page —
   * and the next person to add a control has no way to know where it will land.
   */
  it('uses no positive tabindex on any screen', async () => {
    for (const hash of ['#/', '#/board', '#/settings', '#/codex', '#/contract/c01-shakedown']) {
      await mount(hash);
      const positive = [...document.body.querySelectorAll('[tabindex]')]
        .filter((element) => Number(element.getAttribute('tabindex')) > 0)
        .map((element) => element.tagName.toLowerCase());
      expect(positive, hash).toEqual([]);
      await act(() => {
        render(null, container);
      });
    }
  });
});

describe('an overlay whose opener was removed by its own action', () => {
  /**
   * #169's hardest criterion, in the place it actually happens.
   *
   * The node editor is opened from a node's row in the plan panel. Deleting that node
   * closes the editor and removes the row in the same commit, so the element to restore
   * focus to is detached at the moment it is needed — and `opener.focus()` on a detached
   * element is a silent no-op, not an error. The player is then on `<body>`, at the top of
   * the document, with nothing announced.
   */
  it('lands on the screen heading rather than the document body', async () => {
    await mount('#/contract/c01-shakedown');
    await press('Enter');
    await press('n');

    // Focus the row the way a keyboard user reaching it would, so the overlay captures a
    // real opener rather than the body.
    const row = el('plan-node-0');
    expect(row).not.toBeNull();
    row?.focus();
    expect(document.activeElement).toBe(row);

    await press('e');
    expect(el('node-editor'), 'the editor should be open').not.toBeNull();

    // The action that removes the opener.
    await press('Delete');
    expect(el('node-editor'), 'deleting the node should close its editor').toBeNull();
    expect(el('plan-node-0'), 'the row that opened it should be gone').toBeNull();

    expect(document.activeElement).toBe(heading());
    expect(document.activeElement).not.toBe(document.body);
  });
});
