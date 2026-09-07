/**
 * The planner's state, and the only place a plan changes.
 *
 * Three things are held together here because they have to move together: the model
 * (§8.5.1's interaction, the plan, the scrub head), the evaluation that every region
 * reads, and the assist flags. A region that computed its own evaluation could show a
 * verdict for a plan the region beside it was not looking at, so none of them does —
 * they take props.
 *
 * ## Node identity is the epoch tick
 *
 * §8.5.1's machine addresses nodes by a `NodeId`, and `@hh/render`'s `NodeSpec` wants one
 * too. `Plan` has no id field: FR-101 makes a node `(epoch, Δv)` and nothing more, and
 * adding one would put a value in the plan that has to be serialised, replayed and kept
 * unique for no benefit to the simulation.
 *
 * So the id is derived: `node:<epochTicks>`. Epochs strictly increase (FR-101), so ticks
 * are unique within a plan, and the id is stable for exactly as long as the node stays
 * where it is. When an edit moves a node the id changes — which is why every edit here
 * re-derives the selection from the index `PlanEdit` reports rather than carrying the old
 * id forward. That is a real cost and it buys the alternative's absence: no id allocator,
 * no identity to keep consistent across a replay, and no way for the plan and the machine
 * to disagree about which node is which.
 *
 * ## Refusals are state, not exceptions
 *
 * `addNode` and `moveNode` can refuse with `L5` (#133). The refusal is held in
 * `lastRefusal` and rendered, then cleared by the next successful edit. A thrown error
 * would be a blank screen; a silently dropped edit would be a click that did nothing.
 */
import { type Epoch } from '@hh/astro';
import type { AssistState, LegalityReason, LoadedScenario, PlanEdit } from '@hh/game';
import {
  addNode,
  decodeAssists,
  defaultAssistState,
  restrictToAllowed,
  deleteNode,
  moveNode,
  setNodeDeltaV,
  snapNudge,
  snapToApsis,
  snapToNamedApsis,
} from '@hh/game';
import { metresPerSec } from '@hh/math';
import type { ManeuverNode, Plan } from '@hh/sim';
import { EMPTY_PLAN } from '@hh/sim';
import type {
  DeltaVDrag,
  DraggingState,
  EpochDrag,
  HandleAxis,
  History,
  HistoryEntry,
  Interaction,
  NodeId,
  PlannerModel,
} from '@hh/ui';
import type { DeltaVCounts } from '@hh/sim';
import { fromDeltaVCounts, fromEpochTicks, toDeltaVCounts, toEpochTicks } from '@hh/sim';
import {
  EMPTY_HISTORY,
  IDLE,
  activeNodeId,
  beginDrag,
  cancelDrag,
  commit as commitPlan,
  createModel,
  deselect as deselectNode,
  evaluated,
  isCommittable,
  releaseDrag,
  scrubTo as scrubModel,
  select as selectInteraction,
  record as recordHistory,
  redo as redoHistory,
  undo as undoHistory,
  updateDeltaVDrag,
  updateEpochDrag,
} from '@hh/ui';
import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';

import { evaluateDrag, evaluatePlan, type Evaluation } from './evaluate.js';

/** A node's identity, derived from its epoch. See the docstring. */
export const nodeIdOf = (node: ManeuverNode): NodeId => `node:${String(node.epochTicks)}`;

/** The index a node id refers to, or `null` when it no longer names one. */
export const indexOfNodeId = (plan: Plan, id: NodeId | null): number | null => {
  if (id === null) return null;
  const index = plan.nodes.findIndex((node) => nodeIdOf(node) === id);
  return index === -1 ? null : index;
};

