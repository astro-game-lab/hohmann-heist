/**
 * Resolving a key to a string — FR-910.
 *
 * ## Two ways in, because there are two kinds of key
 *
 * **Static keys** are the ones in the source: a legality reason, a loader error, a
 * heading. The compiler already knows they exist — `Messages` is a mapped type over
 * every declared key — so {@link Catalogue.resolve} cannot be called with a key that is
 * missing, and cannot be called with the wrong parameters for the key it was given.
 * There is no runtime failure mode to design for.
 *
 * **Dynamic keys** are the ones in the data: a scenario's `briefKey`, its `coachMarks`
 * (D14, §11.5). Those come out of a JSON file a contributor wrote, so they can name
 * anything at all, and {@link Catalogue.resolveDynamic} is where the missing-key policy
 * actually applies.
 *
 * ## Loud in development, stable in production, never blank
 *
 * A missing key must never render as an empty string — an empty label is a UI that
 * looks finished and is not, and it is the one failure mode that survives review.
 *
 * So the policy is a **parameter**, not an ambient check. `throw` in development turns a
 * missing brief key into an error at the point of use, with the key in the message.
 * `fallback` in production renders `⟦brief.c05⟧`: visible, unmistakable, greppable, and
 * stable across reloads.
 *
 * Passing it in rather than reading `import.meta.env.DEV` here is deliberate. That
 * global is Vite's, and this package is plain TypeScript that also runs under Node in
 * tests; reading a bundler's global would make the package depend on the bundler and
 * make both branches untestable. `apps/web` reads `import.meta.env.DEV` — which is its
 * job, it being the composition layer — and passes the answer in.
 */
import { formatMet, met } from '@hh/astro';
import type { GameMessage } from '@hh/game';

import { en } from './en.js';
import type {
  AllMessageParams,
  DynamicParams,
  MessageFormatters,
  MessageKey,
  Messages,
  MissingKeyPolicy,
} from './types.js';

/** The default locale, and the only one with a message set today. */
export const DEFAULT_LOCALE = 'en';

/** How a missing dynamic key renders under the `fallback` policy. */
export const missingKeyFallback = (key: string): string => `⟦${key}⟧`;

/**
 * Build the formatters for a locale.
 *
 * The `Intl` objects are constructed once per catalogue rather than per call:
 * `Intl.NumberFormat` is expensive to construct and cheap to reuse, and a message
 * resolved inside a render loop should not be allocating one.
 */
const createFormatters = (locale: string): MessageFormatters => {
  const plain = new Intl.NumberFormat(locale);
  const integer = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const plurals = new Intl.PluralRules(locale);
  const conjunction = new Intl.ListFormat(locale, { type: 'conjunction' });
  const disjunction = new Intl.ListFormat(locale, { type: 'disjunction' });
  const decimals = new Map<number, Intl.NumberFormat>();

  return {
    number: (value, options) =>
      options === undefined
        ? plain.format(value)
        : new Intl.NumberFormat(locale, options).format(value),
    decimal: (value, digits) => {
      let formatter = decimals.get(digits);
      if (formatter === undefined) {
        formatter = new Intl.NumberFormat(locale, {
          minimumFractionDigits: digits,
          maximumFractionDigits: digits,
        });
        decimals.set(digits, formatter);
      }
      return formatter.format(value);
    },
    integer: (value) => integer.format(value),
    plural: (count) => plurals.select(count),
    list: (items, type = 'conjunction') =>
      (type === 'disjunction' ? disjunction : conjunction).format(items),
    met: (metSeconds) => formatMet(met(metSeconds)),
  };
};

/** A resolved catalogue for one locale. */
export interface Catalogue {
  readonly locale: string;
  /** Every key this catalogue answers, in a stable order. What the rot tests read. */
  readonly keys: readonly MessageKey[];
  readonly formatters: MessageFormatters;
  // Function-valued properties rather than method shorthand, so that pulling one off
  // the catalogue -- `const t = catalogue.resolve` -- is not a `this` hazard, which is
  // exactly how a component wants to use it.
  /** Resolve a key known at compile time. Cannot fail. */
  readonly resolve: <K extends MessageKey>(key: K, params: AllMessageParams[K]) => string;
  /** Resolve a `GameMessage` — a key and its parameters, as the rules emit them. */
  readonly resolveMessage: (message: GameMessage) => string;
  /** Resolve a key that came from data. Applies the missing-key policy. */
  readonly resolveDynamic: (key: string, params?: DynamicParams) => string;
  /** Whether a key is in this catalogue. */
  readonly has: (key: string) => boolean;
}

export interface CatalogueOptions {
  readonly locale?: string;
  readonly messages?: Messages;
  /** Defaults to `throw`: the safe default is the loud one. */
  readonly onMissingKey?: MissingKeyPolicy;
}

/** A missing dynamic key, under the `throw` policy. */
export class MissingMessageKeyError extends Error {
  override readonly name = 'MissingMessageKeyError';
  readonly key: string;

  constructor(key: string, locale: string) {
    super(
      `no message for key "${key}" in locale "${locale}". Scenario keys such as ` +
        'briefKey and coachMarks must exist in the catalogue (FR-910, D14).',
    );
    this.key = key;
  }
}

/** Build a catalogue. */
export const createCatalogue = (options: CatalogueOptions = {}): Catalogue => {
  const locale = options.locale ?? DEFAULT_LOCALE;
  const messages = options.messages ?? en;
  const onMissingKey = options.onMissingKey ?? 'throw';
  const formatters = createFormatters(locale);

  // Sorted, so the key list is the same on every platform and in every run: the rot
  // tests compare it against another set, and an unordered comparison that happens to
  // pass today is not a check (NFR-009).
  const keys = (Object.keys(messages) as MessageKey[]).sort();
  const known = new Set<string>(keys);

  const resolve = <K extends MessageKey>(key: K, params: AllMessageParams[K]): string =>
    messages[key](params, formatters);

  return {
    locale,
    keys,
    formatters,
    resolve,
    resolveMessage: (message) =>
      // The `GameMessage` union pairs each key with its own parameters, and the
      // catalogue is indexed by the same keys — but TypeScript cannot see that the two
      // sides of an indexed call line up when the key is a union, so the call is made
      // through a signature that takes the union. `messages` is a total mapped type
      // over every key, which is what makes this safe rather than merely quiet.
      (messages[message.key] as (params: unknown, fmt: MessageFormatters) => string)(
        message.params,
        formatters,
      ),
    resolveDynamic: (key, params = {}) => {
      if (!known.has(key)) {
        if (onMissingKey === 'throw') throw new MissingMessageKeyError(key, locale);
        return missingKeyFallback(key);
      }
      return (messages[key as MessageKey] as (p: unknown, f: MessageFormatters) => string)(
        params,
        formatters,
      );
    },
    has: (key) => known.has(key),
  };
};
