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
import { useEffect, useState } from 'preact/hooks';

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

/**
 * Where to put the card: under its anchor, aligned to the anchor's start edge.
 *
 * Under rather than over, because the anchors are things the player is looking at or
 * pointing at, and a card above one covers the thing it is about on a short viewport.
 * Returns `null` when the anchor is not in the document, which is what docks the card.
 */
const measure = (anchor: string): Position | null => {
  const target = document.querySelector<HTMLElement>(`[data-hh-anchor="${anchor}"]`);
  if (target === null) return null;
  const rect = target.getBoundingClientRect();
  // A region that is present but collapsed — a panel on another tab — is not somewhere to
  // point at either, and it measures as a zero box rather than as absent.
  if (rect.width === 0 && rect.height === 0) return null;
  return { x: rect.left, y: rect.bottom + 8 };
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

  useEffect(() => {
    if (anchor === null) {
      setAt(null);
      return undefined;
    }
    const remeasure = (): void => {
      setAt(measure(anchor));
    };
    remeasure();
    window.addEventListener('resize', remeasure);
    return () => {
      window.removeEventListener('resize', remeasure);
    };
  }, [anchor]);

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
        <div class="hh-mark__card" data-testid={`coach-mark-${mark.key}`}>
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