export interface PlannerState {
  readonly model: PlannerModel;
  readonly evaluation: Evaluation;
  /**
   * §6.6's assist set — #81's model, §8.3.12's *default assist set* setting.
   *
   * This was a lone `snapToApsis: boolean` while DEP-07's toggle was the only control the
   * planner carried. It is the whole set now, because #129's constraint preview is the
   * second consumer and a second boolean beside the first is how the two would come to
   * disagree about what "an assist" is.
   *
   * It arrives from the setting rather than from a control in the planner, and
   * `restrictToAllowed` has already been applied, so an assist this contract does not offer
   * reads `false` here whatever the setting says. Held in the state rather than read where
   * it is used because a committed run has to carry the set it *was* planned under — see
   * `CommittedRun.assists`.
   */
  readonly assists: AssistState;
  /** The last refused edit, shown until the next successful one (#133). */
  readonly lastRefusal: LegalityReason | null;
  /** Whether §8.3.5's overlay is open, and for which node id (#137). */
  readonly editorFor: NodeId | null;
  /**
   * What the plan *would* evaluate to if the gesture in flight were released — #134, #135.
   *
   * Both issues ask for the resulting orbit to update live, inside NFR-011's one-frame
   * budget. The plan itself deliberately does not change during a drag — that is what
   * makes Escape a no-op rather than an undo — so the live picture has to come from
   * somewhere else, and this is it.
   *
   * Built with `evaluateDrag`: `withPlan`'s incremental path and **no objective**, which
   * is where the frame budget is actually won. `null` whenever nothing is being dragged,
   * and every consumer falls back to `evaluation`, so there is exactly one place that
   * knows a preview exists.
   */
  readonly preview: Evaluation | null;
  /**
   * FR-110's undo stack — where the player has been, not where they are (#138).
   *
   * The reducer is in `@hh/ui`, deliberately holding no present of its own: this state
   * *is* the present, and a second copy of the plan here would immediately raise the
   * question of which one is authoritative. `history.ts` argues it at length.
   */
  readonly history: History;
}

export interface PlannerActions {
  readonly scrubTo: (epoch: Epoch) => void;
  readonly selectIndex: (index: number) => void;
  readonly deselect: () => void;
  readonly addNodeAt: (epoch: Epoch) => void;
  readonly deleteIndex: (index: number) => void;
  /** §8.5.1's EVALUATED → COMMITTED. A no-op unless the verdict permits it. */
  readonly commit: () => void;

  // ── #137's overlay ─────────────────────────────────────────────────────────
  readonly openEditor: (index: number) => void;
  readonly closeEditor: () => void;
  /**
   * Move a node to an exact mission-elapsed time. Quantised at entry by
   * `createManeuverNode`, and **never snapped** — the numeric fields are how a player says
   * what they mean, and §8.3.5 gives them the snap radios for the other intent.
   */
  readonly setEpoch: (index: number, metSeconds: number) => void;
  /**
   * §8.3.5's epoch slider: *"continuous drag; snaps to apsis within 30 s unless the snap
   * assist is off"* (#136).
   *
   * Separate from {@link setEpoch} because they are different operations rather than one
   * with a flag: a slider is a gesture and gets DEP-07's tolerance, a typed number is a
   * statement and does not.
   */
  readonly slideEpochTo: (index: number, metSeconds: number) => void;
  /**
   * §8.5.3's `,` / `.` — nudge the epoch, with DEP-07 applied through `snapNudge` (#136).
   *
   * Takes a delta rather than a destination because the snap rule needs to know which way
   * the player pushed: a nudge that would be snapped back the way it came is refused, so
   * a node can be walked off an apsis instead of being pinned to it. `snap.ts` states the
   * rule in full.
   */
  readonly nudgeEpochBy: (index: number, seconds: number) => void;
  readonly setDeltaV: (index: number, progradeMps: number, radialMps: number) => void;
  /** §8.3.5's snap radios — a command, not DEP-07's tolerance. */
  readonly snapNode: (index: number, kind: 'periapsis' | 'apoapsis') => void;
  /** §8.5.2's context menu: zero this burn without deleting it. */
  readonly zeroDeltaV: (index: number) => void;

  // ── #134, #135: a gesture in flight ────────────────────────────────────────
  readonly beginEpochDrag: (index: number) => void;
  readonly beginDeltaVDrag: (index: number, axis: HandleAxis) => void;
  /** Continuous; quantised only on release (FR-105). */
  readonly dragEpochTo: (epoch: Epoch) => void;
  readonly dragDeltaVTo: (progradeMps: number, radialMps: number) => void;
  /** Commits the gesture to the plan. */
  readonly releaseDragging: () => void;
  /** Escape: restores the pre-drag value and changes nothing. */
  readonly cancelDragging: () => void;

