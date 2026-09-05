/**
 * The five palettes — §9.2, §8.3.12, FR-907.
 *
 * Every value here was chosen against the check in `./contrast.ts`, over the pairs in
 * `./pairs.ts`. The ratios are not written down here on purpose: a comment stating that
 * `--bad` clears 4.8:1 is a number that goes stale the first time the value moves, and
 * `palette.test.ts` already fails with the measured ratio and the pair that missed. The
 * check is the record.
 *
 * ## Five palettes, not four and a mode
 *
 * §9.2 calls high contrast the fifth *palette*; §8.8 calls it a *mode* alongside four
 * palettes. §8.3.12 settles it in the direction that matters — one control,
 * *"Colour-vision palette (default / deuteranopia / protanopia / tritanopia / high
 * contrast)"*, five values — so it is a palette here. One axis, one setting, one thing to
 * explain.
 *
 * ## What a colour-vision palette can and cannot do
 *
 * These are not the default palette with the reds swapped out. Each one is built around
 * the colour axis its dichromacy leaves intact:
 *
 * - **Deuteranopia and protanopia** lose the red–green axis, so `--ok` and `--bad` are
 *   the pair at risk. Both palettes move `--ok` to a bluish green and `--bad` to a light
 *   vermillion, following Okabe & Ito's set, which separates them along the surviving
 *   blue–yellow axis instead. Protanopia additionally perceives reds as *darker*, so its
 *   `--bad` is lightened further.
 * - **Tritanopia** loses the blue–yellow axis, so the pair at risk is `--accent` against
 *   `--target` — the ship against its target, which is the most important distinction the
 *   game draws. Red–green survives, so that palette keeps a cyan accent (which reads as a
 *   green-blue) and deepens `--target` so that lightness separates it from `--warn`.
 *
 * **No palette makes every pair unambiguous, and none is asked to.** NFR-019 is the load
 * -bearing rule — *no information conveyed by colour alone* — and it is satisfied by
 * §9.3's three dash patterns, §8.3.2's medal shapes and the persistent text labels at
 * every marker. Colour here is redundant reinforcement, and these palettes make the
 * reinforcement useful rather than making it sufficient. Where a palette leaves two roles
 * close, the note above says so instead of implying otherwise.
 *
 * Confusability itself is not checked automatically here; contrast is. §14.1 puts the
 * greyscale snapshots (#171) and the manual validation across all five (#172) at M6, and
 * a simulation of dichromatic vision written now would be a second unvalidated model
 * sitting in front of the one thing that *is* measurable today.
 *
 * ## `--grid` is not 20%, and NFR-018 is why
 *
 * §9.2's table describes `--grid` as *"20%"* and `--fg-dim` as *"60%"*, in the same
 * column that calls `--bg` *"near-black, slightly warm"* — a description of the intended
 * default, not a specification. A 20% wash of a slate grey over this ground measures
 * about 1.2:1, and §8.8 asks for **3:1 on UI boundaries**, which is what `--grid` draws:
 * the timeline track, the plan rows, the node editor's frame.
 *
 * Where a descriptive column and a numbered requirement disagree, the requirement wins.
 * The alpha here is the value that clears 3:1 with the least change to the intended look,
 * and the visible consequence is that panel borders read as borders rather than as a
 * suggestion of one.
 *
 * ## The medal ramp is not a token
 *
 * §9.2's table has thirteen rows and none of them is a medal. But §8.3.2 draws four
 * medals in four colours, so the values have to live somewhere, and putting them in the
 * token union would mean this file's `TOKENS` no longer matches the section it claims to
 * implement. So they are a separate, per-palette ramp — named as a ramp, checked by the
 * same contrast pairs, and reached through the same palette lookup. A reviewer comparing
 * this file to §9.2 finds thirteen tokens and one clearly labelled extra, rather than
 * seventeen tokens and a discrepancy.
 */
import type { MedalColours, Palette, PaletteId } from './tokens.js';

/** A palette and the medal ramp that goes with it. */
export interface PaletteSet {
  readonly tokens: Palette;
  readonly medals: MedalColours;
}

/**
 * The default dark palette.
 *
 * Deliberately close to the values the orbit scene was tuned against in M2, so that
 * §9.3's rendering language — the dotted equal-time trajectory, the hazard hatch, the
 * fading trails — still reads the way the scene harness was checked against. Three values
 * moved to clear §8.8's thresholds, and each moved by the smallest amount that did it:
 * `--bg-panel` lifted so a panel is visible against the ground, `--fg-dim` and `--bad`
 * lightened to clear 4.5:1 as text.
 */
