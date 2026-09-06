/**
 * "The Codex for the *current concept*" — §8.5.3's `C` (#161).
 *
 * §8.5.3 binds `C` everywhere and says it opens the Codex *for the current concept*.
 * Deciding what that means is this file, and it is the part of #161 that is a judgement
 * rather than a mechanism.
 *
 * ## A contract has one concept, and it is the one §6.12 says it teaches
 *
 * The obvious implementation derives it: an entry declares the contracts it is *seen in*,
 * so the concept for a contract is the entry that names it. That is wrong for exactly the
 * contracts it matters for. C02 is seen in *Burns and apsides* and in *The Hohmann
 * transfer*, and §6.12's outcome for C02 is the second one — the first is C01's, still
 * being used. Deriving would open the entry the player has already read.
 *
 * So the mapping is written down, once, from §6.12's own table. It is seven rows, it is
 * the teaching plan restated, and `current.test.ts` checks each row against the entry's
 * `seenIn` so the table cannot claim a contract the entry does not mention.
 *
 * ## Off a contract, `C` opens the index
 *
 * The title, the board, settings: there is no current concept, and the honest answer is
 * the whole Codex rather than an arbitrary entry. `null` here means "the index".
 */
import type { CodexSlug } from '@hh/game';

/**
 * §6.12's teaching plan, as a lookup. One row per contract that has an outcome.
 *
 * C06 shares C05's concept deliberately — §6.12 gives it no outcome of its own, and
 * *"Everything you learned on the last one still applies, and every sign of it is the
 * other way round"* is that entry read backwards, not a different idea.
 */
const CONCEPT_BY_CONTRACT: Readonly<Record<string, CodexSlug>> = Object.freeze({
  'c01-shakedown': 'burns-and-apsides',
  'c02-round-trip': 'the-hohmann-transfer',
  'c03-cold-open': 'departure-timing',
  'c04-long-haul': 'the-cost-of-altitude',
  'c05-tailgate': 'phasing-orbits',
  'c06-overtake': 'phasing-orbits',
  'c07-slot-machine': 'the-delta-v-time-trade',
});

/**
 * The concept for a contract, or `null` for the index.
 *
 * `null` in, `null` out: a screen with no contract has no concept, and so does a contract
 * this build ships without an entry for — a state that cannot occur today and would be a
 * missing row rather than a reason to open something irrelevant.
 */
export const conceptFor = (contractId: string | null): CodexSlug | null =>
  contractId === null ? null : (CONCEPT_BY_CONTRACT[contractId] ?? null);

/** The table itself, for the test that checks it against the entries. */
export const CONCEPTS: Readonly<Record<string, CodexSlug>> = CONCEPT_BY_CONTRACT;