  // ── #138's undo stack ──────────────────────────────────────────────────────
  /** §8.5.3's `Ctrl+Z`. A no-op when there is nothing to undo, or mid-gesture. */
  readonly undo: () => void;
  /** §8.5.3's `Ctrl+Shift+Z`. */
  readonly redo: () => void;
}

/** The selected node's index, or `null`. Derived, never stored — see the docstring. */
export const selectedIndex = (state: PlannerState): number | null =>
  indexOfNodeId(state.model.plan, activeNodeId(state.model.interaction));

/**
 * The point in history this state represents — #138.
 *
 * The plan, the selection and the editor's target, which is §6.11's *"enough interaction
 * state that undo does not strand the player"*. Not the scrub head: FR-403 makes scrubbing
 * a view operation, and an undoable scrub would make `Ctrl+Z` appear to do nothing after a
 * player had merely looked around.
 */
const entryOf = (state: PlannerState): HistoryEntry => ({
  plan: state.model.plan,
  selectedNodeId: activeNodeId(state.model.interaction),
  editorFor: state.editorFor,
});

/**
 * The interaction state after a plan edit that was not a drag.
 *
 * §8.5.1 reaches EVALUATED from a drag *release*, and `evaluated` deliberately refuses
 * DRAGGING as a source so that a release can never be skipped. Every edit here is a
 * button, a field or a keystroke rather than a gesture, so the narrowing below is a real
 * check and not a formality: if the planner is somehow mid-drag when one arrives, the
 * interaction is left alone and the drag still has to be released.
 *
 * Written as an explicit narrowing rather than a cast. A `as never` here would have
 * type-checked and quietly removed the guarantee `machine.ts` exists to provide.
 */
const afterEdit = (interaction: Interaction, nodeId: NodeId | null): Interaction =>
  interaction.phase === 'DRAGGING' || interaction.phase === 'COMMITTED'
    ? interaction
    : evaluated(interaction, nodeId);

/**
 * The current interaction as an epoch drag, or `null`.
 *
 * `DraggingState<EpochDrag>` and `DraggingState<DeltaVDrag>` are distinct types, and
 * `updateEpochDrag` accepts only the first — see `machine.ts`. These two functions are
 * where that distinction is discharged at run time, once, rather than at each call site.
 */
const epochDragging = (state: PlannerState): DraggingState<EpochDrag> | null => {
  const { interaction } = state.model;
  return interaction.phase === 'DRAGGING' && interaction.drag.kind === 'epoch'
    ? { ...interaction, drag: interaction.drag }
    : null;
};

const deltaVDragging = (state: PlannerState): DraggingState<DeltaVDrag> | null => {
  const { interaction } = state.model;
  return interaction.phase === 'DRAGGING' && interaction.drag.kind === 'deltaV'
    ? { ...interaction, drag: interaction.drag }
    : null;
};

/**
 * The evaluation a gesture's candidate plan would produce, or the last one.
 *
 * A refused candidate — a drag that has carried a node inside FR-101's spacing — keeps
 * the previous preview rather than blanking the orbit view mid-gesture. The refusal is
 * reported on release, which is when the player finds out, and until then the picture
 * simply stops following. Falling back to `null` here would make the trajectory vanish
 * and reappear as the cursor crossed the boundary.
 */
const previewOf = (
  scenario: LoadedScenario,
  current: PlannerState,
  edit: PlanEdit,
): Evaluation | null => {
  const base = current.evaluation.timeline;
  if (!edit.ok || base === null) return current.preview;
  return evaluateDrag(scenario, edit.plan, base);
};

/**
 * What the planner opens with.
 *
 * Empty for a fresh contract. Populated when the player comes *back* — aborting a run
 * (FR-603, *"back to the planner with the plan intact"*) or retrying from the debrief
 * (§6.11, *"Retry restores the plan"*).
 *
 * The scrub head and the selection are part of it because #145's last criterion asks for
 * them: *"abort returns to the planner with selection and scrub state sensibly
 * restored"*. Restoring the plan and dropping the player at T+0 with nothing selected
 * would technically satisfy "intact" and would still lose the place they were working.
 */
export interface PlannerSeed {
  readonly plan?: Plan;
  readonly scrubEpoch?: Epoch;
  readonly selectedNodeId?: NodeId | null;
}

