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
 * The planner is #123 and the eleven issues around it, and it is PR 5 of this milestone.
 * Until it lands, accepting reaches a placeholder — which is still worth having, because
 * it is what makes the `Enter` binding, the attempt count and the save write observable
 * end to end.
 */
import type { LoadedScenario } from '@hh/game';
import type { Catalogue } from '@hh/ui';
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';

import type { ContractProgress } from '../save/index.js';
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
    return (
      <p data-testid="planner-placeholder" class="hh-briefing__planner">
        {t('screen.notBuiltYet', {})}
      </p>
    );
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
