/**
 * Contrast, measured — NFR-018, §8.8.
 *
 * > *WCAG 2.2 AA contrast in all five palettes.* — NFR-018, verified by *"an automated
 * > contrast check over the token matrix"*.
 *
 * This is the arithmetic behind that check: take a token's value, composite it over its
 * ground if it is translucent, and report the WCAG 2.x contrast ratio. `./colour.ts`
 * does the parsing and the compositing; `./pairs.ts` decides *which* pairs are measured;
 * this decides what the number is.
 *
 * ## Why the formula is spelled out rather than taken from a package
 *
 * It is eleven lines, it has not changed since WCAG 2.0, and a dependency here would be a
 * runtime dependency in `@hh/ui` — which ships to the browser — for arithmetic that costs
 * nothing to write. NFR-024 would also want a licence check and an `ATTRIBUTIONS.md` row
 * for it. The constants below are quoted from the specification and cited, which is the
 * same standard `@hh/astro` holds a physical constant to.
 *
 * ## Why compositing happens before measuring
 *
 * Two of §9.2's thirteen tokens are translucent by definition — `--hazard` at 15% and
 * `--grid` at 20%. A translucent colour has no contrast ratio of its own: what a player
 * sees is the colour *composited over whatever is behind it*, and behind it is the
 * console ground or a panel. So {@link contrastRatio} takes the ground as an argument and
 * composites first.
 *
 * The blend is straight source-over alpha in **sRGB**, not in a linear space, because
 * that is what a browser does when it paints `#rrggbbaa` over an opaque fill. Compositing
 * in linear light would be more correct as physics and would give a number no player will
 * ever see, which makes it the wrong answer for a check whose entire purpose is to
 * predict what is legible on a screen.
 *
 * A consequence worth stating: a translucent token measured against the wrong ground
 * produces a plausible, wrong ratio. That is why `./pairs.ts` names the ground for every
 * pair rather than assuming `--bg`, and why {@link contrastRatio} has no default for it.
 *
 * ## Non-negotiable failures are returned, not thrown
 *
 * A malformed colour is a mistake in a palette, and the check that finds it should say
 * which token in which palette rather than dying inside a regular expression. So the
 * parser returns `undefined` and the caller reports.
 */
import { composite, parseColour, type Rgba } from './colour.js';

/**
 * One channel, linearised.
 *
 * WCAG 2.2, "Relative luminance": the threshold is 0.03928 and the exponent is 2.4.
 * <https://www.w3.org/TR/WCAG22/#dfn-relative-luminance>
 *
 * The 0.03928 is the value the specification prints. It is very slightly off the exact
 * breakpoint of the piecewise function (0.04045 / 12.92 ≈ 0.0031308 maps back to
 * 0.04045), and the discrepancy is a known erratum in the standard that WCAG has chosen
 * not to correct because doing so would change published results. **The specification's
 * number is used, not the mathematically tidy one**, so that this module's ratios agree
 * with every other tool a reviewer might reach for — which is the whole value of using a
 * standard formula rather than a better one.
 */
const linearise = (channel: number): number =>
  channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;

/** WCAG relative luminance of an opaque colour. Alpha is ignored; composite first. */
export const relativeLuminance = (colour: Rgba): number =>
  0.2126 * linearise(colour.r) + 0.7152 * linearise(colour.g) + 0.0722 * linearise(colour.b);

/**
 * The WCAG contrast ratio between a colour and its ground, from 1 to 21.
 *
 * `(L_lighter + 0.05) / (L_darker + 0.05)`. Which of the two is lighter is decided here
 * rather than assumed, so the ratio is symmetric and a pair listed in either order gives
 * the same answer — a property `./pairs.ts` relies on to state pairs in whichever order
 * reads better.
 */
export const contrastRatio = (colour: Rgba, ground: Rgba): number => {
  const front = relativeLuminance(colour.a === 1 ? colour : composite(colour, ground));
  const back = relativeLuminance(ground);
  const lighter = Math.max(front, back);
  const darker = Math.min(front, back);
  return (lighter + 0.05) / (darker + 0.05);
};

/**
 * The same ratio, from two colour strings.
 *
 * `undefined` when either string is not a colour — the caller reports which palette and
 * which token, which this function has no way to know.
 */
export const contrastRatioOf = (colour: string, ground: string): number | undefined => {
  const front = parseColour(colour);
  const back = parseColour(ground);
  if (front === undefined || back === undefined) return undefined;
  return contrastRatio(front, back);
};
