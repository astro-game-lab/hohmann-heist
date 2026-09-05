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
import { arcAt, type Plan, type Timeline } from '@hh/sim';
import { R_EARTH_EQ, elementsFromState, metAt, type Epoch } from '@hh/astro';
import type { LoadedScenario } from '@hh/game';
import { isProximityEvaluation, snapToNamedApsis } from '@hh/game';
import type { Catalogue, NodeId } from '@hh/ui';
import { approachReadout, componentsOfCounts, orbitReadout } from '@hh/ui';
import type { JSX } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';

import { AssistTray } from './AssistTray.js';
import { CommitBar } from './CommitBar.js';
import { NodeEditor } from './NodeEditor.js';
import { actionFor, isTypingTarget } from './keys.js';
import { HudBar } from './HudBar.js';
import { OrbitView } from './OrbitView.js';
import { PlanPanel } from './PlanPanel.js';
import { Readouts } from './Readouts.js';
import { TimelineStrip } from './TimelineStrip.js';
import type { Evaluation } from './evaluate.js';
import { indexOfNodeId, selectedIndex, usePlanner, nodeIdOf, type PlannerSeed } from './store.js';

/** Which side panel the narrow layout is showing. Ignored above the breakpoint. */
type Tab = 'plan' | 'readouts' | 'assists';

export interface PlannerScreenProps {
  readonly t: Catalogue['resolve'];
  readonly resolveDynamic: Catalogue['resolveDynamic'];
  readonly scenario: LoadedScenario;
  /**
   * What the planner opens with.
   *
   * Empty on a fresh acceptance; the run's plan, scrub head and selection when the
   * player comes back from an abort (FR-603) or a retry (§6.11).
   */
  readonly seed?: PlannerSeed;
  /**
   * §8.5.1's exit to EXECUTION.
   *
   * Called once, with the plan and the evaluation that gated the commit. Handing the
   * *evaluation* across rather than the plan alone is FR-601: execution plays back the
   * timeline the planner already solved, and re-deriving it on the other side of this
   * call would be the recomputation the requirement forbids.
   */
  readonly onCommit: (committed: CommittedRun) => void;
}

