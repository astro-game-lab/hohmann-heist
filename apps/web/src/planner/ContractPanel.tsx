/**
 * The contract, still readable while planning — §8.3.3, §8.3.4, §8.8, FR-910, D14 (#264).
 *
 * ACCEPT is a one-way door. Everything §8.3.3 states in numbers — the objective, par, the
 * constraints, the target's setup — was gone the moment the planner opened, and the HUD
 * carried only the Δv budget and the deadline. A player planning a transfer had to remember
 * what they were aiming at, or go back to the board and lose their plan.
 *
 * Raised from playing the shipped Acts I–II build rather than by a test, and nothing was
 * broken: the information was simply absent at the moment it was wanted. C07 is the case
 * that makes it urgent — its objective is three numbers, none of which the planner showed,
 * and all of which are needed to plan the burn.
 *
 * ## It renders the briefing's content, from the briefing's own code
 *
 * Every line here comes from `contract-content.tsx`, which `Briefing.tsx` also calls. Not a
 * second rendering: two copies of "how a contract describes itself" is two things to keep
 * in step, and the one that drifts first is the one the player sees least — which would be
 * this one. `ContractPanel.test.tsx` asserts the two render identical text for the same
 * scenario, so the shared module cannot grow a caller-specific branch unnoticed.
 *
 * ## A panel, not a modal
 *
 * §8.3.4 keeps the timeline visible at all times and §6.3 makes direct manipulation the
 * whole game, so the contract must cover neither. It is a fourth entry in the same panel
 * strip the plan, the readouts and the assists already live in — which costs no new layout
 * machinery, because `PlannerScreen` mounts every panel at once and hides them with
 * `hidden`. A fourth therefore loses nothing on a layout switch, for the same structural
 * reason the other three do not.
 *
 * ## Always there, where it used to be summoned
 *
 * #264 shipped this collapsible: a control in the HUD, `B` to toggle it, and a session
 * preference so a player who wanted it up did not re-open it on every contract. All three
 * are gone, and the reason is what that preference was recording — everyone who opened it
 * left it open. The objective, the budget, the deadline and the par are checked against on
 * every burn, not read once, so a panel that had to be summoned to answer "how close is
 * close enough" was summoned every time. It is now the fourth panel unconditionally, and
 * the column it sits in scrolls, so what it costs is a scroll rather than a hidden region.
 *
 * ## It changes nothing
 *
 * Not the plan, not the scrub head, not the selection, not playback. That is the rule §8.8
 * already applies to the help overlay, and it is why this component takes a scenario and a
 * catalogue and no callbacks that could edit anything: there is nothing here that *could*
 * change the plan, rather than nothing that does.
 */
import type { LoadedScenario } from '@hh/game';
import type { Catalogue } from '@hh/ui';
import type { JSX } from 'preact';

import {
  ContractConstraints,
  ContractNumbers,
  ContractSetup,
} from '../screens/contract-content.js';

export interface ContractPanelProps {
  readonly t: Catalogue['resolve'];
  /** For the contract's own keys — `briefKey`, `clientKey` — which come from data. */
  readonly resolveDynamic: Catalogue['resolveDynamic'];
  readonly scenario: LoadedScenario;
}

export const ContractPanel = ({ t, resolveDynamic, scenario }: ContractPanelProps): JSX.Element => {
  const { document: contract } = scenario;
  return (
    <section class="hh-contract" data-testid="contract-panel">
      <h2 class="hh-panel__heading">{t('planner.contract.heading', {})}</h2>

      <p class="hh-contract__title" data-testid="contract-title">
        {t('planner.hud.contract', { index: contract.index, title: contract.title })}
      </p>

      {/*
        The brief itself, resolved through the catalogue by key (FR-910, D14). No prose in
        this component, exactly as the briefing has none.
      */}
      <p class="hh-contract__brief" data-testid="contract-brief">
        {resolveDynamic(contract.briefKey)}
      </p>

      <ContractNumbers t={t} scenario={scenario} />
      <ContractConstraints t={t} scenario={scenario} />
      <ContractSetup t={t} scenario={scenario} />
    </section>
  );
};
