/**
 * The entries — FR-903, FR-904, §6.12, §8.3.10 (#163).
 *
 * One per §6.12 learning outcome, and the record is **total over `CodexSlug`**, so
 * FR-903's *"one entry per learning outcome"* is checked by the compiler rather than by a
 * reviewer counting. Adding an outcome means adding a slug in `@hh/game`, and a slug with
 * no entry does not build.
 *
 * ## Seven, not six
 *
 * §6.12's Acts I–II outcomes are six — C01–C05 and C07. `rendezvous-versus-intercept` is
 * C08's, and it is here anyway because {@link diagnose}'s C08 rule already links it: a
 * debrief that says *"read this"* and lands on a named failure is worse than one Act III
 * entry arriving a milestone early. #164 writes the rest of Acts III–IV.
 *
 * ## What the layers are for, and how they are written
 *
 * **The sentence** is the whole entry for most readers — §8.3.10's standard is *"To catch
 * something ahead of you in the same orbit, you burn retrograde — you slow down."* One
 * sentence, answering the outcome, with the other three layers closed.
 *
 * **The numbers** carry real arithmetic and none of it is typed in: every value comes from
 * `figures.ts`, which computes it from `@hh/astro`'s constants with the same solvers the
 * game plans with. §7.6's process rule is why — `docs/PRODUCT.md` is an input to be
 * checked, not a source to copy from — and `figures.test.ts` is where each one is checked
 * against an independent derivation.
 *
 * **In the real world** grounds the concept in something that actually happens, and says
 * so only where it is true.
 *
 * **What we simplify** is a list of DEP ids, resolved through `@hh/game`'s registry
 * (FR-904). No entry describes a departure in its own words.
 */
import type { CodexSlug } from '@hh/game';

import type { CodexEntry } from './entry.js';
import {
  BURNS_AND_APSIDES_FIGURES,
  COST_OF_ALTITUDE_FIGURES,
  DEPARTURE_TIMING_FIGURES,
  HOHMANN_FIGURES,
  PHASING_FIGURES,
  RENDEZVOUS_FIGURES,
  TRADE_FIGURES,
} from './figures.js';

/**
 * Every entry, keyed by slug.
 *
 * The order is reading order — act, then the contract that teaches it — and the index
 * groups by `act` rather than re-deriving it, so §8.3.10's grouping and this table cannot
 * disagree.
 */
