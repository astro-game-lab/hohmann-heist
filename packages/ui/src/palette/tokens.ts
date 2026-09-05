/**
 * §9.2's design tokens — the thirteen roles every palette must fill.
 *
 * A token is a **role**, not a colour. `--accent` is "the player's ship, their current
 * orbit, and the primary action"; that it is a cyan in the default palette is a fact
 * about that palette and about nothing else. Five palettes fill these roles differently
 * and the components that read them cannot tell, which is the entire point of spending
 * tokens rather than hex codes.
 *
 * ## Why the list is closed
 *
 * §9.2 names thirteen and this names the same thirteen, as a union rather than as a
 * `string`. A palette is then a mapped type over that union, so **a palette missing a
 * token, or carrying one that does not exist, is a compile error** — which is the
 * property that makes "every token is defined in all five palettes" true by construction
 * rather than by a test that has to remember to be written. The test exists as well,
 * because a compile-time guarantee nobody can see is one refactor away from being
 * relaxed; that is the same argument `catalogue/types.ts` makes about message keys.
 *
 * Adding a fourteenth role means editing this file and then being told, by the compiler,
 * every palette that has not answered for it.
 *
 * ## Why values are hex, including the two that carry alpha
 *
 * §9.2 describes `--hazard` as *"red, 15% alpha, hatched"* and `--grid` as *"20%"*, so
 * two of the thirteen are inherently translucent and the rest are not. Both forms are
 * written as hex — `#rrggbb` or `#rrggbbaa` — rather than mixing hex with `rgba()`,
 * for two reasons.
 *
 * One parser. {@link parseColour} in `./contrast.ts` reads every token with one regular
 * expression, which matters because the contrast check has to composite the translucent
 * ones over their ground before it can measure them. A table in two notations means two
 * parsers, and the second one is the one with the bug.
 *
 * And one output. These strings are written straight into CSS custom properties and
 * straight into `SceneColours` for the canvas; `#rrggbbaa` is valid CSS colour syntax and
 * a valid canvas fill style, so neither consumer needs to reformat anything. A value that
 * has to be rewritten on the way out is a value that can be rewritten differently by the
 * two consumers, which is exactly the drift this module exists to prevent.
 */

/**
 * The thirteen roles of §9.2, in the order that table gives them.
 *
 * Ordered ground → text → meaning → scene, because that is the order a palette is
 * designed in: the ground decides what can be read against it, and everything else is
 * chosen to be readable.
 */
export const TOKENS = [
  'bg',
  'bg-panel',
  'fg',
  'fg-dim',
  'accent',
  'target',
  'plan',
  'ok',
  'warn',
  'bad',
  'earth',
  'hazard',
  'grid',
] as const;

/** One of §9.2's thirteen token names, without the `--` a CSS custom property carries. */
export type Token = (typeof TOKENS)[number];

/**
 * What each token is *for*, in one line.
 *
 * Here rather than only in a comment because it is rendered: the scene harness lists the
 * palette with these descriptions so that a value can be judged against the job it is
 * doing, and a reviewer choosing a colour for a new palette reads the role rather than
 * guessing from the name. `--plan` in particular is not "a bright colour", it is "the
 * trajectory that has not happened yet", and those suggest different answers.
 */
export const TOKEN_ROLES: Readonly<Record<Token, string>> = Object.freeze({
  bg: 'Console ground',
  'bg-panel': 'Panel fill, one step up from ground',
  fg: 'Primary text',
  'fg-dim': 'Secondary text and units',
  accent: 'The player ship, the current orbit, the primary action',
  target: 'The target ship and its orbit',
  plan: 'The planned trajectory and its nodes',
  ok: 'Objective met, inside tolerance',
  warn: 'Approaching a limit',
  bad: 'Illegal, violated, failed',
  earth: 'Earth disc',
  hazard: 'The altitude floor and no-fly shells',
  grid: 'Timeline rules and plot axes',
});

/** A complete set of values for §9.2's roles. Every token, or it does not compile. */
export type Palette = Readonly<Record<Token, string>>;

/**
 * §8.3.2's four medals.
 *
 * Named here beside the tokens, and only here, because three files need the list and
 * three copies of it would be three places to forget a fifth medal: the palettes carry
 * the values, the contrast pairs name each one as a subject, and the test iterates them.
 * They are deliberately **not** members of {@link Token} — see `./palettes.ts` on why a
 * medal ramp is not one of §9.2's thirteen roles.
 */
export const MEDAL_KEYS = ['bronze', 'silver', 'gold', 'clean'] as const;

export type MedalKey = (typeof MEDAL_KEYS)[number];

/** A palette's medal ramp. Every medal, or it does not compile. */
export type MedalColours = Readonly<Record<MedalKey, string>>;

/** The palettes §8.3.12's accessibility group offers. */
export const PALETTE_IDS = [
  'default',
  'deuteranopia',
  'protanopia',
  'tritanopia',
  'high-contrast',
] as const;

export type PaletteId = (typeof PALETTE_IDS)[number];

/** The palette a player who has chosen nothing gets (§8.3.12: dark is the default). */
export const DEFAULT_PALETTE_ID: PaletteId = 'default';

/** Whether a string names a palette. Used where a stored or URL value must be checked. */
export const isPaletteId = (value: string): value is PaletteId =>
  (PALETTE_IDS as readonly string[]).includes(value);
