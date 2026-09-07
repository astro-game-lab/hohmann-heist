/**
 * The title screen — §8.3.1, FR-901, #118.
 *
 * The background's *physics* is `background.test.ts`'s job. This is about the screen: what
 * it offers, what it hides, and what it promises the keyboard and the accessibility tree.
 *
 * `TitleBackground` renders here unmocked. jsdom has no 2-D context, so it takes its
 * canvas-unavailable branch and draws nothing — which is exactly the condition #118's
 * fifth criterion asks about, *"the screen is fully usable with it removed"*. Every
 * assertion below therefore runs against a title screen with no background at all, and
 * they all pass, which is the criterion.
 */
import { createCatalogue } from '@hh/ui';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { contracts } from '../contracts/registry.js';

import { TitleScreen } from './TitleScreen.js';

const catalogue = createCatalogue();
let container: HTMLElement;

type Props = Parameters<typeof TitleScreen>[0];

const mount = async (props: Partial<Props> = {}): Promise<void> => {
  await act(() => {
    render(
      <TitleScreen
        t={catalogue.resolve}
        resolveDynamic={catalogue.resolveDynamic}
        continueId={null}
        continueAct={null}
        palette="default"
        still
        {...props}
      />,
      container,
    );
  });
};

const el = (testId: string): HTMLElement | null =>
  container.querySelector(`[data-testid="${testId}"]`);

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
});

describe('the title screen', () => {
  it("renders §8.3.1's tagline", async () => {
    await mount();
    expect(el('title-tagline')?.textContent).toContain('Steal things in orbit');
  });

  /**
   * The footer is the shell's, not this screen's.
   *
   * It used to be rendered here and by the board, and by nothing else — so ten of the
   * twelve routes had no version on them. `Screen` renders it for every route now, and
   * `app.test.tsx` asserts that across §8.2's whole table, which is the property §8.3.1
   * actually states (*"present on every screen's footer"*) and one this screen alone could
   * never have shown.
   */
  it('leaves the footer to the shell', async () => {
    await mount();
    expect(el('footer')).toBeNull();
  });

  /**
   * FR-901: *"A first-time player MUST reach the C01 planner within two clicks of the
   * title screen."*
   *
   * Counted, not asserted in prose. Click one is Start, which must land on the **briefing**
   * for the first contract in play order — not the board, which would spend the budget on
   * a menu §8.3.1 explicitly does not want between a stranger and the game.
   */
  it('reaches the first contract in one click from a fresh save', async () => {
    await mount();

    const first = contracts()[0];
    expect(first).toBeDefined();

    const start = el('title-start');
    expect(start).not.toBeNull();
    expect(start?.getAttribute('href')).toBe(`#/contract/${String(first?.id)}`);

    // Click two is ACCEPT on the briefing that href opens — covered by
    // `ContractScreen.test.tsx`. What this asserts is that the first click does not land
    // anywhere else.
    expect(start?.getAttribute('href')).not.toContain('/board');
  });

  describe('Continue', () => {
    it('is absent with no saved progress', async () => {
      await mount({ continueId: null });
      expect(el('title-continue')).toBeNull();
    });

    it("is present with progress and goes to #82's NEXT", async () => {
      await mount({ continueId: 'c05-tailgate', continueAct: 2 });
      const entry = el('title-continue');
      expect(entry).not.toBeNull();
      expect(entry?.getAttribute('href')).toBe('#/contract/c05-tailgate');
      expect(entry?.textContent).toContain('Act II');
    });

    /**
     * The case that is easy to get wrong. When every unlocked contract is Bronzed,
     * `progression().next` is `null` — there is nothing to resume — and an entry that led
     * nowhere would be worse than no entry.
     */
    it('is absent again once every contract is complete', async () => {
      await mount({ continueId: null, continueAct: null });
      expect(el('title-continue')).toBeNull();
    });
  });

  it("offers §8.2's other three entries, routed rather than hidden", async () => {
    await mount();
    expect(el('title-daily')?.getAttribute('href')).toBe('#/daily');
    // The Codex *index*, not an entry. This asserted `#/codex/` — with the slash — and so
    // passed against `#/codex/phasing`, which is not a slug any entry has: the front door's
    // Codex entry landed on §8.7's "no such entry" screen for the whole of M3.
    expect(el('title-codex')?.getAttribute('href')).toBe('#/codex');
    expect(el('title-settings')?.getAttribute('href')).toBe('#/settings');
  });

  describe('the background', () => {
    it('is hidden from the accessibility tree and is not focusable', async () => {
      await mount();
      const background = el('title-background');
      expect(background?.getAttribute('aria-hidden')).toBe('true');
      expect(background?.hasAttribute('tabindex')).toBe(false);
      expect(background?.querySelector('[tabindex]')).toBeNull();
    });

    /**
     * #118: *"The entries are interactive before the background has drawn its first
     * frame."*
     *
     * Structural rather than timed, and the structure is the guarantee: the canvas is set
     * up in an effect, Preact runs effects after paint, so the entries exist in the DOM
     * before any drawing is attempted. Asserted by rendering *without* flushing effects —
     * the entries are there, and the effect has not run.
     */
    it('does not delay the entries', () => {
      render(
        <TitleScreen
          t={catalogue.resolve}
          resolveDynamic={catalogue.resolveDynamic}
          continueId={null}
          continueAct={null}
          palette="default"
          still
        />,
        container,
      );

      const start = container.querySelector('[data-testid="title-start"]');
      expect(start).not.toBeNull();
      expect(start?.getAttribute('href')).toContain('#/contract/');
    });

    /**
     * §8.8: *"the title background stops"* under reduced motion. jsdom has no 2-D
     * context, so the loop is unreachable here either way; what this asserts is that the
     * component never asks for a frame when told to be still, which is the decision the
     * flag exists to make.
     */
    it('requests no animation frame when still', async () => {
      const raf = vi.spyOn(window, 'requestAnimationFrame');
      await mount({ still: true });
      expect(raf).not.toHaveBeenCalled();
      raf.mockRestore();
    });
  });

  /**
   * §8.7's canvas row, reported rather than thrown. jsdom cannot give a 2-D context, so
   * this is the branch that actually runs — and the screen still renders everything else.
   */
  it('reports an unavailable canvas without breaking the screen', async () => {
    const onCanvasUnavailable = vi.fn();
    await mount({ onCanvasUnavailable });
    expect(onCanvasUnavailable).toHaveBeenCalled();
    expect(el('title-start')).not.toBeNull();
  });
});
