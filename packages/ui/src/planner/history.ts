/**
 * Undo and redo over plan edits — FR-110, §6.11, #138.
 *
 * > *Every node add/move/delete/Δv change is one entry.* — §6.11
 *
 * The planner is a direct-manipulation surface, so a wrong drag currently costs the player
 * the node. §6.11 makes undo the first row of its failure-and-retry table and §13.5's E7
 * makes it a release gate: *"undo/redo across 10 mutations returns the exact original
 * plan."*
 *
 * ## Here rather than in `apps/web`
 *
 * Beside §8.5.1's machine, in the root TypeScript project that has no DOM library. So this
 * is checked to run under Node, is testable without a canvas, and cannot drift from the
 * transitions it sits next to. It is a pure function of its arguments: no clock, no
 * storage, no identity — which is also what makes E7 assertable by comparing values rather
 * than by driving a screen.
 *
 * ## The present is the caller's, not this module's
 *
 * The usual shape for this is `{past, present, future}`. That is not what is here, and the
 * reason is that the planner already has a present: `PlannerState` holds the plan, the
 * interaction and the editor target, and every region renders from them. A `present` field
 * would be a second copy of all three, and the interesting question would immediately
 * become which of the two is authoritative — a question with no good answer and a bug in
 * every branch that forgets to update both.
 *
 * So {@link History} is two stacks and nothing else, and every operation takes the current
 * entry as an argument. The store stays the single source of truth for what is on screen;
 * this owns only where the player has been.
 *
 * ## What is in an entry, and what is deliberately not
 *
 * §6.11's unit is a completed edit. An entry carries the plan, the selection, and the node
 * editor's target — enough that undo does not strand the player looking at an overlay for
 * a node that no longer exists, which is what "returns the plan" alone would do.
 *
 * **The scrub head is not in it.** FR-403 makes scrubbing a pure view operation, and
 * §6.11's list of what counts as an entry does not include it. If it were undoable,
 * `Ctrl+Z` after looking around would appear to do nothing — the plan would not change —
 * and the stack would look broken at exactly the moment a player was testing whether it
 * worked. That is #138's own reasoning and it is worth restating because the opposite
 * choice is the easy one to make by accident.
 *
 * ## Whole values rather than diffs
 *
 * A `Plan` is small and immutable (FR-101), so an entry is three references. Fifty of them
 * cost nothing worth measuring, and storing them whole means undo is an assignment rather
 * than a replay of inverse operations — which is the version that cannot be subtly wrong
 * about an edit that was refused halfway.
 *
 * The cap exists to bound memory over a long session, not because fifty is a meaningful
 * number of mistakes. At the cap the **oldest** entry is dropped and the newest accepted:
 * refusing the newest would mean the player's most recent action was the one that could
 * not be undone, which is exactly backwards.
 *
 * ## FR-502, which does not exist yet
 *
 * §8.3.11's targeting computer will offer *"insert as plan"* — a whole plan replacing
 * whatever the player had, as **one** undoable operation. Nothing here needs to change for
 * it: {@link record} takes the entry being replaced and does not care how different the
 * next one is, so a wholesale replacement is one entry by construction. That is why this
 * records values rather than operations; an operation-based stack would need a new inverse
 * for that case, and it would be the one whose inverse was hardest to get right.
 */
import type { Plan } from '@hh/sim';

import type { NodeId } from './machine.js';

/**
 * FR-110: *"at least 50 mutations"*.
 *
 * At least, so this is a floor rather than a target — but a stated one, because "as many
 * as fit" is not a promise a test can check.
 */
export const UNDO_DEPTH = 50;

/** One point in the history of a plan. See the module docstring on what is here and why. */
export interface HistoryEntry {
  readonly plan: Plan;
  /** Which node was selected. Restored with the plan, so undo does not also lose the place. */
  readonly selectedNodeId: NodeId | null;
  /** Which node §8.3.5's overlay was open for, or `null`. */
  readonly editorFor: NodeId | null;
}

/** Where the player has been, and where they came back from. Two stacks, no present. */
export interface History {
  /** Oldest first. The last element is what one undo returns to. */
  readonly past: readonly HistoryEntry[];
  /** Nearest first. The first element is what one redo moves to. */
  readonly future: readonly HistoryEntry[];
}

/** A history with nothing in it. What the planner opens with. */
export const EMPTY_HISTORY: History = Object.freeze({ past: [], future: [] });

/**
 * Record a completed edit: `replaced` is the entry the plan is moving *away* from.
 *
 * Called once per completed edit, which is the whole of §6.11's rule. A drag is one call
 * because the plan is not touched until `releaseDragging` — that was already true before
 * this existed, and it is what makes "a drag is one entry" structural rather than something
 * to be careful about.
 *
 * **A refused edit must not call this.** §6.11 counts mutations, and an `L5` refusal did
 * not mutate anything; recording one would put an entry on the stack whose undo is a no-op,
 * and would clear the redo stack for an action that never happened. The caller decides,
 * because only the caller knows whether the edit was accepted.
 */
export const record = (history: History, replaced: HistoryEntry): History => {
  const past = [...history.past, replaced];
  return {
    // The oldest goes, never the newest. See the module docstring.
    past: past.length > UNDO_DEPTH ? past.slice(past.length - UNDO_DEPTH) : past,
    // A new edit invalidates redo — the standard rule, and the only coherent one: the
    // future the player was going to return to was reached from a state that no longer
    // exists.
    future: [],
  };
};

export const canUndo = (history: History): boolean => history.past.length > 0;
export const canRedo = (history: History): boolean => history.future.length > 0;

/** What a move produced: where to go, and the history that remains. */
export interface HistoryMove {
  readonly entry: HistoryEntry;
  readonly history: History;
}

/**
 * Step back. `current` is where the planner is now, and becomes the head of the future.
 *
 * `null` when there is nothing to undo, rather than returning the history unchanged — the
 * caller has to distinguish the two anyway to leave its own state alone, and a silent
 * no-op is the version that hides a wrong `canUndo` in the control that calls it.
 */
export const undo = (history: History, current: HistoryEntry): HistoryMove | null => {
  const entry = history.past[history.past.length - 1];
  if (entry === undefined) return null;
  return {
    entry,
    history: {
      past: history.past.slice(0, -1),
      future: [current, ...history.future],
    },
  };
};

/** Step forward. The exact inverse of {@link undo}, which is what makes E7 hold. */
export const redo = (history: History, current: HistoryEntry): HistoryMove | null => {
  const [entry, ...rest] = history.future;
  if (entry === undefined) return null;
  return {
    entry,
    history: {
      past: [...history.past, current],
      future: rest,
    },
  };
};
