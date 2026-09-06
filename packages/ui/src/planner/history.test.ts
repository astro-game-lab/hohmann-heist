/**
 * The undo stack — FR-110, §6.11, §13.5's E7 (#138).
 *
 * Driven as plain values, with no DOM and no store, which is the point of the reducer
 * living in this package: E7 is *"undo/redo across 10 mutations returns the exact original
 * plan"*, and that is a statement about values rather than about a screen.
 */
import { EMPTY_PLAN, createPlan, maneuverNodeFromCounts, type Plan } from '@hh/sim';
import { describe, expect, it } from 'vitest';

import {
  EMPTY_HISTORY,
  UNDO_DEPTH,
  canRedo,
  canUndo,
  record,
  redo,
  undo,
  type History,
  type HistoryEntry,
} from './history.js';

/** A plan with `n` burns, each distinguishable by its epoch and its Δv. */
const planOf = (n: number): Plan =>
  createPlan(
    Array.from({ length: n }, (_, i) =>
      maneuverNodeFromCounts(Math.round((i + 1) * 600 * 1024), [0, 1000 * (i + 1), 0]),
    ),
  );

const entry = (n: number): HistoryEntry => ({
  plan: planOf(n),
  selectedNodeId: n === 0 ? null : `node:${String(Math.round(n * 600 * 1024))}`,
  editorFor: null,
});

const EMPTY_ENTRY: HistoryEntry = { plan: EMPTY_PLAN, selectedNodeId: null, editorFor: null };

/**
 * E7's comparison: canonical JSON, not field-by-field equality.
 *
 * #138 asks for it in those words, and the reason is that a field-by-field check passes
 * for two plans that differ in a field the check forgot. Serialising the whole value
 * cannot forget one.
 */
const canonical = (plan: Plan): string => JSON.stringify(plan);

describe('recording an edit (§6.11)', () => {
  it('starts with nothing to undo or redo', () => {
    expect(canUndo(EMPTY_HISTORY)).toBe(false);
    expect(canRedo(EMPTY_HISTORY)).toBe(false);
  });

  it('makes the replaced entry the one an undo returns to', () => {
    const history = record(EMPTY_HISTORY, EMPTY_ENTRY);
    expect(canUndo(history)).toBe(true);
    expect(undo(history, entry(1))?.entry).toEqual(EMPTY_ENTRY);
  });

  it('invalidates redo, which is the standard rule', () => {
    let history = record(EMPTY_HISTORY, EMPTY_ENTRY);
    const back = undo(history, entry(1));
    if (back === null) throw new Error('expected an undo');
    expect(canRedo(back.history)).toBe(true);

    // A new edit from the undone state. The future the player was going to return to was
    // reached from a state that no longer exists.
    history = record(back.history, back.entry);
    expect(canRedo(history)).toBe(false);
  });
});

describe('the depth FR-110 requires', () => {
  it('holds at least 50 entries', () => {
    let history: History = EMPTY_HISTORY;
    for (let i = 0; i < UNDO_DEPTH; i++) history = record(history, entry(i));
    expect(history.past).toHaveLength(UNDO_DEPTH);
    expect(UNDO_DEPTH).toBeGreaterThanOrEqual(50);
  });

  it('drops the oldest at the cap and accepts the newest', () => {
    let history: History = EMPTY_HISTORY;
    for (let i = 0; i < UNDO_DEPTH + 10; i++) history = record(history, entry(i));

    expect(history.past).toHaveLength(UNDO_DEPTH);
    // The newest is the one an undo reaches first — refusing it would mean the player's
    // most recent action was the one that could not be undone, which is backwards.
    const newest = history.past[history.past.length - 1];
    expect(canonical(newest?.plan ?? EMPTY_PLAN)).toBe(canonical(entry(UNDO_DEPTH + 9).plan));
    // And the oldest survivor is entry 10, not entry 0.
    expect(canonical(history.past[0]?.plan ?? EMPTY_PLAN)).toBe(canonical(entry(10).plan));
  });
});

describe('undo and redo are inverses (§13.5’s E7)', () => {
  it('returns a plan identical to the original across ten mixed mutations', () => {
    const original = EMPTY_ENTRY;
    let history: History = EMPTY_HISTORY;
    let current = original;

    // Ten mutations, each a different plan — the shape of an E7 run without a screen.
    for (let i = 1; i <= 10; i++) {
      history = record(history, current);
      current = entry(i);
    }
    expect(canonical(current.plan)).not.toBe(canonical(original.plan));

    for (let i = 0; i < 10; i++) {
      const back = undo(history, current);
      if (back === null) throw new Error(`ran out of undo at step ${String(i)}`);
      history = back.history;
      current = back.entry;
    }

    // **Identical**, compared by canonical JSON rather than field by field.
    expect(canonical(current.plan)).toBe(canonical(original.plan));
    expect(canUndo(history)).toBe(false);
  });

  it('redoes all ten back to where it started', () => {
    let history: History = EMPTY_HISTORY;
    let current = EMPTY_ENTRY;
    for (let i = 1; i <= 10; i++) {
      history = record(history, current);
      current = entry(i);
    }
    const final = current;

    for (let i = 0; i < 10; i++) {
      const back = undo(history, current);
      if (back === null) throw new Error('ran out of undo');
      history = back.history;
      current = back.entry;
    }
    for (let i = 0; i < 10; i++) {
      const forward = redo(history, current);
      if (forward === null) throw new Error(`ran out of redo at step ${String(i)}`);
      history = forward.history;
      current = forward.entry;
    }

    expect(canonical(current.plan)).toBe(canonical(final.plan));
    expect(canRedo(history)).toBe(false);
  });

  it('restores the selection and the editor target with the plan', () => {
    const before: HistoryEntry = { plan: planOf(2), selectedNodeId: 'node:1', editorFor: 'node:1' };
    const history = record(EMPTY_HISTORY, before);
    const back = undo(history, entry(3));
    // #138: undo must not strand the player looking at an overlay for a node that the
    // plan it just restored does not contain.
    expect(back?.entry.selectedNodeId).toBe('node:1');
    expect(back?.entry.editorFor).toBe('node:1');
  });
});

describe('the ends of the stacks', () => {
  it('answers null rather than silently doing nothing', () => {
    // A no-op return would hide a wrong `canUndo` in whichever control called it; `null`
    // makes the caller handle the case it has to handle anyway.
    expect(undo(EMPTY_HISTORY, EMPTY_ENTRY)).toBeNull();
    expect(redo(EMPTY_HISTORY, EMPTY_ENTRY)).toBeNull();
  });

  it('never mutates the history it was given', () => {
    const history = record(EMPTY_HISTORY, EMPTY_ENTRY);
    const snapshot = canonical(history.past[0]?.plan ?? EMPTY_PLAN);
    undo(history, entry(1));
    redo(history, entry(1));
    record(history, entry(2));
    expect(history.past).toHaveLength(1);
    expect(canonical(history.past[0]?.plan ?? EMPTY_PLAN)).toBe(snapshot);
  });
});

describe('FR-502’s wholesale replacement, which is one entry by construction', () => {
  it('records a completely different plan as a single step', () => {
    // §8.3.11's "insert as plan" is M5. Nothing here needs to change for it: `record`
    // takes the entry being replaced and does not care how different the next one is.
    const history = record(EMPTY_HISTORY, entry(1));
    expect(history.past).toHaveLength(1);
    const back = undo(history, entry(8));
    expect(canonical(back?.entry.plan ?? EMPTY_PLAN)).toBe(canonical(entry(1).plan));
  });
});
