/**
 * §8.5.2's node context menu — #136.
 *
 * Driven through `PlannerScreen` against the real `c03-cold-open`, for the reason
 * `PlannerScreen.test.tsx` gives: a fixture would let a unit error look reasonable.
 *
 * C03 opens on a **400 km circular LEO**, and that is not an inconvenience to work around
 * — it is the case #136 asks to be tested. A near-circular orbit is below
 * `APSIS_ECCENTRICITY_FLOOR` and has no apsides at all, every Act I contract starts on
 * one, and so "there is nothing to snap to" is the common path through this menu rather
 * than its edge case. The snap entries are therefore expected *disabled with a reason*
 * here, which is exactly what a player meets first.
 *
 * The menu is opened from the plan panel's row rather than by right-clicking the canvas,
 * because §8.8's canvas-parity rule says the DOM route must exist and this is that route.
 * The pointer route calls the same `setMenu` through `onOpenNodeMenu` — `OrbitView.drag.test.tsx`
 * covers the gesture reaching it.
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

const el = (testId: string): HTMLElement | null =>
  container.querySelector(`[data-testid="${testId}"]`);

const click = async (testId: string): Promise<void> => {
  await act(() => {
    el(testId)?.click();
  });
};

const press = async (key: string, modifiers: Partial<KeyboardEventInit> = {}): Promise<void> => {
  await act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...modifiers }));
  });
};

const mount = async (): Promise<void> => {
  await act(() => {
    render(
      <PlannerScreen
        t={catalogue.resolve}
        resolveDynamic={catalogue.resolveDynamic}
        scenario={c03()}
        onCommit={() => undefined}
        coachMarksSeen={[]}
        onCoachMarkSeen={() => undefined}
        onOpenCodex={() => undefined}
        onOpenHelp={() => undefined}
      />,
      container,
    );
  });
};

/** A planner with one burn placed at the scrub head, which `N` selects as it adds. */
const withOneNode = async (): Promise<void> => {
  await mount();
  await press('n');
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
});

describe('opening it (#136, §8.5.2, NFR-016)', () => {
  it('is not open until it is asked for', async () => {
    await withOneNode();
    expect(el('node-menu')).toBeNull();
  });

  it('opens from the row’s control — the pointer-free route §8.8 requires', async () => {
    await withOneNode();
    await click('plan-menu-0');
    expect(el('node-menu')).not.toBeNull();
  });

  it('opens on the selected node with Shift+F10', async () => {
    await withOneNode();
    await press('F10', { shiftKey: true });
    expect(el('node-menu')).not.toBeNull();
  });

  it('opens with the dedicated ContextMenu key too', async () => {
    await withOneNode();
    await press('ContextMenu');
    expect(el('node-menu')).not.toBeNull();
  });

  it('does not open on F10 without Shift, which is the browser’s own binding', async () => {
    await withOneNode();
    await press('F10');
    expect(el('node-menu')).toBeNull();
  });

  it('offers all four of §8.5.2’s actions', async () => {
    await withOneNode();
    await click('plan-menu-0');
    expect(el('node-menu-periapsis')).not.toBeNull();
    expect(el('node-menu-apoapsis')).not.toBeNull();
    expect(el('node-menu-zero')).not.toBeNull();
    expect(el('node-menu-delete')).not.toBeNull();
  });

  it('moves focus into the menu, so a keyboard user is not left behind', async () => {
    await withOneNode();
    await press('F10', { shiftKey: true });
    const menu = el('node-menu');
    expect(menu?.contains(document.activeElement)).toBe(true);
  });
});

describe('a circular orbit has no apsides, and the menu says so (#136)', () => {
  it('disables both snap entries rather than hiding them', async () => {
    await withOneNode();
    await click('plan-menu-0');
    // Disabled, not absent. A menu whose entries come and go teaches a player the game is
    // inconsistent; a disabled entry with a reason teaches them something true about
    // orbits. `NodeContextMenu.tsx` argues it at length.
    expect((el('node-menu-periapsis') as HTMLButtonElement).disabled).toBe(true);
    expect((el('node-menu-apoapsis') as HTMLButtonElement).disabled).toBe(true);
  });

  it('gives the reason, and associates it with the controls it explains', async () => {
    await withOneNode();
    await click('plan-menu-0');
    const reason = el('node-menu-no-apsides');
    expect(reason).not.toBeNull();
    // `aria-describedby`, so someone who tabs to a dimmed entry hears why rather than
    // just "dimmed" — the same rule `CommitBar` applies to a disabled Commit.
    expect(el('node-menu-periapsis')?.getAttribute('aria-describedby')).toBe(reason?.id);
  });

  it('still offers the two actions that do not need an apsis', async () => {
    await withOneNode();
    await click('plan-menu-0');
    expect((el('node-menu-zero') as HTMLButtonElement).disabled).toBe(false);
    expect((el('node-menu-delete') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('acting, and closing (#136)', () => {
  it('deletes the burn, and closes', async () => {
    await withOneNode();
    expect(container.querySelectorAll('.hh-plan__row')).toHaveLength(1);
    await click('plan-menu-0');
    await click('node-menu-delete');
    expect(container.querySelectorAll('.hh-plan__row')).toHaveLength(0);
    expect(el('node-menu')).toBeNull();
  });

  it('zeroes Δv without deleting the burn', async () => {
    await withOneNode();
    // Give it a Δv to zero: `↑` is §8.5.3's prograde nudge.
    await press('ArrowUp');
    // Asserted on the announced sentence rather than the visible cells, because that is
    // where a zero burn is stated as a fact rather than as a number — the catalogue drops
    // a zero component instead of announcing it, and says "no burn" when both are zero.
    expect(el('plan-node-0')?.textContent).not.toContain('no burn');
    await click('plan-menu-0');
    await click('node-menu-zero');
    expect(container.querySelectorAll('.hh-plan__row')).toHaveLength(1);
    expect(el('plan-node-0')?.textContent).toContain('no burn');
  });

  it('closes on Escape without acting', async () => {
    await withOneNode();
    await click('plan-menu-0');
    await press('Escape');
    expect(el('node-menu')).toBeNull();
    // Escape closed the menu and nothing else. A player who opens a menu by accident and
    // presses Escape should not also lose their selection.
    expect(container.querySelectorAll('.hh-plan__row')).toHaveLength(1);
    expect(el('plan-node-0')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('is dismissed by a press outside it', async () => {
    await withOneNode();
    await click('plan-menu-0');
    await act(() => {
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });
    expect(el('node-menu')).toBeNull();
  });
});
