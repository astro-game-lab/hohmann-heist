/**
 * A coach mark — FR-902, §8.6, §8.8 (#159).
 *
 * > *First-time coach marks: three per contract maximum, in C01–C04 only, dismissible
 * > permanently.* — §8.6
 *
 * ## Not a dialog, and deliberately not written like one
 *
 * `useOverlay`'s modal arm gives an overlay the four things §8.8 asks of a *dialog*: focus
 * moves in, focus is trapped, `Esc` closes, focus returns. A coach mark must have none of
 * the first three, so it is the one overlay in the app that calls neither arm — the third
 * kind `a11y/overlay.ts` names, and `coachMarks.test.tsx` holds it to that. It appears while the player is mid-drag; moving focus would abandon the gesture,
 * and trapping it would make a hint that cannot be ignored — which is a modal, which is
 * exactly what §8.6 says this is not.
 *
 * So what it does instead:
 *
 * - **Announced, not focused.** The container is a persistent `role="status"` region and
 *   the mark's text is swapped into it. Polite: a screen reader finishes the sentence it
 *   is on and then reads the hint, and nothing about the keyboard focus moves.
 * - **In the tab order.** Its two buttons are ordinary buttons, so `Tab` reaches them from
 *   wherever the player is. Nothing is hidden from the keyboard.
 * - **`Esc` while focus is inside it** dismisses it. Not a document-level handler: `Esc`
 *   in the planner already means *back, or close what is open* (§8.5.3), and quietly
 *   inserting a hint at the head of that chain would change what the key does everywhere
 *   for a mark the player may not even be looking at.
 *
 * ## The container is always mounted
 *
 * Even with no mark. A `role="status"` element that is created at the moment its content
 * appears is a live region the assistive technology was not yet observing, and the
 * announcement is lost — the classic way to ship a live region that never speaks. So the
 * region persists and its *contents* change.
 *
 * ## Anchoring, and what happens when the anchor is not there
 *
 * `@hh/ui`'s table names a region — `orbit`, `timeline`, `commit`, `burns`, `readouts` —
 * and each is marked with `data-hh-anchor` where it is drawn. The measured position goes
 * out as custom properties and CSS clamps it to the viewport, which is the arrangement
 * `.hh-editor__anchor` already uses and for the same reason: the clamp stays correct
 * through every resize without a layout read.
 *
 * If the anchor is not on screen — wrong tab, narrow layout, a region this contract does
 * not have — the mark **docks** rather than floating unattached. A hint pointing at
 * nothing is worse than one that is merely nearby.
 */
import type { CodexSlug } from '@hh/game';
import type { Catalogue, MarkSpec } from '@hh/ui';
import type { JSX } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';

export interface CoachMarkProps {
  readonly t: Catalogue['resolve'];
  readonly resolveDynamic: Catalogue['resolveDynamic'];
  /** The mark to show, or `null` for none. The region stays mounted either way. */
  readonly mark: MarkSpec | null;
  readonly onDismiss: () => void;
  readonly onDismissPermanently: () => void;
  /** Open the Codex at the entry this mark is the short version of. */
  readonly onOpenCodex: (slug: CodexSlug) => void;
}

interface Position {
  readonly x: number;
  readonly y: number;
}

/** The gap between a card and the thing it points at. */
const GAP_PX = 8;

/**
 * Regions a card may never cover, whatever its anchor says.
 *
 * The commit bar is the planner's primary action, and the timeline strip is how a burn is
 * placed. A hint is transient and dismissible; the controls under it are not, so when the
 * two want the same pixels the hint moves.
 *
 * This is not belt-and-braces — it is the bug. The first mark a new player sees is
 * anchored to `orbit`, the orbit view reaches to within 8 px of the timeline, and "under
 * the anchor" put the card exactly on top of the commit bar: `elementFromPoint` at the
 * centre of **Commit plan** returned the card's *More in the Codex* button, and a click on
 * *Commit plan* could not land at all. A first-time player with a legal plan could not fly
 * it — and coach marks are shown to precisely the players who would not know why.
 */
const RESERVED_ANCHORS = ['commit', 'timeline'] as const;

/** The top of the highest reserved region below `from`, or the viewport's bottom. */
const floorBelow = (from: number): number => {
  let floor = window.innerHeight;
  for (const name of RESERVED_ANCHORS) {
    const el = document.querySelector<HTMLElement>(`[data-hh-anchor="${name}"]`);
    if (el === null) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    // Only regions that actually start below the card's top can constrain it.
    if (rect.top >= from && rect.top < floor) floor = rect.top;
  }
  return floor;
};

