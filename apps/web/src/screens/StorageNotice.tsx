/**
 * "Progress can't be saved" — FR-702's player-facing half, §8.6, §8.7 (#184).
 *
 * > *The game MUST remain fully playable when storage is unavailable, with a non-blocking
 * > notice.*
 *
 * The mechanism was already right: `storage.ts` distinguishes absent, unavailable, corrupt
 * and full, and never throws. Two of those four were rendered — `SaveNotice` covers
 * corrupt and version — and the other two were not, so a player in Safari with cookies
 * blocked played a full contract and lost it in silence. That silence is the bug; this is
 * the fix.
 *
 * ## Two states, and they need different words
 *
 * **Unavailable** is known at load and has always been true for this player: the browser
 * will not store, nothing was ever going to be kept, and the honest sentence is §8.6's —
 * *"Progress can't be saved in this browser mode. The game still works."*
 *
 * **Full** is the worse one, and it is a *change*: saving used to work and has stopped,
 * discovered at write time, after the player did something worth keeping. It has to appear
 * at that moment rather than at the next load, because the next load is where the loss
 * would be discovered instead.
 *
 * ## The escape hatch is export, not an apology
 *
 * FR-703's export is the only recovery that exists for either state — there is no account
 * and no server (D11) — so the notice offers it rather than only saying sorry. It reads the
 * **in-memory** save, which is what makes it work at all here: re-reading storage would
 * return nothing, which is the whole problem being reported.
 *
 * ## What it deliberately is not
 *
 * Not modal, not focus-trapping, not blocking, and `role="status"` rather than `alert` —
 * the same choice `SaveNotice` makes, for the same reason: nothing is waiting on it, and an
 * assertive live region would interrupt whatever the screen reader was saying about the
 * screen the player is on. Dismissible, and it stays dismissed for the session: a
 * quota-full notice that reappeared on every subsequent write would be a modal built out of
 * a banner.
 */
import type { Catalogue } from '@hh/ui';
import type { JSX } from 'preact';

/** Which of the two storage states is being reported. */
export type StorageProblem = 'unavailable' | 'full';

export interface StorageNoticeProps {
  readonly t: Catalogue['resolve'];
  readonly problem: StorageProblem;
  /** Downloads the in-memory save. Never reads storage — see the docstring. */
  readonly onExport: () => void;
  readonly onDismiss: () => void;
}

export const StorageNotice = ({
  t,
  problem,
  onExport,
  onDismiss,
}: StorageNoticeProps): JSX.Element => (
  <div
    class="hh-save-notice hh-save-notice--storage"
    role="status"
    data-testid="storage-notice"
    data-problem={problem}
  >
    <p>{t(problem === 'unavailable' ? 'save.unavailable' : 'save.full', {})}</p>
    <button type="button" data-testid="storage-notice-export" onClick={onExport}>
      {t('save.notice.export', {})}
    </button>
    <button type="button" data-testid="storage-notice-dismiss" onClick={onDismiss}>
      {t('save.notice.dismiss', {})}
    </button>
  </div>
);
