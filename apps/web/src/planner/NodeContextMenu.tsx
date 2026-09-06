/**
 * §8.5.2's node context menu — delete, snap to periapsis, snap to apoapsis, zero Δv (#136).
 *
 * > *right-click a node → delete, snap to periapsis, snap to apoapsis, zero Δv* — §8.5.2
 * > *long-press on touch, same menu* — §8.5.4
 *
 * The planner had no context menu at all before this. What it had was four operations
 * scattered across three surfaces: delete on the plan panel's row and on `Delete`, the two
 * snaps only inside §8.3.5's overlay, and zero Δv nowhere.
 *
 * ## It is DOM, not canvas — §8.8
 *
 * The menu is positioned over the orbit view but is an ordinary list of buttons, because
 * §8.8's canvas-parity rule means every action available by clicking has a DOM path. That
 * is also what makes it keyboard-reachable without a second implementation: `Menu` opens
 * it at the selected node's own screen position, `Tab` and the arrow keys move through it,
 * `Enter` activates, and `Esc` closes it and puts focus back where it came from.
 *
 * ## Focus is taken, and given back
 *
 * NFR-016 and §8.8 both forbid a keyboard trap, and a menu is where one is easiest to
 * build by accident. Three things prevent it here: focus moves to the first item on open
 * so a keyboard user is not left behind on the canvas, `Esc` and a completed action both
 * restore focus to the element that opened the menu, and the arrow keys wrap rather than
 * dead-ending. Nothing here calls `preventDefault` on `Tab` — a player who tabs out of the
 * menu leaves it, which is an exit rather than a trap, and the menu closes behind them.
 *
 * ## Why the snap entries can be absent
 *
 * A near-circular orbit has no apsides (`APSIS_ECCENTRICITY_FLOOR`), and every Act I
 * contract starts on one — so this is the common case, not the edge case. `snapToNamedApsis`
 * answers `null` there and the caller passes `available: false`, which renders the entry
 * disabled with a reason rather than hiding it. Hidden would be worse: a menu whose entries
 * come and go teaches a player that the game is inconsistent, where a disabled entry with
 * "this orbit is circular — it has no apsides" teaches them something true about orbits.
 */
import type { Catalogue } from '@hh/ui';
import type { JSX } from 'preact';
import { useEffect } from 'preact/hooks';

import { useOverlay } from '../a11y/overlay.js';

/** Where the menu is anchored, in stage pixels. */
export interface MenuPosition {
  readonly x: number;
  readonly y: number;
}

export interface NodeContextMenuProps {
  readonly t: Catalogue['resolve'];
  readonly at: MenuPosition;
  /** Which node the menu is acting on, for the accessible name. */
  readonly nodeIndex: number;
  /** Whether this orbit has apsides to snap to — see the docstring. */
  readonly apsidesAvailable: boolean;
  readonly onSnap: (kind: 'periapsis' | 'apoapsis') => void;
  readonly onZeroDeltaV: () => void;
  readonly onDelete: () => void;
  /** Close without acting. Restores focus to whatever opened the menu. */
  readonly onClose: () => void;
}

const ITEM_SELECTOR = 'button:not([disabled])';

