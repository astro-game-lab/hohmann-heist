/**
 * §8.3.2's daily strip — #119.
 *
 * > *Daily strip: always visible. Shows submission count when online, "offline" when not.*
 *
 * The daily challenge is M7. There is no generator, no backend, and no submissions — so
 * this shows neither a count nor an "offline" notice, because both would imply a service
 * that exists and is merely unreachable. It says what it does not know instead, which is
 * §8.7's treatment of the leaderboard applied one milestone early and for a stronger
 * reason: an offline notice is a claim about the network, and there is nothing on the other
 * end of it to be offline from.
 *
 * It is *visible* now rather than hidden until M7 because §8.3.2's layout is the campaign's
 * shape, and a strip that appears late changes the board's proportions on the day the daily
 * lands. Rendering it honestly and empty costs a row and keeps the geometry settled.
 *
 * No date, either. A date here would be a wall-clock read (§11.4 bans them in the
 * simulation; this is UI, so it would be legal) presented as though it selected today's
 * challenge — and it would not, because there is no challenge to select.
 */
import type { Catalogue } from '@hh/ui';
import type { JSX } from 'preact';

export interface DailyStripProps {
  readonly t: Catalogue['resolve'];
}

export const DailyStrip = ({ t }: DailyStripProps): JSX.Element => (
  <section class="hh-daily" data-testid="daily-strip" aria-labelledby="hh-daily-heading">
    <h2 class="hh-daily__heading" id="hh-daily-heading">
      {t('board.daily.heading', {})}
    </h2>
    <p class="hh-daily__state">{t('board.daily.notAttempted', {})}</p>
    <p class="hh-daily__submissions">{t('board.daily.noSubmissions', {})}</p>
    <p class="hh-daily__best">{t('board.daily.yourBest', {})}</p>
  </section>
);
