/**
 * #124's gate.
 *
 * Two assertions carry the issue and the rest support them. **The content is generated
 * from the live keymap** — every binding the handler would act on appears, and no binding
 * appears that it would not — which is checked as a set comparison against `BINDINGS`
 * rather than against a list written here, because a hand-written list is exactly the
 * cheat sheet this overlay exists to replace. And **a rebind shows immediately**, which is
 * the property that makes the first one worth having once #187 exists.
 */
import { createCatalogue } from '@hh/ui';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BINDINGS } from '../planner/keys.js';
import { HelpOverlay, sectionOrder } from './HelpOverlay.js';

const catalogue = createCatalogue({ onMissingKey: 'throw' });
let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
});

const el = (testId: string): HTMLElement | null =>
  container.querySelector(`[data-testid="${testId}"]`);

const mount = async (
  props: Partial<Parameters<typeof HelpOverlay>[0]> = {},
): Promise<() => void> => {
  const onClose = vi.fn();
  await act(() => {
    render(
      <HelpOverlay t={catalogue.resolve} rebinds={{}} scope={null} onClose={onClose} {...props} />,
      container,
    );
  });
  return onClose;
};

describe('the content', () => {
  it('lists every binding the handler would act on, and no other', async () => {
    await mount();
    // Selected by the row class rather than by a `help-` prefix: the panel, the close
    // button and the Settings link all carry `help-` test ids too, and a filter listing
    // them by name would need editing every time the chrome gained an element.
    const shown = [...container.querySelectorAll('.hh-help__row')].map((row) =>
      (row.getAttribute('data-testid') ?? '').slice('help-'.length),
    );

    expect([...shown].sort()).toStrictEqual([...BINDINGS.map((b) => b.id)].sort());
  });

  it('shows the keys a binding actually responds to', async () => {
    await mount();
    expect(el('help-addNode')?.querySelector('kbd')?.textContent).toBe('N');
    // A named key renders as its word rather than as its `event.key`.
    expect(el('help-playPause')?.textContent).toContain('Space');
    expect(el('help-scrubToStart')?.textContent).toContain('Home');
  });

  it('shows the modifiers a binding requires', async () => {
    await mount();
    const redo = el('help-redo')?.textContent ?? '';
    expect(redo).toContain('Ctrl');
    expect(redo).toContain('Shift');
    // `undo` forbids Shift, and forbidding is not requiring.
    const undo = el('help-undo')?.textContent ?? '';
    expect(undo).toContain('Ctrl');
    expect(undo).not.toContain('Shift');
  });

  it('shows the new key after a rebind, without a reload', async () => {
    await mount({ rebinds: { addNode: 'k' } });
    expect(el('help-addNode')?.querySelector('kbd')?.textContent).toBe('K');
  });

  it('shows one key where the table lists two spellings of the same one', async () => {
    await mount();
    // `playPause` is `[' ', 'Spacebar']` — one key. The row read "Space Space" before the
    // label de-duplicated by what it shows rather than by the key string.
    expect(el('help-playPause')?.querySelectorAll('kbd')).toHaveLength(1);
  });

  it('marks a binding whose feature is not built rather than hiding it', async () => {
    await mount();
    // `C` for the Codex is #161's, and §8.5.3 lists it. Hiding it would make the overlay
    // disagree with the printed map; showing it as working would be a lie.
    expect(el('help-codex')?.textContent).toContain('Not built yet');
  });
});

describe('the order', () => {
  it('puts the current scope first, and Everywhere last', () => {
    expect(sectionOrder('execution')).toStrictEqual([
      'execution',
      'planner',
      'briefing',
      'debrief',
      'everywhere',
    ]);
    expect(sectionOrder('debrief')[0]).toBe('debrief');
    // Everywhere stays last: those bindings are true on the current screen too, and a
    // player looking for what they can do *here* wants the screen's own list at the top.
    expect(sectionOrder('planner').at(-1)).toBe('everywhere');
  });

  it('falls back to the default order outside a contract', () => {
    expect(sectionOrder(null)).toStrictEqual([
      'planner',
      'execution',
      'briefing',
      'debrief',
      'everywhere',
    ]);
  });

  it('renders the sections in that order', async () => {
    await mount({ scope: 'execution' });
    const sections = [...container.querySelectorAll('[data-testid^="help-scope-"]')].map(
      (section) => section.getAttribute('data-testid'),
    );
    expect(sections[0]).toBe('help-scope-execution');
    expect(sections.at(-1)).toBe('help-scope-everywhere');
  });
});

describe('as a dialog — §8.8, #169s rule', () => {
  it('is a labelled dialog', async () => {
    await mount();
    const panel = container.querySelector('[role="dialog"]');
    expect(panel).not.toBeNull();
    expect(panel?.getAttribute('aria-modal')).toBe('true');
    const labelledBy = panel?.getAttribute('aria-labelledby');
    expect(labelledBy).not.toBeNull();
    expect(container.querySelector(`#${labelledBy ?? ''}`)?.textContent).toBeTruthy();
  });

  it('moves focus into itself on open', async () => {
    await mount();
    expect(container.contains(document.activeElement)).toBe(true);
  });

  it('closes on Esc', async () => {
    const onClose = await mount();
    await act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('returns focus to whatever opened it', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    await mount();
    expect(document.activeElement).not.toBe(opener);

    await act(() => {
      render(null, container);
    });
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('traps Tab, wrapping rather than blocking', async () => {
    await mount();
    const focusable = [
      ...container.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'),
    ];
    expect(focusable.length).toBeGreaterThan(1);

    const last = focusable[focusable.length - 1];
    last?.focus();
    await act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }),
      );
    });
    // Wrapped to the first, rather than focus being held where it was — a dialog that
    // blocked Tab would be the trap §8.8 forbids.
    expect(document.activeElement).toBe(focusable[0]);
  });
});

describe('remapping', () => {
  it('links to Settings rather than offering a second place to rebind', async () => {
    await mount();
    expect(el('help-remap')?.getAttribute('href')).toBe('#/settings');
    // No capture affordance anywhere in here.
    expect(container.querySelector('[data-testid^="capture-"]')).toBeNull();
  });
});
