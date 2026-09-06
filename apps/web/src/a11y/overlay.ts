/**
 * One focus policy for every overlay in the app — §8.8, NFR-016, NFR-017 (#169).
 *
 * §8.8 asks for a *"visible focus ring, never suppressed. Logical tab order. No keyboard
 * traps."* Half of that is a stylesheet rule and half of it is this file: what happens to
 * focus when something opens over the screen, and — the half that actually strands people
 * — what happens to it when that something goes away.
 *
 * Written once because M3 opens six of these, and because the failure mode is silent. An
 * overlay that forgets to restore focus leaves a keyboard user at the top of the document
 * with no idea anything closed, and nothing about the page looks wrong. Three hand-written
 * copies is where three would start to differ; this is the copy they share.
 *
 * ## Three kinds, and the app has all three
 *
 * The mistake this module exists to make impossible is treating every overlay as a dialog.
 *
 * - **Modal** — `role="dialog" aria-modal="true"`: the help overlay, settings, the Codex.
 *   The screen behind is inert, so focus moves in, is trapped, `Esc` closes, and focus
 *   returns to the opener. All four, from here.
 * - **Non-modal** — the node editor (`role="group"`), the settings confirmation
 *   (`aria-modal="false"`), the node context menu (`role="menu"`). The screen behind stays
 *   live and interactive, so focus moves in and is *restored* on close, but is never
 *   trapped: tabbing straight back out to the rest of the screen is the correct behaviour
 *   rather than a leak.
 * - **Announce-only** — a coach mark (`role="status"`, #159). It neither takes focus nor
 *   holds it. It uses none of this, deliberately, and `coachMarks.test.tsx` asserts that it
 *   does not: a hint that yanked focus out of the control it is pointing at would be worse
 *   than no hint.
 *
 * ## Why `Esc` is a modal-only option, and is spelled in the type
 *
 * The obvious API gives every overlay an `onClose` and closes it on `Esc`. That is wrong
 * here, and the planner is where it breaks: `keys.ts` binds `Escape` to `cancel` on
 * *every* screen, and `PlannerScreen` runs an explicit innermost-first cascade with it —
 * menu, then editor, then the selection. A non-modal overlay that also listened on the
 * document would fire alongside that cascade, from a listener that cannot see what else is
 * open and cannot know it is second in line.
 *
 * So a non-modal overlay's `Esc` belongs to whoever can order it, and {@link OverlayOptions}
 * is a union rather than a struct with an optional field: `modal: false` has no `onClose`
 * to pass, so the wrong arrangement does not typecheck rather than merely being discouraged.
 *
 * ## The trap is a wrap, not a block
 *
 * `Tab` past the last focusable element moves to the first, and `Shift+Tab` before the
 * first moves to the last. What it never does is `preventDefault` and leave focus where it
 * was — that is a dialog a player can neither use nor leave, which is the thing §8.8
 * forbids rather than the thing it asks for. `Esc` is always the way out.
 *
 * ## Why the focusable set is read at each press
 *
 * A dialog's contents change while it is open — the remapper grows a swap/cancel pair when
 * a conflict appears, the Data group grows a confirmation. A set captured on open would
 * trap focus into the elements that existed then, and the new buttons would be
 * unreachable: the exact bug the trap is supposed to prevent, introduced by the trap.
 */
import { useEffect, useRef, type MutableRef } from 'preact/hooks';

import { focusableWithin, restoreFocus } from './focus.js';

interface OverlayCommon {
  /** False while the overlay is not showing, so the hook can be called unconditionally. */
  readonly open?: boolean;
  /**
   * Where focus should land on open, when the first focusable element is the wrong answer.
   *
   * The node editor's is its heading: focus lands on the text that names what just opened,
   * rather than on whichever stepper button happens to be first in the markup. A structural
   * type rather than Preact's `Ref`, so any of the three ref flavours a caller might already
   * be holding is accepted without a cast.
   */
  readonly initialFocus?: { readonly current: HTMLElement | null };
}

