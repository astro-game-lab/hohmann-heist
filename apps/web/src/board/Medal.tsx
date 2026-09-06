/**
 * A medal, as §8.3.2 and NFR-019 require it — #119, #81.
 *
 * > *▲ shape + label + colour. Never colour alone (principle 5).*
 *
 * All three, and in an order that makes the rule hard to break later: the **label is a
 * text node**, so it is what a screen reader reads and what survives a greyscale
 * screenshot; the shape is `Icon name="medal"`, `aria-hidden` because the label beside it
 * already says the tier; and the colour arrives through `data-medal` on the wrapper, which
 * the stylesheet keys off. Delete the colour and nothing is lost. Delete the label and the
 * test below it fails.
 *
 * ## Why one glyph rather than four
 *
 * See `icons/index.tsx`. §8.8 asks that medals be distinguishable by shape *and* label,
 * and the word is what distinguishes them — four near-identical triangles would be harder
 * to tell apart at 16 px than `GOLD` is from `SILVER`, not easier.
 *
 * ## No medal is a state, not an absence
 *
 * A contract completed without a medal, and one never played, are different facts and the
 * board shows both. This renders the first; the card decides which to ask for.
 */
import type { Catalogue } from '@hh/ui';
import type { JSX } from 'preact';

import { Icon } from '../icons/index.js';
import type { Medal as MedalTier } from '../save/index.js';

export interface MedalProps {
  readonly t: Catalogue['resolve'];
  readonly medal: MedalTier;
}

export const Medal = ({ t, medal }: MedalProps): JSX.Element => (
  <span class="hh-medal" data-medal={medal} data-testid="medal">
    <Icon name="medal" class="hh-medal__glyph" />
    <span class="hh-medal__label">{t('debrief.medal', { medal })}</span>
  </span>
);
