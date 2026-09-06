/**
 * Where focus is allowed to land — §8.8, NFR-016, NFR-017 (#169).
 *
 * The three things every screen and every overlay in the app agree about, kept here so
 * they are agreed *once*: what counts as focusable, and where focus goes when the thing
 * that had it is gone.
 *
 * ## The fallback is the whole point of this module
 *
 * An overlay that restores focus to whatever opened it is correct until the opener stops
 * existing, and then it is the bug it was written to prevent. The node editor is the case
 * #169 names: it is opened from a node's row in the plan panel, and deleting that node
 * closes the editor and removes the row in the same commit. `opener.focus()` on a detached
 * element is not an error — it is a silent no-op that leaves focus on `<body>`, which is
 * the top of the document with no announcement and no way back except tabbing the whole
 * screen again.
 *
 * So restoring is a *chain*, not a call, and its last real rung is the screen heading:
 * the one element every screen has, already focusable for exactly this reason (`Screen`
 * gives it `tabIndex={-1}`), and already where a route change puts focus. A player whose
 * opener vanished ends up where a player who just arrived would be, which is a place that
 * makes sense rather than a place that merely is not a crash.
 */

/**
 * The screen heading's id — the skip link's target, the route change's focus target, and
 * {@link restoreFocus}'s fallback.
 *
 * Here rather than in `Screen.tsx` because three unrelated modules need to agree on it and
 * only one of them renders it. One id rather than one per screen is safe because the
 * router keys `Screen` by route, so exactly one is mounted at a time.
 */
export const CONTENT_HEADING_ID = 'hh-content';

/**
 * What counts as focusable.
 *
 * Explicitly excludes `[tabindex="-1"]`, which is how a "you are here" target like the
 * screen heading is marked — programmatically focusable, deliberately not in the tab
 * order — and disabled controls, which a browser skips anyway but which
 * `querySelectorAll` would happily return.
 */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Every focusable descendant, in tab order, skipping the ones a browser would not reach. */
export const focusableWithin = (root: HTMLElement): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    // Hidden elements match the selector and cannot take focus; `offsetParent` is null for
    // anything `display: none`, which is what the visually-hidden file input is not (it is
    // clipped, not hidden) — so this keeps that reachable while skipping the truly absent.
    (element) => element.offsetParent !== null || element.tabIndex >= 0,
  );

/** The last real rung of the chain below, and the skip link's destination. */
const focusContentHeading = (): void => {
  document.getElementById(CONTENT_HEADING_ID)?.focus();
};

/**
 * Put focus back after an overlay closes: the opener, the screen heading, or nowhere.
 *
 * `isConnected` rather than a `document.contains` call or a null check, because the
 * question is exactly "is this element still in the document" and a removed element is
 * still a perfectly valid object holding a perfectly valid `focus` method that does
 * nothing.
 *
 * The last rung does nothing at all rather than reaching for `document.body`. A screen
 * with no heading is a bug elsewhere, and focusing the body is what the browser already
 * did — pretending that was a decision would hide it.
 */
export const restoreFocus = (opener: HTMLElement | null): void => {
  if (opener?.isConnected === true) opener.focus();
  else focusContentHeading();

  /*
   * ## The settle-time check, and why `isConnected` above is not enough on its own
   *
   * This is the part that was measured rather than reasoned about, and the reasoning would
   * have got it wrong.
   *
   * The case is the node editor closed by deleting its node. At the moment the overlay's
   * cleanup runs, the opener — the deleted node's row in the plan panel — is **still
   * attached**: Preact tears the overlay down before it removes the rest of the subtree.
   * So `isConnected` is true, focus goes to the row, and the row is then removed a few
   * lines later inside the same commit. The browser drops focus to `<body>`, and every
   * check above has already run and reported success.
   *
   * A microtask runs after the commit finishes, which is the first moment the DOM is the
   * shape the player will actually meet. If focus has come to rest nowhere by then, it is
   * sent to the heading. The condition is deliberately narrow — only `<body>` and nothing
   * else — so a focus move that anything else made on purpose in between is never undone.
   */
  queueMicrotask(() => {
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    focusContentHeading();
  });
};