/**
 * The state after stepping to another point in history — #138.
 *
 * Shared by undo and redo because they differ only in which entry they move to; writing it
 * twice is how the two would come to disagree about, say, whether the editor target is
 * restored.
 *
 * Three things are deliberately *not* taken from the entry. The **scrub head** stays where
 * it is, because it was never recorded (FR-403). The **assist flags** stay, because they
 * are a setting rather than an edit and §6.6 does not make them part of the plan. And
 * `lastRefusal` is cleared, because the refusal being shown was about an edit that is no
 * longer the most recent thing that happened.
 *
 * The interaction becomes EVALUATED rather than IDLE, and that matters: §8.5.1 reaches
 * COMMITTED only from EVALUATED, so an undone plan left IDLE would render a Commit button
 * that could not fire. It is also simply true — the line below evaluates the plan.
 */
const restored = (
  scenario: LoadedScenario,
  current: PlannerState,
  entry: HistoryEntry,
  history: History,
): PlannerState => {
  // A restored selection has to name a node the restored plan actually contains. It
  // always does, because the entry recorded them together — the check is what keeps a
  // stale id out of the machine if that ever stops being true.
  const selected =
    entry.selectedNodeId !== null && indexOfNodeId(entry.plan, entry.selectedNodeId) !== null
      ? entry.selectedNodeId
      : null;

  return {
    model: {
      plan: entry.plan,
      interaction: evaluated(IDLE, selected),
      scrub: current.model.scrub,
    },
    evaluation: evaluatePlan(scenario, entry.plan, current.evaluation.timeline),
    assists: current.assists,
    lastRefusal: null,
    editorFor:
      entry.editorFor !== null && indexOfNodeId(entry.plan, entry.editorFor) !== null
        ? entry.editorFor
        : null,
    preview: null,
    history,
  };
};

