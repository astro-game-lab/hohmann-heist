/**
 * The Codex, over the planner — §8.5.3's `C`, §8.8, FR-903 (#161).
 *
 * ## Why an overlay exists at all, when there is a perfectly good route
 *
 * `usePlanner` holds the plan in component state. Navigating from the planner to
 * `#/codex/…` unmounts the planner, and coming back mounts a fresh one — which would make
 * *"reading an entry mid-plan does not lose the plan"* false in the most direct way
 * possible. Persisting the plan to survive the trip would mean giving the planner a
 * session store to solve a problem that only exists because the reader left.
 *
 * So `C` opens the entry **here**, over the planner, and the planner keeps running behind
 * it. `#/codex/:slug` remains a real route for a cold load, a shared link and the debrief's
 * diagnosis link, and both hosts render the same {@link CodexEntryView}: one entry
 * component, two ways in, and no second implementation to keep in step.
 *
 * "Returns the player where they were on close" then costs nothing — they never left —
 * and focus returns to whatever opened it, which is `useOverlay`'s job and the same
 * contract the settings and help overlays already meet.
 *
 * ## This one *is* a dialog, unlike a coach mark
 *
 * A coach mark appears unbidden beside what the player is doing, so it must not take
 * focus. This is opened deliberately, is the thing the player is now reading, and covers
 * the screen — so it takes focus, traps it while open, closes on `Esc`, and gives focus
 * back. §8.8's four rules, from `useOverlay` rather than written a fourth time.
 */
import { entryBySlug } from '@hh/ui';
import type { Catalogue, CodexLayer } from '@hh/ui';
import type { JSX } from 'preact';
import { useEffect } from 'preact/hooks';

import { useOverlay } from '../a11y/overlay.js';

import { CodexEntryView } from './CodexEntryView.js';
import { codexIndexHref } from './CodexIndex.js';

export interface CodexOverlayProps {
  readonly t: Catalogue['resolve'];
  /** The entry to show. An unknown slug renders the named failure, as the route does. */
  readonly slug: string;
  readonly openLayer?: CodexLayer | undefined;
  readonly onRead: (slug: string) => void;
  readonly onClose: () => void;
}

export const CodexOverlay = ({
  t,
  slug,
  openLayer,
  onRead,
  onClose,
}: CodexOverlayProps): JSX.Element => {
  const ref = useOverlay<HTMLDivElement>({ modal: true, onClose });
  const entry = entryBySlug(slug);
  const readSlug = entry?.slug ?? null;

  useEffect(() => {
    if (readSlug !== null) onRead(readSlug);
  }, [readSlug, onRead]);

  return (
    <div class="hh-codex-overlay" data-testid="codex-overlay">
      <div
        class="hh-codex-overlay__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hh-codex-heading"
        ref={ref}
      >
        <header class="hh-codex-overlay__header">
          <h2 id="hh-codex-heading">{t('codex.heading', {})}</h2>
          <button type="button" data-testid="codex-overlay-close" onClick={onClose}>
            {t('codex.close', {})}
          </button>
        </header>

        {entry === undefined ? (
          <div data-testid="codex-overlay-unknown">
            <p class="hh-codex__failure">{t('codex.unknown', { slug })}</p>
            <p>{t('codex.unknownHelp', {})}</p>
          </div>
        ) : (
          <CodexEntryView t={t} entry={entry} openLayer={openLayer} />
        )}

        {/*
          The way out to the full Codex. A link rather than a second navigation control:
          following it leaves the planner, which is the player's decision to make
          deliberately, and a link is the affordance that says so.
        */}
        <a class="hh-codex-overlay__index" href={codexIndexHref()}>
          {t('codex.backToIndex', {})}
        </a>
      </div>
    </div>
  );
};
