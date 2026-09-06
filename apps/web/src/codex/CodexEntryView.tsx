/**
 * One Codex entry, in four progressively disclosed layers — FR-903, FR-904, §8.3.10 (#161).
 *
 * > *Each entry has four layers, progressively disclosed: **the sentence** (P1), **the
 * > diagram** (everyone), **the numbers** (P2), **what we simplify** (P2/G3).*
 *
 * ## Disclosure, not navigation
 *
 * The last two layers are `<details>`. Opening one reveals it in place: the URL does not
 * change, the scroll position does not jump, and the reader who wanted the sentence still
 * has the sentence above them. That is what §8.3.10 means by *progressive disclosure*, and
 * it is why this is not a tab strip — tabs would take the sentence away to show the
 * derivation, which is the wrong trade for the reader who is following a link from a
 * debrief.
 *
 * `<details>` rather than a hand-rolled disclosure for the ordinary reason: it is
 * keyboard-operable, announced with its state, and findable by the browser's own in-page
 * search even while closed. A `<div>` with an `onClick` is none of those without work.
 *
 * ## Which layers are open is data, and a deep link can change it
 *
 * `OPEN_BY_DEFAULT` decides the default and `openLayer` overrides it for one layer, which
 * is how `#/codex/phasing-orbits?layer=numbers` opens *at the numbers* — #161's
 * *"including into a specific layer"*. The override adds; it never closes something that
 * would otherwise be open.
 *
 * ## The diagram is a slot, and it says what it is
 *
 * §8.3.10 wants a live simulation. #162 builds one, at M4. So the slot renders a labelled
 * placeholder rather than a picture, and the label is the honest part: a static drawing in
 * the space reserved for "real sim, scrubs with a slider" would be claiming something the
 * build cannot do. #162 replaces this one component and changes no entry.
 */
import { departureById } from '@hh/game';
import { CODEX_LAYERS, OPEN_BY_DEFAULT, resolveNumbers } from '@hh/ui';
import type { Catalogue, CodexEntry, CodexLayer } from '@hh/ui';
import type { JSX } from 'preact';

import { contractById } from '../contracts/registry.js';
import { PHYSICS_URL } from '../links.js';

export interface CodexEntryViewProps {
  readonly t: Catalogue['resolve'];
  readonly entry: CodexEntry;
  /** A layer to open beyond the defaults — the `?layer=` deep link. */
  readonly openLayer?: CodexLayer | undefined;
}

const LAYER_HEADINGS = {
  sentence: 'codex.layer.sentence',
  diagram: 'codex.layer.diagram',
  numbers: 'codex.layer.numbers',
  simplifications: 'codex.layer.simplifications',
} as const satisfies Record<CodexLayer, string>;

/**
 * §8.3.10's *"Seen in"*, resolved through the shipped contracts.
 *
 * An id that names no shipped contract is dropped rather than printed raw. `entries` is
 * checked against the registry by test, so this cannot happen in a build that passes CI —
 * and if it somehow does, a cross-reference to a contract that is not there is worth less
 * than the line it would occupy.
 */
const SeenIn = ({ t, entry }: { t: Catalogue['resolve']; entry: CodexEntry }): JSX.Element => {
  const labels = entry.seenIn
    .map((id) => contractById(id))
    .filter((scenario) => scenario !== undefined)
    .map((scenario) =>
      t('codex.contractLabel', {
        index: scenario.document.index,
        title: scenario.document.title,
      }),
    );

  return (
    <p class="hh-codex__seen" data-testid="codex-seen-in">
      {labels.length === 0 ? t('codex.seenInNone', {}) : t('codex.seenIn', { contracts: labels })}
    </p>
  );
};

export const CodexEntryView = ({ t, entry, openLayer }: CodexEntryViewProps): JSX.Element => {
  const isOpen = (layer: CodexLayer): boolean =>
    OPEN_BY_DEFAULT.includes(layer) || openLayer === layer;

  return (
    <article class="hh-codex-entry" data-testid={`codex-entry-${entry.slug}`}>
      <header class="hh-codex-entry__header">
        <h2>{t(entry.titleKey, {})}</h2>
        <p class="hh-codex-entry__subtitle">{t(entry.subtitleKey, {})}</p>
      </header>

      {/* Layer one. Not a `<details>`: it is the entry, for most readers. */}
      <p class="hh-codex-entry__sentence" data-testid="codex-layer-sentence">
        {t(entry.sentenceKey, {})}
      </p>

      {/* Layer two — #162's slot. */}
      <figure class="hh-codex-entry__diagram" data-testid="codex-layer-diagram">
        <figcaption>{t(LAYER_HEADINGS.diagram, {})}</figcaption>
        <p class="hh-codex-entry__pending">{t('codex.diagramPending', {})}</p>
      </figure>

      {/* Layer three. Every number in it is computed — see `@hh/ui`'s `figures.ts`. */}
      <details open={isOpen('numbers')} data-testid="codex-layer-numbers">
        <summary>{t(LAYER_HEADINGS.numbers, {})}</summary>
        <p>{resolveNumbers(entry, t)}</p>
        <p class="hh-codex-entry__real">{t(entry.realWorldKey, {})}</p>
      </details>

      {/* Layer four — FR-904. Ids resolved through the registry, never re-described. */}
      <details open={isOpen('simplifications')} data-testid="codex-layer-simplifications">
        <summary>{t(LAYER_HEADINGS.simplifications, {})}</summary>
        <ul class="hh-codex-entry__departures">
          {entry.departures.map((id) => {
            const departure = departureById(id);
            return departure === undefined ? null : (
              <li key={id}>{t('codex.departure', { id, summary: departure.summary })}</li>
            );
          })}
        </ul>
        <a class="hh-codex-entry__physics" href={PHYSICS_URL}>
          {t('codex.physicsLink', {})}
        </a>
      </details>

      <SeenIn t={t} entry={entry} />
    </article>
  );
};

/** Every layer, for the test that asserts each one renders. */
export const LAYERS: readonly CodexLayer[] = CODEX_LAYERS;
