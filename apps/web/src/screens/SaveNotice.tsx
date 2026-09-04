/**
 * "Your progress could not be read" — #183's *reported and recoverable*.
 *
 * The save module refuses rather than repairs: a corrupt or newer-than-this-build
 * document is left exactly where it is, and an empty save is handed back so the game
 * keeps working. That is only half of "recoverable" — the other half is that the player
 * is told, because a game that silently starts you from nothing is indistinguishable from
 * a game that ate your progress.
 *
 * Deliberately small. #167 owns the storage-unavailable notice and whatever affordance
 * goes with it (export the damaged file, clear it, retry); this is the sentence that has
 * to be true before any of that: *nothing has been overwritten*.
 *
 * `role="status"` rather than `role="alert"`: it is not urgent, nothing is waiting on it,
 * and an assertive live region would interrupt whatever the screen reader was saying about
 * the screen the player just arrived on.
 */
import type { Catalogue } from '@hh/ui';
import type { JSX } from 'preact';

import type { SaveProblem } from '../save/index.js';

export interface SaveNoticeProps {
  readonly t: Catalogue['resolve'];
  readonly problem: SaveProblem;
}

export const SaveNotice = ({ t, problem }: SaveNoticeProps): JSX.Element => {
  // The version numbers are only present on a version problem, and a message that
  // rendered "save format undefined" would be worse than the generic one.
  const message =
    problem.found === undefined || problem.supported === undefined
      ? t('save.problem.unreadable', {})
      : problem.code === 'futureVersion'
        ? t('save.problem.futureVersion', { found: problem.found, supported: problem.supported })
        : t('save.problem.unknownVersion', { found: problem.found, supported: problem.supported });

  return (
    <p class="hh-save-notice" role="status" data-testid="save-notice">
      {message}
    </p>
  );
};