const DEFAULT_SET: PaletteSet = {
  tokens: {
    bg: '#05070d',
    'bg-panel': '#0f1622',
    fg: '#e8ecf4',
    'fg-dim': '#9fb3c8',
    accent: '#5bc0eb',
    target: '#e0a94f',
    plan: '#c3d2e2',
    ok: '#79c96d',
    warn: '#edc76a',
    bad: '#f4705c',
    earth: '#16294a',
    hazard: '#f4705c40',
    grid: '#8fa3bb99',
  },
  medals: {
    bronze: '#d9955f',
    silver: '#c6c8d0',
    gold: '#edc76a',
    clean: '#5bc0eb',
  },
};

/** Red–green dichromacy, M-cone. `--ok` and `--bad` separate on the blue–yellow axis. */
const DEUTERANOPIA_SET: PaletteSet = {
  tokens: {
    bg: '#05070d',
    'bg-panel': '#0f1622',
    fg: '#e8ecf4',
    'fg-dim': '#9fb3c8',
    accent: '#56b4e9',
    target: '#f0c761',
    plan: '#d5dde6',
    ok: '#4ecfa8',
    warn: '#e8b04a',
    bad: '#ff8f70',
    earth: '#16294a',
    hazard: '#ff8f7040',
    grid: '#93a7bd99',
  },
  medals: {
    bronze: '#cf9a6b',
    silver: '#c6c8d0',
    gold: '#f0c761',
    clean: '#56b4e9',
  },
};

/** Red–green dichromacy, L-cone. As deuteranopia, with reds lightened — they read darker. */
const PROTANOPIA_SET: PaletteSet = {
  tokens: {
    bg: '#05070d',
    'bg-panel': '#0f1622',
    fg: '#e8ecf4',
    'fg-dim': '#9fb3c8',
    accent: '#5bb8ea',
    target: '#f2cf6b',
    plan: '#d5dde6',
    ok: '#4ed0b0',
    warn: '#e9bc57',
    bad: '#ffa88c',
    earth: '#16294a',
    hazard: '#ffa88c40',
    grid: '#93a7bd99',
  },
  medals: {
    bronze: '#d7a97c',
    silver: '#c6c8d0',
    gold: '#f2cf6b',
    clean: '#5bb8ea',
  },
};

/** Blue–yellow dichromacy. `--accent` against `--target` is the pair at risk. */
const TRITANOPIA_SET: PaletteSet = {
  tokens: {
    bg: '#05070d',
    'bg-panel': '#0f1622',
    fg: '#e8ecf4',
    'fg-dim': '#9fb3c8',
    accent: '#59c6e8',
    target: '#e08b6a',
    plan: '#c8d6e4',
    ok: '#74c96a',
    warn: '#f2d98a',
    bad: '#f4605c',
    earth: '#16294a',
    hazard: '#f4605c40',
    grid: '#8fa3bb99',
  },
  medals: {
    bronze: '#d9955f',
    silver: '#c6c8d0',
    gold: '#f2d98a',
    clean: '#59c6e8',
  },
};

/** Maximum separation: a black ground, a white foreground, and saturated signals. */
const HIGH_CONTRAST_SET: PaletteSet = {
  tokens: {
    bg: '#000000',
    'bg-panel': '#14181f',
    fg: '#ffffff',
    'fg-dim': '#d6dde6',
    accent: '#4fe3ff',
    target: '#ffc400',
    plan: '#ffffff',
    ok: '#4dff9e',
    warn: '#ffd740',
    bad: '#ff8b7a',
    earth: '#12233f',
    hazard: '#ff8b7a59',
    grid: '#d6dde6a6',
  },
  medals: {
    bronze: '#ffab6b',
    silver: '#dfe3ea',
    gold: '#ffd740',
    clean: '#4fe3ff',
  },
};

/** Every palette, by id. A mapped type, so a missing id is a compile error. */
export const PALETTES: Readonly<Record<PaletteId, PaletteSet>> = Object.freeze({
  default: DEFAULT_SET,
  deuteranopia: DEUTERANOPIA_SET,
  protanopia: PROTANOPIA_SET,
  tritanopia: TRITANOPIA_SET,
  'high-contrast': HIGH_CONTRAST_SET,
});

/** The set for an id. Total, so no caller needs a fallback. */
export const paletteSet = (id: PaletteId): PaletteSet => PALETTES[id];
