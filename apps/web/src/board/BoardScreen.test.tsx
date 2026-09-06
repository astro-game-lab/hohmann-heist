/**
 * The contract board — §8.3.2, FR-302, FR-303, FR-304, §6.7, §6.8, §6.10, #119.
 *
 * Against the **shipped** contracts, for the reason `Briefing.test.tsx` gives: a fixture
 * board would let a wrong act, a wrong par or a wrong unlock rule look perfectly
 * reasonable. Acts I–II are four contracts and three, so §6.8's ⌈2/3⌉ threshold makes Act
 * II need three Bronzes — a number this file checks the board *reports* rather than
 * recomputes, because the board must not contain the rule (see its docstring).
 */
import { createCatalogue } from '@hh/ui';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { contracts } from '../contracts/registry.js';
import type { ContractProgress } from '../save/index.js';

import { BoardScreen } from './BoardScreen.js';

const catalogue = createCatalogue();
let container: HTMLElement;

const shipped = contracts();
const actI = shipped.filter((s) => s.document.act === 1);
const actII = shipped.filter((s) => s.document.act === 2);

const bronzed = (): ContractProgress => ({
  attempts: 1,
  medal: 'bronze',
  bestDv_mps: 111.1,
  firstCompletedAt: '2026-09-14T18:22:11Z',
});

const mount = async (records: Readonly<Record<string, ContractProgress>> = {}): Promise<void> => {
  await act(() => {
    render(
      <BoardScreen
        t={catalogue.resolve}
        resolveDynamic={catalogue.resolveDynamic}
        records={records}
      />,
      container,
    );
  });
};

const el = (testId: string): HTMLElement | null =>
  container.querySelector(`[data-testid="${testId}"]`);

/** Enough Act I Bronzes to open Act II, taken from the front of the act. */
const openActII = (): Record<string, ContractProgress> =>
  Object.fromEntries(actI.slice(0, 3).map((s) => [s.id, bronzed()]));

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
});

