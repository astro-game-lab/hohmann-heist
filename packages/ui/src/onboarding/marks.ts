/**
 * The coach-mark catalogue — FR-902, §6.6, §8.6, §8.3.3 (#159, #160).
 *
 * A scenario declares its marks as bare catalogue keys (§11.5's `coachMarks`), and that is
 * all a contract should have to know: which ideas it wants named. *Where* a mark points
 * and *when* it appears are properties of the idea rather than of the contract, so they
 * live here beside the key, and a contract stays data.
 *
 * That split is what #160's *"no per-contract code"* means in practice. Adding a mark is a
 * row in this table, a string in `en.ts`, and a key in a `.json` file — three data edits
 * and no component change.
 *
 * ## Why the anchor is a name and not a selector
 *
 * A mark points at a region of the planner: the trajectory, the timeline, the commit bar,
 * the burn counter, the readouts. Naming those five means the framework can look one up
 * with `[data-hh-anchor="…"]` and a content author never writes a CSS selector — a
 * selector in content is a selector that breaks silently the next time the markup moves,
 * and it would put DOM knowledge into a table that is otherwise portable.
 *
 * The set is closed for the same reason the trigger vocabulary is: five regions is what
 * §8.3.4's screen has, and a sixth anchor should be a deliberate act.
 *
 * ## The cap lives with the content, not here
 *
 * FR-902's *"at most three per contract, C01–C04 only"* is a property of the **scenario
 * files**, so `tools/content` enforces it there. This table is keyed by mark, and a mark
 * does not know which contract declared it.
 */
import type { CodexSlug } from '@hh/game';

import type { MessageKey } from '../catalogue/types.js';

import type { MarkTrigger } from './triggers.js';

/**
 * A coach mark's key: the subset of the catalogue that names one.
 *
 * Derived from the catalogue rather than declared separately, so a mark string added to
 * `en.ts` without a row below — or a row below with no string — is a compile error. #160's
 * content and #159's framework cannot drift apart.
 */
export type MarkKey = Extract<MessageKey, `mark.${string}`>;

/**
 * Where a mark points. One of §8.3.4's regions, by name.
 *
 * `apps/web` puts the matching `data-hh-anchor` on each. A mark whose anchor is not on the
 * screen it fires on simply does not show — see `useCoachMarks` — rather than floating
 * unattached, because a hint pointing at nothing is worse than no hint.
 */
export type MarkAnchor =
  /** §8.3.4's orbit view — the trajectory and its nodes. */
  | 'orbit'
  /** The timeline strip along the bottom. */
  | 'timeline'
  /** The commit bar and its reasons. */
  | 'commit'
  /** The HUD's burn counter — where a burn-count cap is visible. */
  | 'burns'
  /** The readouts panel, including closest approach. */
  | 'readouts';

/** Every anchor, for the test that asserts `apps/web` provides all of them. */
export const MARK_ANCHORS: readonly MarkAnchor[] = Object.freeze([
  'orbit',
  'timeline',
  'commit',
  'burns',
  'readouts',
]);

export interface MarkSpec {
  readonly key: MarkKey;
  readonly anchor: MarkAnchor;
  readonly trigger: MarkTrigger;
  /**
   * The Codex entry this mark is the one-line version of — FR-903, §8.3.10.
   *
   * Optional, and most marks have one. A mark says the concept's name in the voice of the
   * contract; the entry is where a player who wants the derivation goes. #163 writes the
   * entries; this is the link #160 is allowed to make without writing one.
   */
  readonly codex?: CodexSlug;
}

/**
 * Every mark in the game — eight, across C01–C04.
 *
 * Two per contract rather than FR-902's ceiling of three. §8.3.3's model for this voice is
 * *"Don't overthink the direction you burn"*: a nudge, not a manual. Each contract carries
 * the one idea §6.12 says it teaches, plus one that names where to *look* for it — and the
 * second is the one that would be a tooltip in a worse game.
 *
 * Frozen and ordered. The order is the order a contract's marks are offered in, and
 * `useCoachMarks` shows the first eligible one, so an earlier row is the earlier moment.
 */
export const MARKS: Readonly<Record<MarkKey, MarkSpec>> = Object.freeze({
  // ── C01 Shakedown — a prograde burn raises the opposite side ───────────────
  'mark.c01.oppositeSide': {
    key: 'mark.c01.oppositeSide',
    anchor: 'orbit',
    trigger: 'firstNode',
    codex: 'burns-and-apsides',
  },
  'mark.c01.commit': {
    key: 'mark.c01.commit',
    anchor: 'commit',
    trigger: 'planLegal',
  },

  // ── C02 Round Trip — a transfer is two burns, half a period apart ──────────
  'mark.c02.secondBurn': {
    key: 'mark.c02.secondBurn',
    anchor: 'timeline',
    trigger: 'onePlanNotEnough',
    codex: 'the-hohmann-transfer',
  },
  'mark.c02.apoapsis': {
    key: 'mark.c02.apoapsis',
    anchor: 'orbit',
    trigger: 'firstNode',
    codex: 'burns-and-apsides',
  },

  // ── C03 Cold Open — the transfer must arrive when the target is there ──────
  'mark.c03.departureWindow': {
    key: 'mark.c03.departureWindow',
    anchor: 'timeline',
    trigger: 'planEmpty',
    codex: 'departure-timing',
  },
  'mark.c03.closestApproach': {
    key: 'mark.c03.closestApproach',
    anchor: 'readouts',
    trigger: 'firstNode',
    codex: 'departure-timing',
  },

  // ── C04 Long Haul — scale, and the burn-count cap ──────────────────────────
  'mark.c04.scale': {
    key: 'mark.c04.scale',
    anchor: 'orbit',
    trigger: 'planEmpty',
    codex: 'the-cost-of-altitude',
  },
  'mark.c04.burnCap': {
    key: 'mark.c04.burnCap',
    anchor: 'burns',
    trigger: 'firstNode',
  },
});

/** Every mark key, in declaration order. */
export const MARK_KEYS: readonly MarkKey[] = Object.freeze(Object.keys(MARKS) as MarkKey[]);

/** FR-902's ceiling. Enforced against the scenario files by `tools/content`. */
export const MAX_MARKS_PER_CONTRACT = 3;

/** Look up a mark declared by a scenario. `undefined` for a key with no row. */
export const markByKey = (key: string): MarkSpec | undefined =>
  Object.hasOwn(MARKS, key) ? MARKS[key as MarkKey] : undefined;
