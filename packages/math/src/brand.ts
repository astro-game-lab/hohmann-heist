/**
 * Branded numeric types.
 *
 * Most bugs in this domain are unit bugs: kilometres where metres were meant,
 * degrees where radians were meant. Branding turns that class of mistake into a
 * compile error rather than a wrong number that propagates silently into a
 * delta-v the player is told to trust.
 *
 * **The rule.** Brands are load-bearing *at API boundaries*, where a caller could
 * plausibly pass the wrong unit. Inside a formula they are unwrapped and the
 * arithmetic is plain. Full branded arithmetic is expressible in TypeScript but
 * makes something like vis-viva unreadable, and a convention people bypass is
 * worse than no convention at all. So: every exported function takes and returns
 * branded values; the algebra between them does not.
 *
 * The brand is a `unique symbol` rather than a string property. A property brand
 * can be forged by any object literal that happens to carry that key; a symbol
 * brand cannot be written outside this module.
 */

declare const brand: unique symbol;

/** A `T` tagged with a unit, distinguishable from a bare `T` by the compiler. */
export type Brand<T, B extends string> = T & { readonly [brand]: B };

/** Metres. */
export type Metres = Brand<number, 'm'>;
/** Seconds. */
export type Seconds = Brand<number, 's'>;
/** Metres per second. */
export type MetresPerSec = Brand<number, 'm/s'>;
/** Radians. Normalised to `[0, 2π)` wherever a function returns one. */
export type Radians = Brand<number, 'rad'>;
/** Kilograms. */
export type Kilograms = Brand<number, 'kg'>;

/** Tag a number as metres. */
export const metres = (n: number): Metres => n as Metres;
/** Tag a number as seconds. */
export const seconds = (n: number): Seconds => n as Seconds;
/** Tag a number as metres per second. */
export const metresPerSec = (n: number): MetresPerSec => n as MetresPerSec;
/** Tag a number as radians. */
export const radians = (n: number): Radians => n as Radians;
/** Tag a number as kilograms. */
export const kilograms = (n: number): Kilograms => n as Kilograms;

/**
 * Drop the brand.
 *
 * Prefer using a branded value directly — it *is* a number, so arithmetic works
 * without this. Reach for it only where an explicit widening reads better than an
 * implicit one.
 */
export const unbrand = (value: number): number => value;
