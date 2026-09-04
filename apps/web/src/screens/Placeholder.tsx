/**
 * What a route renders while the screen that owns it is still someone else's issue.
 *
 * §8.2's table has nine routes; M2 builds two of them (#117's not-found and #120's
 * briefing) and the planner. The other seven are #101–#109 and #144–#147, and each is a
 * separate PR.
 *
 * They still have to *resolve*, because "every route in §8.2's table resolves" is
 * #117's first acceptance criterion and a route that renders nothing cannot be said to
 * resolve. So each gets the real frame — real heading, real focus move, real transition —
 * with this in the body. The screen that replaces it changes one line of `app.tsx` and
 * deletes nothing else.
 *
 * The nav is here rather than in a layout chrome because it is temporary: §8.2's
 * information architecture routes the player through the title screen and the contract
 * board, and neither exists yet. It goes when #101 and #102 land, and until then it is
 * the only way to reach a route without typing its hash.
 */
import type { JSX } from 'preact';

import type { Catalogue } from '@hh/ui';

import { hrefFor } from '../router.js';

export interface PlaceholderProps {
  readonly t: Catalogue['resolve'];
  /** Paths to offer as links, already paired with their resolved labels. */
  readonly links?: readonly (readonly [path: string, label: string])[];
}

export const Placeholder = ({ t, links }: PlaceholderProps): JSX.Element => (
  <>
    <p data-testid="placeholder-notice">{t('screen.notBuiltYet', {})}</p>
    {links === undefined ? null : (
      <nav aria-label={t('app.routesLabel', {})}>
        <ul>
          {links.map(([path, label]) => (
            <li key={path}>
              <a href={hrefFor(path)}>{label}</a>
            </li>
          ))}
        </ul>
      </nav>
    )}
  </>
);
