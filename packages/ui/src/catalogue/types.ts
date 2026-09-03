/**
 * The catalogue's contract — FR-910 and NFR-028.
 *
 * > *All user-facing strings MUST come from a message catalogue; none MUST be
 * > constructed by concatenation.*
 *
 * ## A message is a function, not a template string
 *
 * The obvious catalogue is `Record<string, string>` with `{placeholders}` in it. It
 * fails the last of #88's criteria — *"the message shape does not assume English word
 * order or English pluralisation rules"* — in two ways at once, and both are the kind
 * of failure that only shows up when the second language arrives.
 *
 * **Word order.** A template is a string with holes at fixed positions. Translating it
 * means moving the holes, which the format allows, right up until a language needs a
 * parameter *twice*, or needs one parameter's form to depend on another's value. German
 * and Russian both do routinely.
 *
 * **Pluralisation.** English has two plural categories. Arabic has six, Polish has four,
 * Japanese has one. A template engine that handles this grows into a small language of
 * its own — which is what ICU MessageFormat is, and it costs a runtime dependency and a
 * parser.
 *
 * A **function** `(params, fmt) => string` has neither problem. It is code, so it can
 * put its parameters wherever the language wants them, use one twice, branch on
 * `Intl.PluralRules`, and format numbers through `Intl.NumberFormat` for the locale. It
 * costs nothing at runtime — no parser, no dependency — and the compiler checks that
 * every message takes the parameters its key declares.
 *
 * What it gives up is that a message is not extractable to a `.po` file by a script. For
 * a game whose strings are keys in a typed catalogue, that trade is worth making: the
 * translator's unit is the function body, and the type says exactly what is available
 * to it.
 *
 * ## Where the keys come from
 *
 * `@hh/game` declares every key its rules can emit. This package declares the keys the
 * UI owns. The catalogue is a mapped type over the union of both, so **a key with no
 * message, or a message with no key, is a compile error** — which is a stronger
 * statement than the test #88 asks for, and the test is there as well because a
 * compile-time guarantee nobody can see is one refactor from being relaxed.
 */
import type { GameMessageParams, MessageParams } from '@hh/game';

/**
 * Locale-aware formatting, handed to every message.
 *
 * A message never calls `toFixed` or `String(n)`: those produce a period for a decimal
 * separator and no digit grouping, which is wrong in most of Europe. Everything goes
 * through `Intl`, which is in every runtime this project targets and costs no bytes.
 */
export interface MessageFormatters {
  /** A number, with the locale's separators. `options` reaches `Intl.NumberFormat`. */
  readonly number: (value: number, options?: Intl.NumberFormatOptions) => string;
  /** A number rounded to `digits` decimal places. The common case, spelled once. */
  readonly decimal: (value: number, digits: number) => string;
  /** A whole number. */
  readonly integer: (value: number) => string;
  /** The CLDR plural category for `count` in this locale — `one`, `few`, `other`, … */
  readonly plural: (count: number) => Intl.LDMLPluralRule;
  /** A list, joined the way the locale joins lists. */
  readonly list: (items: readonly string[], type?: 'conjunction' | 'disjunction') => string;
  /** Mission elapsed time as `T+HH:MM:SS`, per `@hh/astro`'s `formatMet`. */
  readonly met: (metSeconds: number) => string;
}

/** Keys the UI owns, with their parameters. Rules' keys come from `@hh/game`. */
export interface UiMessageParams {
  readonly 'app.title': Record<string, never>;
  readonly 'app.skeletonNotice': Record<string, never>;
  readonly 'app.routesLabel': Record<string, never>;
  readonly 'app.currentRouteHeading': Record<string, never>;
  readonly 'app.routeName': Record<string, never>;
  readonly 'app.routePath': Record<string, never>;
  readonly 'app.routeParams': Record<string, never>;
  readonly 'app.simulationHeading': Record<string, never>;
  readonly 'app.geoSpeedLabel': Record<string, never>;
  /** The value and its unit, together: a unit is formatting, not a word to append. */
  readonly 'app.geoSpeedValue': { readonly speedMps: number };
  readonly 'app.missionClockLabel': Record<string, never>;
  readonly 'nav.title': Record<string, never>;
  readonly 'nav.board': Record<string, never>;
  readonly 'nav.contract': { readonly index: number };
  readonly 'nav.daily': Record<string, never>;
  readonly 'nav.codex': Record<string, never>;
  readonly 'nav.settings': Record<string, never>;
  readonly 'nav.spike': Record<string, never>;
}

/** Every key in the catalogue: the rules' and the UI's. */
export type AllMessageParams = GameMessageParams & UiMessageParams;

/** Every key. */
export type MessageKey = keyof AllMessageParams;

/** One message: a function of its parameters and the locale's formatters. */
export type MessageFor<P> = (params: P, fmt: MessageFormatters) => string;

/**
 * A complete set of messages for one locale.
 *
 * A mapped type over {@link MessageKey}, which is what makes coverage a compile-time
 * property in both directions: a missing key fails to satisfy the type, and an extra one
 * is an excess property.
 */
export type Messages = {
  readonly [K in MessageKey]: MessageFor<AllMessageParams[K]>;
};

/**
 * What to do about a key that is not in the catalogue.
 *
 * Only reachable for a **dynamic** key — a `briefKey` out of a scenario file, a coach
 * mark — because every statically-known key is checked by the compiler. Which is
 * exactly where it matters: scenario data is the part contributors write (G6).
 */
export type MissingKeyPolicy =
  /** Development: throw, loudly, at the point of use. */
  | 'throw'
  /** Production: render a stable, visible marker. Never a blank string. */
  | 'fallback';

/** Parameters for a key that is not known at compile time. */
export type DynamicParams = MessageParams;
