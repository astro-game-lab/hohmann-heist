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
import type { LegalityReason, LoadedScenario, PlanEdit } from '@hh/game';
import {
  addNode,
  deleteNode,
  moveNode,
  setNodeDeltaV,
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
  Interaction,
  NodeId,
  PlannerModel,
} from '@hh/ui';
import type { DeltaVCounts } from '@hh/sim';
import { fromDeltaVCounts, fromEpochTicks, toDeltaVCounts, toEpochTicks } from '@hh/sim';
import {
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
  updateDeltaVDrag,
  updateEpochDrag,
} from '@hh/ui';
import { useCallback, useMemo, useState } from 'preact/hooks';

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
  /** DEP-07's assist. On by default: §6.6's assists start enabled and are opted out of. */
  readonly snapToApsis: boolean;
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
}

export interface PlannerActions {
  readonly scrubTo: (epoch: Epoch) => void;
  readonly selectIndex: (index: number) => void;
  readonly deselect: () => void;
  readonly addNodeAt: (epoch: Epoch) => void;
  readonly deleteIndex: (index: number) => void;
  readonly setSnapToApsis: (enabled: boolean) => void;
  /** §8.5.1's EVALUATED → COMMITTED. A no-op unless the verdict permits it. */
  readonly commit: () => void;

  // ── #137's overlay ─────────────────────────────────────────────────────────
  readonly openEditor: (index: number) => void;
  readonly closeEditor: () => void;
  /** Move a node to a mission-elapsed time. Quantised at entry by `createManeuverNode`. */
  readonly setEpoch: (index: number, metSeconds: number) => void;
  readonly setDeltaV: (index: number, progradeMps: number, radialMps: number) => void;
  /** §8.3.5's snap radios — a command, not DEP-07's tolerance. */
  readonly snapNode: (index: number, kind: 'periapsis' | 'apoapsis') => void;

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
}

/** The selected node's index, or `null`. Derived, never stored — see the docstring. */
export const selectedIndex = (state: PlannerState): number | null =>
  indexOfNodeId(state.model.plan, activeNodeId(state.model.interaction));

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

export const usePlanner = (
  scenario: LoadedScenario,
  initialPlan: Plan = EMPTY_PLAN,
): readonly [PlannerState, PlannerActions] => {
  const [state, setState] = useState<PlannerState>(() => ({
    model: createModel(initialPlan, scenario.startEpoch),
    evaluation: evaluatePlan(scenario, initialPlan),
    snapToApsis: true,
    lastRefusal: null,
    editorFor: null,
    preview: null,
  }));

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
          snapToApsis: current.snapToApsis,
          lastRefusal: null,
          preview: null,
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
            timeline === null ? epoch : snapToApsis(timeline, epoch, current.snapToApsis).epoch;
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

      setSnapToApsis: (enabled) => {
        setState((current) => ({ ...current, snapToApsis: enabled }));
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
        apply((current) =>
          current.model.plan.nodes[index] === undefined
            ? null
            : moveNode(current.model.plan, index, (scenario.startEpoch + metSeconds) as Epoch),
        );
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
          const at = Math.min(Math.max(epoch, scenario.startEpoch), scenario.horizon) as Epoch;
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
            snapToApsis: current.snapToApsis,
            lastRefusal: null,
            preview: null,
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
