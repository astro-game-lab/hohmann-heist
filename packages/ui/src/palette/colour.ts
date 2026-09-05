/**
 * Colour algebra — parsing, blending, and back to a string.
 *
 * Everything the palette does to a colour that is not *measuring* it. `./contrast.ts`
 * builds on this; nothing here knows what a contrast ratio is, which is what keeps the
 * two files a straight line rather than a cycle.
 *
 * ## Why hex in and hex out
 *
 * Token values are hex (see `./tokens.ts` on why), and both consumers — a CSS custom
 * property and a canvas fill style — take the string unchanged. A derived colour that
 * came back in some intermediate form would have to be formatted on the way out, by each
 * consumer, which is a second place for them to disagree.
 *
 * ## sRGB, deliberately
 *
 * Every blend here interpolates in sRGB rather than in linear light. That is the wrong
 * answer as physics and the right one here: these values exist to predict what a browser
 * paints, and a browser blends `#rrggbbaa` and `color-mix(in srgb, …)` in sRGB. A
 * derivation that was more correct than the renderer would produce a coastline that
 * measured well and looked wrong.
 *
 * ## `mix` and `composite` are one operation
 *
 * Painting a 55% black over a disc and mixing a colour 55% toward black are the same
 * calculation, so {@link composite} is defined in terms of {@link mixRgba} rather than
 * written out again. Two implementations of one formula drift, and the interesting way
 * they drift is in the space they interpolate in — which is exactly the decision above.
 */

/** An sRGB colour with straight (non-premultiplied) alpha, each channel in [0, 1]. */
export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  /** 1 for an opaque colour. */
  readonly a: number;
}

/**
 * `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`.
 *
 * The short forms are accepted because CSS accepts them and a palette written by hand
 * will eventually use one; rejecting them would be a rule this module invented.
 */
const HEX = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

const expandShort = (digits: string): string =>
  digits
    .split('')
    .map((digit) => digit + digit)
    .join('');

/**
 * Read a hex colour, or `undefined` if it is not one.
 *
 * Every token value in every palette goes through here, which is what lets the palettes
 * be a plain table of strings and still be checked.
 */
export const parseColour = (value: string): Rgba | undefined => {
  if (!HEX.test(value)) return undefined;

  const digits = value.slice(1);
  const full = digits.length <= 4 ? expandShort(digits) : digits;
  const channel = (index: number): number =>
    Number.parseInt(full.slice(index, index + 2), 16) / 255;

  return {
    r: channel(0),
    g: channel(2),
    b: channel(4),
    a: full.length === 8 ? channel(6) : 1,
  };
};

/** Clamp to the unit interval, so a rounding error cannot produce `#100` or `#-1`. */
const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** One channel as two hex digits. */
const hexPair = (channel: number): string =>
  Math.round(clamp01(channel) * 255)
    .toString(16)
    .padStart(2, '0');

/**
 * An {@link Rgba} back to a CSS colour string.
 *
 * Six digits when opaque, eight when not — so a value that did not need alpha does not
 * grow one, and a derived colour reads the same way a hand-written token does.
 */
export const toHex = (colour: Rgba): string => {
  const rgb = `#${hexPair(colour.r)}${hexPair(colour.g)}${hexPair(colour.b)}`;
  return colour.a >= 1 ? rgb : `${rgb}${hexPair(colour.a)}`;
};

/**
 * `a` moved `t` of the way toward `b`, in sRGB. `t = 0` is `a`, `t = 1` is `b`.
 *
 * Alpha is interpolated with the colour, which is what makes {@link composite} a special
 * case of this rather than a second function.
 */
export const mixRgba = (a: Rgba, b: Rgba, t: number): Rgba => {
  const k = clamp01(t);
  return {
    r: a.r + (b.r - a.r) * k,
    g: a.g + (b.g - a.g) * k,
    b: a.b + (b.b - a.b) * k,
    a: a.a + (b.a - a.a) * k,
  };
};

/**
 * The same, on colour strings. `undefined` if either is not a colour.
 *
 * This is what the scene derivation calls: `mix('--earth', '--fg-dim', 0.45)` says what
 * a coastline *is* — Earth's colour, lifted toward the annotation ink — in a way that a
 * hex code cannot, and it moves with the palette instead of having to be redrawn for
 * each of the five.
 */
export const mix = (a: string, b: string, t: number): string | undefined => {
  const from = parseColour(a);
  const to = parseColour(b);
  if (from === undefined || to === undefined) return undefined;
  return toHex(mixRgba(from, to, t));
};

/** A colour at a stated alpha, discarding whatever alpha it had. `undefined` if not a colour. */
export const withAlpha = (colour: string, alpha: number): string | undefined => {
  const parsed = parseColour(colour);
  if (parsed === undefined) return undefined;
  return toHex({ ...parsed, a: clamp01(alpha) });
};

/**
 * `source` painted over `ground`, straight alpha, in sRGB.
 *
 * `ground` is assumed opaque — every pair in `./pairs.ts` names a ground that is one of
 * `--bg` or `--bg-panel`, both of which are. Compositing a translucent colour over a
 * translucent one would need a third layer to be meaningful, and the design has no such
 * case.
 */
export const composite = (source: Rgba, ground: Rgba): Rgba => ({
  ...mixRgba(ground, source, source.a),
  a: 1,
});

/**
 * The sRGB transfer function, forward.
 *
 * The inverse of `./contrast.ts`'s `linearise`, and it uses that module's threshold in
 * the direction the specification states it: 0.0031308 in linear light is 0.03928 encoded
 * (near enough — see the note there on WCAG's published erratum, which this deliberately
 * mirrors rather than corrects).
 */
const encode = (linear: number): number =>
  linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055;

/** WCAG relative luminance, duplicated here so `./contrast.ts` may depend on this file. */
const luminance = (colour: Rgba): number => {
  const lin = (channel: number): number =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  return 0.2126 * lin(colour.r) + 0.7152 * lin(colour.g) + 0.0722 * lin(colour.b);
};

/**
 * The same colour with its hue removed, at the lightness a viewer actually perceives.
 *
 * §8.3.4's fifth principle and NFR-019: *no information conveyed by colour alone*. The
 * way to check that is to look at the scene with the hue taken out and see whether the
 * three trajectories, the two markers and the hazard states are still tellable apart —
 * which is what the scene harness's greyscale toggle is for.
 *
 * The grey is the colour's **relative luminance**, re-encoded, not the average of its
 * channels. Averaging is the intuitive implementation and it is wrong in the direction
 * that matters here: it makes a saturated blue and a saturated yellow the same grey when
 * a viewer sees the yellow as far lighter, so an averaged check would report a collision
 * the eye does not have and hide ones it does.
 *
 * Alpha is carried through unchanged — a translucent wash stays translucent.
 */
export const greyscale = (colour: string): string | undefined => {
  const parsed = parseColour(colour);
  if (parsed === undefined) return undefined;
  const grey = encode(luminance(parsed));
  return toHex({ r: grey, g: grey, b: grey, a: parsed.a });
};
