/**
 * `@hh/ui/palette` — §9.2's tokens, the five palettes, and the contrast check over them.
 *
 * Data and arithmetic only. This package compiles without the DOM library, so nothing
 * here knows what a stylesheet or a canvas is: `apps/web` is the composition point (§11.2)
 * and it is what turns these values into CSS custom properties and into the renderer's
 * `SceneColours`. Keeping the palette here rather than in the application is what lets the
 * contrast check run under Node in `pnpm test`, and what stops `@hh/render` — which cannot
 * import this package — from ever holding a colour of its own.
 */
export type { MedalColours, MedalKey, Palette, PaletteId, Token } from './tokens.js';
export {
  DEFAULT_PALETTE_ID,
  MEDAL_KEYS,
  PALETTE_IDS,
  TOKENS,
  TOKEN_ROLES,
  isPaletteId,
} from './tokens.js';

export type { PaletteSet } from './palettes.js';
export { PALETTES, paletteSet } from './palettes.js';

export type { Rgba } from './colour.js';
export {
  composite as compositeColour,
  greyscale,
  mix as mixColour,
  mixRgba,
  parseColour,
  toHex,
  withAlpha,
} from './colour.js';

export { contrastRatio, contrastRatioOf, relativeLuminance } from './contrast.js';

export type { ContrastPair, ContrastSubject, PairKind } from './pairs.js';
export { CONTRAST_PAIRS, GRAPHIC_CONTRAST_MIN, TEXT_CONTRAST_MIN, minimumFor } from './pairs.js';
