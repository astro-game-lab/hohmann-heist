/**
 * DEP-07's mark on the plan panel — #136's *"say what it did"*.
 *
 * The rule and the mark are tested in two places on purpose, because they are two
 * different claims. **Whether** a node is on an apsis is `apsisAt`'s answer and is checked
 * in `packages/game/src/snap.test.ts` against real geometry, including the quantisation
 * round trip that makes an exact comparison fail. **How** that answer is shown is this
 * file, driven with the answer supplied — so a rendering test cannot pass because the
 * geometry happened to agree, and a geometry test cannot pass because the glyph was there.
 *
 * DEP-07 moves a burn to an epoch the player did not choose. §8.5.2 and #136 both ask for
 * that to be visible, and NFR-019 asks for it not to be *only* visible — hence the two
 * assertions on every case here: the glyph, and the sentence a screen reader is given.
 */
import { epoch } from '@hh/astro';
import { addNode, type PlanEdit } from '@hh/game';
import { EMPTY_PLAN, type Plan } from '@hh/sim';
import { createCatalogue } from '@hh/ui';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PlanPanel } from './PlanPanel.js';

const catalogue = createCatalogue();
let container: HTMLElement;

const START = epoch(0);

const ok = (edit: PlanEdit): Plan => {
  if (!edit.ok) throw new Error(`the fixture plan was refused: ${edit.reason.code}`);
  return edit.plan;
};

/** Two burns, far enough apart to clear FR-101's minimum spacing. */
const twoNodes = (): Plan => ok(addNode(ok(addNode(EMPTY_PLAN, epoch(600))), epoch(1200)));

const mount = async (snappedKinds: readonly ('periapsis' | 'apoapsis' | null)[]): Promise<void> => {
  await act(() => {
    render(
      <PlanPanel
        t={catalogue.resolve}
        plan={twoNodes()}
        startEpoch={START}
        selectedIndex={null}
        snappedKinds={snappedKinds}
        onSelect={() => undefined}
        onDelete={() => undefined}
        onExpand={() => undefined}
        onOpenMenu={() => undefined}
        onAdd={() => undefined}
      />,
      container,
    );
  });
};

const el = (testId: string): HTMLElement | null =>
  container.querySelector(`[data-testid="${testId}"]`);

const rowText = (index: number): string =>
  container.querySelectorAll('.hh-plan__row')[index]?.textContent ?? '';

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
});

describe('marking a snapped node (#136, DEP-07)', () => {
  it('marks a node that is on an apsis, and names which', async () => {
    await mount(['periapsis', null]);
    expect(el('plan-snapped-0')).not.toBeNull();
    expect(el('plan-snapped-0')?.dataset['kind']).toBe('periapsis');
    // NFR-019: the glyph is never the only channel. The row's announced sentence says it
    // in words, and the glyph carries a `title` for a pointer user who has not met it.
    expect(rowText(0)).toContain('snapped to periapsis');
    expect(el('plan-snapped-0')?.getAttribute('title')).toBe('snapped to periapsis');
  });

  it('distinguishes apoapsis from periapsis', async () => {
    await mount(['apoapsis', null]);
    expect(el('plan-snapped-0')?.dataset['kind']).toBe('apoapsis');
    expect(rowText(0)).toContain('snapped to apoapsis');
    // A different glyph, not merely a different label — the two are opposite ends of the
    // orbit and reading them as the same mark would be worse than no mark.
    expect(el('plan-snapped-0')?.textContent).not.toBe('⌄');
  });

  it('leaves an unsnapped node unmarked, in both channels', async () => {
    await mount([null, null]);
    expect(el('plan-snapped-0')).toBeNull();
    expect(el('plan-snapped-1')).toBeNull();
    expect(rowText(0)).not.toContain('snapped to');
  });

  it('marks each node independently', async () => {
    await mount([null, 'apoapsis']);
    expect(el('plan-snapped-0')).toBeNull();
    expect(el('plan-snapped-1')).not.toBeNull();
    expect(rowText(1)).toContain('snapped to apoapsis');
  });

  it('exposes the state on the row, so the stylesheet does not re-derive it', async () => {
    await mount(['periapsis', null]);
    const rows = container.querySelectorAll('.hh-plan__row');
    expect((rows[0] as HTMLElement).dataset['snapped']).toBe('periapsis');
    expect((rows[1] as HTMLElement).dataset['snapped']).toBe('none');
  });

  it('survives a shorter list than the plan without throwing', async () => {
    // Defensive, and cheap: the two arrays are built together in `PlannerScreen`, but a
    // caller that got them out of step should render an unmarked row rather than crash the
    // one region §8.8 says must always carry the plan in text.
    await mount([]);
    expect(container.querySelectorAll('.hh-plan__row')).toHaveLength(2);
    expect(el('plan-snapped-0')).toBeNull();
  });
});

describe('the row’s controls (#136, §8.8)', () => {
  it('offers a menu control per node, named for the burn it acts on', async () => {
    await mount([null, null]);
    expect(el('plan-menu-0')).not.toBeNull();
    expect(el('plan-menu-1')).not.toBeNull();
    // The accessible name distinguishes the two, so "open actions" is not announced twice
    // with nothing to tell them apart. It is on the glyph rather than in the row's text —
    // `Icon` gives a labelled glyph `role="img"` and an `aria-label`, which is what makes a
    // control with no visible text announceable at all.
    expect(el('plan-menu-0')?.querySelector('svg')?.getAttribute('aria-label')).toBe(
      'Open actions for burn 1',
    );
    expect(el('plan-menu-1')?.querySelector('svg')?.getAttribute('aria-label')).toBe(
      'Open actions for burn 2',
    );
  });
});
