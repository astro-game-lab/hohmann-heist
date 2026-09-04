/**
 * `/#/contract/:id` — §8.2's "Briefing → planner".
 *
 * One route covering two screens, which is §8.2's own arrangement rather than a shortcut:
 * accepting a contract is not navigation, it is the same job seen from the inside. That
 * has a consequence worth stating — **Back from the planner returns to the board, not to
 * the briefing** — and it is the right one. Re-reading a brief you accepted four seconds
 * ago is not a thing anyone wants a history entry for, and §8.3.3's "no loading screen"
 * only means anything if ACCEPT does not go through the router at all.
 *
 * Accepting swaps the briefing for the planner in place. Nothing navigates, so there is
 * no router round trip, no second parse of the contract and no frame in which the screen
 * is empty — which is what makes §8.3.3's "no loading screen" true rather than asserted.
 */
import type { LoadedScenario } from '@hh/game';
import type { Catalogue } from '@hh/ui';
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';

import type { ContractProgress } from '../save/index.js';
import { PlannerScreen } from '../planner/PlannerScreen.js';
import { Briefing } from './Briefing.js';

export interface ContractScreenProps {
  readonly t: Catalogue['resolve'];
  readonly resolveDynamic: Catalogue['resolveDynamic'];
  readonly scenario: LoadedScenario;
  readonly progress?: ContractProgress;
  /** Counts the attempt and persists it. Called once per acceptance. */
  readonly onAccept: () => void;
}

export const ContractScreen = ({
  t,
  resolveDynamic,
  scenario,
  progress,
  onAccept,
}: ContractScreenProps): JSX.Element => {
  const [accepted, setAccepted] = useState(false);

  if (accepted) {
    return <PlannerScreen t={t} resolveDynamic={resolveDynamic} scenario={scenario} />;
  }

  return (
    <Briefing
      t={t}
      resolveDynamic={resolveDynamic}
      scenario={scenario}
      {...(progress === undefined ? {} : { progress })}
      onAccept={() => {
        onAccept();
        setAccepted(true);
      }}
    />
  );
};