/** A modal overlay: inert behind, trapped, `Esc` closes. */
export interface ModalOverlayOptions extends OverlayCommon {
  readonly modal: true;
  /** Called for `Esc`. The caller decides what closing means — often a navigation. */
  readonly onClose: () => void;
}

/**
 * A non-modal overlay: live behind, never trapped, and `Esc` is not this hook's business.
 *
 * See the module docstring — the caller owns `Esc` because only the caller knows what else
 * is open and which of them a player pressing it meant.
 */
export interface NonModalOverlayOptions extends OverlayCommon {
  readonly modal: false;
}

export type OverlayOptions = ModalOverlayOptions | NonModalOverlayOptions;

/**
 * Wire an overlay's focus behaviour. Returns the ref to put on its root element.
 *
 * The opener is captured from `document.activeElement` at open rather than passed in:
 * every caller would otherwise have to hold a ref to a button it does not otherwise care
 * about, and the browser already knows the answer. What the browser does *not* know is
 * whether that element still exists by the time the overlay closes — see `restoreFocus`.
 */
export const useOverlay = <T extends HTMLElement = HTMLElement>(
  options: OverlayOptions,
): MutableRef<T | null> => {
  const { modal, open = true, initialFocus } = options;
  // Read outside the effect so the dependency is the function rather than the union, and
  // null for a non-modal overlay because there is nothing for `Esc` to call.
  const onClose = options.modal ? options.onClose : null;

  // Generic over the element so a caller can put the ref straight onto its `<div>` without
  // a cast — `Ref<HTMLElement>` is not assignable to `Ref<HTMLDivElement>`, and a cast at
  // every call site is a cast nobody reads after the first one.
  //
  // Returned as the mutable ref rather than as `Ref<T>` so a caller that needs to *read*
  // the element gets one ref rather than two. The context menu is why: its arrow-key
  // roving walks its own items, and a second ref alongside this one would be a second
  // thing to attach and a second thing to forget.
  const ref = useRef<T | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const root = ref.current;
    if (root === null) return undefined;

    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // The requested target, the first focusable thing, or the overlay itself if it has
    // none — an overlay with nothing to focus is still a thing a screen reader should be
    // reading, and leaving focus outside it would announce the page behind.
    const target = initialFocus?.current ?? focusableWithin(root)[0];
    if (target === undefined) {
      root.tabIndex = -1;
      root.focus();
    } else {
      target.focus();
    }

    return () => {
      /*
       * Restore when focus is still inside the overlay, or when it has already fallen to
       * `<body>` — the browser puts it there the moment a focused element is detached, and
       * an overlay closed by having its contents removed can reach this point that way.
       *
       * A close that moved focus somewhere *deliberate* — a route change, an element the
       * action created — put it on a real element, and that case falls through untouched.
       * `<body>` is not a destination anyone chooses.
       *
       * Note that `restoreFocus` cannot finish the job from here: at this instant the
       * opener may still be attached and be removed later in the same commit. It has a
       * settle-time check for exactly that, and `focus.ts` records what was measured.
       */
      const active = document.activeElement;
      if (root.contains(active) || active === null || active === document.body) {
        restoreFocus(opener.current);
      }
    };
    // `initialFocus` is a ref and never changes identity; listing it would re-run the
    // effect on every render of a caller that builds one inline, which is a focus steal
    // rather than a dependency.
  }, [open]);

  useEffect(() => {
    if (!open || !modal || onClose === null) return undefined;

    const onKeyDown = (event: KeyboardEvent): void => {
      const root = ref.current;
      if (root === null) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'Tab') return;
      const focusable = focusableWithin(root);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (first === undefined || last === undefined) return;

      const active = document.activeElement;
      if (event.shiftKey && (active === first || !root.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    // On the document, because focus may legitimately be on the overlay root itself rather
    // than on a child, and a listener on the root would miss `Tab` from there.
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [modal, onClose, open]);

  return ref;
};
