/**
 * §8.5.3's keyboard map, as much of it as M2 builds — FR-405, NFR-016.
 *
 * > *Every action in the game is reachable by keyboard alone. The planner is fully
 * > operable without a pointer.*
 *
 * §8.5.3's table has twenty-four bindings across the whole game. The ones here are the
 * planner's, minus the four whose features are M3 — undo and redo (#138), the keyboard
 * help overlay (#141) and the Codex (`C`) — and minus the execution keys, which belong
 * to the phase #121 builds. A binding for a feature that does not exist would be a key
 * that does nothing, which is worse than an absent one.
 *
 * ## Why this is a table rather than a switch
 *
 * §8.3.12 makes every binding remappable, and #141 is the issue that does it. A `switch`
 * over `event.key` would have to be rewritten for that; a lookup from key to action name
 * only has to be re-keyed. The table is also what a help overlay renders, so the map a
 * player is shown cannot drift from the map that runs.
 *
 * ## Modifiers are read once, and mean the same thing everywhere
 *
 * §8.5.3 gives the nudges `Shift` for a tenth and `Ctrl` for the coarse step, and §8.3.5
 * gives the Δv steppers exactly the same pair. `deltaVStep` in `@hh/ui` is that rule, and
 * both the stepper buttons and `↑`/`↓` here call it — the same operation reached two ways
 * rather than two statements of one rule.
 *
 * ## Nothing here fires while the player is typing
 *
 * The node editor is full of number inputs, and `,` `.` `1` `5` are all things a player
 * types into one. {@link isTypingTarget} is the guard, and it is why the handler is
 * installed on the document rather than per-component: a binding that only worked when
 * focus was nowhere in particular would fail exactly when a keyboard user needed it.
 */
import { deltaVStep } from '@hh/ui';

/** What a key press means. Resolved by the planner, never by this module. */
export type PlannerAction =
  | { readonly kind: 'addNode' }
  | { readonly kind: 'deleteNode' }
  | { readonly kind: 'editNode' }
  | { readonly kind: 'cycleNode'; readonly delta: number }
  | { readonly kind: 'nudgeEpoch'; readonly seconds: number }
  | { readonly kind: 'nudgeDeltaV'; readonly progradeMps: number; readonly radialMps: number }
  | { readonly kind: 'scrub'; readonly seconds: number }
  | { readonly kind: 'scrubTo'; readonly where: 'start' | 'deadline' }
  | { readonly kind: 'zoom'; readonly factor: number }
  | { readonly kind: 'recentre' }
  | { readonly kind: 'commit' }
  | { readonly kind: 'cancel' };

export interface Modifiers {
  readonly shift: boolean;
  readonly ctrl: boolean;
}

/**
 * §8.5.3's epoch nudge: ∓1 s, ×0.1 with Shift, ×60 with Ctrl.
 *
 * The Ctrl factor is 60 rather than the Δv map's 10, and that is §8.5.3's own table
 * rather than an inconsistency: a minute is the useful coarse step for an epoch, and ten
 * seconds is not a unit anybody thinks in.
 */
export const EPOCH_NUDGE_SECONDS = 1;

const epochNudge = (modifiers: Modifiers): number => {
  if (modifiers.shift) return EPOCH_NUDGE_SECONDS * 0.1;
  if (modifiers.ctrl) return EPOCH_NUDGE_SECONDS * 60;
  return EPOCH_NUDGE_SECONDS;
};

/** §8.5.3's scrub step: ∓1 min, with the same modifiers as the epoch nudge. */
export const SCRUB_NUDGE_SECONDS = 60;

const scrubNudge = (modifiers: Modifiers): number => {
  if (modifiers.shift) return SCRUB_NUDGE_SECONDS * 0.1;
  if (modifiers.ctrl) return SCRUB_NUDGE_SECONDS * 60;
  return SCRUB_NUDGE_SECONDS;
};

/** One notch of `+`/`-`. Matches the wheel's feel without matching its resolution. */
const KEY_ZOOM_FACTOR = 1.25;

/**
 * Whether a key press belongs to whatever the player is typing into.
 *
 * Everything editable, plus `contenteditable`, plus anything that has opted out with
 * `role="textbox"`. Checked structurally rather than by tag name alone so a future
 * component cannot quietly escape it.
 */
export const isTypingTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  // The property *and* the attribute. `isContentEditable` is the correct read in a
  // browser because it inherits, but it is unimplemented in jsdom — where it is always
  // false — so relying on it alone would leave this untested in the one place the
  // planner's tests run. The attribute check is not a workaround for that: it also
  // catches the element that declares it, which is the case worth being sure of.
  if (target.isContentEditable) return true;
  const editable = target.getAttribute('contenteditable');
  if (editable !== null && editable !== 'false') return true;
  if (target.getAttribute('role') === 'textbox') return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
};

/**
 * Resolve a key press to an action, or `null`.
 *
 * Pure, so `keys.test.ts` drives the whole map with plain strings and no DOM at all —
 * which is what makes NFR-016's "fully operable without a pointer" checkable as a table
 * rather than as twenty simulated key events.
 */
export const actionFor = (key: string, modifiers: Modifiers): PlannerAction | null => {
  switch (key) {
    case 'n':
    case 'N':
      return { kind: 'addNode' };
    case 'Delete':
    case 'Backspace':
      return { kind: 'deleteNode' };
    case 'e':
    case 'E':
      return { kind: 'editNode' };
    case 'Tab':
      return { kind: 'cycleNode', delta: modifiers.shift ? -1 : 1 };

    // §8.5.3's `,` / `.` — nudge the selected node's epoch.
    case ',':
      return { kind: 'nudgeEpoch', seconds: -epochNudge(modifiers) };
    case '.':
      return { kind: 'nudgeEpoch', seconds: epochNudge(modifiers) };

    // `↑` / `↓` prograde, `←` / `→` radial. The keyboard equivalent #135 asks for, and
    // the same step rule the node editor's steppers use.
    case 'ArrowUp':
      return { kind: 'nudgeDeltaV', progradeMps: deltaVStep(modifiers), radialMps: 0 };
    case 'ArrowDown':
      return { kind: 'nudgeDeltaV', progradeMps: -deltaVStep(modifiers), radialMps: 0 };
    case 'ArrowRight':
      return { kind: 'nudgeDeltaV', progradeMps: 0, radialMps: deltaVStep(modifiers) };
    case 'ArrowLeft':
      return { kind: 'nudgeDeltaV', progradeMps: 0, radialMps: -deltaVStep(modifiers) };

    case '[':
      return { kind: 'scrub', seconds: -scrubNudge(modifiers) };
    case ']':
      return { kind: 'scrub', seconds: scrubNudge(modifiers) };
    case 'Home':
      return { kind: 'scrubTo', where: 'start' };
    case 'End':
      return { kind: 'scrubTo', where: 'deadline' };

    case '+':
    case '=':
      return { kind: 'zoom', factor: KEY_ZOOM_FACTOR };
    case '-':
      return { kind: 'zoom', factor: 1 / KEY_ZOOM_FACTOR };
    case 'f':
    case 'F':
      return { kind: 'recentre' };

    case 'Enter':
      return { kind: 'commit' };
    case 'Escape':
      return { kind: 'cancel' };

    default:
      return null;
  }
};
