/**
 * The Codex index — §8.3.10, §8.7 (#161).
 *
 * Every entry, grouped by the act it belongs to, with the contracts it is seen in.
 *
 * ## Grouped from the entries, not from a second list
 *
 * #161's criterion is that the index is *"derived from the entry data rather than
 * hand-maintained"*. So the grouping is `entriesByAct()` and the act's name is
 * `board.actName` — the same string the contract board prints — which means an entry that
 * declares `act: 3` appears under Act III because it said so, and no one has to remember
 * to add it here. A hand-kept index is a list that is right on the day it is written.
 *
 * ## Read is a mark, not a filter
 *
 * `flags.codexRead` shows as a badge and changes nothing else. An entry the player has
 * read is still listed, still in the same place, still linkable — the flag exists so the
 * board and the coach marks can stop *suggesting* one, not so the Codex can start hiding
 * things from the person who read them.
 */
import { entriesByAct } from '@hh/ui';
import type { Catalogue, CodexEntry } from '@hh/ui';
import type { JSX } from 'preact';

import { hrefFor } from '../router.js';

export interface CodexIndexProps {
  readonly t: Catalogue['resolve'];
  /** `flags.codexRead` from the save. */
  readonly read: readonly string[];
}

/** The route for an entry. Also what a coach mark and a debrief diagnosis link to. */
export const codexHref = (slug: string): string => hrefFor(`/codex/${slug}`);

/** The route for the index. */
export const codexIndexHref = (): string => hrefFor('/codex');

const EntryRow = ({
  t,
  entry,
  read,
}: {
  readonly t: Catalogue['resolve'];
  readonly entry: CodexEntry;
  readonly read: boolean;
}): JSX.Element => (
  <li class="hh-codex-index__row">
    <a
      class="hh-codex-index__link"
      href={codexHref(entry.slug)}
      data-testid={`codex-index-${entry.slug}`}
    >
      {t(entry.titleKey, {})}
    </a>
    <span class="hh-codex-index__subtitle">{t(entry.subtitleKey, {})}</span>
    {read ? (
      <span class="hh-codex-index__read" data-testid={`codex-read-${entry.slug}`}>
        {t('codex.read', {})}
      </span>
    ) : null}
  </li>
);

export const CodexIndex = ({ t, read }: CodexIndexProps): JSX.Element => (
  <div class="hh-codex-index" data-testid="codex-index">
    <p class="hh-codex-index__intro">{t('codex.intro', {})}</p>
    {entriesByAct().map(([act, entries]) => (
      <section key={act} class="hh-codex-index__act">
        <h2>{t('board.actName', { act })}</h2>
        <ul>
          {entries.map((entry) => (
            <EntryRow key={entry.slug} t={t} entry={entry} read={read.includes(entry.slug)} />
          ))}
        </ul>
      </section>
    ))}
  </div>
);
