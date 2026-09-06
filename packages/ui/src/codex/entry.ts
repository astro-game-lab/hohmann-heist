/**
 * What a Codex entry *is* — FR-903, FR-904, §8.3.10 (#161).
 *
 * > *Each entry has four layers, progressively disclosed: **the sentence** (P1), **the
 * > diagram** (everyone), **the numbers** (P2), **what we simplify** (P2/G3).*
 *
 * ## An entry is data, and that is the acceptance criterion
 *
 * #161 asks that *"adding one requires no change to the framework"*. So an entry declares
 * a slug, an act, its five catalogue keys, the departures it rests on, the contracts it is
 * seen in, and its figures — and nothing else. Its **words are not here**: every layer's
 * text is a catalogue key, which is what keeps FR-910 true and what lets a translator work
 * on an entry without touching this table.
 *
 * The diagram is the exception that proves it: §8.3.10 wants a live simulation, #162
 * builds one, and #162 is M4. So an entry declares no diagram at all and the view renders
 * a **labelled** placeholder. An entry does not change when the real diagram arrives.
 *
 * ## The keys are spelled out, and the types spell them for you
 *
 * Deriving them — `codex.${slug}.title` at the call site — would be shorter and is wrong
 * twice over. `tools/guardrails/catalogue.test.ts` finds an unused message by searching
 * the source for its key, and a key that only ever exists as a template expression is a
 * key that check reports as dead; and the first thing anyone does with an entry is grep
 * for the words it renders.
 *
 * So each entry writes its five keys out, and each field's *type* is the literal it must
 * hold — `codex.${S}.title` for that entry's own `S`. There is exactly one string that
 * satisfies it, so the redundancy costs nothing and cannot drift.
 */
import type { CodexSlug, DepartureId } from '@hh/game';

import type { AllMessageParams, MessageKey } from '../catalogue/types.js';

/** §8.3.10's four layers, in disclosure order. */
export type CodexLayer = 'sentence' | 'diagram' | 'numbers' | 'simplifications';

/**
 * The layers, in order.
 *
 * The first two are open on arrival and the last two are collapsed — §8.3.10's
 * *"progressively disclosed"*, and {@link OPEN_BY_DEFAULT} is where that is decided rather
 * than in a component's `useState`, so a deep link into a layer and the default state read
 * the same table.
 */
export const CODEX_LAYERS: readonly CodexLayer[] = Object.freeze([
  'sentence',
  'diagram',
  'numbers',
  'simplifications',
]);

/** The layers a reader sees without asking. §8.3.10: the sentence, and the picture. */
export const OPEN_BY_DEFAULT: readonly CodexLayer[] = Object.freeze(['sentence', 'diagram']);

/** Whether `value` names a layer. Applied to the `?layer=` deep link, which is data. */
export const isCodexLayer = (value: string): value is CodexLayer =>
  (CODEX_LAYERS as readonly string[]).includes(value);

/**
 * One entry.
 *
 * Distributed over the slug, so every field that mentions the slug is checked against
 * *this* entry's slug: the five keys, and `figures`, whose type is the parameter type of
 * this entry's numbers message. A figure the message never mentions, or one it mentions
 * that the entry does not compute, is a compile error — which is the mechanism underneath
 * #163's *"every number … derived from `@hh/astro`'s constants, not copied from
 * `docs/PRODUCT.md`"*, with `figures.test.ts` checking the arithmetic itself.
 */
export type CodexEntry = {
  readonly [S in CodexSlug]: {
    readonly slug: S;
    /** §6.8's act, for the index's grouping. */
    readonly act: number;
    /** §8.3.10's header — the concept's name, in the game's voice. */
    readonly titleKey: `codex.${S}.title`;
    /** The line under it: what the entry is *about*, in five or six words. */
    readonly subtitleKey: `codex.${S}.subtitle`;
    /** Layer one. One sentence, and the whole entry for most readers. */
    readonly sentenceKey: `codex.${S}.sentence`;
    /** Layer three. Takes {@link figures}; every number in it is computed. */
    readonly numbersKey: `codex.${S}.numbers`;
    /** §8.3.10's *"In the real world"*. Correct, and cited where it is a claim. */
    readonly realWorldKey: `codex.${S}.realWorld`;
    /**
     * FR-904's departures, by DEP id, resolved through `@hh/game`'s registry.
     *
     * Ids rather than prose, so an entry cannot describe a simplification differently from
     * the way `docs/PHYSICS.md` does. The registry is the single description, and
     * `entries.test.ts` fails on an id that is not in it.
     */
    readonly departures: readonly DepartureId[];
    /** §8.3.10's *"Seen in"* — scenario ids, checked against the shipped contracts. */
    readonly seenIn: readonly string[];
    readonly figures: AllMessageParams[`codex.${S}.numbers`];
  };
}[CodexSlug];

/** An entry for one specific slug, where the slug is known. */
export type CodexEntryOf<S extends CodexSlug> = Extract<CodexEntry, { readonly slug: S }>;

/** Every key an entry uses, for the test that checks all five resolve. */
export const keysOf = (entry: CodexEntry): readonly MessageKey[] => [
  entry.titleKey,
  entry.subtitleKey,
  entry.sentenceKey,
  entry.numbersKey,
  entry.realWorldKey,
];

/**
 * Resolve an entry's *numbers* layer.
 *
 * The one place a cast is needed, and for the same reason `resolve.ts`'s `resolveMessage`
 * needs one: `CodexEntry` pairs each slug with its own figure type, and `numbersKey` is
 * indexed by the same slug — but TypeScript cannot see the two sides line up while the
 * slug is still a union. Every other layer takes no parameters and resolves directly.
 *
 * What makes this safe rather than merely quiet is that both sides are derived from the
 * one `S`: `figures` *is* `AllMessageParams[numbersKey]` by construction, so there is no
 * pairing left for the cast to get wrong.
 */
export const resolveNumbers = (
  entry: CodexEntry,
  resolve: <K extends MessageKey>(key: K, params: AllMessageParams[K]) => string,
): string =>
  (resolve as (key: MessageKey, params: unknown) => string)(entry.numbersKey, entry.figures);
