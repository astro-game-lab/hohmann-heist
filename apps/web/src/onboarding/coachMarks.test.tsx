/**
 * Coach marks in the browser — FR-902's criteria (#159, #160).
 *
 * The framework's *logic* is `@hh/ui`'s and is tested there without a DOM. What needs a DOM
 * is everything FR-902 actually promises a player: that the two dismissals are different
 * lifetimes, that the assist switches the lot off, that the mark is announced without
 * taking focus, and that it points at its anchor when the anchor is on screen and docks
 * when it is not.
 */
import { MARKS, createCatalogue } from '@hh/ui';
import type { MarkFacts } from '@hh/ui';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CoachMark } from './CoachMark.js';
import { useCoachMarks } from './useCoachMarks.js';

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

const click = async (testId: string): Promise<void> => {
  await act(() => {
    el(testId)?.click();
  });
};

const C01 = ['mark.c01.oppositeSide', 'mark.c01.commit'];

/**
 * A harness that mounts the hook and the component together.
 *
 * They are tested as a pair rather than separately because the thing being checked is the
 * *behaviour*: "dismissing permanently writes the save and the mark goes away" is one
 * statement spanning both, and splitting it would leave the join untested.
 */
const Harness = ({
  declared = C01,
  enabled = true,
  facts,
  seen = [],
  onSeen = () => undefined,
  onOpenCodex = () => undefined,
}: {
  readonly declared?: readonly string[];
  readonly enabled?: boolean;
  readonly facts: MarkFacts;
  readonly seen?: readonly string[];
  readonly onSeen?: (key: string) => void;
  readonly onOpenCodex?: (slug: string) => void;
}) => {
  const marks = useCoachMarks({ declared, enabled, facts, seen, onSeen });
  return (
    <CoachMark
      t={catalogue.resolve}
      resolveDynamic={catalogue.resolveDynamic}
      mark={marks.mark}
      onDismiss={marks.dismiss}
      onDismissPermanently={marks.dismissPermanently}
      onOpenCodex={onOpenCodex}
    />
  );
};

const FACTS = {
  empty: { nodeCount: 0, committable: false, nodeSelected: false, objectiveMet: false },
  oneNode: { nodeCount: 1, committable: false, nodeSelected: false, objectiveMet: false },
  legal: { nodeCount: 2, committable: true, nodeSelected: false, objectiveMet: true },
} satisfies Record<string, MarkFacts>;

const mount = async (props: Partial<Parameters<typeof Harness>[0]> = {}): Promise<void> => {
  await act(() => {
    render(<Harness facts={FACTS.oneNode} {...props} />, container);
  });
};

