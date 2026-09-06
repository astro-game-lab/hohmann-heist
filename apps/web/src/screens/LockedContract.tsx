/**
 * A locked contract, reached by typing its URL — §8.3.3, #119.
 *
 * > *locked (unreachable by UI; direct-URL access shows the unlock rule)*
 *
 * The board renders no link to a locked card, so this is only reachable by editing the
 * hash, following an old shared link, or returning to a bookmark from a save that has since
 * been cleared. The last of those is the one that matters: it is a player whose progress
 * went away, and the useful answer is the rule, not a refusal.
 *
 * The rule arrives as #82's `LockReason` — the same value the board's card renders, from
 * the same `progression()` call. Nothing here recomputes it, which is what makes it
 * impossible for this screen and the board to disagree about whether a contract is open.
 */
import type { LockReason } from '@hh/game';
import type { Catalogue } from '@hh/ui';
import type { JSX } from 'preact';

import { Icon } from '../icons/index.js';
import { hrefFor } from '../router.js';

export interface LockedContractProps {
  readonly t: Catalogue['resolve'];
  readonly lock: LockReason;
}

export const LockedContract = ({ t, lock }: LockedContractProps): JSX.Element => (
  <section class="hh-state hh-state--locked" role="status" data-testid="locked-contract">
    <h2 class="hh-state__heading">
      <Icon name="lock" class="hh-state__glyph" />
      <span>{t('board.lockedContract.heading', {})}</span>
    </h2>
    <p class="hh-state__body" data-testid="locked-contract-rule">
      {t('board.actLocked', {
        requiredAct: lock.requiredAct,
        required: lock.required,
        earned: lock.earned,
      })}
    </p>
    <a class="hh-state__action" href={hrefFor('/board')}>
      {t('board.lockedContract.back', {})}
    </a>
  </section>
);
