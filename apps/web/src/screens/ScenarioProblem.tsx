/**
 * §8.7's scenario refusal — #125.
 *
 * > *Scenario fails schema validation: refuse to load it, show which field failed, and
 * > offer to report it. Never load a partially valid scenario.*
 *
 * All three of those decisions were made before this component sees anything.
 * `parseScenario` refused, and it produced a JSON pointer and a catalogue key per problem;
 * the registry kept them instead of stringifying them into an `Error` (see
 * `contracts/registry.ts`). So this **adds no policy** — it lays out what the loader
 * already decided, which is #125's own rule about itself.
 *
 * ## Why the field matters
 *
 * "This contract is invalid" tells the one person who could fix it — a contributor writing
 * a scenario, which is G6's whole audience — nothing at all. `/ship/dvBudget_mps: must be
 * a number` tells them where to look. FR-202 asks for a field-level error and this is the
 * surface that keeps that promise.
 *
 * ## The report affordance is prefilled
 *
 * With the id and every failing pointer, because a report that says "a contract did not
 * load" costs a round trip to become actionable. It is a link rather than a button: nothing
 * is submitted from the game, and a player who does not want to file anything should be
 * able to see that by reading the URL.
 *
 * ## It does not block
 *
 * NFR-014. This is a section on a screen that otherwise works — the board still lists every
 * contract that *did* load, and the game is still playable. It is never a modal.
 */
import type { ScenarioError } from '@hh/game';
import type { Catalogue } from '@hh/ui';
import type { JSX } from 'preact';

import { issueHref } from '../links.js';
import { BUILD_ID } from '../version.js';

export interface ScenarioProblemProps {
  readonly t: Catalogue['resolve'];
  /** The loader's messages are `@hh/game` keys, so they resolve dynamically. */
  readonly resolveDynamic: Catalogue['resolveDynamic'];
  readonly id: string;
  readonly errors: readonly ScenarioError[];
}

export const ScenarioProblem = ({
  t,
  resolveDynamic,
  id,
  errors,
}: ScenarioProblemProps): JSX.Element => {
  const rows = errors.map((error) => ({
    path: error.path,
    detail: resolveDynamic(error.message.key, error.message.params),
  }));

  const href = issueHref({
    title: `scenario: ${id} fails validation`,
    labels: 'bug',
    body: [
      `Contract: \`${id}\``,
      `Build: ${BUILD_ID}`,
      '',
      'Reported by the game as:',
      '',
      ...rows.map((row) => `- \`${row.path}\` — ${row.detail}`),
    ].join('\n'),
  });

  return (
    <section
      class="hh-state hh-state--scenario"
      role="status"
      data-testid={`scenario-problem-${id}`}
    >
      <h2 class="hh-state__heading">{t('state.scenario.heading', { id })}</h2>
      <p class="hh-state__body">{t('state.scenario.body', {})}</p>
      <ul class="hh-state__fields" data-testid="scenario-problem-fields">
        {rows.map((row) => (
          <li key={row.path + row.detail}>{t('state.scenario.field', row)}</li>
        ))}
      </ul>
      <a class="hh-state__action" href={href} target="_blank" rel="noopener noreferrer">
        {t('state.scenario.report', {})}
      </a>
    </section>
  );
};