export const usePlanner = (
  scenario: LoadedScenario,
  seed: PlannerSeed = {},
  /**
   * §8.3.12's *default assist set*, as the bitmask the setting stores.
   *
   * A mask rather than an `AssistState` because it is what the settings screen holds, what
   * §11.6's replay records, and — the reason it matters here — a **number**, so the memo
   * below and the effect that follows it have a dependency that does not change identity
   * on every render of the screen above.
   *
   * The planner used to ignore this entirely: it started from `defaultAssistState()` on
   * every contract, and the setting was written to the save and read by nothing. The tray
   * that made that survivable is gone, so this is now the only thing that decides whether
   * a run snaps to apsides or previews constraints.
   */
  assistMask = 0,
): readonly [PlannerState, PlannerActions] => {
  /**
   * The set this run is planned under: the setting, restricted to what the contract offers.
   *
   * §6.6 makes `assistsAllowed` a permission rather than a default, so the restriction is
   * applied here and not in the setting — turning the targeting computer on before C13
   * unlocks it is a thing a player can do in Settings and not a thing that reaches a run.
   *
   * A mask this build cannot decode falls back to the defaults rather than to nothing: an
   * unreadable setting should not silently take a player's snapping away.
   */
  const assists = useMemo(
    () =>
      restrictToAllowed(
        decodeAssists(assistMask) ?? defaultAssistState(),
        scenario.document.assistsAllowed,
      ),
    [assistMask, scenario],
  );

  const [state, setState] = useState<PlannerState>(() => {
    const initialPlan = seed.plan ?? EMPTY_PLAN;
    const model = createModel(initialPlan, seed.scrubEpoch ?? scenario.startEpoch);
    // A restored selection has to name a node that still exists — the plan came back with
    // the run, so it does, but a seed assembled elsewhere might not. The check is what
    // keeps a stale id out of the machine.
    const selected = seed.selectedNodeId ?? null;
    const restored = selected !== null && indexOfNodeId(initialPlan, selected) !== null;

    return {
      model: {
        ...model,
        // **A restored planner starts EVALUATED, not IDLE**, and that is a correctness
        // point rather than a nicety. §8.5.1 reaches COMMITTED only from EVALUATED, and
        // `commit` enforces it by taking that state — so a planner seeded with a plan and
        // left IDLE would render an enabled Commit button that did nothing. The state is
        // also simply true: the line above evaluated the plan, which is exactly what
        // EVALUATED means.
        //
        // A fresh planner stays IDLE. There is no plan there to have evaluated, and
        // offering Commit before the player has placed a burn would be offering to fly an
        // empty plan.
        interaction:
          seed.plan === undefined ? model.interaction : evaluated(IDLE, restored ? selected : null),
      },
      evaluation: evaluatePlan(scenario, initialPlan),
      assists,
      lastRefusal: null,
      editorFor: null,
      preview: null,
      // Empty even when a plan was seeded. A retry or an abort restores the plan the
      // player committed (§6.11, FR-603); it does not restore the session in which they
      // built it, and offering to undo edits made before a run would be offering to undo
      // something that is no longer on screen.
      history: EMPTY_HISTORY,
    };
  });

  /**
   * Apply an edit, or record why it was refused.
   *
   * The single funnel every mutation goes through, so re-evaluation, the selection update
   * and the refusal handling are written once rather than once per action. `previous` is
   * the current timeline, which is what lets `evaluatePlan` take `withPlan`'s incremental
   * path (FR-104) instead of rebuilding from arc 0.
   */
  const apply = useCallback(
    (edit: (current: PlannerState) => PlanEdit | null): void => {
      setState((current) => {
        const result = edit(current);
        if (result === null) return current;
        if (!result.ok) return { ...current, lastRefusal: result.reason };

        const node = result.plan.nodes[result.nodeIndex];
        return {
          model: {
            plan: result.plan,
            interaction: afterEdit(
              current.model.interaction,
              node === undefined ? null : nodeIdOf(node),
            ),
            // Scrubbing is orthogonal: an edit does not move the scrub head.
            scrub: current.model.scrub,
          },
          evaluation: evaluatePlan(scenario, result.plan, current.evaluation.timeline),
          assists: current.assists,
          lastRefusal: null,
          preview: null,
          // One entry per accepted edit -- §6.11's rule, and it is recorded *here*
          // rather than at each call site precisely because this is the single funnel
          // every non-drag mutation goes through. The refusal arm above returns before
          // reaching this, so an `L5` pushes nothing and leaves redo alone.
          history: recordHistory(current.history, entryOf(current)),
          // The overlay follows the node it was opened for. An edit that moved the node
          // changed its id — ids are derived from the epoch, see the docstring — so
          // carrying the old one forward would close the editor on every epoch change.
          editorFor:
            current.editorFor === null || node === undefined ? current.editorFor : nodeIdOf(node),
        };
      });
    },
    [scenario],
  );

  /**
   * The setting can change while the planner is open, and it must take effect.
   *
   * Settings is a route that renders as an *overlay* over whatever screen is showing
   * (`SettingsOverlay` says why), so a player turning snapping off mid-plan never leaves
   * the planner and would otherwise be looking at a screen that disagreed with the switch
   * they had just moved. The memo above gives this a stable identity, so it runs when the
   * mask or the contract changes and not once per render.
   */
  useEffect(() => {
    setState((current) => (current.assists === assists ? current : { ...current, assists }));
  }, [assists]);

  const actions = useMemo<PlannerActions>(
    () => ({
      scrubTo: (epoch) => {
        // Clamped into the horizon before it reaches the model. `arcAt` throws
        // `EpochOutOfHorizonError` outside it, and the timeline slider's
        // `startEpoch + seconds` can land an ulp past `horizon` at the top of its
        // range — which would be a crash at the one position a player is most likely
        // to drag to. Clamping is right rather than merely safe: §6.3 stops prediction
        // at the horizon, so there is nothing past it to scrub to.
        const at = Math.min(Math.max(epoch, scenario.startEpoch), scenario.horizon) as Epoch;
        // Otherwise straight through the machine, so the plan is passed by reference and
        // FR-403's invariant holds here for the same reason it holds in `machine.test.ts`.
        setState((current) => ({ ...current, model: scrubModel(current.model, at) }));
      },

      selectIndex: (index) => {
        setState((current) => {
          const node = current.model.plan.nodes[index];
          if (node === undefined) return current;

          const { interaction } = current.model;
          // `select` accepts IDLE, SELECTED and EVALUATED and nothing else. The other
          // three are not errors to report — a click during a drag is just a click the
          // drag owns — so they are left alone.
          if (
            interaction.phase !== 'IDLE' &&
            interaction.phase !== 'SELECTED' &&
            interaction.phase !== 'EVALUATED'
          ) {
            return current;
          }
          return {
            ...current,
            model: {
              ...current.model,
              interaction: selectInteraction(interaction, nodeIdOf(node)),
            },
          };
        });
      },

      deselect: () => {
        setState((current) => {
          const { interaction } = current.model;
          if (interaction.phase !== 'SELECTED' && interaction.phase !== 'EVALUATED') {
            return current;
          }
          return {
            ...current,
            model: { ...current.model, interaction: deselectNode(interaction) },
          };
        });
      },

      addNodeAt: (epoch) => {
        apply((current) => {
          const { timeline } = current.evaluation;
          // DEP-07 needs a timeline to find apsides on. Without one — a plan that failed
          // to build — the raw epoch is used, which is the answer the assist-off path
          // gives anyway and is better than refusing to place a node at all.
          const at =
            timeline === null
              ? epoch
              : snapToApsis(timeline, epoch, current.assists.snapping).epoch;
          return addNode(current.model.plan, at);
        });
      },

      deleteIndex: (index) => {
        apply((current) =>
          current.model.plan.nodes[index] === undefined
            ? null
            : deleteNode(current.model.plan, index),
        );
      },

      // ── #137's overlay ───────────────────────────────────────────────────
      openEditor: (index) => {
        setState((current) => {
          const node = current.model.plan.nodes[index];
          return node === undefined ? current : { ...current, editorFor: nodeIdOf(node) };
        });
      },

      closeEditor: () => {
        // Nothing to save: every field in the overlay commits as it is edited, so there
        // is no draft to lose (#137's sixth criterion). See `NodeEditor.tsx`.
        setState((current) => ({ ...current, editorFor: null }));
      },

      setEpoch: (index, metSeconds) => {
        apply((current) => {
          if (current.model.plan.nodes[index] === undefined) return null;
          // Clamped for the same reason `nudgeEpochBy` below clamps: evaluating a plan
          // whose node sits outside the window throws `RangeError` from
          // `requireNodesWithinHorizon`, and that throw would happen inside `apply`'s
          // `setState` updater. `NodeEditor` already refuses an out-of-window typed epoch
          // and restores the field — §8.3.5 asks for rejection, not clamping, so this is
          // the guard behind that rather than the rule, and it keeps every other caller of
          // `setEpoch` from being able to throw.
          const at = Math.min(
            Math.max(scenario.startEpoch + metSeconds, scenario.startEpoch),
            scenario.horizon,
          ) as Epoch;
          return moveNode(current.model.plan, index, at);
        });
      },

      slideEpochTo: (index, metSeconds) => {
        apply((current) => {
          if (current.model.plan.nodes[index] === undefined) return null;
          const at = (scenario.startEpoch + metSeconds) as Epoch;
          const { timeline } = current.evaluation;
          // The same fallback `addNodeAt` takes: with no timeline there is nothing to find
          // apsides on, and the raw epoch is the answer the assist-off path gives anyway.
          const to =
            timeline === null ? at : snapToApsis(timeline, at, current.assists.snapping).epoch;
          return moveNode(current.model.plan, index, to);
        });
      },

      nudgeEpochBy: (index, seconds) => {
        apply((current) => {
          const node = current.model.plan.nodes[index];
          if (node === undefined) return null;
          const to = (node.epoch + seconds) as Epoch;
          const { timeline } = current.evaluation;
          // Clamped before the snap, not after: `snapNudge` calls `arcAt`, which throws
          // outside the horizon, and `.` at the end of the mission is a key a player will
          // press. Clamping after would also let the snap carry the node past the wall.
          const clamped = Math.min(Math.max(to, scenario.startEpoch), scenario.horizon) as Epoch;
          const at =
            timeline === null
              ? clamped
              : snapNudge(timeline, node.epoch, clamped, current.assists.snapping).epoch;
          return moveNode(current.model.plan, index, at);
        });
      },

      setDeltaV: (index, progradeMps, radialMps) => {
        apply((current) =>
          current.model.plan.nodes[index] === undefined
            ? null
            : setNodeDeltaV(current.model.plan, index, progradeMps, radialMps),
        );
      },

      snapNode: (index, kind) => {
        apply((current) => {
          const node = current.model.plan.nodes[index];
          const { timeline } = current.evaluation;
          if (node === undefined || timeline === null) return null;
          const at = snapToNamedApsis(timeline, node.epoch, kind);
          // `null` is a round orbit, which has no apsides, or an open one with no
          // apoapsis. Leaving the node alone is the honest answer — moving it to an
          // arbitrary point on a circle would be motion with no meaning.
          return at === null ? null : moveNode(current.model.plan, index, at);
        });
      },

      zeroDeltaV: (index) => {
        apply((current) =>
          current.model.plan.nodes[index] === undefined
            ? null
            : setNodeDeltaV(current.model.plan, index, 0, 0),
        );
      },

      // ── #134, #135 ───────────────────────────────────────────────────────
      beginEpochDrag: (index) => {
        setState((current) => {
          const node = current.model.plan.nodes[index];
          const { interaction } = current.model;
          // `beginDrag` accepts SELECTED and nothing else, so the node has to be selected
          // first. The orbit view does that on the same pointer-down.
          if (node === undefined || interaction.phase !== 'SELECTED') return current;
          const drag: EpochDrag = {
            kind: 'epoch',
            fromTicks: node.epochTicks,
            ticks: node.epochTicks,
          };
          return {
            ...current,
            model: { ...current.model, interaction: beginDrag(interaction, drag) },
          };
        });
      },

      beginDeltaVDrag: (index, axis) => {
        setState((current) => {
          const node = current.model.plan.nodes[index];
          const { interaction } = current.model;
          if (node === undefined || interaction.phase !== 'SELECTED') return current;
          const drag: DeltaVDrag = {
            kind: 'deltaV',
            axis,
            fromCounts: node.deltaVCounts,
            counts: node.deltaVCounts,
          };
          return {
            ...current,
            model: { ...current.model, interaction: beginDrag(interaction, drag) },
          };
        });
      },

      dragEpochTo: (epoch) => {
        setState((current) => {
          const dragging = epochDragging(current);
          if (dragging === null) return current;
          // Ticks, continuously. The *value* is quantised here because ticks are the
          // unit the drag carries — see `machine.ts` — but the **plan** is not touched
          // until release, which is what FR-105 and #134 actually ask for.
          const raw = Math.min(Math.max(epoch, scenario.startEpoch), scenario.horizon) as Epoch;
          // **DEP-07 applies during the gesture, not on release — #136.**
          //
          // `releaseDragging` used to call `moveNode` with the raw dragged tick while
          // `addNodeAt` snapped, so a node placed by clicking landed on the apsis and the
          // same node dragged one pixel came off it. Snapping *here* fixes that and fixes
          // the second half of #136 at the same time: the drag carries the snapped value,
          // so the preview already shows where the burn will land and there is no jump on
          // release. Snapping on release instead would leave the node visibly moving after
          // the player let go.
          //
          // Searched against the settled timeline rather than the drag preview, which is
          // what `addNodeAt` does too: the apsides a player is aiming at are the ones on
          // the trajectory they grabbed, and re-deriving them from a preview that changes
          // with every pixel would make the target move as it was approached.
          const { timeline } = current.evaluation;
          const at =
            timeline === null ? raw : snapToApsis(timeline, raw, current.assists.snapping).epoch;
          const index = indexOfNodeId(current.model.plan, dragging.nodeId);
          return {
            ...current,
            model: {
              ...current.model,
              interaction: updateEpochDrag(dragging, toEpochTicks(at)),
            },
            preview:
              index === null
                ? current.preview
                : previewOf(scenario, current, moveNode(current.model.plan, index, at)),
          };
        });
      },

      dragDeltaVTo: (progradeMps, radialMps) => {
        setState((current) => {
          const dragging = deltaVDragging(current);
          if (dragging === null) return current;
          const counts: DeltaVCounts = [
            toDeltaVCounts(metresPerSec(radialMps)),
            toDeltaVCounts(metresPerSec(progradeMps)),
            0,
          ];
          const index = indexOfNodeId(current.model.plan, dragging.nodeId);
          return {
            ...current,
            model: {
              ...current.model,
              interaction: updateDeltaVDrag(dragging, counts),
            },
            preview:
              index === null
                ? current.preview
                : previewOf(
                    scenario,
                    current,
                    setNodeDeltaV(current.model.plan, index, progradeMps, radialMps),
                  ),
          };
        });
      },

      releaseDragging: () => {
        setState((current) => {
          const { interaction } = current.model;
          if (interaction.phase !== 'DRAGGING') return current;

          const index = indexOfNodeId(current.model.plan, interaction.nodeId);
          // §8.5.1 requires the release even when there is nothing to commit, so the
          // machine leaves DRAGGING either way.
          const released = releaseDrag(interaction);
          if (index === null) {
            return {
              ...current,
              model: { ...current.model, interaction: released },
              preview: null,
            };
          }

          const { drag } = interaction;
          const edit =
            drag.kind === 'epoch'
              ? moveNode(current.model.plan, index, fromEpochTicks(drag.ticks))
              : setNodeDeltaV(
                  current.model.plan,
                  index,
                  fromDeltaVCounts(drag.counts[1]),
                  fromDeltaVCounts(drag.counts[0]),
                );

          if (!edit.ok) {
            // A refused release — #134's "lands within the minimum spacing" case. The
            // plan is unchanged, which *is* the restoration: the pre-drag value was never
            // overwritten, because a drag does not touch the plan until here.
            return {
              ...current,
              model: { ...current.model, interaction: released },
              lastRefusal: edit.reason,
              preview: null,
            };
          }

          const node = edit.plan.nodes[edit.nodeIndex];
          return {
            model: {
              plan: edit.plan,
              interaction: evaluated(released, node === undefined ? null : nodeIdOf(node)),
              scrub: current.model.scrub,
            },
            evaluation: evaluatePlan(scenario, edit.plan, current.evaluation.timeline),
            assists: current.assists,
            lastRefusal: null,
            preview: null,
            // **One drag is one entry**, however many pointer events it produced. That is
            // structural rather than something to be careful about: the plan is not
            // touched until this release, so this is the only place a drag can record.
            history: recordHistory(current.history, entryOf(current)),
            editorFor:
              current.editorFor === null || node === undefined ? current.editorFor : nodeIdOf(node),
          };
        });
      },

      cancelDragging: () => {
        setState((current) => {
          const { interaction } = current.model;
          if (interaction.phase !== 'DRAGGING') return current;
          // Nothing to restore. The plan was never edited during the gesture, so
          // returning to SELECTED *is* the restoration — which is why `cancelDrag` goes
          // back to SELECTED rather than to EVALUATED (#134, #135).
          return {
            ...current,
            model: { ...current.model, interaction: cancelDrag(interaction) },
            preview: null,
          };
        });
      },

      // ── #138 ─────────────────────────────────────────────────────────────
      undo: () => {
        setState((current) => {
          // Never mid-gesture. §8.5.1 requires a drag to be released or cancelled, and
          // undoing out from under one would leave the machine in DRAGGING against a plan
          // the drag was not started on. `Escape` is the way out of a drag.
          if (current.model.interaction.phase === 'DRAGGING') return current;
          const move = undoHistory(current.history, entryOf(current));
          return move === null ? current : restored(scenario, current, move.entry, move.history);
        });
      },

      redo: () => {
        setState((current) => {
          if (current.model.interaction.phase === 'DRAGGING') return current;
          const move = redoHistory(current.history, entryOf(current));
          return move === null ? current : restored(scenario, current, move.entry, move.history);
        });
      },

      commit: () => {
        setState((current) => {
          const { legality } = current.evaluation;
          // Two narrowings, and both are the requirement rather than defensive coding.
          // `isCommittable` is §6.4's check; `evaluated` is §8.5.1's precondition that
          // COMMITTED follows an evaluation. Neither can be skipped, because `commit`
          // does not accept a state or a verdict that has not passed them.
          if (!isCommittable(legality)) return current;
          const { interaction } = current.model;
          if (interaction.phase !== 'EVALUATED') return current;

          return {
            ...current,
            model: {
              ...current.model,
              interaction: commitPlan(interaction, legality, current.model.plan),
            },
          };
        });
      },
    }),
    [apply, scenario],
  );

  return [state, actions] as const;
};
