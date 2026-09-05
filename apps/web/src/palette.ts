/**
 * One palette, resolved for both consumers — #116, FR-907, §9.2.
 *
 * `@hh/ui` owns the thirteen roles and their values; this owns the two things that turn
 * them into paint. `apps/web` is the composition point (§11.2) and it is the only layer
 * that knows both that a CSS custom property exists and that a canvas takes a fill style
 * — `@hh/render` cannot import `@hh/ui`, they are siblings — so the join has to happen
 * here or not at all.
 *
 * Before this, it happened twice: `app.css` carried some thirty hex codes and
 * `planner/colours.ts` carried fourteen more, and the two were a palette each. Nothing
 * made them agree, and nothing would have said so when they stopped.
 *
 * ## The scene needs fourteen inks from thirteen roles
 *
 * {@link sceneColoursFor} is a **mapping**, not a lookup, and it has to be: Earth's disc,
 * its coastline and its night side are all `--earth`, and the difference between them is
 * a derivation. Writing five hand-made scene palettes instead would be five more places
 * for a colour to be wrong, and four of them would be looked at roughly never.
 *
 * The derivations are stated once, below, and they move with the palette. `mixColour`
 * lets a coastline be *"Earth, lifted toward the annotation ink"* rather than a hex code
 * that has to be re-chosen for deuteranopia.
 *
 * ## `--hazard` carries alpha for CSS and loses it for the canvas
 *
 * The token is translucent by §9.2's definition — *"red, 15% alpha, hatched"* — and the
 * timeline's constraint band uses it exactly that way, as a wash in a repeating gradient.
 * The renderer does not: `hazardShellPrimitives` applies **its own** alpha to the fill and
 * to the hatch ticks, and draws the shell's boundary circles opaque on top. Handing it a
 * translucent ink would multiply the two and produce a shell that fades as the palette
 * changes.
 *
 * So the scene gets the hazard colour at full strength and the stylesheet gets it at the
 * token's. That asymmetry is deliberate, and it is why the shell's **boundary** is the
 * thing `palette.test.ts` holds to §8.8's 3:1 — the boundary is the opaque stroke, and it
 * is what makes the shell visible at all.
 */
import type { SceneColours } from '@hh/render';
import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  DEFAULT_PALETTE_ID,
  MEDAL_KEYS,
  TOKENS,
  isPaletteId,
  mixColour,
  paletteSet,
  withAlpha,
  type PaletteId,
} from '@hh/ui';

/**
 * How far Earth's coastline is lifted from its fill toward the annotation ink.
 *
 * Chosen as the smallest lift that clears §8.8's 3:1 against **both** the disc it is drawn
 * on and the space around it — a limb has to be visible from either side, and the two
 * pull in opposite directions. `palette.test.ts` is what holds it to that; if a palette
 * ever cannot satisfy both, the test names the palette rather than this constant quietly
 * being nudged.
 */
const COASTLINE_LIFT = 0.62;

/** How opaque Earth's night side is, drawn as the ground colour over the lit disc. */
const NIGHT_ALPHA = 0.55;

/**
 * The renderer's fourteen inks, derived from one palette's thirteen roles.
 *
 * Every value is either a token or a stated derivation from one. Nothing here is a
 * literal, which is the property the guardrail in `tools/guardrails` enforces and the
 * reason a fifth palette costs thirteen values rather than twenty-seven.
 */
export const sceneColoursFor = (id: PaletteId): SceneColours => {
  const { tokens } = paletteSet(id);

  // `mixColour` and `withAlpha` return `undefined` only for a value that is not a colour,
  // and every token is checked to be one by `palette.test.ts` in @hh/ui. Falling back to
  // the source token keeps this total without inventing a colour: a coastline that failed
  // to derive would be Earth's own fill, which is visibly wrong rather than subtly wrong.
  const coastline = mixColour(tokens.earth, tokens['fg-dim'], COASTLINE_LIFT) ?? tokens['fg-dim'];
  const night = withAlpha(tokens.bg, NIGHT_ALPHA) ?? tokens.bg;
  const hazard = withAlpha(tokens.hazard, 1) ?? tokens.bad;

  return {
    background: tokens.bg,
    earthFill: tokens.earth,
    earthCoastline: coastline,
    earthNight: night,
    hazard,
    hazardViolated: tokens.bad,
    current: tokens.accent,
    planned: tokens.plan,
    target: tokens.target,
    // §9.3 gives the ship a marker, not a colour of its own; the primary text ink is the
    // brightest thing in the palette and is what makes ▲ read as "you" at every zoom.
    ship: tokens.fg,
    targetMarker: tokens.target,
    // §9.2 assigns nodes to `--plan`, with §9.3 separating them from the trajectory by
    // shape — a ◆ with a handle cross against a run of dots — rather than by hue.
    node: tokens.plan,
    // §9.3: "selected nodes get a ring". The ring is the signal (NFR-019); `--accent` is
    // what makes it legible against the node it surrounds.
    nodeSelected: tokens.accent,
    annotation: tokens['fg-dim'],
  };
};

