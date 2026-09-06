/**
 * What a route renders while the screen that owns it is still someone else's issue.
 *
 * §8.2's table has nine routes. M3 leaves four unbuilt — the daily (#103), a past daily
 * and its leaderboard (#104), the Codex (#105) and the replay *viewer* (#106) — all of
 * which are M6–M7.
 *
 * They still have to *resolve*, because "every route in §8.2's table resolves" is #117's
 * first acceptance criterion and a route that renders nothing cannot be said to resolve.
 * So each gets the real frame — real heading, real focus move, real transition — with this
 * in the body. The screen that replaces it changes one line of `app.tsx` and deletes
 * nothing else.
 *
 * ## The nav is gone
 *
 * This used to carry a list of links, because §8.2 routes the player title → board →
 * briefing and neither the title screen nor the board existed: without them there was no
 * way to reach a route except by typing its hash. #118 and #119 built both, so the list
 * went with them, exactly as its own comment said it would.
 */
import type { JSX } from 'preact';

import type { Catalogue } from '@hh/ui';

export interface PlaceholderProps {
  readonly t: Catalogue['resolve'];
}

export const Placeholder = ({ t }: PlaceholderProps): JSX.Element => (
  <p data-testid="placeholder-notice">{t('screen.notBuiltYet', {})}</p>
);
