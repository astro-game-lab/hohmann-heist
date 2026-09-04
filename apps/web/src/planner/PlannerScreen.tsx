/**
 * The planner — §8.3.4, #123. The screen the game is played on.
 *
 * Composes the five regions and decides which of them is on screen at which width. It
 * owns no plan state: `usePlanner` holds the model and every region takes props, so the
 * layout can change without anything else noticing — which is #123's fifth criterion, and
 * the reason it is met rather than tested for.
 *
 * ## One tree, two layouts, and the state cannot be lost
 *
 * §8.3.4 gives a wide arrangement — five regions in a grid — and a narrow one where the
 * three side panels collapse into a tab strip. The obvious implementation renders one
 * component tree above 1024 px and a different one below, and it is wrong in a way that
 * only shows up on a rotating phone: the two trees are different components, so switching
 * unmounts one and mounts the other, and every piece of local state in them is gone.
 *
 * So there is **one tree**. The same `PlanPanel`, `Readouts` and `AssistTray` instances
 * are rendered at every width; what changes is whether they sit in a grid column or
 * inside a tab panel, and that is CSS plus one `hidden` attribute. The plan, the
 * selection and the scrub position live above all of it in `usePlanner` regardless.
 *
 * The tab strip is therefore *also* present at every width and hidden by CSS above the
 * breakpoint, which is what keeps `activeTab` — the one piece of layout state there is —
 * from being reset by crossing it.
 *
 * ## The timeline is never behind a tab
 *
 * §8.3.4 is explicit: *"the timeline stays visible at all times — it is the
 * second-most-important control after the orbit view and must never be behind a tab."*
 * It is rendered outside the tab panel in both layouts, which is why it appears once here
 * and not twice.
 *
 * ## Capabilities do not shrink with the viewport
 *
 * #123's second criterion asks for the narrow layout to have *"the same capabilities, not
 * a reduced feature set"*. Because the panels are the same instances, this is structural:
 * there is no narrow variant of `PlanPanel` that could quietly drop the delete button.
 */
import { arcAt, type Timeline } from '@hh/sim';
import { R_EARTH_EQ, elementsFromState, type Epoch } from '@hh/astro';
import type { LoadedScenario } from '@hh/game';
import type { Catalogue } from '@hh/ui';
import { approachReadout, orbitReadout } from '@hh/ui';
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';

import { AssistTray } from './AssistTray.js';
import { CommitBar } from './CommitBar.js';
import { HudBar } from './HudBar.js';
import { OrbitView } from './OrbitView.js';
import { PlanPanel } from './PlanPanel.js';
import { Readouts } from './Readouts.js';
import { TimelineStrip } from './TimelineStrip.js';
import { selectedIndex, usePlanner, nodeIdOf } from './store.js';

/** Which side panel the narrow layout is showing. Ignored above the breakpoint. */
type Tab = 'plan' | 'readouts' | 'assists';

export interface PlannerScreenProps {
  readonly t: Catalogue['resolve'];
  readonly resolveDynamic: Catalogue['resolveDynamic'];
  readonly scenario: LoadedScenario;
}

/**
 * The orbit at the scrub head.
 *
 * The osculating elements of whichever arc owns the scrub epoch — which is the definition
 * of "at the scrub head" and is why this is a lookup rather than a stored value. `arcAt`
 * is O(log n) and the elements are cached on the arc, so it costs a binary search per
 * scrub event and no Kepler solve at all.
 */
const orbitAtScrub = (timeline: Timeline, at: Epoch, mu: number) => {
  const arc = arcAt(timeline, at);
  return orbitReadout(arc.elements, mu, R_EARTH_EQ);
};

