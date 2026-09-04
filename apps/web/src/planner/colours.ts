/**
 * The scene's colours, until #116 brings the five palettes in M3.
 *
 * `@hh/render` owns the *slots* — `SceneColours` names every ink the scene can use — and
 * this owns the values. That split is why this file is small and why replacing it later
 * is a one-file change: nothing in the renderer or the planner names a hex code.
 *
 * These are **not** the design tokens. #116 defines the palettes, including the
 * high-contrast and colour-blind-safe ones §8.8 requires, and this is deliberately not a
 * head start on that work — it is the smallest set that makes §9.3's rendering language
 * legible, chosen so that the three trajectory styles stay distinguishable in greyscale
 * (§8.3.4's fifth principle), which the scene harness exists to check.
 */
import type { SceneColours } from '@hh/render';

export const SCENE_COLOURS: SceneColours = {
  background: '#05070d',
  earthFill: '#12233f',
  earthCoastline: '#4d7ba8',
  earthNight: 'rgba(2, 4, 10, 0.55)',
  hazard: '#b4643c',
  hazardViolated: '#e2503c',
  current: '#5bc0eb',
  planned: '#a8bcd2',
  target: '#d8a657',
  ship: '#f2f6fb',
  targetMarker: '#d8a657',
  node: '#f5a623',
  nodeSelected: '#ffd479',
  annotation: '#8fa3bb',
};
