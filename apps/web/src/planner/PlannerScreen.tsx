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
 * ## Five siblings, in the narrow layout's order
 *
 * The HUD, the stage, the side panels, the timeline and the commit bar are siblings, in
 * that order, and the wide layout is a grid that places out of it — the panels into a
 * column of their own, the timeline and the commit bar into the column beside it. The
 * side used to be *inside* the stage, which made the wide layout a row with the timeline
 * and the commit bar stacked under the whole of it; a panel column taller than the stage
 * then had nothing to be bounded by and painted straight over both. `app.css` has the
 * layout half of that story.
 *
 * What belongs here is why the order is this one and not the grid's. It is the narrow
 * layout's reading order, so below the breakpoint the boxes stack correctly with no
 * `order` and no second tree, and at both widths the focus order is the visual one —
 * which a grid that reorders its items cannot promise. The stage keeps the node editor
 * and the context menu because both are positioned in the orbit view's pixel space
 * (§8.3.5), and the stage is now exactly the orbit view's box.
 *
 * ## Capabilities do not shrink with the viewport
 *
 * #123's second criterion asks for the narrow layout to have *"the same capabilities, not
 * a reduced feature set"*. Because the panels are the same instances, this is structural:
 * there is no narrow variant of `PlanPanel` that could quietly drop the delete button.
 */
import { arcAt, fromEpochTicks, type Plan, type Timeline } from '@hh/sim';
import { R_EARTH_EQ, elementsFromState, metAt, type Epoch } from '@hh/astro';
import type { LoadedScenario } from '@hh/game';
import { apsisAt, isProximityEvaluation, snapToNamedApsis } from '@hh/game';
import type { Catalogue, NodeId } from '@hh/ui';
import {
  approachReadout,
  canRedo,
  canUndo,
  componentsOfCounts,
  isCommittable,
  orbitReadout,
} from '@hh/ui';
import type { JSX } from 'preact';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';

import { AssistTray } from './AssistTray.js';
import { NodeContextMenu } from './NodeContextMenu.js';
import { bandsFor } from './constraint-bands.js';
import { ContractPanel, contractPanelSession } from './ContractPanel.js';
import { CommitBar } from './CommitBar.js';
import { NodeEditor } from './NodeEditor.js';
import { useKeybindings } from '../settings/context.js';
import { actionFor, isTypingTarget } from './keys.js';
import { HudBar } from './HudBar.js';
import { OrbitView } from './OrbitView.js';
import { PlanPanel } from './PlanPanel.js';
import { Readouts } from './Readouts.js';
import { CoachMark } from '../onboarding/CoachMark.js';
import { useCoachMarks } from '../onboarding/useCoachMarks.js';

import { TimelineStrip } from './TimelineStrip.js';
import type { Evaluation } from './evaluate.js';
import { indexOfNodeId, selectedIndex, usePlanner, nodeIdOf, type PlannerSeed } from './store.js';