/**
 * Where to put the card: under its anchor, aligned to the anchor's start edge.
 *
 * Under rather than over, because the anchors are things the player is looking at or
 * pointing at, and a card above one covers the thing it is about on a short viewport.
 * Returns `null` when the anchor is not in the document, which is what docks the card.
 *
 * ## Flip, then dock
 *
 * Under the anchor is the preference, not the rule. `cardHeight` is measured from the
 * rendered card, so this knows whether the card actually fits in the space under the
 * anchor before the reserved regions begin — and if it does not, it tries above the
 * anchor, and docks if that fails too. Docking already exists for an anchor that is not on
 * screen; a screen with no room for the card is the same situation from the card's point
 * of view.
 *
 * A card anchored *to* a reserved region is placed under it as usual: `floorBelow` only
 * considers regions starting below the card, so the commit bar does not block a mark that
 * is about the commit bar.
 */
const measure = (anchor: string, cardHeight: number): Position | null => {
  const target = document.querySelector<HTMLElement>(`[data-hh-anchor="${anchor}"]`);
  if (target === null) return null;
  const rect = target.getBoundingClientRect();
  // A region that is present but collapsed — a panel on another tab — is not somewhere to
  // point at either, and it measures as a zero box rather than as absent.
  if (rect.width === 0 && rect.height === 0) return null;

  const below = rect.bottom + GAP_PX;
  if (below + cardHeight <= floorBelow(below)) return { x: rect.left, y: below };

  const above = rect.top - GAP_PX - cardHeight;
  if (above >= 0) return { x: rect.left, y: above };

  return null;
};

/**
 * The *More in the Codex* button, or nothing.
 *
 * Its own component so the slug is a **prop** rather than a field read inside a closure:
 * `mark.codex` is optional, and a callback that reads it later is a callback TypeScript
 * cannot narrow, which is how this ends up with a cast in it.
 */
const CodexLink = ({
  t,
  slug,
  onOpen,
}: {
  readonly t: Catalogue['resolve'];
  readonly slug: CodexSlug | undefined;
  readonly onOpen: (slug: CodexSlug) => void;
}): JSX.Element | null =>
  slug === undefined ? null : (
    <button
      type="button"
      class="hh-mark__codex"
      data-testid="coach-mark-codex"
      onClick={() => {
        onOpen(slug);
      }}
    >
      {t('coachMark.readMore', {})}
    </button>
  );

export const CoachMark = ({
  t,
  resolveDynamic,
  mark,
  onDismiss,
  onDismissPermanently,
  onOpenCodex,
}: CoachMarkProps): JSX.Element => {
  const [at, setAt] = useState<Position | null>(null);
  const anchor = mark?.anchor ?? null;
  /**
   * The card, so its height can be measured.
   *
   * Placement needs it: whether there is room under the anchor is a question about the
   * card, and answering it with a constant would be a guess that §8.3.12's interface scale
   * and §8.9's +40% string length both falsify. Read in a layout effect, before paint, so
   * the card is never seen in the wrong place first.
   */
  const cardRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (anchor === null) {
      setAt(null);
      return undefined;
    }
    const remeasure = (): void => {
      // Zero before the first paint, which resolves to "under the anchor" — the same
      // answer as before — and is corrected on the pass that follows.
      setAt(measure(anchor, cardRef.current?.getBoundingClientRect().height ?? 0));
    };
    remeasure();
    window.addEventListener('resize', remeasure);
    return () => {
      window.removeEventListener('resize', remeasure);
    };
    // `mark.key` too: a different hint on the same anchor is a different height.
  }, [anchor, mark?.key]);

  return (
    <div
      class="hh-mark"
      role="status"
      aria-label={t('coachMark.label', {})}
      data-testid="coach-mark"
      data-anchored={at !== null}
      style={
        at === null
          ? undefined
          : { '--hh-mark-x': `${String(at.x)}px`, '--hh-mark-y': `${String(at.y)}px` }
      }
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || mark === null) return;
        // Scoped to focus-within by virtue of being a container handler: a key event only
        // reaches it if something inside has focus. See the module docstring.
        event.stopPropagation();
        onDismiss();
      }}
    >
      {mark === null ? null : (
        <div class="hh-mark__card" ref={cardRef} data-testid={`coach-mark-${mark.key}`}>
          <p class="hh-mark__text">{resolveDynamic(mark.key)}</p>
          <div class="hh-mark__actions">
            <button type="button" data-testid="coach-mark-dismiss" onClick={onDismiss}>
              {t('coachMark.dismiss', {})}
            </button>
            <button
              type="button"
              class="hh-mark__forever"
              data-testid="coach-mark-forever"
              onClick={onDismissPermanently}
            >
              {t('coachMark.dismissPermanently', {})}
            </button>
            <CodexLink t={t} slug={mark.codex} onOpen={onOpenCodex} />
          </div>
        </div>
      )}
    </div>
  );
};
