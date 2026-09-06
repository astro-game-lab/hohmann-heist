/**
 * The briefing — §8.3.3, #120.
 *
 * > *Purpose: state the job in the game's voice, then state the constraints in numbers.
 * > Ten seconds to read.*
 *
 * The first screen in the game that renders real content, and the last one before the
 * planner. Everything on it comes out of the contract's own JSON — nothing is written
 * into this file about any particular contract, which is what lets a contributor add one
 * and have it play (G6).
 *
 * ## Numbers arrive in SI and leave in display units, and the conversion is the
 * catalogue's
 *
 * §8.3.3 asks for "display units (km, m/s, h:mm)" with "a tooltip with the SI value".
 * Both renderings are catalogue messages: metres in, kilometres out is a locale decision
 * as much as a unit one — the decimal separator, the grouping, and where the abbreviation
 * goes all change with the language. This file therefore does no formatting at all. It
 * reads SI out of the loaded scenario, and hands it to a key.
 *
 * The tooltip is a `title` **and** a visually-hidden span. A `title` is invisible to
 * touch and unreliable to a screen reader, and §8.8's canvas-parity rule is really a
 * statement about the whole UI: nothing is available to one input method only. The
 * hidden span costs a few characters of markup and makes the unrounded quantity part of
 * the accessible text.
 *
 * ## Four states, and the one this build cannot decide
 *
 * First attempt, replay-with-best and the daily variant are all read out of the save and
 * the route. **Locked is not**: §6.8's unlock rule — an act opens when ⌈2/3⌉ of the
 * previous act's contracts have Bronze — is written once already, in
 * `tools/content/reachability.ts`, whose own docstring says it moves into `@hh/game`
 * when progression lands (#82, M3). Writing it a second time here to have something to
 * evaluate would be the exact duplication that note exists to prevent, and the copies
 * would disagree the first time one of them changed.
 *
 * So the lock is an **input**. This screen renders it and states the rule; deciding it is
 * #82's, and until then `App` passes nothing and every shipped contract is open — which
 * is also the truth, since the only contract that ships is in act I.
 */
import type { LoadedScenario } from '@hh/game';
import type { Catalogue } from '@hh/ui';
import type { JSX } from 'preact';
import { useEffect } from 'preact/hooks';

import { actionFor } from '../planner/keys.js';
import type { ContractProgress } from '../save/index.js';
import { useKeybindings } from '../settings/context.js';
import { hrefFor } from '../router.js';
import { ContractConstraints, ContractNumbers, ContractSetup } from './contract-content.js';

export interface BriefingProps {
  readonly t: Catalogue['resolve'];
  /** For the contract's own keys — `briefKey`, `clientKey` — which come from data. */
  readonly resolveDynamic: Catalogue['resolveDynamic'];
  readonly scenario: LoadedScenario;
  /** What the save holds for this contract. Absent on a first attempt. */
  readonly progress?: ContractProgress;
  /** Set when this contract is the daily variant for a date (§6.9). */
  readonly dailyDate?: string;
  /** Set when progression has not opened this contract. See the note above. */
  readonly locked?: boolean;
  readonly onAccept: () => void;
}

export const Briefing = ({
  t,
  resolveDynamic,
  scenario,
  progress,
  dailyDate,
  locked = false,
  onAccept,
}: BriefingProps): JSX.Element => {
  const { document: contract } = scenario;

  /**
   * §8.3.3: ACCEPT is bound to `Enter`.
   *
   * On the document rather than on the button, because focus is on the screen's heading
   * when the route change hands it over — a listener on the button would only fire for
   * someone who had already tabbed to it, which is the one person who does not need a
   * shortcut.
   *
   * It stands down for anything that has its own meaning for `Enter`: a focused control,
   * an editable field, a modifier held, or an event something else has already handled.
   * Without that guard, clicking ACCEPT with the keyboard would accept twice.
   */
  const rebinds = useKeybindings();

  useEffect(() => {
    if (locked) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.altKey || event.metaKey) return;
      // Through §8.5.3's table rather than comparing `event.key` — #187. `Enter` was
      // hard-coded here, which made "commit / confirm" the one row in the map that a
      // rebind could not reach: the planner honoured it and the briefing did not.
      const action = actionFor(
        'briefing',
        event.key,
        { shift: event.shiftKey, ctrl: event.ctrlKey },
        rebinds,
      );
      if (action?.kind !== 'commit') return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        if (target.isContentEditable) return;
        if (['BUTTON', 'A', 'INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      }
      onAccept();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [locked, onAccept, rebinds]);

  return (
    <div class="hh-briefing">
      <p class="hh-briefing__back">
        <a href={hrefFor('/board')}>{t('briefing.backToBoard', {})}</a>
      </p>

      {dailyDate === undefined ? null : (
        <p class="hh-briefing__daily" data-testid="daily-variant">
          <span>{t('briefing.dailyVariant', { date: dailyDate })}</span>{' '}
          <a href={hrefFor(`/leaderboard/${dailyDate}`)}>{t('briefing.leaderboardLink', {})}</a>
        </p>
      )}

      <p class="hh-briefing__meta">
        {contract.clientKey === undefined ? null : (
          <span data-testid="client">
            {t('briefing.clientLabel', {})} {resolveDynamic(contract.clientKey)}
          </span>
        )}
        {contract.fee_kcr === undefined ? null : (
          <span data-testid="fee">
            {t('briefing.feeLabel', {})} {t('briefing.fee', { kilocredits: contract.fee_kcr })}
          </span>
        )}
      </p>

      <p class="hh-briefing__brief" data-testid="brief">
        {resolveDynamic(contract.briefKey)}
      </p>

      <ContractNumbers t={t} scenario={scenario} />
      <ContractConstraints t={t} scenario={scenario} />
      <ContractSetup t={t} scenario={scenario} />

      <footer class="hh-briefing__footer">
        {locked ? (
          <p data-testid="locked">{t('briefing.locked', { act: contract.act })}</p>
        ) : (
          <button type="button" class="hh-briefing__accept" onClick={onAccept} data-testid="accept">
            {t('briefing.accept', {})}
          </button>
        )}
        <p class="hh-briefing__record" data-testid="record">
          <span>
            {progress?.bestDv_mps === undefined
              ? t('briefing.recordNone', {})
              : t('briefing.record', {
                  bestDvMps: progress.bestDv_mps,
                  medal: progress.medal ?? '',
                  attempts: progress.attempts,
                })}
          </span>{' '}
          <span>{t('briefing.attempts', { attempts: progress?.attempts ?? 0 })}</span>
        </p>
      </footer>
    </div>
  );
};

/** Shown when a URL names a contract that does not ship. */
export const UnknownContract = ({
  t,
  id,
}: {
  readonly t: Catalogue['resolve'];
  readonly id: string;
}): JSX.Element => (
  <>
    <p data-testid="unknown-contract">{t('briefing.unknownContract', { id })}</p>
    <p>
      <a href={hrefFor('/board')}>{t('briefing.backToBoard', {})}</a>
    </p>
  </>
);
