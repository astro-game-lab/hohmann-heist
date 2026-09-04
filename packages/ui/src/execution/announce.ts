/**
 * What the live region says during playback — #146, §8.8, D8, FR-905.
 *
 * §8.8 requires an `aria-live="polite"` region that announces *"execution milestones"*,
 * and #146 adds the constraint that makes it a design problem rather than a wiring
 * problem:
 *
 * > *Announcements do not flood assistive technology at 10 000×; the announcement
 * > strategy is explicit and tested.*
 *
 * **Explicit** is the operative word. The naïve implementation writes every crossed
 * entry into the live region, which is correct at 1× and unusable above it: at 10 000×
 * a single frame of `c03-cold-open` passes a burn, two apsides and a revolution, and
 * the whole six-hour horizon goes by in two seconds. A screen reader's queue is serial
 * and does not drop anything, so what the player gets is ninety seconds of speech
 * describing a run that finished before it started talking — and no way to interrupt it
 * except leaving the page.
 *
 * ## The strategy
 *
 * Two rules, and they are the whole of it.
 *
 * **1. Some events matter more than others.** A burn firing, the closest approach, the
 * objective being met, entering the atmosphere — those are the milestones §8.8 means.
 * An apsis passage and a revolution are *context*: real, worth having in the log, and
 * not worth interrupting someone to say. So kinds are partitioned into
 * {@link NOTABLE_KINDS} and the rest, and only notable ones are ever spoken
 * individually.
 *
 * **2. A single step announces a bounded number of things.** At most
 * {@link AnnouncementPolicy.maxIndividual} entries, and if more were crossed, one
 * summary line saying how many. The bound is per *step*, not per second, which is the
 * right unit: a step is what the player's chosen speed made happen at once, so the
 * bound scales with the thing that causes the flood rather than fighting it.
 *
 * The result is that the live region says at most `maxIndividual + 1` things per frame
 * at any speed — that is the property `announce.test.ts` asserts at 1×, 1 000× and
 * 100 000×, and it is testable precisely because this module is a pure function of the
 * crossed array rather than something entangled with a DOM node.
 *
 * ## What this deliberately does not do
 *
 * It does not rate-limit by wall-clock time. A time-based throttle would need a clock,
 * would make the output depend on how busy the machine was, and would drop different
 * events on different runs — so the same plan would be described differently to two
 * players. Bounding per step keeps the announcements a function of the run.
 *
 * It also does not decide the words. An {@link Announcement} carries the entry, whose
 * message is a catalogue key (FR-910); the component resolves it. The one string this
 * module implies is the summary count, and that is a key too.
 */
import type { FlightLogKind } from '@hh/game';

import type { TimedEvent } from './playback.js';

/** An event this module can rank: the flight log's entries, and anything shaped like one. */
export interface AnnounceableEvent extends TimedEvent {
  readonly kind: FlightLogKind;
}

/**
 * The kinds worth interrupting someone for — §8.8's "execution milestones".
 *
 * A `Set` for the lookup, built from a literal array so the membership is readable as a
 * list rather than as a series of `||`. Everything absent is context: it stays in the
 * flight log, which is scrollable and navigable, and does not reach the live region on
 * its own.
 *
 * `end` is here because a run finishing is the single most important thing to hear —
 * without it a screen-reader user has no signal that the debrief is now on screen.
 */
export const NOTABLE_KINDS: ReadonlySet<FlightLogKind> = new Set<FlightLogKind>([
  'ignition',
  'burn',
  'constraintEnter',
  'constraintExit',
  'closestApproach',
  'objectiveMet',
  'end',
]);

/** Whether an entry is spoken on its own. */
export const isNotable = (event: AnnounceableEvent): boolean => NOTABLE_KINDS.has(event.kind);

/** How much one step may say. */
export interface AnnouncementPolicy {
  /**
   * Most entries announced individually in one step.
   *
   * Three, which is two facts and a bit of context — about as much as fits in the gap
   * between two frames at a speed a person is actually watching. Raising it does not
   * make a fast run more informative, it makes it slower to listen to.
   */
  readonly maxIndividual: number;
}

/** The policy in use. Exported so a test states the bound it is asserting. */
export const DEFAULT_ANNOUNCEMENT_POLICY: AnnouncementPolicy = Object.freeze({
  maxIndividual: 3,
});

/**
 * One thing to say.
 *
 * A union rather than a string, because the summary is not an entry and pretending it
 * were would mean building a sentence in this package — which is the one thing FR-910
 * forbids everywhere.
 */
export type Announcement<E extends AnnounceableEvent> =
  | { readonly kind: 'entry'; readonly entry: E }
  /** `count` events were crossed and not spoken individually. */
  | { readonly kind: 'summary'; readonly count: number };

/**
 * What to announce for the events one step crossed.
 *
 * Pure, total, and independent of speed: the speed shows up only in how many events
 * arrive here at once, which is exactly the variable the bound is meant to absorb.
 *
 * Notable entries come first and in log order, so the sequence a listener hears is the
 * sequence that happened. The summary, when there is one, comes last — it is a footnote
 * about what was skipped, not an item in the narrative.
 */
export const announcementsFor = <E extends AnnounceableEvent>(
  crossed: readonly E[],
  policy: AnnouncementPolicy = DEFAULT_ANNOUNCEMENT_POLICY,
): readonly Announcement<E>[] => {
  if (crossed.length === 0) return [];

  const notable = crossed.filter(isNotable);
  const spoken = notable.slice(0, Math.max(0, policy.maxIndividual));
  const omitted = crossed.length - spoken.length;

  const announcements: Announcement<E>[] = spoken.map((entry) => ({ kind: 'entry', entry }));
  if (omitted > 0) announcements.push({ kind: 'summary', count: omitted });
  return announcements;
};
