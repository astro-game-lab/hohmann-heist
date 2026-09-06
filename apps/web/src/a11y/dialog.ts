/**
 * The four things a dialog owes a keyboard user — §8.8, NFR-016, NFR-017 (#169's rule).
 *
 * > *Focus moves into it on open, is trapped while it is open, `Esc` closes it, and focus
 * > returns to whatever opened it.*
 *
 * Written once because it is needed twice in this PR — the settings overlay and the help
 * overlay — and because the failure mode is silent: a dialog that forgets to restore focus
 * leaves a keyboard user at the top of the document with no idea anything closed, and
 * nothing about the page looks wrong. `NodeContextMenu` already does this by hand for a
 * menu; a third hand-written copy is where the three would start to differ.
 *
 * ## The trap is a wrap, not a block
 *
 * `Tab` past the last focusable element moves to the first, and `Shift+Tab` before the
 * first moves to the last. What it never does is `preventDefault` and leave focus where it
 * was — that is a dialog a player can neither use nor leave, which is the thing §8.8
 * forbids rather than the thing it asks for. `Esc` is always the way out, and it is
 * handled here rather than by each caller so it cannot be forgotten.
 *
 * ## Why the focusable set is read at each press
 *
 * A dialog's contents change while it is open — the remapper grows a swap/cancel pair when
 * a conflict appears, the Data group grows a confirmation. A set captured on open would
 * trap focus into the elements that existed then, and the new buttons would be
 * unreachable: the exact bug the trap is supposed to prevent, introduced by the trap.
 */
import type { Ref } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

/**
 * What counts as focusable.
 *
 * Explicitly excludes `[tabindex="-1"]`, which is how a "you are here" target like
 * `Screen`'s heading is marked — programmatically focusable, deliberately not in the tab
 * order — and disabled controls, which a browser skips anyway but which
 * `querySelectorAll` would happily return.
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const focusableWithin = (root: HTMLElement): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    // Hidden elements match the selector and cannot take focus; `offsetParent` is null for
    // anything `display: none`, which is what the visually-hidden file input is not (it is
    // clipped, not hidden) — so this keeps that reachable while skipping the truly absent.
    (element) => element.offsetParent !== null || element.tabIndex >= 0,
  );

export interface DialogOptions {
  /** Called for `Esc`. The caller decides what closing means — often a navigation. */
  readonly onClose: () => void;
  /** False while the dialog is not showing, so the hook can be called unconditionally. */
  readonly open?: boolean;
}

/**
 * Wire a dialog's focus behaviour. Returns the ref to put on its root element.
 *
 * The opener is captured from `document.activeElement` at open rather than passed in:
 * every caller would otherwise have to hold a ref to a button it does not otherwise care
 * about, and the browser already knows the answer.
 */
export const useDialog = <T extends HTMLElement = HTMLElement>({
  onClose,
  open = true,
}: DialogOptions): Ref<T> => {
  // Generic over the element so a caller can put the ref straight onto its `<div>` without
  // a cast — `Ref<HTMLElement>` is not assignable to `Ref<HTMLDivElement>`, and a cast at
  // every call site is a cast nobody reads after the first one.
  const ref = useRef<T | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const root = ref.current;
    if (root === null) return undefined;

    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    // Into the first focusable thing, or onto the dialog itself if it has none — a dialog
    // with nothing to focus is still a thing a screen reader should be reading, and
    // leaving focus outside it would announce the page behind.
    const first = focusableWithin(root)[0];
    if (first === undefined) {
      root.tabIndex = -1;
      root.focus();
    } else {
      first.focus();
    }

    return () => {
      // Only if focus is still inside — a close that already moved focus somewhere
      // deliberate (a route change, an element the action created) should not be undone.
      if (root.contains(document.activeElement)) opener.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;

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

    // On the document, because focus may legitimately be on the dialog root itself rather
    // than on a child, and a listener on the root would miss `Tab` from there.
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose, open]);

  return ref;
};
