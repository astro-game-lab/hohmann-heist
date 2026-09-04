/**
 * The flight-log feed — §8.3.8, FR-604, #146, §8.8, D8.
 *
 * §8.3.8 puts this where the plan panel was: two columns, an epoch and a phrase, filling
 * as the run goes. #146 makes it more than a decoration —
 *
 * > *The feed is a DOM list, keyboard navigable and screen-reader friendly (D8). It is
 * > the accessible representation of what the orbit view shows.*
 *
 * — which is §8.8's canvas-parity rule applied to execution. Everything the canvas
 * animates, this says in text: the burns, the apsides, the revolutions, the encounter.
 * A player who cannot see the canvas watches the run here, and misses nothing that the
 * run decided.
 *
 * ## The list is not the live region, and that distinction is the whole design
 *
 * Marking the list `aria-live` is the obvious implementation and it is exactly the flood
 * #146 forbids: every appended entry would be announced, and at 10 000× that is dozens
 * per second into a queue that plays them all, serially, long after the run has ended.
 *
 * So there are **two** things here with two different jobs:
 *
 * - The **list** is the record. It is not live. It fills silently, and a screen-reader
 *   user browses it at their own pace — before, during or after the run.
 * - The **live region** is the narration, and it is fed by `announcementsFor`, which
 *   bounds what one step may say. At 1× that is usually the entry itself; at 10 000× it
 *   is a burn and "39 more events".
 *
 * The record is complete and the narration is bounded. Neither could be both.
 *
 * ## Keyboard navigation without twelve tab stops
 *
 * The list is one focus stop with `tabindex="0"` and scrolls natively from there, rather
 * than every `<li>` being focusable. A hundred-entry run would otherwise put a hundred
 * stops between the flight log and the abort button, which is a keyboard trap in
 * everything but name — NFR-016 asks for every action to be reachable, and reachable
 * means reachable in a sensible number of presses.
 *
 * Arrow keys are not bound in execution (§8.5.3 gives them to the planner), so native
 * scrolling inside the focused list works with no handler here at all.
 */
import type { FlightLogEntry } from '@hh/game';
import type { Catalogue } from '@hh/ui';
import type { Announcement } from '@hh/ui';
import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

export interface FlightLogProps {
  readonly t: Catalogue['resolve'];
  readonly resolveDynamic: Catalogue['resolveDynamic'];
  /** The entries revealed so far, in order. */
  readonly entries: readonly FlightLogEntry[];
  /** What the live region should say for the most recent step. */
  readonly announcements: readonly Announcement<FlightLogEntry>[];
  /** Whether to follow the tail. Off under `prefers-reduced-motion`. */
  readonly autoScroll: boolean;
}

/**
 * One entry's text, resolved.
 *
 * `resolveDynamic` rather than `resolve` because the key is a value on the entry rather
 * than a literal at the call site — the same seam the renderer's labels use. The
 * compiler has already checked that every key `@hh/game` can emit is in the catalogue,
 * so this cannot miss; `resolveDynamic` is the API for a key that is not statically
 * known, not a weaker guarantee.
 */
const textOf = (entry: FlightLogEntry, resolveDynamic: Catalogue['resolveDynamic']): string =>
  resolveDynamic(entry.message.key, entry.message.params);

export const FlightLog = ({
  t,
  resolveDynamic,
  entries,
  announcements,
  autoScroll,
}: FlightLogProps): JSX.Element => {
  const listRef = useRef<HTMLOListElement | null>(null);

  // Follow the tail as the run fills the log, unless the player has asked for less
  // motion — §9.4 makes every transition instant under the preference, and a list that
  // scrolls itself is a transition. `scrollTop` rather than `scrollIntoView`, which
  // would also scroll the page when the list is near its edge.
  useEffect(() => {
    const list = listRef.current;
    if (list === null || !autoScroll) return;
    list.scrollTop = list.scrollHeight;
  }, [entries.length, autoScroll]);

  return (
    <section class="hh-log" data-testid="flight-log">
      <h2 class="hh-log__heading">{t('execution.log.heading', {})}</h2>

      <ol
        class="hh-log__list"
        ref={listRef}
        tabIndex={0}
        aria-label={t('execution.log.label', { count: entries.length })}
        data-testid="flight-log-list"
      >
        {entries.map((entry) => (
          // Keyed by epoch *and* kind: two entries share an epoch whenever a burn sits
          // on an apsis, which DEP-07's snap makes the common case rather than a rarity.
          // Keying on the epoch alone would make Preact reuse one node for both.
          <li
            key={`${String(entry.epoch)}:${entry.kind}`}
            class="hh-log__entry"
            data-kind={entry.kind}
          >
            <span class="hh-log__met">
              {t('planner.hud.met', { metSeconds: entry.metSeconds })}
            </span>
            <span class="hh-log__text">{textOf(entry, resolveDynamic)}</span>
          </li>
        ))}
      </ol>

      {entries.length === 0 ? <p class="hh-log__empty">{t('execution.log.empty', {})}</p> : null}

      {/*
        The narration. Visually hidden because it duplicates the list above — a sighted
        player reads the entries, and repeating the last one beside them would be noise.
        `role="status"` carries an implicit `aria-live="polite"`, which is §8.8's
        requirement: polite waits for a gap rather than interrupting.
      */}
      <p
        class="hh-sr-only"
        role="status"
        aria-label={t('execution.announce.label', {})}
        data-testid="flight-log-announcement"
      >
        {/*
          One element per announcement rather than a joined string. Joining would mean
          building a sentence out of fragments with a separator chosen here, which is
          the concatenation FR-910 exists to prevent — and the separator that reads
          correctly is not the same in every language. Separate elements give a screen
          reader its own natural boundary between them.
        */}
        {announcements.map((announcement, index) => (
          <span key={`${String(index)}:${announcement.kind}`} class="hh-log__announcement">
            {announcement.kind === 'entry'
              ? textOf(announcement.entry, resolveDynamic)
              : t('execution.announce.summary', { count: announcement.count })}
          </span>
        ))}
      </p>
    </section>
  );
};
