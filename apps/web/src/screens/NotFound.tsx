/**
 * The not-found screen — #117, §8.7.
 *
 * §8.7 has no row for a bad route, which is itself the point: every state in that table
 * is a *failure of something the game tried to do*, and none of them is "the URL says
 * something the game has never heard of". A hash the router cannot match is nobody's
 * fault and needs no diagnosis — it needs a page that says so and a way back.
 *
 * It is reachable in ordinary use, not only by typo. Hash routing means an old shared
 * link keeps its path after the route table changes, and every throwaway route in this
 * build (`/scene`) is a link that will one day stop resolving. A blank screen
 * on any of those reads as a broken game.
 *
 * The path is echoed back because the alternative is a screen that cannot be acted on:
 * someone who followed a link needs to see what it asked for before they can tell
 * whether the link was wrong or the game moved.
 */
import type { JSX } from 'preact';

import type { Catalogue } from '@hh/ui';

import { hrefFor } from '../router.js';

export interface NotFoundProps {
  readonly t: Catalogue['resolve'];
  /** The path that matched nothing, as the router parsed it. */
  readonly path: string;
}

export const NotFound = ({ t, path }: NotFoundProps): JSX.Element => (
  <>
    <p data-testid="not-found-path">{t('screen.notFound.body', { path })}</p>
    <p>
      <a href={hrefFor('/')}>{t('screen.notFound.backToTitle', {})}</a>
    </p>
  </>
);