export const PlannerScreen = ({ t, resolveDynamic, scenario }: PlannerScreenProps): JSX.Element => {
  const [state, actions] = usePlanner(scenario);
  const [tab, setTab] = useState<Tab>('plan');

  const { model, evaluation } = state;
  const index = selectedIndex(state);
  const selectedNode = index === null ? undefined : model.plan.nodes[index];
  const selectedNodeId = selectedNode === undefined ? null : nodeIdOf(selectedNode);

  // The constraint evaluations legality already ran, so no region re-derives them.
  const legality = evaluation.legality;
  const budget = legality.evaluable
    ? legality.constraints.budget
    : {
        kind: 'dv_budget' as const,
        violations: [],
        usedMps: 0,
        budgetMps: scenario.ship.dvBudgetMps,
        remainingMps: scenario.ship.dvBudgetMps,
        fraction: 0,
        level: 'ok' as const,
        exceededAtNode: null,
      };

  const orbit =
    evaluation.timeline === null
      ? orbitReadout(
          elementsFromState(
            scenario.ship.state.position,
            scenario.ship.state.velocity,
            scenario.mu,
          ),
          scenario.mu,
          R_EARTH_EQ,
        )
      : orbitAtScrub(evaluation.timeline, model.scrub.epoch, scenario.mu);

  const approach =
    evaluation.objective !== null && evaluation.objective.kind !== 'reach_orbit'
      ? approachReadout(evaluation.objective)
      : null;

  const panel = (name: Tab, content: JSX.Element): JSX.Element => (
    <div
      class="hh-planner__panel"
      data-panel={name}
      // Hidden only in the narrow layout, where the tab strip decides. The attribute is
      // inert above the breakpoint because the CSS shows every panel there — see the
      // docstring on why this is one tree rather than two.
      hidden={tab !== name}
      id={`hh-panel-${name}`}
      role="tabpanel"
      aria-labelledby={`hh-tab-${name}`}
    >
      {content}
    </div>
  );

  return (
    <div class="hh-planner" data-testid="planner">
      <HudBar
        t={t}
        contractIndex={scenario.document.index}
        contractTitle={scenario.document.title}
        budget={budget}
        startEpoch={scenario.startEpoch}
        scrubEpoch={model.scrub.epoch}
        onOpenHelp={() => undefined}
      />

      <div class="hh-planner__stage">
        <OrbitView
          t={t}
          resolveDynamic={resolveDynamic}
          scenario={scenario}
          timeline={evaluation.timeline}
          scrubEpoch={model.scrub.epoch}
          selectedNodeId={selectedNodeId}
          onSelectNode={(id) => {
            const at = model.plan.nodes.findIndex((node) => nodeIdOf(node) === id);
            if (at !== -1) actions.selectIndex(at);
          }}
          onDeselect={actions.deselect}
        />

        <div class="hh-planner__side">
          <div class="hh-planner__tabs" role="tablist" aria-label={t('planner.tabsLabel', {})}>
            {(
              [
                ['plan', t('planner.tab.plan', { count: model.plan.nodes.length })],
                ['readouts', t('planner.tab.readouts', {})],
                ['assists', t('planner.tab.assists', {})],
              ] as const
            ).map(([name, label]) => (
              <button
                key={name}
                type="button"
                role="tab"
                id={`hh-tab-${name}`}
                aria-selected={tab === name}
                aria-controls={`hh-panel-${name}`}
                data-testid={`planner-tab-${name}`}
                onClick={() => {
                  setTab(name);
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {panel(
            'plan',
            <PlanPanel
              t={t}
              plan={model.plan}
              startEpoch={scenario.startEpoch}
              selectedIndex={index}
              onSelect={actions.selectIndex}
              onDelete={actions.deleteIndex}
              onExpand={actions.selectIndex}
              onAdd={() => {
                // §8.5.3's `N`: add a node at the scrub head. The pointer route — clicking
                // the trajectory — is #133 and lands with the rest of the interactions.
                actions.addNodeAt(model.scrub.epoch);
              }}
            />,
          )}
          {panel(
            'readouts',
            <Readouts t={t} orbit={orbit} approach={approach} startEpoch={scenario.startEpoch} />,
          )}
          {panel(
            'assists',
            <AssistTray
              t={t}
              snapToApsis={state.snapToApsis}
              onToggleSnap={actions.setSnapToApsis}
            />,
          )}
        </div>
      </div>

      <TimelineStrip
        t={t}
        plan={model.plan}
        startEpoch={scenario.startEpoch}
        horizon={scenario.horizon}
        deadlineSeconds={scenario.rules.deadlineSeconds}
        scrubEpoch={model.scrub.epoch}
        reasons={legality.evaluable ? legality.reasons : []}
        objectiveMetEpoch={
          evaluation.objective?.met === true ? (evaluation.objective.atEpoch ?? null) : null
        }
        selectedNodeIndex={index}
        onScrub={actions.scrubTo}
        onSelectNode={actions.selectIndex}
      />

      <CommitBar
        t={t}
        resolveDynamic={resolveDynamic}
        legality={legality}
        onCommit={actions.commit}
      />

      {model.interaction.phase === 'COMMITTED' ? (
        // §8.5.1's exit to EXECUTION. The execution phase is #121 and PR 6 of this
        // milestone, so committing currently reaches the same honest placeholder every
        // unbuilt route does — the machine's terminal edge is real and its destination
        // is not built yet.
        <p class="hh-planner__committed" role="status" data-testid="planner-committed">
          {t('screen.notBuiltYet', {})}
        </p>
      ) : null}

      {state.lastRefusal === null ? null : (
        <p class="hh-planner__refusal" role="status" data-testid="planner-refusal">
          {resolveDynamic(state.lastRefusal.message.key, state.lastRefusal.message.params)}
        </p>
      )}
    </div>
  );
};