/** What crossing §8.5.1's last edge carries with it. */
export interface CommittedRun {
  readonly plan: Plan;
  readonly evaluation: Evaluation;
  /** Where the scrub head was, so aborting can put it back (#145). */
  readonly scrubEpoch: Epoch;
  /** Which node was selected, likewise. */
  readonly selectedNodeId: NodeId | null;
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

export const PlannerScreen = ({
  t,
  resolveDynamic,
  scenario,
  seed,
  onCommit,
}: PlannerScreenProps): JSX.Element => {
  const [state, actions] = usePlanner(scenario, seed ?? {});
  const [tab, setTab] = useState<Tab>('plan');
  // Where the overlay's node is drawn, reported by the orbit view. `null` when it is off
  // screen, or when the plan produced no trajectory to draw it on — see below.
  const [anchor, setAnchor] = useState<{ readonly x: number; readonly y: number } | null>(null);

  /**
   * Whether a pointer is currently held down inside the overlay.
   *
   * §8.3.5 anchors the editor to its node, and the editor's own controls *move* that node
   * — so the two combine into a control that runs away from the finger using it. Dragging
   * the epoch slider from T+0 to T+40m moved the slider 348 px across the stage and 75 px
   * down, which is several times its own length: the thumb is released almost immediately
   * and the drag cannot be completed at all. The same applies in miniature to the
   * steppers, which walk out from under a repeated click.
   *
   * So the anchor is **suspended while the overlay is being operated by pointer**, and
   * resumes on release. Not while it is merely open: following the node is the behaviour
   * §8.3.5 asks for, and it is right when the node moves for a reason outside the panel —
   * a drag in the orbit view, or a nudge from the keyboard, where nothing is being held.
   * The freeze is scoped to exactly the case where following is self-defeating.
   *
   * A ref rather than state: it is read inside a callback that must keep a stable
   * identity (`onAnchor` is in the orbit view's effect dependencies), and re-rendering on
   * press would be work for something no one can see.
   */
  const anchorHeld = useRef(false);

  /**
   * The orbit view's anchor report, gated by the freeze above.
   *
   * `useCallback` with no dependencies because `onAnchor` is a dependency of the effect
   * that installs the canvas listeners: a fresh identity per render would tear down and
   * rebuild the hit index, the framing and every listener sixty times a second.
   */
  const reportAnchor = useCallback((at: { readonly x: number; readonly y: number } | null) => {
    if (anchorHeld.current) return;
    setAnchor(at);
  }, []);

  // Released on the window, not the panel: a drag that leaves the slider still ends the
  // gesture, and a pointer released outside would otherwise leave the anchor frozen for
  // the rest of the session.
  useEffect(() => {
    const release = (): void => {
      anchorHeld.current = false;
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    return () => {
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    };
  }, []);

  const { model } = state;
  // The preview while a gesture is in flight, the settled evaluation otherwise. Every
  // region reads this one value, so the orbit view, the readouts and the timeline cannot
  // disagree about which plan they are showing (#134, #135).
  const evaluation = state.preview ?? state.evaluation;
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

  // #137's overlay, and the two orbits its result block compares. The impulse already
  // carries the state on each side of the burn, so there is no propagation here.
  const editorIndex = indexOfNodeId(model.plan, state.editorFor);
  const editorNode = editorIndex === null ? undefined : model.plan.nodes[editorIndex];
  const impulse = editorIndex === null ? undefined : evaluation.timeline?.impulses[editorIndex];
  const editorOrbits =
    impulse === undefined
      ? null
      : {
          before: elementsFromState(impulse.before.position, impulse.before.velocity, scenario.mu),
          after: elementsFromState(impulse.after.position, impulse.after.velocity, scenario.mu),
        };

  // What the orbit view needs to draw a gesture in flight (#134, #135). Read from the
  // machine's drag payload rather than from the plan, because the plan is deliberately
  // not touched until release.
  const draggingInteraction = model.interaction.phase === 'DRAGGING' ? model.interaction : null;
  const draggingIndex =
    draggingInteraction === null ? null : indexOfNodeId(model.plan, draggingInteraction.nodeId);
  const dragPreview =
    draggingInteraction === null || draggingIndex === null
      ? null
      : {
          nodeId: draggingInteraction.nodeId,
          kind: draggingInteraction.drag.kind,
          index: draggingIndex,
          ...(draggingInteraction.drag.kind === 'deltaV'
            ? componentsOfCounts(draggingInteraction.drag.counts)
            : componentsOfCounts(model.plan.nodes[draggingIndex]?.deltaVCounts ?? [0, 0, 0])),
        };

  // Which apsis the overlay's burn is sitting on, for §8.3.5's radios. Compared against
  // the epoch the *command* would produce, so the reading agrees with what pressing the
  // radio would do — a separate tolerance here could say "free" for a burn that snapping
  // would not move.
  const editorSnappedTo = ((): 'periapsis' | 'apoapsis' | null => {
    // Narrowed once, in a block, rather than asserted at each use. `evaluation.timeline`
    // is nullable and the closure below reads it twice; hoisting is what lets both reads
    // be checked instead of cast away.
    const { timeline } = evaluation;
    if (editorNode === undefined || timeline === null) return null;
    return (
      (['periapsis', 'apoapsis'] as const).find(
        (kind) => snapToNamedApsis(timeline, editorNode.epoch, kind) === editorNode.epoch,
      ) ?? null
    );
  })();

  // §8.3.4's closest-approach block belongs to an encounter with a second body. A
  // `reach_orbit` goal compares element sets and a `station` goal measures a longitude;
  // neither has an approach to read out (#77).
  const approach =
    evaluation.objective !== null && isProximityEvaluation(evaluation.objective)
      ? approachReadout(evaluation.objective)
      : null;

  /**
   * §8.5.3's map, on the document.
   *
   * Installed once rather than per-region, because NFR-016's "fully operable without a
   * pointer" has to hold wherever focus happens to be — a binding that only worked while
   * focus was on the canvas would fail exactly when a keyboard user needed it. The
   * typing guard is what keeps `,` and `N` from firing into the node editor's fields.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isTypingTarget(event.target)) return;
      const action = actionFor(event.key, { shift: event.shiftKey, ctrl: event.ctrlKey });
      if (action === null) return;

      const at = selectedIndex({ ...state });
      switch (action.kind) {
        case 'addNode':
          actions.addNodeAt(model.scrub.epoch);
          break;
        case 'deleteNode':
          if (at !== null) actions.deleteIndex(at);
          break;
        case 'editNode':
          if (at !== null) actions.openEditor(at);
          break;
        case 'cycleNode': {
          const count = model.plan.nodes.length;
          if (count === 0) break;
          // Wraps, so Tab keeps cycling rather than stopping at the last burn.
          const next = at === null ? 0 : (at + action.delta + count) % count;
          actions.selectIndex(next);
          break;
        }
        case 'nudgeEpoch':
          if (at !== null) {
            const node = model.plan.nodes[at];
            if (node !== undefined) {
              actions.setEpoch(at, metAt(scenario.startEpoch, node.epoch) + action.seconds);
            }
          }
          break;
        case 'nudgeDeltaV':
          if (at !== null) {
            const node = model.plan.nodes[at];
            if (node !== undefined) {
              const current = componentsOfCounts(node.deltaVCounts);
              actions.setDeltaV(
                at,
                current.progradeMps + action.progradeMps,
                current.radialMps + action.radialMps,
              );
            }
          }
          break;
        case 'scrub':
          actions.scrubTo((model.scrub.epoch + action.seconds) as Epoch);
          break;
        case 'scrubTo':
          actions.scrubTo(
            action.where === 'start'
              ? scenario.startEpoch
              : ((scenario.startEpoch + scenario.rules.deadlineSeconds) as Epoch),
          );
          break;
        case 'commit':
          actions.commit();
          break;
        case 'cancel':
          // Escape closes the overlay if it is open, and otherwise clears the selection.
          // A drag's Escape is the orbit view's, which sees it first because it is
          // holding the pointer capture (#134, #135).
          if (state.editorFor !== null) actions.closeEditor();
          else actions.deselect();
          break;
        case 'zoom':
        case 'recentre':
          // Handled by the orbit view, which owns the camera — see `OrbitView.tsx`. This
          // arm exists so the switch stays exhaustive over `PlannerAction`: a new action
          // is then a compile error here rather than a key that silently does nothing.
          return;
      }
      event.preventDefault();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [actions, model, scenario, state]);

  /**
   * §8.5.1's exit to EXECUTION.
   *
   * An effect rather than a call inside `actions.commit`, because COMMITTED is a state
   * the machine reaches and leaving the screen is a consequence of having reached it —
   * doing it inside the action would mean navigating from a state updater, which runs
   * during render and may run twice.
   *
   * The evaluation handed over is the one the commit gate read. `isCommittable` has
   * already refused a plan with no timeline, so `timeline` here is non-null by the same
   * check that let the machine move; the guard states that rather than assuming it.
   */
  // The selection at the moment of commit, kept because the machine drops it.
  //
  // COMMITTED carries the plan and nothing else — §8.5.1 makes it terminal, and a
  // terminal state remembering which node had a ring around it would be state nobody in
  // the machine needs. #145 does need it, one layer up: aborting should put the player
  // back where they were working. So the *screen* remembers, which is the right owner —
  // "where the player was looking" is a display fact, not a rule.
  const lastSelected = useRef<NodeId | null>(null);
  if (selectedNodeId !== null) lastSelected.current = selectedNodeId;

  const committedPlan = model.interaction.phase === 'COMMITTED' ? model.interaction.plan : null;
  useEffect(() => {
    if (committedPlan === null || evaluation.timeline === null) return;
    onCommit({
      plan: committedPlan,
      evaluation,
      scrubEpoch: model.scrub.epoch,
      selectedNodeId: lastSelected.current,
    });
  }, [committedPlan, evaluation, model.scrub.epoch, onCommit]);

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
          onPlaceNode={actions.addNodeAt}
          onOpenEditor={(id) => {
            const at = indexOfNodeId(model.plan, id);
            if (at !== null) actions.openEditor(at);
          }}
          onBeginEpochDrag={(id) => {
            const at = indexOfNodeId(model.plan, id);
            if (at !== null) actions.beginEpochDrag(at);
          }}
          onBeginDeltaVDrag={(id, axis) => {
            const at = indexOfNodeId(model.plan, id);
            if (at !== null) actions.beginDeltaVDrag(at, axis);
          }}
          onDragEpochTo={actions.dragEpochTo}
          onDragDeltaVTo={actions.dragDeltaVTo}
          onReleaseDrag={actions.releaseDragging}
          onCancelDrag={actions.cancelDragging}
          dragging={dragPreview}
          anchorNodeId={state.editorFor}
          onAnchor={reportAnchor}
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
              onExpand={actions.openEditor}
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
        {editorNode === undefined || editorIndex === null ? null : (
          <div
            class="hh-editor__anchor"
            data-anchored={anchor !== null}
            // Suspends the anchor for the duration of the gesture — see `anchorHeld`.
            // On the container rather than on each control, so a stepper, a radio, the
            // slider and a text field all get it without four copies of the same line.
            onPointerDown={() => {
              anchorHeld.current = true;
            }}
            // §8.3.5's "anchored to the node". Absolute over the stage when the orbit
            // view can say where the node is drawn; docked at the edge when it cannot —
            // the node is off screen, or the plan produced no trajectory — because an
            // overlay pointing at nothing is worse than one that is merely nearby.
            // The position goes out as custom properties and the *clamping* is CSS's,
            // against the stage's own width — `clamp(…, calc(100% - …))`. Doing it here
            // would mean measuring the stage and the panel on every frame of a re-frame
            // ease; doing it there costs nothing and cannot go stale. Without it the
            // overlay runs off the right edge on a narrow layout, which is a horizontal
            // scrollbar on the whole page.
            style={
              anchor === null
                ? undefined
                : {
                    '--hh-anchor-x': `${String(anchor.x + 16)}px`,
                    '--hh-anchor-y': `${String(anchor.y)}px`,
                  }
            }
          >
            <NodeEditor
              t={t}
              node={editorNode}
              index={editorIndex}
              startEpoch={scenario.startEpoch}
              horizonSeconds={scenario.horizonSeconds}
              orbits={editorOrbits}
              mu={scenario.mu}
              referenceRadiusM={R_EARTH_EQ}
              onEpoch={(metSeconds) => {
                actions.setEpoch(editorIndex, metSeconds);
              }}
              onDeltaV={(progradeMps, radialMps) => {
                actions.setDeltaV(editorIndex, progradeMps, radialMps);
              }}
              onSnap={(kind) => {
                actions.snapNode(editorIndex, kind);
              }}
              snappedTo={editorSnappedTo}
              onDelete={() => {
                actions.deleteIndex(editorIndex);
                actions.closeEditor();
              }}
              onClose={actions.closeEditor}
            />
          </div>
        )}
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

      {state.lastRefusal === null ? null : (
        <p class="hh-planner__refusal" role="status" data-testid="planner-refusal">
          {resolveDynamic(state.lastRefusal.message.key, state.lastRefusal.message.params)}
        </p>
      )}
    </div>
  );
};
