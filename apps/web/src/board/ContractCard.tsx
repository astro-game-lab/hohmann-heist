/**
 * One card on the contract board — §8.3.2, FR-304, #119.
 *
 * > *Card: number, title, best medal, best Δv, par. Locked cards show act name and unlock
 * > rule, never the contract title (preserves the reveal).*
 *
 * Two renderings, and they are separate components rather than one with branches, because
 * the thing that must not happen is a locked card leaking the title. A single component
 * holding the scenario and choosing what to print keeps the title one `if` away from the
 * output for the rest of the file's life; {@link LockedCard} is never handed it.
 *
 * ## Par is unconditional
 *
 * FR-304: par is displayed *always*, played or not. That is the game telling the player
 * what good looks like before they try, which is the opposite of hiding the target until
 * they have missed it — and it is why par sits outside the "have you played this" branch.
 *
 * ## `NEXT` is a marker, and the focus is the board's
 *
 * The board decides which card is next (#82) and passes it down. The card renders the
 * marker and hands its link back through a ref; **it does not focus itself**. That looks
 * like indirection and is not: the board has to be able to fall back to the heading when
 * there is no next contract, and a card that grabbed focus in its own mount effect would
 * also run *before* the shell's heading focus and lose to it. Both problems belong to one
 * owner, and it is the board. See `BoardScreen`.
 */
import type { LoadedScenario } from '@hh/game';
import type { LockReason } from '@hh/game';
import type { Catalogue } from '@hh/ui';
import type { JSX, RefObject } from 'preact';

import { Icon } from '../icons/index.js';
import { hrefFor } from '../router.js';
import type { ContractProgress } from '../save/index.js';

import { Medal } from './Medal.js';

export interface ContractCardProps {
  readonly t: Catalogue['resolve'];
  readonly scenario: LoadedScenario;
  readonly progress: ContractProgress | undefined;
  /** §8.3.2's `NEXT`. Exactly one card on the board has this. */
  readonly isNext: boolean;
  /** Given to the `NEXT` card only, so the board can put focus on it. */
  readonly linkRef?: RefObject<HTMLAnchorElement>;
}

export const ContractCard = ({
  t,
  scenario,
  progress,
  isNext,
  linkRef,
}: ContractCardProps): JSX.Element => {
  const { index, title, par } = scenario.document;
  const medal = progress?.medal;
  const bestDv = progress?.bestDv_mps;

  return (
    <li class="hh-card" data-next={isNext} data-testid={`card-${scenario.id}`}>
      <a
        class="hh-card__link"
        href={hrefFor(`/contract/${scenario.id}`)}
        {...(linkRef === undefined ? {} : { ref: linkRef })}
        aria-label={t('board.cardLabel', { index, title })}
        data-testid={`card-link-${scenario.id}`}
      >
        <span class="hh-card__number">{t('board.cardNumber', { index })}</span>
        <span class="hh-card__title">{title}</span>

        {isNext ? (
          <span class="hh-card__next" data-testid="next-marker">
            <Icon name="chevron" class="hh-card__next-glyph" />
            <span>{t('board.next', {})}</span>
          </span>
        ) : null}

        <span class="hh-card__record">
          {medal === undefined ? null : <Medal t={t} medal={medal} />}
          {bestDv === undefined ? (
            <span class="hh-card__unplayed">{t('board.notAttempted', {})}</span>
          ) : (
            <span class="hh-card__best">{t('board.best', { dvMps: bestDv })}</span>
          )}
          {/* FR-304: always, played or not. */}
          <span class="hh-card__par" data-testid={`card-par-${scenario.id}`}>
            {t('board.par', { dvMps: par.dv_mps })}
          </span>
        </span>
      </a>
    </li>
  );
};

export interface LockedCardProps {
  readonly t: Catalogue['resolve'];
  /** The act this card sits in — the act named on it. Never the act that unlocks it. */
  readonly act: number;
  readonly lock: LockReason;
}

/**
 * A locked card.
 *
 * **It is not a link.** §8.3.3 says a locked contract is *"unreachable by UI"*, and a
 * disabled-looking anchor that still navigates is the commonest way that promise gets
 * broken. There is nothing to focus and nothing to activate; the direct-URL path is
 * separately guarded by the same `progression` call, so typing the address shows the same
 * rule rather than the briefing.
 *
 * It carries no title, and — see the module docstring — is never given one.
 *
 * ## It names its own act, and has no `aria-label`
 *
 * Both were wrong in the browser before they were right. The act shown is the one the card
 * **belongs to**, not `lock.requiredAct` — an Act II card that said "Act I" read as though
 * it were an Act I card, which is the opposite of communicating the shape of the campaign.
 *
 * And there is no `aria-label`: it used to carry the card's position within its act, so
 * C05–C07 announced themselves as "Contract 01/02/03 — locked" while C01–C03 sat unlocked
 * above them. An `aria-label` *replaces* the content a screen reader would otherwise read,
 * so the fix is not a better label but no label — the card's own text is accurate, and it
 * is what should be announced.
 */
export const LockedCard = ({ t, act, lock }: LockedCardProps): JSX.Element => (
  <li class="hh-card hh-card--locked" data-testid="locked-card">
    <div class="hh-card__link">
      <span class="hh-card__number">{t('board.lockedCardNumber', {})}</span>
      <span class="hh-card__lock">
        <Icon name="lock" class="hh-card__lock-glyph" />
        <span>{t('board.actName', { act })}</span>
      </span>
      <span class="hh-card__rule">
        {t('board.actLocked', {
          requiredAct: lock.requiredAct,
          required: lock.required,
          earned: lock.earned,
        })}
      </span>
    </div>
  </li>
);
