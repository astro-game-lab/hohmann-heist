/**
 * §8.7's two replay-code failures — #125.
 *
 * > *Replay code invalid or from a future schema version: explicit message naming the
 * > version mismatch, with a link to the release that can read it.*
 *
 * Two distinct states, not one, and the distinction is the whole row. A malformed code is
 * the sender's problem — ask for it again. A code from a *newer* schema is the reader's
 * problem, and telling someone to re-copy a code that arrived perfectly intact would send
 * them round a loop that cannot terminate. So the version mismatch names both numbers.
 *
 * ## Neither message is invented here
 *
 * `parseReplay` in `@hh/sim` already distinguishes them; this renders its answer. §11.6's
 * `v` field is the *schema* version, which is not the app's version and not the engine
 * major either (§14.4) — which is exactly why the message states the two numbers rather
 * than saying "update the game", and why the link goes to the release list rather than to
 * a tag this build would have to guess at. See `links.ts`.
 */
import type { Catalogue } from '@hh/ui';
import type { JSX } from 'preact';

import { RELEASES_URL } from '../links.js';

/** Which of §8.7's two replay rows to render. */
export type ReplayProblemKind =
  | { readonly kind: 'invalid' }
  | { readonly kind: 'futureVersion'; readonly found: number; readonly supported: number };

export interface ReplayProblemProps {
  readonly t: Catalogue['resolve'];
  readonly problem: ReplayProblemKind;
}

export const ReplayProblem = ({ t, problem }: ReplayProblemProps): JSX.Element => (
  <section
    class="hh-state hh-state--replay"
    role="status"
    data-testid="replay-problem"
    data-kind={problem.kind}
  >
    {problem.kind === 'invalid' ? (
      <>
        <h2 class="hh-state__heading">{t('state.replay.invalidHeading', {})}</h2>
        <p class="hh-state__body">{t('state.replay.invalidBody', {})}</p>
      </>
    ) : (
      <>
        <h2 class="hh-state__heading">{t('state.replay.futureHeading', {})}</h2>
        <p class="hh-state__body">
          {t('state.replay.futureBody', {
            found: problem.found,
            supported: problem.supported,
          })}
        </p>
        <a
          class="hh-state__action"
          href={RELEASES_URL}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="replay-problem-release"
        >
          {t('state.replay.release', {})}
        </a>
      </>
    )}
  </section>
);