export const CODEX_ENTRIES: Readonly<Record<CodexSlug, CodexEntry>> = Object.freeze({
  // ── Act I ─────────────────────────────────────────────────────────────────
  'burns-and-apsides': {
    slug: 'burns-and-apsides',
    act: 1,
    titleKey: 'codex.burns-and-apsides.title',
    subtitleKey: 'codex.burns-and-apsides.subtitle',
    sentenceKey: 'codex.burns-and-apsides.sentence',
    numbersKey: 'codex.burns-and-apsides.numbers',
    realWorldKey: 'codex.burns-and-apsides.realWorld',
    // DEP-01: the burn is instant, so "where you burn" is a point rather than an arc.
    // DEP-10: the axis the player pushes along is called prograde, and is transverse.
    departures: ['DEP-01', 'DEP-10'],
    seenIn: ['c01-shakedown', 'c02-round-trip'],
    figures: BURNS_AND_APSIDES_FIGURES,
  },
  'the-hohmann-transfer': {
    slug: 'the-hohmann-transfer',
    act: 1,
    titleKey: 'codex.the-hohmann-transfer.title',
    subtitleKey: 'codex.the-hohmann-transfer.subtitle',
    sentenceKey: 'codex.the-hohmann-transfer.sentence',
    numbersKey: 'codex.the-hohmann-transfer.numbers',
    realWorldKey: 'codex.the-hohmann-transfer.realWorld',
    departures: ['DEP-01', 'DEP-02'],
    seenIn: ['c02-round-trip', 'c04-long-haul'],
    figures: HOHMANN_FIGURES,
  },
  'departure-timing': {
    slug: 'departure-timing',
    act: 1,
    titleKey: 'codex.departure-timing.title',
    subtitleKey: 'codex.departure-timing.subtitle',
    sentenceKey: 'codex.departure-timing.sentence',
    numbersKey: 'codex.departure-timing.numbers',
    realWorldKey: 'codex.departure-timing.realWorld',
    // DEP-09 belongs here specifically: the lead angle is a statement about *when*, and
    // when is quantised to 1/1024 s.
    departures: ['DEP-01', 'DEP-09'],
    seenIn: ['c03-cold-open'],
    figures: DEPARTURE_TIMING_FIGURES,
  },
  'the-cost-of-altitude': {
    slug: 'the-cost-of-altitude',
    act: 1,
    titleKey: 'codex.the-cost-of-altitude.title',
    subtitleKey: 'codex.the-cost-of-altitude.subtitle',
    sentenceKey: 'codex.the-cost-of-altitude.sentence',
    numbersKey: 'codex.the-cost-of-altitude.numbers',
    realWorldKey: 'codex.the-cost-of-altitude.realWorld',
    departures: ['DEP-01', 'DEP-02'],
    seenIn: ['c04-long-haul'],
    figures: COST_OF_ALTITUDE_FIGURES,
  },

  // ── Act II ────────────────────────────────────────────────────────────────
  'phasing-orbits': {
    slug: 'phasing-orbits',
    act: 2,
    titleKey: 'codex.phasing-orbits.title',
    subtitleKey: 'codex.phasing-orbits.subtitle',
    sentenceKey: 'codex.phasing-orbits.sentence',
    numbersKey: 'codex.phasing-orbits.numbers',
    realWorldKey: 'codex.phasing-orbits.realWorld',
    // DEP-08 is not incidental here. The cheapest phasing orbit for a large angle in few
    // revolutions has its periapsis underground, and the floor is what says so.
    departures: ['DEP-01', 'DEP-02', 'DEP-08'],
    seenIn: ['c05-tailgate', 'c06-overtake'],
    figures: PHASING_FIGURES,
  },
  'the-delta-v-time-trade': {
    slug: 'the-delta-v-time-trade',
    act: 2,
    titleKey: 'codex.the-delta-v-time-trade.title',
    subtitleKey: 'codex.the-delta-v-time-trade.subtitle',
    sentenceKey: 'codex.the-delta-v-time-trade.sentence',
    numbersKey: 'codex.the-delta-v-time-trade.numbers',
    realWorldKey: 'codex.the-delta-v-time-trade.realWorld',
    // DEP-12: the trade has a par on both axes, and par is the best known rather than the
    // proven optimum — which is exactly the caveat a player comparing two answers needs.
    departures: ['DEP-02', 'DEP-08', 'DEP-12'],
    seenIn: ['c06-overtake', 'c07-slot-machine'],
    figures: TRADE_FIGURES,
  },

  // ── Act III, early — see the module docstring ─────────────────────────────
  'rendezvous-versus-intercept': {
    slug: 'rendezvous-versus-intercept',
    act: 3,
    titleKey: 'codex.rendezvous-versus-intercept.title',
    subtitleKey: 'codex.rendezvous-versus-intercept.subtitle',
    sentenceKey: 'codex.rendezvous-versus-intercept.sentence',
    numbersKey: 'codex.rendezvous-versus-intercept.numbers',
    realWorldKey: 'codex.rendezvous-versus-intercept.realWorld',
    departures: ['DEP-03', 'DEP-04'],
    seenIn: ['c03-cold-open', 'c05-tailgate'],
    figures: RENDEZVOUS_FIGURES,
  },
});

/** Look up an entry by a slug that came from a URL. `undefined` for anything else. */
export const entryBySlug = (slug: string): CodexEntry | undefined =>
  Object.hasOwn(CODEX_ENTRIES, slug) ? CODEX_ENTRIES[slug as CodexSlug] : undefined;

/**
 * The entries grouped by act, in reading order — §8.3.10's index.
 *
 * Derived rather than hand-maintained, which is #161's criterion: an entry that declares
 * `act: 3` appears under Act III without anyone editing a second list.
 */
export const entriesByAct = (): readonly (readonly [
  act: number,
  entries: readonly CodexEntry[],
])[] => {
  const acts = new Map<number, CodexEntry[]>();
  for (const entry of Object.values(CODEX_ENTRIES)) {
    const list = acts.get(entry.act);
    if (list === undefined) acts.set(entry.act, [entry]);
    else list.push(entry);
  }
  return [...acts.entries()].sort(([a], [b]) => a - b);
};
