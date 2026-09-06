/**
 * §8.3.4's region ① — the HUD bar. #127, FR-401, FR-403, FR-406.
 *
 * Contract identity, Δv against budget with a bar, and MET at the scrub head. Three
 * things, and each one is a decision worth naming.
 *
 * ## The Δv bar's three levels are words first
 *
 * §8.3.4: *"Δv bar turns amber at 90%, red and `L1` at >100%."* Colour is the least of
 * that. §8.3.4's own fifth principle and §8.8 both refuse to let colour carry a meaning
 * alone, so the bar is a `progressbar` whose accessible name is a sentence — "Δv near
 * budget — 231.0 of 250 m/s" — and the fill colour reinforces a state the markup has
 * already stated. `data-level` carries it for CSS; the catalogue carries it for people.
 *
 * The thresholds themselves come from `@hh/game`: `BUDGET_WARNING_FRACTION` is 0.9 and
 * `BudgetLevel` is already computed by `evaluateBudget`, so this reads a level rather
 * than comparing a fraction. That matters for the "and `L1`" half of the sentence —
 * over-budget is a legality reason, and if this component decided "over" on its own it
 * could disagree with the reason list two regions away.
 *
 * ## The burn count is shown because it is soft, not in spite of it
 *
 * §6.5's cap never disables *Commit* — `constraints/burn-count.ts` says why at length —
 * so the only thing that makes it a constraint rather than a hidden Gold threshold is
 * that a player can see it while they plan. §6.5's own closing line is *"a player never
 * discovers a constraint by failing it"*, and for a soft one this readout is the whole of
 * that promise. A contract with no cap renders nothing here rather than a blank or an
 * infinity, which is the same distinction the evaluation keeps in its `null`.
 *
 * ## MET tracks the scrub head, not the wall clock
 *
 * FR-403 makes scrubbing a pure view operation, and #127's third criterion says MET
 * follows it. There is no clock in this component and no state: it renders the MET of
 * whatever epoch it is handed, which is the scrub head's. That is what makes scrubbing
 * back and forth show the same reading each time.
 */
import { metAt, type Epoch } from '@hh/astro';
import type { BudgetEvaluation, BurnCountEvaluation } from '@hh/game';
import type { Catalogue } from '@hh/ui';
import type { JSX } from 'preact';

import { hrefFor } from '../router.js';
import { Value } from './Value.js';

export interface HudBarProps {
  readonly t: Catalogue['resolve'];
  readonly contractIndex: number;
  readonly contractTitle: string;
  readonly budget: BudgetEvaluation;
  /**
   * §6.5's burn-count cap, evaluated on every plan change.
   *
   * Rendered only when the contract declares one — `maxBurns` is `null` otherwise, and
   * there is nothing to show a player about a limit that does not exist.
   */
  readonly burnCount: BurnCountEvaluation;
  /** The timeline's start, so MET can be measured from it. */
  readonly startEpoch: Epoch;
  /** Where the scrub head is. MET is read from here, never from a clock (FR-403). */
  readonly scrubEpoch: Epoch;
  readonly onOpenHelp: () => void;
  /** Whether §8.3.3's contract panel is showing — #264. */
  readonly contractOpen: boolean;
  readonly onToggleContract: () => void;
}

export const HudBar = ({
  t,
  contractIndex,
  contractTitle,
  budget,
  burnCount,
  startEpoch,
  scrubEpoch,
  onOpenHelp,
  contractOpen,
  onToggleContract,
}: HudBarProps): JSX.Element => {
  const metSeconds = metAt(startEpoch, scrubEpoch);
  // `fraction` is `Infinity` for a zero budget with any spend, which would make the bar's
  // width `NaN%`. Clamped for the *fill* only — the accessible name and the level still
  // report the real number, because "infinitely over budget" is a true and useful thing
  // to be told.
  const fillPercent = Math.max(0, Math.min(1, budget.fraction)) * 100;

  return (
    <header class="hh-hud" aria-label={t('planner.region.hud', {})}>
      <a class="hh-hud__back" href={hrefFor('/board')}>
        {t('planner.hud.back', {})}
      </a>

      <span class="hh-hud__contract" data-testid="hud-contract">
        {t('planner.hud.contract', { index: contractIndex, title: contractTitle })}
      </span>

      <div class="hh-hud__budget">
        <span class="hh-hud__label">{t('planner.hud.dvLabel', {})}</span>
        <Value
          name="dv"
          display={t('planner.hud.dv', {
            usedMps: budget.usedMps,
            budgetMps: budget.budgetMps,
          })}
          precise={t('planner.si.metresPerSecond', { metresPerSecond: budget.usedMps })}
        />
        <div
          class="hh-dv-bar"
          role="progressbar"
          // `valuenow` is the spend, not the percentage, so assistive technology reads the
          // same number the label does rather than a second derived one.
          aria-valuenow={budget.usedMps}
          aria-valuemin={0}
          aria-valuemax={budget.budgetMps}
          aria-label={t('planner.hud.dvBar', {
            fraction: budget.fraction,
            usedMps: budget.usedMps,
            budgetMps: budget.budgetMps,
          })}
          data-level={budget.level}
          data-testid="hud-dv-bar"
        >
          <div class="hh-dv-bar__fill" style={{ width: `${String(fillPercent)}%` }} />
        </div>
      </div>

      {burnCount.maxBurns === null ? null : (
        <div class="hh-hud__burns" data-hh-anchor="burns">
          <span class="hh-hud__label">{t('planner.hud.burnsLabel', {})}</span>
          <span
            data-testid="hud-burns"
            data-exceeded={String(burnCount.exceeded)}
            aria-label={t('planner.hud.burnsStatus', {
              burns: burnCount.burns,
              maxBurns: burnCount.maxBurns,
            })}
          >
            {t('planner.hud.burns', { burns: burnCount.burns, maxBurns: burnCount.maxBurns })}
          </span>
        </div>
      )}

      <div class="hh-hud__met">
        <span class="hh-hud__label">{t('planner.hud.metLabel', {})}</span>
        <span data-testid="hud-met">{t('planner.hud.met', { metSeconds })}</span>
      </div>

      {/*
        #264's discoverable control, beside `?` and `⚙` where §8.3.3's other
        always-available affordances live. `aria-pressed` rather than a label that changes:
        the control's name is what it shows, and its state is the button's own — a control
        that renamed itself between "Show contract" and "Hide contract" would be announced
        as a different control each time it was used.
      */}
      <button
        type="button"
        class="hh-hud__control"
        aria-pressed={contractOpen}
        data-testid="hud-contract-toggle"
        onClick={onToggleContract}
      >
        {t('planner.contract.toggle', {})}
      </button>
      <button type="button" class="hh-hud__control" onClick={onOpenHelp}>
        {t('planner.hud.help', {})}
      </button>
      <a class="hh-hud__control" href={hrefFor('/settings')}>
        {t('planner.hud.settings', {})}
      </a>
    </header>
  );
};
