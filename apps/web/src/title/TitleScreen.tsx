/**
 * The title screen — §8.3.1, FR-901, #118.
 *
 * > *Purpose: identify the game, get the player into it in one click, and communicate
 * > "real physics" without saying so.*
 *
 * The wordmark is the `<h1>` that `Screen` already renders, and the footer is the shell's
 * too, so this is what sits between them: the tagline, §8.2's five entries, and the live
 * background.
 *
 * ## Two clicks, and they are counted
 *
 * FR-901: *"A first-time player MUST reach the C01 planner within two clicks of the title
 * screen."* §8.3.1 spends the budget deliberately — *"no menus between a stranger and the
 * game"* — so **Start goes straight to the briefing**, not to the board. Start is the first
 * click and Accept is the second. Routing Start to the contract board instead would read as
 * tidier and would cost the requirement.
 *
 * ## Continue is not a second rule
 *
 * *Continue* is `progression().next` (#82) and nothing else — the same value the board puts
 * its `NEXT` marker on. It is absent on a fresh save because there is nothing to resume,
 * and absent again once every unlocked contract is Bronzed, because `next` is `null` there
 * and an entry that led nowhere would be worse than no entry. Both of those are the
 * progression module's answers, not this screen's.
 *
 * ## Daily routes to its placeholder on purpose
 *
 * Daily is M7. §8.2's table is the information architecture, and a route that *resolves* is
 * checkable now — #117's first criterion — whereas an entry that was hidden until its
 * screen existed would make the architecture unobservable until the last milestone that
 * touches it. It goes where it goes and says what it is.
 *
 * Codex is no longer among them: #260 shipped the real thing, so that entry opens the
 * index rather than a placeholder.
 *
 * ## Focus
 *
 * Nothing here steals it. The skip link is first in the document, the `<h1>` is next and is
 * focusable but not tabbable, and the first entry is the first tab stop — so a keyboard
 * player's first Tab lands on *Start* and Enter plays the game. The board (#119) does move
 * focus programmatically, because §8.3.2 asks it to; a title screen has no equivalent
 * reason and taking focus on load would move a player past their browser's own controls.
 */
import type { Catalogue } from '@hh/ui';
import type { PaletteId } from '@hh/ui';
import type { JSX } from 'preact';

import { contracts } from '../contracts/registry.js';
import { hrefFor } from '../router.js';
import { Icon } from '../icons/index.js';

import { TitleBackground } from './TitleBackground.js';

export interface TitleScreenProps {
  readonly t: Catalogue['resolve'];
  readonly resolveDynamic: Catalogue['resolveDynamic'];
  /** #82's `NEXT`: where *Continue* goes, or null when there is nothing to resume. */
  readonly continueId: string | null;
  /** The act `continueId` sits in, for the entry's description. */
  readonly continueAct: number | null;
  readonly palette: PaletteId;
  /** §9.4 and §8.3.12 together: whether the background may move. */
  readonly still: boolean;
  readonly onCanvasUnavailable?: () => void;
}

/** One entry in §8.3.1's list. */
interface Entry {
  readonly id: string;
  readonly href: string;
  readonly label: string;
  readonly detail?: string;
}

export const TitleScreen = ({
  t,
  resolveDynamic,
  continueId,
  continueAct,
  palette,
  still,
  onCanvasUnavailable,
}: TitleScreenProps): JSX.Element => {
  // §8.3.1's "straight into the C01 briefing". The *first contract in play order* rather
  // than the literal id `c01-shakedown`: `contracts()` is already sorted by act and index,
  // and hard-coding the id would make renaming the opening contract a silent dead link.
  const first = contracts()[0];

  const entries: readonly Entry[] = [
    ...(first === undefined
      ? []
      : [
          {
            id: 'start',
            href: hrefFor(`/contract/${first.id}`),
            label: t('title.start', {}),
          },
        ]),
    ...(continueId === null
      ? []
      : [
          {
            id: 'continue',
            href: hrefFor(`/contract/${continueId}`),
            label: t('title.continue', {}),
            ...(continueAct === null
              ? {}
              : { detail: t('title.continueAct', { act: continueAct }) }),
          },
        ]),
    { id: 'daily', href: hrefFor('/daily'), label: t('title.daily', {}) },
    // The index, not an entry. This pointed at `/codex/phasing`, which is not a slug —
    // the nearest real one is `phasing-orbits` — so the front door's Codex entry landed on
    // §8.7's "no such entry" screen. `router.ts` keeps the index as a real route precisely
    // so it can be linked to; a menu item has no business picking one entry out of seven.
    { id: 'codex', href: hrefFor('/codex'), label: t('title.codex', {}) },
    { id: 'settings', href: hrefFor('/settings'), label: t('title.settings', {}) },
  ];

  return (
    <div class="hh-title" data-testid="title-screen">
      <TitleBackground
        palette={palette}
        still={still}
        resolveDynamic={resolveDynamic}
        {...(onCanvasUnavailable === undefined ? {} : { onCanvasUnavailable })}
      />

      <div class="hh-title__content">
        <p class="hh-title__tagline" data-testid="title-tagline">
          {t('title.tagline', {})}
        </p>

        <nav class="hh-title__menu" aria-label={t('title.menuLabel', {})}>
          <ul>
            {entries.map((entry) => (
              <li key={entry.id}>
                <a
                  class="hh-title__entry"
                  href={entry.href}
                  data-testid={`title-${entry.id}`}
                  data-entry={entry.id}
                >
                  {/* §8.3.1's `▸`. Decorative — the entry's text is its name. */}
                  <Icon name="chevron" class="hh-title__marker" />
                  <span class="hh-title__entry-label">{entry.label}</span>
                  {entry.detail === undefined ? null : (
                    <span class="hh-title__entry-detail">{entry.detail}</span>
                  )}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </div>
  );
};