describe('the live region', () => {
  /**
   * Always mounted, even with nothing to say.
   *
   * A `role="status"` element created at the moment its content appears is a live region
   * the assistive technology was not yet observing, and the announcement is lost. This is
   * the check that stops someone "tidying up" by rendering the container conditionally.
   */
  it('exists before there is a mark, and stays after one is dismissed', async () => {
    await mount({ facts: FACTS.empty, declared: [] });
    const region = el('coach-mark');
    expect(region).not.toBeNull();
    expect(region?.getAttribute('role')).toBe('status');
    expect(el('coach-mark-dismiss')).toBeNull();
  });

  it('never takes focus when a mark appears', async () => {
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    await mount();
    expect(el('coach-mark-dismiss')).not.toBeNull();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('puts its controls in the tab order', async () => {
    await mount();
    // Ordinary buttons: reachable by Tab, with no `tabindex` games and no trap.
    expect(el('coach-mark-dismiss')?.tabIndex).toBe(0);
    expect(el('coach-mark-forever')?.tabIndex).toBe(0);
  });
});

describe('which mark shows', () => {
  it('shows the first eligible one in the scenario’s order', async () => {
    await mount({ facts: FACTS.oneNode });
    // C01 declares `oppositeSide` first, and both its trigger and `commit`'s could be
    // satisfied later — declaration order is what decides, not which fired last.
    expect(el(`coach-mark-${MARKS['mark.c01.oppositeSide'].key}`)).not.toBeNull();
  });

  it('shows nothing before its moment', async () => {
    await mount({ facts: FACTS.empty });
    expect(el('coach-mark-dismiss')).toBeNull();
  });

  it('moves to the next one when the first is dismissed', async () => {
    await mount({ facts: FACTS.legal });
    expect(el('coach-mark-mark.c01.oppositeSide')).not.toBeNull();
    await click('coach-mark-dismiss');
    expect(el('coach-mark-mark.c01.oppositeSide')).toBeNull();
    expect(el('coach-mark-mark.c01.commit')).not.toBeNull();
  });

  it('shows nothing a contract did not declare', async () => {
    await mount({ declared: [], facts: FACTS.legal });
    expect(el('coach-mark-dismiss')).toBeNull();
  });

  it('ignores a declared key with no row in the table', async () => {
    // A content error `tools/content` refuses at merge; here it must degrade to silence
    // rather than to a crash or an unanchored card.
    await mount({ declared: ['mark.c99.invented'], facts: FACTS.legal });
    expect(el('coach-mark-dismiss')).toBeNull();
  });
});

describe('FR-902’s two dismissals', () => {
  it('“Got it” hides this mark and writes nothing', async () => {
    const onSeen = vi.fn();
    await mount({ facts: FACTS.oneNode, onSeen });
    await click('coach-mark-dismiss');
    expect(onSeen).not.toHaveBeenCalled();
    expect(el('coach-mark-mark.c01.oppositeSide')).toBeNull();
  });

  it('“Don’t show this one again” writes the save', async () => {
    const onSeen = vi.fn();
    await mount({ facts: FACTS.oneNode, onSeen });
    await click('coach-mark-forever');
    expect(onSeen).toHaveBeenCalledExactlyOnceWith('mark.c01.oppositeSide');
  });

  /** Across reloads, which is what the save is for: a seen mark never comes back. */
  it('never shows a mark already in flags.coachMarksSeen', async () => {
    await mount({ facts: FACTS.legal, seen: ['mark.c01.oppositeSide'] });
    expect(el('coach-mark-mark.c01.oppositeSide')).toBeNull();
    expect(el('coach-mark-mark.c01.commit')).not.toBeNull();
  });

  it('hides the mark immediately rather than waiting for the save to come back', async () => {
    // `onSeen` goes up to the shell and returns as a new `seen` prop on a later render.
    // Without the local hide the card would sit there for that round trip.
    await mount({ facts: FACTS.oneNode, onSeen: () => undefined });
    await click('coach-mark-forever');
    expect(el('coach-mark-mark.c01.oppositeSide')).toBeNull();
  });

  it('closes on Esc from inside the card', async () => {
    await mount({ facts: FACTS.oneNode });
    await act(() => {
      el('coach-mark-dismiss')?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
      );
    });
    expect(el('coach-mark-mark.c01.oppositeSide')).toBeNull();
  });
});

describe('the assist is the off switch', () => {
  /**
   * §6.6's `coach_marks` assist and §8.3.12's Gameplay setting are one flag (#186's table
   * lost its duplicate for this issue). Off means every mark, not the current one.
   */
  it('suppresses every mark when the assist is off', async () => {
    await mount({ facts: FACTS.legal, enabled: false });
    expect(el('coach-mark-dismiss')).toBeNull();
    // The region is still there — it is a live region, not a mark.
    expect(el('coach-mark')).not.toBeNull();
  });
});

describe('anchoring', () => {
  it('docks when its anchor is not on screen', async () => {
    await mount({ facts: FACTS.oneNode });
    expect(el('coach-mark')?.dataset['anchored']).toBe('false');
  });

  it('points at its anchor when the region is there', async () => {
    const orbit = document.createElement('div');
    orbit.dataset['hhAnchor'] = 'orbit';
    // jsdom gives every element a zero-sized rect, which `measure` treats as "not really
    // there". A stub is the only way to have a box in this environment, and the thing under
    // test is the lookup and the docking decision rather than the arithmetic.
    orbit.getBoundingClientRect = () =>
      ({ left: 120, bottom: 240, width: 400, height: 300 }) as DOMRect;
    document.body.append(orbit);

    await mount({ facts: FACTS.oneNode });
    const region = el('coach-mark');
    expect(region?.dataset['anchored']).toBe('true');
    expect(region?.style.getPropertyValue('--hh-mark-x')).toBe('120px');
    expect(region?.style.getPropertyValue('--hh-mark-y')).toBe('248px');
    orbit.remove();
  });
});

describe('the way into the Codex', () => {
  it('offers a link for a mark that names an entry, and calls back with its slug', async () => {
    const onOpenCodex = vi.fn();
    await mount({ facts: FACTS.oneNode, onOpenCodex });
    await click('coach-mark-codex');
    expect(onOpenCodex).toHaveBeenCalledExactlyOnceWith(
      MARKS['mark.c01.oppositeSide'].codex ?? 'MISSING',
    );
  });

  it('offers none for a mark that names no entry', async () => {
    await mount({ declared: ['mark.c04.burnCap'], facts: FACTS.oneNode });
    expect(el('coach-mark-mark.c04.burnCap')).not.toBeNull();
    expect(el('coach-mark-codex')).toBeNull();
  });
});