/** The custom property a token is published as. `--bg`, `--fg-dim`, and so on. */
export const cssVariableFor = (token: string): string => `--${token}`;

/** The custom property a medal is published as, kept apart from §9.2's thirteen. */
export const medalVariableFor = (medal: string): string => `--medal-${medal}`;

/**
 * The whole palette as custom properties, as a plain record.
 *
 * Separated from {@link applyPalette} so the mapping can be asserted without a DOM, which
 * is what lets `palette.test.ts` compare what CSS gets against what the canvas gets and
 * prove they came from the same token.
 */
export const cssVariablesFor = (id: PaletteId): Readonly<Record<string, string>> => {
  const set = paletteSet(id);
  const variables: Record<string, string> = {};
  for (const token of TOKENS) variables[cssVariableFor(token)] = set.tokens[token];
  for (const medal of MEDAL_KEYS) variables[medalVariableFor(medal)] = set.medals[medal];
  return variables;
};

/**
 * Publish a palette onto an element, and record which one is active.
 *
 * The properties go on `:root` in practice, so every rule and every component below it
 * resolves against them; `data-palette` is there so a stylesheet or a test can ask which
 * palette is showing without reading thirteen values back.
 *
 * Setting properties rather than swapping a class is what makes the canvas and the DOM
 * agree: {@link sceneColoursFor} reads the same source, so there is no moment where the
 * page has restyled and the scene has not.
 */
export const applyPalette = (root: HTMLElement, id: PaletteId): void => {
  for (const [name, value] of Object.entries(cssVariablesFor(id))) {
    root.style.setProperty(name, value);
  }
  root.dataset['palette'] = id;
};

/**
 * Which palette to show, until §8.3.12's control exists.
 *
 * **Temporary, and deliberately visible as such.** #186 makes the palette a persisted
 * setting and #122 renders the control; until then there is no way to reach four of the
 * five palettes, which would make FR-907 unverifiable and would leave "switching restyles
 * every screen and the canvas" as a claim nobody could check.
 *
 * So the hash carries it: `#/board?palette=deuteranopia`. The router already discards
 * everything after the `?` when matching a route (`router.ts`), so this reads the same
 * string without changing how routing works, and an unknown or absent value is the
 * default rather than an error.
 *
 * This goes when the setting lands, exactly as `app.tsx`'s temporary `NAV` list goes when
 * the title screen does.
 */
export const paletteFromHash = (hash: string): PaletteId => {
  const query = hash.indexOf('?');
  if (query === -1) return DEFAULT_PALETTE_ID;
  const requested = new URLSearchParams(hash.slice(query + 1)).get('palette');
  return requested !== null && isPaletteId(requested) ? requested : DEFAULT_PALETTE_ID;
};

/**
 * The palette that is showing, as a value a component can render from.
 *
 * Subscribes to `hashchange` for the same reason {@link paletteFromHash} exists: the
 * temporary source is in the URL, so changing it has to restyle without a reload — which
 * is the property FR-907 is judged on and the one a hard-coded default could not
 * demonstrate. When #186 makes this a setting, only this hook's body changes.
 */
export const usePalette = (): PaletteId => {
  const [id, setId] = useState<PaletteId>(() => paletteFromHash(window.location.hash));

  useEffect(() => {
    const emit = (): void => {
      setId(paletteFromHash(window.location.hash));
    };
    window.addEventListener('hashchange', emit);
    emit();
    return () => {
      window.removeEventListener('hashchange', emit);
    };
  }, []);

  return id;
};

/**
 * The scene's inks for the palette that is showing.
 *
 * Memoised because it is a dependency of the effect that builds and draws the whole
 * scene: a fresh object every render would re-run that effect every render, which at
 * 60 Hz is the difference between a palette change and a redraw loop.
 */
export const useSceneColours = (): SceneColours => {
  const id = usePalette();
  return useMemo(() => sceneColoursFor(id), [id]);
};
