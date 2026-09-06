/**
 * Undo and redo as the planner actually wires them — FR-110, §6.11, #138.
 *
 * `packages/ui/src/planner/history.test.ts` proves the reducer. This proves the three
 * claims that are about the *store* rather than the stack, and that a reducer test cannot
 * reach:
 *
 * - **One gesture is one entry.** §6.11's rule is about edits, and only the store knows
 *   where an edit begins and ends.
 * - **A refused edit records nothing.** `L5` is a legality answer, and whether it reaches
 *   the stack is a decision the store makes.
 * - **Scrubbing is not undoable.** FR-403 makes it a view operation; the reducer never
 *   sees a scrub at all, which is exactly the property worth asserting from outside.
 *
 * Driven through `PlannerScreen` against the real `c03-cold-open` and through the keyboard,
 * because §8.5.3's bindings are half of what #138 delivers.
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

const press = async (key: string, modifiers: Partial<KeyboardEventInit> = {}): Promise<void> => {
  await act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...modifiers }));
  });
};

const undo = (): Promise<void> => press('z', { ctrlKey: true });
const redo = (): Promise<void> => press('Z', { ctrlKey: true, shiftKey: true });

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
      />,
      container,
    );
  });
};

const rows = (): number => container.querySelectorAll('.hh-plan__row').length;

/** The plan as text, which is what "the same plan" means to a player. */
const planText = (): string => el('plan-panel')?.textContent ?? '';

const undoDisabled = (): boolean =>
  (el('commit-undo') as HTMLButtonElement | null)?.disabled ?? true;
const redoDisabled = (): boolean =>
  (el('commit-redo') as HTMLButtonElement | null)?.disabled ?? true;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
});

describe('what counts as one entry (§6.11)', () => {
  it('has nothing to undo before anything has happened', async () => {
    await mount();
    expect(undoDisabled()).toBe(true);
    expect(redoDisabled()).toBe(true);
  });

  it('makes an added node one entry', async () => {
    await mount();
    await press('n');
    expect(rows()).toBe(1);
    expect(undoDisabled()).toBe(false);

    await undo();
    expect(rows()).toBe(0);
    expect(undoDisabled()).toBe(true);
  });

  it('makes a Δv change one entry', async () => {
    await mount();
    await press('n');
    const before = planText();
    await press('ArrowUp');
    expect(planText()).not.toBe(before);

    await undo();
    expect(planText()).toBe(before);
    // And the node is still there — the Δv change was the entry, not the node.
    expect(rows()).toBe(1);
  });

  it('makes a delete one entry, and brings the node back', async () => {
    await mount();
    await press('n');
    await press('Delete');
    expect(rows()).toBe(0);
    await undo();
    expect(rows()).toBe(1);
  });

  it('does not record a refused edit, and does not clear redo with one', async () => {
    await mount();
    await press('n');
    await undo();
    expect(rows()).toBe(0);
    expect(redoDisabled()).toBe(false);

    // Two nodes at the same scrub head: FR-101's minimum spacing refuses the second with
    // `L5`. §6.11 counts *mutations*, and a refusal mutated nothing.
    await press('n');
    await press('n');
    expect(el('planner-refusal')).not.toBeNull();
    expect(rows()).toBe(1);

    // One undo, not two: the refusal pushed no entry.
    await undo();
    expect(rows()).toBe(0);
  });
});

describe('scrubbing is not undoable (FR-403, #138)', () => {
  it('leaves the stack empty after a scrub', async () => {
    await mount();
    await press(']');
    await press(']');
    // If a scrub were an entry, `Ctrl+Z` after merely looking around would appear to do
    // nothing — the plan would not change — and the stack would look broken at exactly the
    // moment a player was testing whether it worked.
    expect(undoDisabled()).toBe(true);
  });

  it('does not let a scrub after an edit be undone before the edit', async () => {
    await mount();
    await press('n');
    await press(']');
    await undo();
    // The one undo available took away the node, not the scrub.
    expect(rows()).toBe(0);
    expect(undoDisabled()).toBe(true);
  });
});

describe('redo, and what invalidates it (#138)', () => {
  it('puts back what undo took away', async () => {
    await mount();
    await press('n');
    const after = planText();
    await undo();
    expect(rows()).toBe(0);
    await redo();
    expect(planText()).toBe(after);
    expect(redoDisabled()).toBe(true);
  });

  it('is invalidated by a new edit', async () => {
    await mount();
    await press('n');
    await undo();
    expect(redoDisabled()).toBe(false);

    await press('n');
    expect(redoDisabled()).toBe(true);
  });
});

describe('E7: ten mutations, undone and redone (§13.5)', () => {
  it('returns the plan the player started with, and then gets back to the end', async () => {
    await mount();
    const original = planText();

    // Ten accepted mutations: one node, then nine Δv nudges on it. Each is one entry, and
    // each changes the plan — which is what makes the count meaningful.
    await press('n');
    for (let i = 0; i < 9; i++) await press('ArrowUp');
    const final = planText();
    expect(final).not.toBe(original);

    for (let i = 0; i < 10; i++) await undo();
    expect(planText()).toBe(original);
    expect(rows()).toBe(0);
    expect(undoDisabled()).toBe(true);

    for (let i = 0; i < 10; i++) await redo();
    expect(planText()).toBe(final);
    expect(redoDisabled()).toBe(true);
  });
});

describe('the bindings (§8.5.3)', () => {
  it('is inert while the player is typing', async () => {
    await mount();
    await press('n');
    await press('e');
    const field = container.querySelector('input[type="number"]');
    expect(field).not.toBeNull();

    // `isTypingTarget` is the guard, and the browser's own undo applies inside a field.
    await act(() => {
      field?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }),
      );
    });
    expect(rows()).toBe(1);
  });

  it('does not fire on a bare z', async () => {
    await mount();
    await press('n');
    await press('z');
    expect(rows()).toBe(1);
  });
});
