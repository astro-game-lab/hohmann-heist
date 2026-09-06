/**
 * The footer — §8.3.1, §14.4, #118.
 *
 * > *`astro-game-lab · MIT · the physics ↗`. Present on every screen's footer.*
 *
 * ## Why the version is not a catalogue string
 *
 * Everything else on screen resolves through `@hh/ui` (FR-910, and a lint rule refuses
 * literal JSX text). The version does not, and `version.ts` says why: it is an identifier
 * meant to be copied verbatim into a bug report or a playtest sheet, and a locale that
 * regrouped its digits would break the one thing it is for. What *is* translated is the
 * word that labels it.
 *
 * ## Two numbers, one of them visible
 *
 * §14.4 wants both the release and the build. Printing `0.0.0 (ae569e9)` puts two numbers
 * on a title card that has one job, so the commit is carried as the version's `title` and
 * in its accessible name instead — #118's criterion is that it be *reachable*, not that it
 * be shown.
 *
 * That is why this element is focusable. `title` is a hover affordance and hover is not
 * available to a keyboard, so a version nobody could focus would be reachable by mouse
 * users and screen-reader users and by nobody else. One extra tab stop, at the very end of
 * the document, with the focus ring §8.8 requires — and `aria-label` carries both halves,
 * so what is announced does not depend on the tooltip being read.
 */
import type { Catalogue } from '@hh/ui';
import type { JSX } from 'preact';

import { PHYSICS_URL } from '../links.js';
import { COMMIT, VERSION } from '../version.js';

export interface FooterProps {
  readonly t: Catalogue['resolve'];
}

export const Footer = ({ t }: FooterProps): JSX.Element => (
  <footer class="hh-footer" data-testid="footer" aria-label={t('footer.label', {})}>
    <p class="hh-footer__credits">
      <span>{t('footer.attribution', {})}</span>
      {/*
        The `·` between this and the link is a CSS `::before` on `.hh-footer__physics`, not
        a text node. A separator in JSX is literal text and NFR-028's rule refuses it —
        rightly, because it would also be a sentence built from fragments, which is what a
        message-function catalogue exists to prevent (`types.ts`).

        `rel="noreferrer"` alongside `noopener`: the target is our own repository, so
        neither is load-bearing for security here, but a link that opens a tab should not
        depend on the reader knowing where it points.
      */}
      <a
        class="hh-footer__physics"
        href={PHYSICS_URL}
        target="_blank"
        rel="noopener noreferrer"
        data-testid="footer-physics"
      >
        {t('footer.physics', {})}
      </a>
    </p>
    <p
      class="hh-footer__build"
      data-testid="footer-version"
      tabIndex={0}
      title={t('footer.buildDetail', { commit: COMMIT })}
      aria-label={`${t('footer.build', {})} ${VERSION}, ${t('footer.buildDetail', { commit: COMMIT })}`}
    >
      {VERSION}
    </p>
  </footer>
);