/** Which side panel the narrow layout is showing. Ignored above the breakpoint. */
type Tab = 'plan' | 'readouts' | 'assists' | 'contract';

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
  /** FR-902's permanently dismissed marks — `flags.coachMarksSeen` (#159). */
  readonly coachMarksSeen: readonly string[];
  readonly onCoachMarkSeen: (key: string) => void;
  /** Open the Codex over this screen, from a mark's *More in the Codex* (#161). */
  readonly onOpenCodex: (slug: string) => void;
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
  coachMarksSeen,
  onCoachMarkSeen,
  onOpenCodex,
}: PlannerScreenProps): JSX.Element => {
  const [state, actions] = usePlanner(scenario, seed ?? {});
  const [tab, setTab] = useState<Tab>('plan');
  // Seeded from the session's value and written back on every change, so the preference
  // survives the unmount a contract change causes — `contractPanelSession` says why it
  // lives there rather than in component state or in the save (#264).
  const [contractOpen, setContractOpen] = useState(contractPanelSession.open);
  const toggleContract = useCallback(() => {
    setContractOpen((was) => {
      contractPanelSession.open = !was;
      return !was;
    });
  }, []);
  /**
   * Where the open editor's node is drawn, reported by the orbit view, or `null` when it
   * is off screen or the plan produced no trajectory to draw it on.
   *
   * A ref rather than state, and that is a consequence of the overlay no longer moving
   * (see `.hh-editor__anchor` below). Nothing renders from this any more: its one reader
   * is `nodeMenu`, which opens §8.5.2's menu at the node's drawn position and is an event
   * handler, so it can read the current value at the moment it needs it. As state it
   * re-rendered the whole planner on every frame in which the node moved — sixty times a
   * second through a drag — to produce identical markup.
   */
  const anchor = useRef<{ readonly x: number; readonly y: number } | null>(null);
  /**
   * §8.5.2's context menu: which node it is acting on, and where it is anchored (#136).
   *
   * The position is carried here rather than read from `anchor`, because the two answer
   * different questions. `anchor` is *where the node is drawn*; a menu opens *where the
   * player asked*, which for a right-click two pixels off the marker is two pixels off the
   * marker. The keyboard route has no pointer position and falls back to the node's own,
   * which is the only thing `anchor` is still consulted for — see `nodeMenu` below.
   */
  const [menu, setMenu] = useState<{
    readonly nodeId: NodeId;
    readonly at: { readonly x: number; readonly y: number };
  } | null>(null);

  /**
   * The orbit view's anchor report.
   *
   * `useCallback` with no dependencies because `onAnchor` is a dependency of the effect
   * that installs the canvas listeners: a fresh identity per render would tear down and
   * rebuild the hit index, the framing and every listener sixty times a second.
   */
  const reportAnchor = useCallback((at: { readonly x: number; readonly y: number } | null) => {
    anchor.current = at;
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

  // The same arrangement for the burn-count cap. A plan the engine could not evaluate has
  // no timeline to count nodes on, but the *plan* still has nodes and the contract still
  // has a cap, so the fallback reports both rather than hiding the readout at the moment
  // a player most wants to know where they stand.
  const burnCount = legality.evaluable
    ? legality.constraints.burnCount
    : {
        kind: 'burn_count' as const,
        violations: [],
        burns: model.plan.nodes.length,
        maxBurns: scenario.rules.maxBurns ?? null,
        remaining:
          scenario.rules.maxBurns === undefined
            ? null
            : scenario.rules.maxBurns - model.plan.nodes.length,
        exceeded:
          scenario.rules.maxBurns !== undefined &&
          model.plan.nodes.length > scenario.rules.maxBurns,
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

  /**
   * Which apsis the overlay's burn is sitting on, for §8.3.5's radios.
   *
   * `apsisAt`, which is the same question `snappedKinds` below asks, so the editor's radios
   * and the plan panel's caret cannot disagree about one node — they did, and this is why.
   *
   * This used to compare `snapToNamedApsis(...) === node.epoch` exactly, on the reasoning
   * that the reading should agree with what pressing the radio would do. It does not: the
   * command's epoch is quantised at node construction (FR-105) and the finder's is not, so
   * the two are never bit-equal and every snapped node read "free". `apsisAt`'s docstring
   * names that exact trap and carries the one-tick window that avoids it.
   */
  const editorSnappedTo =
    editorNode === undefined || evaluation.timeline === null
      ? null
      : apsisAt(evaluation.timeline, editorNode.epoch);

  /**
   * Which apsis each node is sitting on — DEP-07 made visible (#136).
   *
   * §8.5.2 and #136 both ask for a snapped node to be *distinguishable from one that
   * happens to be near an apsis*, because DEP-07 moves a burn to an epoch the player did
   * not choose and a departure the player cannot see is one they cannot account for.
   *
   * Derived rather than stored. A flag set when the snap happened would have to be cleared
   * every time the node moved for any other reason — a nudge, a typed epoch, an earlier
   * burn reshaping the arc this one sits on — and the first one missed would leave a node
   * claiming to be on an apsis it had left. `apsisAt` asks the geometry instead, so the
   * mark cannot be stale by construction.
   */
  const snappedKinds =
    evaluation.timeline === null
      ? []
      : model.plan.nodes.map((node) =>
          evaluation.timeline === null ? null : apsisAt(evaluation.timeline, node.epoch),
        );

  /**
   * Whether this orbit has apsides at all, for the context menu's snap entries.
   *
   * Asked at the *selected* node's epoch, because a plan can cross several arcs and only
   * the one the menu is acting on matters. Every Act I contract starts on a near-circular
   * orbit, so `false` here is the common case rather than an edge one — see
   * `NodeContextMenu.tsx` on why that makes the entries disabled rather than absent.
   */
  const menuIndex = menu === null ? null : indexOfNodeId(model.plan, menu.nodeId);
  const menuNode = menuIndex === null ? undefined : model.plan.nodes[menuIndex];
  const menuApsides = ((): boolean => {
    const { timeline } = evaluation;
    if (menuNode === undefined || timeline === null) return false;
    return (['periapsis', 'apoapsis'] as const).some(
      (kind) => snapToNamedApsis(timeline, menuNode.epoch, kind) !== null,
    );
  })();

  /**
   * §6.5's bands — violations, and the regions a burn would be illegal in (#129).
   *
   * Built from the constraint *evaluations* rather than from the reason list, so a
   * constraint that raises no `LegalityReason` — the burn-count cap is soft and raises none
   * by design — can still be drawn. `constraint-bands.ts` carries the representation table
   * and the reasoning.
   *
   * Gated on §6.6's `constraints` assist, which is the flag #129 provides and #81's model
   * scores: disabling it earns *Blind*. It reaches here from the same `AssistState` the tray
   * writes, so there is one answer to "is preview on" rather than a prop and a setting.
   *
   * A plan the engine could not evaluate has no constraints to band. That is not the same
   * as a legal plan and the timeline shows nothing rather than pretending it is clear —
   * the commit bar carries the reason in that case.
   */
  /**
   * FR-902's coach marks, for this contract — #159.
   *
   * The facts are four things the planner has already computed for its own regions, and
   * `@hh/ui`'s trigger table turns them into "has this moment arrived". Nothing here knows
   * which contract is loaded: the scenario's `coachMarks` list is the only input that
   * varies, which is what keeps FR-902's content out of this file.
   *
   * `state.assists.coach_marks` is the off switch — §6.6's assist and §8.3.12's setting,
   * which are the same flag (#186) and reach the planner as one.
   */
  const marks = useCoachMarks({
    declared: scenario.document.coachMarks ?? [],
    enabled: state.assists.coach_marks,
    facts: {
      nodeCount: model.plan.nodes.length,
      committable: isCommittable(legality),
      nodeSelected: index !== null,
      objectiveMet: evaluation.objective?.met === true,
    },
    seen: coachMarksSeen,
    onSeen: onCoachMarkSeen,
  });

  const bands = legality.evaluable
    ? bandsFor({
        constraints: legality.constraints,
        startEpoch: scenario.startEpoch,
        horizon: scenario.horizon,
        deadlineSeconds: scenario.rules.deadlineSeconds,
        previewEnabled: state.assists.constraints,
      })
    : [];

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
  // §8.5.3's map as the player has it, not as it ships (#187). Read here rather than
  // inside the handler so the effect re-installs when a rebind lands — a listener closed
  // over a stale map is exactly the bug "applies immediately" is about.
  const rebinds = useKeybindings();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isTypingTarget(event.target)) return;
      const action = actionFor(
        'planner',
        event.key,
        { shift: event.shiftKey, ctrl: event.ctrlKey },
        rebinds,
      );
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
          // Through `nudgeEpochBy` rather than `setEpoch`, because DEP-07 applies to a
          // nudge and the snap has to know which way the player pushed — see `snap.ts`'s
          // `snapNudge` and #136. A nudge routed through `setEpoch` would either not snap
          // at all or snap the node straight back onto the apsis it was leaving.
          if (at !== null) actions.nudgeEpochBy(at, action.seconds);
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
        case 'undo':
          actions.undo();
          break;
        case 'redo':
          actions.redo();
          break;
        case 'toggleContract':
          toggleContract();
          break;
        case 'nodeMenu':
          // §8.8's canvas-parity rule: every pointer action on the orbit view has a
          // keyboard route, and this is the menu's. Anchored at the node's drawn position
          // when the orbit view has reported one, and docked at the stage's corner when it
          // has not — a menu that opened at (0, 0) because the node is off screen would be
          // worse than one that admits it does not know.
          if (at !== null) {
            const node = model.plan.nodes[at];
            if (node !== undefined)
              setMenu({ nodeId: nodeIdOf(node), at: anchor.current ?? { x: 16, y: 16 } });
          }
          break;
        case 'commit':
          actions.commit();
          break;
        case 'cancel':
          // Escape closes the innermost thing that is open, then the overlay, and only
          // then clears the selection. The menu is checked first because it is the most
          // recently opened and the most modal — a player pressing Escape with a menu up
          // means the menu. A drag's Escape is the orbit view's, which sees it first
          // because it is holding the pointer capture (#134, #135).
          //
          // The menu's *own* handler also stops propagation, so this arm is what runs when
          // focus has left the menu without it closing.
          if (menu !== null) setMenu(null);
          else if (state.editorFor !== null) actions.closeEditor();
          else actions.deselect();
          break;
        case 'playPause':
        case 'skipToEnd':
        case 'setSpeedIndex':
        case 'retry':
          // Execution's and the debrief's bindings. Unreachable here — the table scopes
          // them to those screens — and listed so the switch stays exhaustive over
          // `PlannerAction`: a new action is then a compile error rather than a key that
          // silently does nothing.
          return;
        case 'zoom':
        case 'recentre':
          // Handled by the orbit view, which owns the camera — see `OrbitView.tsx`. This
          // arm exists so the switch stays exhaustive over `PlannerAction`: a new action
          // is then a compile error here rather than a key that silently does nothing.
          return;
        case 'help':
          // The shell's (#124). Returning *before* the `preventDefault` below is the
          // point: opening the overlay must not consume the key on the planner's behalf,
          // and §8.5.3's `?` is explicitly one of the two things that neither pauses nor
          // mutates anything here.
          return;
      }
      event.preventDefault();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [actions, menu, model, rebinds, scenario, state, toggleContract]);

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
        burnCount={burnCount}
        startEpoch={scenario.startEpoch}
        scrubEpoch={model.scrub.epoch}
        onOpenHelp={() => undefined}
        contractOpen={contractOpen}
        onToggleContract={toggleContract}
      />

      <div class="hh-planner__stage">
        <OrbitView
          t={t}
          resolveDynamic={resolveDynamic}
          scenario={scenario}
          timeline={evaluation.timeline}
          scrubEpoch={model.scrub.epoch}
          selectedNodeId={selectedNodeId}
          snappedKinds={snappedKinds}
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
          onOpenNodeMenu={(id, at) => {
            setMenu({ nodeId: id, at });
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

        {menu === null || menuIndex === null ? null : (
          <NodeContextMenu
            t={t}
            at={menu.at}
            nodeIndex={menuIndex}
            apsidesAvailable={menuApsides}
            onSnap={(kind) => {
              actions.snapNode(menuIndex, kind);
            }}
            onZeroDeltaV={() => {
              actions.zeroDeltaV(menuIndex);
            }}
            onDelete={() => {
              actions.deleteIndex(menuIndex);
            }}
            onClose={() => {
              setMenu(null);
            }}
          />
        )}
        {/*
          The overlay's berth is the top-right corner of the orbit view, at every width
          and for every node. No position is written from here at all — `app.css` has the
          whole of it, which is the point. See `.hh-editor__anchor` there for why the
          panel stopped following the node §8.3.5 anchors it to.
        */}
        {editorNode === undefined || editorIndex === null ? null : (
          <div class="hh-editor__anchor">
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
              onEpochSlide={(metSeconds) => {
                actions.slideEpochTo(editorIndex, metSeconds);
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

      <div class="hh-planner__side">
        <div class="hh-planner__tabs" role="tablist" aria-label={t('planner.tabsLabel', {})}>
          {(
            [
              ['plan', t('planner.tab.plan', { count: model.plan.nodes.length })],
              ['readouts', t('planner.tab.readouts', {})],
              ['assists', t('planner.tab.assists', {})],
              ['contract', t('planner.tab.contract', {})],
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
            snappedKinds={snappedKinds}
            dragging={
              dragPreview === null || draggingInteraction === null
                ? null
                : {
                    index: dragPreview.index,
                    // An epoch drag carries ticks; a Δv drag leaves the epoch alone, so
                    // the plan's own value is the live one for it.
                    metSeconds:
                      draggingInteraction.drag.kind === 'epoch'
                        ? metAt(scenario.startEpoch, fromEpochTicks(draggingInteraction.drag.ticks))
                        : metAt(
                            scenario.startEpoch,
                            model.plan.nodes[dragPreview.index]?.epoch ?? scenario.startEpoch,
                          ),
                    progradeMps: dragPreview.progradeMps,
                    radialMps: dragPreview.radialMps,
                  }
            }
            onSelect={actions.selectIndex}
            onDelete={actions.deleteIndex}
            onExpand={actions.openEditor}
            onOpenMenu={(nodeIndex) => {
              const node = model.plan.nodes[nodeIndex];
              if (node !== undefined) {
                setMenu({ nodeId: nodeIdOf(node), at: anchor.current ?? { x: 16, y: 16 } });
              }
            }}
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
        {/*
          The wide layout's collapsible half of #264: the section is in the column with
          the other three and `contractOpen` decides whether it is there. In the narrow
          layout the tab strip decides instead, which is why the panel is still mounted
          when it is merely on another tab — that is #123's guarantee and a fourth panel
          inherits it.
        */}
        {contractOpen || tab === 'contract'
          ? panel(
              'contract',
              <ContractPanel t={t} resolveDynamic={resolveDynamic} scenario={scenario} />,
            )
          : null}
        {panel(
          'assists',
          <AssistTray
            t={t}
            assists={state.assists}
            allowed={scenario.document.assistsAllowed ?? []}
            onToggle={actions.setAssist}
          />,
        )}
      </div>

      <TimelineStrip
        t={t}
        plan={model.plan}
        startEpoch={scenario.startEpoch}
        horizon={scenario.horizon}
        deadlineSeconds={scenario.rules.deadlineSeconds}
        scrubEpoch={model.scrub.epoch}
        bands={bands}
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
        canUndo={canUndo(state.history)}
        canRedo={canRedo(state.history)}
        onUndo={actions.undo}
        onRedo={actions.redo}
      />

      {state.lastRefusal === null ? null : (
        <p class="hh-planner__refusal" role="status" data-testid="planner-refusal">
          {resolveDynamic(state.lastRefusal.message.key, state.lastRefusal.message.params)}
        </p>
      )}

      {/*
        Last in the tree, and always mounted. Last because a mark is positioned against a
        region it must therefore be able to overlap, and always because its container is a
        live region — one created at the moment it has something to say is one the screen
        reader was not yet watching. `CoachMark` says both at length.
      */}
      <CoachMark
        t={t}
        resolveDynamic={resolveDynamic}
        mark={marks.mark}
        onDismiss={marks.dismiss}
        onDismissPermanently={marks.dismissPermanently}
        onOpenCodex={onOpenCodex}
      />
    </div>
  );
};
