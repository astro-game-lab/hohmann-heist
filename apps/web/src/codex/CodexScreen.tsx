/**
 * The `/#/codex` routes — FR-903, §8.2, §8.7 (#161).
 *
 * Three states, and one of them is a failure state that has to be as good as the other
 * two:
 *
 * - **`/#/codex`** — the index.
 * - **`/#/codex/:slug`** — the entry, optionally opened at a layer via `?layer=numbers`.
 * - **`/#/codex/:slug` where the slug names nothing** — §8.7's treatment: say what failed,
 *   in words, and then show the index. Not a 404, and not a blank page. A slug reaches
 *   this from a shared link, an old bookmark, or a debrief written against an entry a
 *   later build renamed, and in all three cases the reader is a person who wanted to read
 *   something and can still be given it.
 *
 * All three work from a **cold load**, which is #161's criterion and is a property of the
 * router rather than of this file: `parseHash` runs before the first render, so there is
 * no moment where the app is mounted at the index and then navigates. `app.tsx` renders
 * whichever of these the hash already named.
 *
 * ## Reading an entry marks it read
 *
 * `flags.codexRead` is written on mount, once per entry, through the same save path
 * everything else uses. An unknown slug marks nothing — there is nothing to mark.
 */
import { isCodexLayer, entryBySlug } from '@hh/ui';
import type { Catalogue, CodexLayer } from '@hh/ui';
import type { JSX } from 'preact';
import { useEffect } from 'preact/hooks';

import { hrefFor } from '../router.js';

import { CodexEntryView } from './CodexEntryView.js';
import { CodexIndex } from './CodexIndex.js';

export interface CodexScreenProps {
  readonly t: Catalogue['resolve'];
  /** The captured `:slug`, or null for the bare index route. */
  readonly slug: string | null;
  /** The route's raw query string — `layer=numbers`. */
  readonly search: string;
  /** `flags.codexRead` from the save. */
  readonly read: readonly string[];
  /** Record that an entry has been read. Called once per mount, for a real entry. */
  readonly onRead: (slug: string) => void;
}

/**
 * The layer a link asks to open, if it asks for one it recognises.
 *
 * `?layer=` is data out of a URL, so an unknown value is ignored rather than refused: the
 * entry is still the thing the reader asked for, and failing the whole navigation over a
 * query parameter would be answering a small question with a big error.
 */
export const layerFrom = (search: string): CodexLayer | undefined => {
  const value = new URLSearchParams(search).get('layer');
  return value !== null && isCodexLayer(value) ? value : undefined;
};

export const CodexScreen = ({ t, slug, search, read, onRead }: CodexScreenProps): JSX.Element => {
  const entry = slug === null ? undefined : entryBySlug(slug);
  const readSlug = entry?.slug ?? null;

  useEffect(() => {
    if (readSlug !== null) onRead(readSlug);
  }, [readSlug, onRead]);

  if (slug === null) return <CodexIndex t={t} read={read} />;

  if (entry === undefined) {
    return (
      <div class="hh-codex" data-testid="codex-unknown">
        <p class="hh-codex__failure">{t('codex.unknown', { slug })}</p>
        <p>{t('codex.unknownHelp', {})}</p>
        <CodexIndex t={t} read={read} />
      </div>
    );
  }

  return (
    <div class="hh-codex">
      <CodexEntryView t={t} entry={entry} openLayer={layerFrom(search)} />
      <a class="hh-codex__back" href={hrefFor('/codex')}>
        {t('codex.backToIndex', {})}
      </a>
    </div>
  );
};