describe('the contract board', () => {
  it("renders §8.3.2's structure", async () => {
    await mount();
    expect(el('board-screen')).not.toBeNull();
    expect(el('act-1')).not.toBeNull();
    expect(el('act-2')).not.toBeNull();
    expect(el('daily-strip')).not.toBeNull();
    expect(el('board-credits')).not.toBeNull();
    expect(el('board-settings')).not.toBeNull();
    expect(el('footer')).not.toBeNull();
  });

  /** §8.7's "no saved progress" row: Act I unlocked, everything else locked, NEXT on C01. */
  it('shows Act I open and Act II locked on an empty save', async () => {
    await mount();
    expect(el('act-1')?.dataset['unlocked']).toBe('true');
    expect(el('act-2')?.dataset['unlocked']).toBe('false');

    const first = actI[0];
    expect(first).toBeDefined();
    expect(el(`card-${String(first?.id)}`)?.dataset['next']).toBe('true');
  });

  it("opens Act II once §6.8's threshold is met, and reports the count", async () => {
    await mount(openActII());
    expect(el('act-2')?.dataset['unlocked']).toBe('true');
    expect(el('act-progress-1')?.textContent).toBe('3/4');
  });

  /**
   * FR-304: *"par is displayed always"* — played or not.
   *
   * On the empty save above, so every card is unplayed and every one of them still names
   * the number to beat.
   */
  it('shows par on every unlocked card, played or not', async () => {
    await mount();
    for (const scenario of actI) {
      const par = el(`card-par-${scenario.id}`);
      expect(par, scenario.id).not.toBeNull();
      expect(par?.textContent).toContain('par');
    }
  });

  /**
   * §8.3.2: *"Locked cards show act name and unlock rule, never the contract title
   * (preserves the reveal)."*
   *
   * The strongest assertion on this screen, because the failure is silent: a locked card
   * that leaked its title would look fine and would have spoiled the campaign.
   */
  it('never shows a locked contract title', async () => {
    await mount();

    const board = el('board-screen')?.textContent ?? '';
    for (const scenario of actII) {
      expect(board, scenario.id).not.toContain(scenario.document.title);
    }

    // And what it shows instead: the act it needs, and the rule with its counts.
    expect(el('act-lock-2')?.textContent).toContain('Act I');
    expect(el('act-lock-2')?.textContent).toContain('3');
  });

  it('renders a locked card as a non-link', async () => {
    await mount();
    const locked = container.querySelector('.hh-card--locked .hh-card__link');
    expect(locked).not.toBeNull();
    expect(locked?.tagName).not.toBe('A');
  });

  /**
   * A locked card names **its own** act, not the one that unlocks it.
   *
   * It used to name `lock.requiredAct`, so Act II's three cards each read "Act I" — which
   * reads as though they belonged to Act I, and is the opposite of §8.3.2's *"communicate
   * the shape of the campaign"*. Found by looking at the running board.
   */
  it('names the act a locked card belongs to', async () => {
    await mount();
    const cards = [...container.querySelectorAll('[data-testid="locked-card"]')];
    expect(cards).toHaveLength(actII.length);
    for (const card of cards) {
      expect(card.textContent).toContain('Timing Is Everything');
      expect(card.textContent).not.toContain('Getting Off The Ground');
    }
  });

  /**
   * And it carries no `aria-label`.
   *
   * It used to carry the card's position within its act, so C05–C07 announced themselves as
   * "Contract 01/02/03 — locked" while the real C01–C03 sat unlocked above them. An
   * `aria-label` replaces the content that would otherwise be read, so the fix is not a
   * better label but none: the card's own text is accurate.
   */
  it('does not announce a locked card under another contract’s number', async () => {
    await mount();
    for (const card of container.querySelectorAll('[data-testid="locked-card"] .hh-card__link')) {
      expect(card.getAttribute('aria-label')).toBeNull();
    }

    const board = el('board-screen')?.textContent ?? '';
    // "??" stands in for the number, and no locked card claims one.
    expect(board).toContain('??');
  });

  describe('NEXT', () => {
    it('marks the first unstarted unlocked contract', async () => {
      const records = openActII();
      await mount(records);

      // Act I's first three are Bronzed, so NEXT is its fourth.
      const fourth = actI[3];
      expect(fourth).toBeDefined();
      expect(el(`card-${String(fourth?.id)}`)?.dataset['next']).toBe('true');
      expect(el('next-marker')).not.toBeNull();
    });

    /** §8.3.2: *"Keyboard focus lands here on entry."* The board's whole navigation story. */
    it('takes keyboard focus on entry', async () => {
      await mount();
      const first = actI[0];
      expect(document.activeElement).toBe(el(`card-link-${String(first?.id)}`));
    });

    /**
     * With nothing left to point at, focus still has to land somewhere.
     *
     * `progression().next` is null once every unlocked contract is Bronzed. Leaving focus
     * unset there means `<body>`, which is exactly the stranding #117's heading focus
     * exists to prevent — so the board falls back to the heading rather than to nothing.
     */
    it('falls back to the heading when there is no next contract', async () => {
      const heading = document.createElement('h1');
      heading.id = 'hh-content';
      heading.tabIndex = -1;
      document.body.append(heading);

      await mount(Object.fromEntries(shipped.map((s) => [s.id, bronzed()])));

      expect(container.querySelector('[data-testid="next-marker"]')).toBeNull();
      expect(document.activeElement).toBe(heading);
      heading.remove();
    });
  });

  describe('medals', () => {
    /**
     * NFR-019: no information by colour alone. The accessible name has to state the medal
     * in words, so a greyscale screenshot and a screen reader carry the same fact.
     */
    it('states the medal in text, not only in colour', async () => {
      const scenario = actI[0];
      expect(scenario).toBeDefined();
      await mount({ [String(scenario?.id)]: { ...bronzed(), medal: 'gold' } });

      const medal = el('medal');
      expect(medal).not.toBeNull();
      expect((medal?.textContent ?? '').toLowerCase()).toContain('gold');

      // The colour is carried separately and is reinforcement only.
      expect(medal?.dataset['medal']).toBe('gold');
    });

    it('shows no medal for a contract never completed', async () => {
      await mount();
      expect(el('medal')).toBeNull();
    });
  });

  describe('credits', () => {
    it('is zero on an empty save', async () => {
      await mount();
      expect(el('board-credits')?.textContent).toContain('0');
    });

    it('sums the fees of completed contracts', async () => {
      await mount(openActII());
      const expected = actI.slice(0, 3).reduce((sum, s) => sum + (s.document.fee_kcr ?? 0), 0);
      expect(el('board-credits')?.textContent).toContain(String(expected));
    });
  });

  /** The daily is M7. The strip says so rather than implying a backend. */
  it('renders an honest daily strip with no submission count', async () => {
    await mount();
    const strip = el('daily-strip');
    expect(strip?.textContent).toContain('Not attempted');
    expect(strip?.textContent).not.toMatch(/\d+\s*submissions/i);
  });
});
