/**
 * The four settings that are properties of the document rather than of a component —
 * FR-704, FR-907, FR-908, §8.3.12 (#186).
 *
 * Palette, theme, UI scale and line weights do not belong to any one screen: they change
 * how every rule in the stylesheet resolves, and two of them cross into the canvas. So
 * they are published onto the root element and read back by CSS, which is what makes them
 * apply to markup this module has never heard of — including markup that has not been
 * written yet.
 *
 * Kept as a plain function of an element and a settings record, separately from the
 * effect that calls it, for the same reason `palette.ts` splits `cssVariablesFor` from
 * `applyPalette`: the mapping can then be asserted without a DOM, and the effect has
 * nothing left in it to get wrong.
 *
 * ## Why `data-` attributes rather than classes
 *
 * A class is a set; an attribute is a value. `data-theme="light"` cannot also be `dark`,
 * where `class="theme-light theme-dark"` can and eventually is — and the attribute reads
 * back as the thing that was set, so a test asks *which theme is showing* rather than
 * checking three class memberships. It is also what `applyPalette` already does with
 * `data-palette`, and one convention beats two.
 */
import { applyPalette } from '../palette.js';

import type { Settings } from './schema.js';

/** The custom property §8.3.12's 90–150% is published as. `app.css` scales from it. */
export const UI_SCALE_PROPERTY = '--hh-ui-scale';

/**
 * Publish the document-level settings onto an element.
 *
 * `theme: 'system'` sets no attribute at all rather than resolving the media query here.
 * The stylesheet already answers `prefers-color-scheme`, and resolving it in script would
 * mean this module re-running on every OS theme change to keep an attribute in step with
 * a query CSS can read for itself. An absent attribute *is* "follow the system", stated
 * in one place.
 */
export const applyDocumentSettings = (root: HTMLElement, settings: Settings): void => {
  applyPalette(root, settings['accessibility.palette']);

  const theme = settings['display.theme'];
  if (theme === 'system') delete root.dataset['theme'];
  else root.dataset['theme'] = theme;

  // A unitless multiplier rather than a percentage or a px size: `app.css` multiplies its
  // own root font size by it, so every `rem` in the stylesheet scales together and
  // nothing has to be respecified per component. 100% is written as `1` and not omitted —
  // the property must always resolve, or every `calc` that reads it collapses.
  root.style.setProperty(UI_SCALE_PROPERTY, String(settings['display.uiScale'] / 100));

  // Present or absent, never `"false"`: `[data-line-weights]` is the selector, and an
  // attribute whose mere presence is the signal cannot be set to a falsy string that
  // still matches.
  if (settings['accessibility.lineWeights']) root.dataset['lineWeights'] = '';
  else delete root.dataset['lineWeights'];

  if (settings['accessibility.backgroundAnimation']) delete root.dataset['noBackgroundAnimation'];
  else root.dataset['noBackgroundAnimation'] = '';
};
