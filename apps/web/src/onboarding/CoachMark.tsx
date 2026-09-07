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
 * Everything a player can click, so a card can be checked for covering one.
 *
 * Broad on purpose: the rule is about *controls*, not about a list of regions somebody
 * remembered to reserve. The first version of this fix did reserve regions by name, and
 * moved the bug rather than fixing it — the card stopped covering the commit bar and
 * started covering the HUD's own buttons and a plan row instead.
 */
const CONTROLS = 'button, a[href], input, select, textarea, summary, [role="slider"]';

/** Whether two boxes share any pixel. Touching edges do not count. */
const overlaps = (a: DOMRect, b: { x: number; y: number; w: number; h: number }): boolean =>
  a.left < b.x + b.w && a.right > b.x && a.top < b.y + b.h && a.bottom > b.y;

/**
 * Whether a card at this position would cover something the player can click.
 *
 * This is the invariant the whole placement exists to keep, and it is the bug stated
 * directly. The first mark a new player sees is anchored to the orbit view, which reaches
 * to within 8 px of the timeline, so "under the anchor" was exactly on top of the commit
 * bar: `elementFromPoint` at the centre of **Commit plan** returned the card's *More in
 * the Codex* button, and the click could not land at all. A first-time player with a legal
 * plan could not fly it — and coach marks are shown to precisely the players who would not
 * know why.
 *
 * A hint is transient and dismissible; the controls under it are not. When the two want
 * the same pixels, the hint moves.
 */
const coversAControl = (
  card: HTMLElement,
  at: { x: number; y: number; w: number; h: number },
): boolean => {
  for (const el of document.querySelectorAll<HTMLElement>(CONTROLS)) {
    // The card's own buttons are not something it can cover.
    if (card.contains(el)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    if (overlaps(rect, at)) return true;
  }
  return false;
};

/**
 * Where to put the card: under its anchor, aligned to the anchor's start edge.
 *
 * Under rather than over, because the anchors are things the player is looking at or
 * pointing at, and a card above one covers the thing it is about on a short viewport.
 * Returns `null` when nothing works, which is what docks the card.
 *
 * ## Candidates, in order of preference
 *
 * Under the anchor is the preference, not the rule. The card's own box is measured from
 * the rendered element, because §8.3.12's interface scale and §8.9's +40% string length
 * both falsify any constant — and each candidate is tried in turn until one covers no
 * control:
 *
 * 1. **Under the anchor.** The original placement, and still right for a small anchor
 *    with room beneath it.
 * 2. **Above the anchor**, the standard popover flip.
 * 3. **Inside the anchor**, top-left then bottom-left. Only a large region can host a card
 *    at all, and the planner's large region is the orbit view — a card in its corner
 *    covers some canvas, which is a surface rather than a control, and covers no button.
 *
 * Every candidate is clamped to the viewport before it is tested, so what is checked is
 * where the card will actually be rather than where it was asked to go — the CSS clamp
 * would otherwise move it onto something after this had approved it.
 *
 * If none is clear the card docks — the same fallback as an anchor that is not on screen.
 * With the planner fitting the viewport, candidate 3 is clear for the `orbit` anchor and
 * candidate 1 for the small ones, so the fallback is a genuine last resort rather than the
 * usual answer.
 */
const measure = (anchor: string, card: HTMLElement | null): Position | null => {
  const target = document.querySelector<HTMLElement>(`[data-hh-anchor="${anchor}"]`);
  if (target === null || card === null) return null;
  const rect = target.getBoundingClientRect();
  // A region that is present but collapsed — a panel on another tab — is not somewhere to
  // point at either, and it measures as a zero box rather than as absent.
  if (rect.width === 0 && rect.height === 0) return null;

  const { width: w, height: h } = card.getBoundingClientRect();
  if (w === 0 || h === 0) return { x: rect.left, y: rect.bottom + GAP_PX };

  const clamp = (value: number, max: number): number => Math.min(Math.max(value, 8), max);
  const at = (x: number, y: number): { x: number; y: number; w: number; h: number } => ({
    x: clamp(x, Math.max(8, window.innerWidth - w - 8)),
    y: clamp(y, Math.max(8, window.innerHeight - h - 8)),
    w,
    h,
  });

  const candidates = [
    at(rect.left, rect.bottom + GAP_PX),
    at(rect.left, rect.top - GAP_PX - h),
    at(rect.left + GAP_PX, rect.top + GAP_PX),
    at(rect.left + GAP_PX, rect.bottom - GAP_PX - h),
  ];

  for (const candidate of candidates) {
    if (!coversAControl(card, candidate)) return { x: candidate.x, y: candidate.y };
  }
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
      // The card is already in the DOM by the time a layout effect runs — docked, on the
      // first pass — so its box is real. Docked and anchored are the same width and the
      // same height, so what is measured here is what will be placed.
      setAt(measure(anchor, cardRef.current));
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