export const NodeContextMenu = ({
  t,
  at,
  nodeIndex,
  apsidesAvailable,
  onSnap,
  onZeroDeltaV,
  onDelete,
  onClose,
}: NodeContextMenuProps): JSX.Element => {
  /*
   * §8.8's overlay policy, from `a11y/overlay.ts` rather than written here (#169).
   *
   * Focus moves to the first item on open — without that a keyboard user who pressed
   * `Menu` would have opened something they then could not reach without tabbing through
   * the page — and is returned to the opener on close.
   *
   * **Non-modal, and the markup already said so.** This is a `role="menu"` popup rather
   * than a `role="dialog"`, it dismisses on a press anywhere outside, and `Tab` should
   * leave it rather than cycle inside it. Trapping four items would be the keyboard trap
   * §8.8 forbids, wearing the costume of the rule that forbids it.
   *
   * Restoring matters most for **Delete**, which is the case #169 calls out: the item
   * removes the node whose row opened this menu, so the opener is detached by the time the
   * menu closes. `restoreFocus` lands on the screen heading rather than on `<body>`.
   *
   * `Esc` stays below rather than coming from the hook, because it must also
   * `stopPropagation` — `PlannerScreen`'s cascade checks the menu first, and this handler
   * is what makes that arm unnecessary while focus is still inside the menu.
   */
  const menuRef = useOverlay<HTMLDivElement>({ modal: false });

  // A press anywhere else dismisses, which is what every other menu on the platform does.
  // `pointerdown` rather than `click`, so the menu is gone before the press it was
  // dismissed by can also select a node behind it.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      const menu = menuRef.current;
      if (menu === null) return;
      // Phrased as "not inside" rather than "is an element outside", because a target that
      // is not a `Node` at all — the window itself — is also not inside the menu, and the
      // first phrasing quietly treats that case as a press *within* the menu and leaves it
      // open. That is not hypothetical: it is what the dismissal test caught.
      const inside = event.target instanceof Node && menu.contains(event.target);
      if (!inside) onClose();
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
    };
  }, [onClose]);

  const move = (delta: number): void => {
    const menu = menuRef.current;
    if (menu === null) return;
    const items = [...menu.querySelectorAll<HTMLButtonElement>(ITEM_SELECTOR)];
    if (items.length === 0) return;
    const active = items.findIndex((item) => item === document.activeElement);
    const from = active === -1 ? 0 : active;
    // `+ items.length` before the modulo, so stepping up from the first item wraps to the
    // last rather than producing a negative index. Neither end is a place to get stuck.
    const next = items[(from + delta + items.length) % items.length];
    next?.focus();
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        onClose();
        break;
      case 'ArrowDown':
        event.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        move(-1);
        break;
      default:
        break;
    }
  };

  const item = (
    testId: string,
    label: string,
    onActivate: () => void,
    disabled = false,
    describedBy?: string,
  ): JSX.Element => (
    <button
      type="button"
      role="menuitem"
      class="hh-node-menu__item"
      data-testid={testId}
      disabled={disabled}
      {...(describedBy === undefined ? {} : { 'aria-describedby': describedBy })}
      onClick={() => {
        onActivate();
        onClose();
      }}
    >
      {label}
    </button>
  );

  const reasonId = 'hh-node-menu-no-apsides';

  return (
    <div
      class="hh-node-menu"
      ref={menuRef}
      role="menu"
      aria-label={t('planner.nodeMenu.label', { index: nodeIndex + 1 })}
      data-testid="node-menu"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      style={{ '--hh-menu-x': `${String(at.x)}px`, '--hh-menu-y': `${String(at.y)}px` }}
    >
      {item(
        'node-menu-periapsis',
        t('planner.nodeMenu.snapPeriapsis', {}),
        () => {
          onSnap('periapsis');
        },
        !apsidesAvailable,
        apsidesAvailable ? undefined : reasonId,
      )}
      {item(
        'node-menu-apoapsis',
        t('planner.nodeMenu.snapApoapsis', {}),
        () => {
          onSnap('apoapsis');
        },
        !apsidesAvailable,
        apsidesAvailable ? undefined : reasonId,
      )}
      {apsidesAvailable ? null : (
        <p class="hh-node-menu__reason" id={reasonId} data-testid="node-menu-no-apsides">
          {t('planner.nodeMenu.noApsides', {})}
        </p>
      )}
      {item('node-menu-zero', t('planner.nodeMenu.zeroDeltaV', {}), onZeroDeltaV)}
      {item('node-menu-delete', t('planner.nodeMenu.delete', {}), onDelete)}
    </div>
  );
};
