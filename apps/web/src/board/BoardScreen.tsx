/**
 * The contract board — §8.3.2, FR-302, FR-303, FR-304, §6.7, §6.8, §6.10, #119.
 *
 * > *Purpose: show progress, communicate the shape of the campaign, and make the next
 * > contract obvious.*
 *
 * It is the screen that turns seven contracts into a game: without it M3 is a set of URLs.
 * It is also where §6.7's medals and §6.8's progression become *visible*, which is the
 * point of computing them.
 *
 * ## It contains no rules
 *
 * Every gate on this screen comes from one `progression()` call (#82) and nothing else.
 * The ⌈2/3⌉ threshold, which act is open, which contract is `NEXT`, and what a locked card
 * says are all read out of its result — there is deliberately no second copy of §6.8's
 * rule here, which is what lets the direct-URL guard in `app.tsx` use the same function and
 * be unable to disagree with what the player is looking at.
 *
 * The acts are the ones the **registry actually ships**, so Acts I–II render correctly with
 * Acts III–VI unwritten, and Act III appears the day its contracts do without an edit here.
 * §8.3.2's mockup draws a locked Act III of `??` cards; that row is rendered from
 * registered contracts, so at M3 there is nothing to draw and drawing three grey rectangles
 * for contracts that do not exist would be inventing content.
 *
 * ## Focus lands on `NEXT`, and this screen is the one that puts it there
 *
 * §8.3.2 puts keyboard entry on the next contract, and that is the board's whole navigation
 * story: a returning player presses Tab once and is where they left off.
 *
 * It has to happen **here** rather than in the card, for two reasons found by driving the
 * real app rather than by reading the code:
 *
 * - `Screen` moves focus to the `<h1>` on every route change (#117), and Preact runs child
 *   effects before parent ones — so a card focusing itself was immediately overridden by
 *   the shell, and the board opened with focus on its heading. `app.tsx` now stands the
 *   shell's focus down for this route, and this screen takes responsibility for the whole
 *   of it, including the fallback.
 * - There may be **no** next contract, once every unlocked one is Bronzed. Then focus has
 *   to go somewhere sensible rather than nowhere, and "nowhere" means `<body>` — which is
 *   exactly the stranding #117 exists to prevent. The heading is the fallback.
 *
 * On mount only: `Screen` is keyed by route, so this runs once per visit and never on a
 * re-render, or a save write would pull focus back mid-tab.
 *
 * ## Broken contracts are shown, not hidden
 *
 * §8.7's scenario row (#125). A contract whose data was refused cannot be placed in an act —
 * its `act` and `index` are in the document that failed validation — so it cannot be a card.
 * It gets its own section at the end naming each failure. In any build the content suite has
 * passed there are none, which is every build on `main`.
 */
import { progression, type ProgressionContract } from '@hh/game';
import type { Catalogue } from '@hh/ui';
import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

import { brokenContracts, contracts } from '../contracts/registry.js';
import { Icon } from '../icons/index.js';
import { hrefFor } from '../router.js';
import type { ContractProgress } from '../save/index.js';
import { ScenarioProblem } from '../screens/ScenarioProblem.js';

import { ContractCard, LockedCard } from './ContractCard.js';
import { DailyStrip } from './DailyStrip.js';
import { careerCredits } from './credits.js';

export interface BoardScreenProps {
  readonly t: Catalogue['resolve'];
  readonly resolveDynamic: Catalogue['resolveDynamic'];
  readonly records: Readonly<Record<string, ContractProgress>>;
}

export const BoardScreen = ({ t, resolveDynamic, records }: BoardScreenProps): JSX.Element => {
  const shipped = contracts();
  const broken = brokenContracts();

  const byId = new Map(shipped.map((scenario) => [scenario.id, scenario]));

  const progressionContracts: readonly ProgressionContract[] = shipped.map((scenario) => ({
    id: scenario.id,
    act: scenario.document.act,
    index: scenario.document.index,
  }));

  const state = progression(progressionContracts, records);
  const credits = careerCredits(shipped, records);

  const nextRef = useRef<HTMLAnchorElement>(null);

  // §8.3.2's *"keyboard focus lands here on entry"* — see the module docstring on why this
  // is the board's job and not the card's. `HEADING_ID` is `Screen`'s, looked up rather
  // than passed because only one screen is mounted at a time, which is the same reason
  // that id is a constant.
  useEffect(() => {
    const target = nextRef.current ?? document.getElementById('hh-content');
    target?.focus();
  }, []);

  return (
    <div class="hh-board" data-testid="board-screen">
      <div class="hh-board__bar">
        <a class="hh-board__back" href={hrefFor('/')} data-testid="board-back">
          <Icon name="chevron" class="hh-board__back-glyph" />
          <span>{t('board.backToTitle', {})}</span>
        </a>

        <p class="hh-board__credits" data-testid="board-credits">
          <span class="hh-board__credits-label">{t('board.creditsLabel', {})}</span>
          <span class="hh-board__credits-value">
            {t('board.credits', { kilocredits: credits })}
          </span>
        </p>

        <a class="hh-board__settings" href={hrefFor('/settings')} data-testid="board-settings">
          <Icon name="settings" label={t('board.settings', {})} />
        </a>
      </div>

      {state.acts.map((act) => {
        const headingId = `hh-act-${String(act.act)}`;
        return (
          <section
            class="hh-act"
            key={act.act}
            data-act={act.act}
            data-unlocked={act.unlocked}
            data-testid={`act-${String(act.act)}`}
            aria-labelledby={headingId}
          >
            <header class="hh-act__header">
              <h2 class="hh-act__heading" id={headingId}>
                {t('board.actName', { act: act.act })}
              </h2>
              <p class="hh-act__progress" data-testid={`act-progress-${String(act.act)}`}>
                {t('board.actProgress', { bronzed: act.bronzed, total: act.contracts.length })}
              </p>
              {act.lock === undefined ? null : (
                <p class="hh-act__lock" data-testid={`act-lock-${String(act.act)}`}>
                  <Icon name="lock" class="hh-act__lock-glyph" />
                  <span>
                    {t('board.actLocked', {
                      requiredAct: act.lock.requiredAct,
                      required: act.lock.required,
                      earned: act.lock.earned,
                    })}
                  </span>
                </p>
              )}
            </header>

            <ul class="hh-act__cards" aria-label={t('board.cardsLabel', { act: act.act })}>
              {act.contracts.map((id) => {
                const scenario = byId.get(id);
                if (scenario === undefined) return null;
                const lock = state.locks[id];

                // A locked card never receives the scenario — see `ContractCard`'s
                // docstring on why the title is kept out of reach rather than unrendered.
                return lock === undefined ? (
                  <ContractCard
                    key={id}
                    t={t}
                    scenario={scenario}
                    progress={records[id]}
                    isNext={state.next === id}
                    {...(state.next === id ? { linkRef: nextRef } : {})}
                  />
                ) : (
                  <LockedCard key={id} t={t} act={act.act} lock={lock} />
                );
              })}
            </ul>
          </section>
        );
      })}

      {broken.length === 0
        ? null
        : broken.map((contract) => (
            <ScenarioProblem
              key={contract.id}
              t={t}
              resolveDynamic={resolveDynamic}
              id={contract.id}
              errors={contract.errors}
            />
          ))}

      <DailyStrip t={t} />
    </div>
  );
};
