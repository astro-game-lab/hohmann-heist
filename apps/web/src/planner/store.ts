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
import { addNode, deleteNode, snapToApsis } from '@hh/game';
import type { ManeuverNode, Plan } from '@hh/sim';
import { EMPTY_PLAN } from '@hh/sim';
import type { Interaction, NodeId, PlannerModel } from '@hh/ui';
import {
  activeNodeId,
  commit as commitPlan,
  createModel,
  deselect as deselectNode,
  evaluated,
  isCommittable,
  scrubTo as scrubModel,
  select as selectInteraction,
} from '@hh/ui';
import { useCallback, useMemo, useState } from 'preact/hooks';

import { evaluatePlan, type Evaluation } from './evaluate.js';

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

export const usePlanner = (
  scenario: LoadedScenario,
  initialPlan: Plan = EMPTY_PLAN,
): readonly [PlannerState, PlannerActions] => {
  const [state, setState] = useState<PlannerState>(() => ({
    model: createModel(initialPlan, scenario.startEpoch),
    evaluation: evaluatePlan(scenario, initialPlan),
    snapToApsis: true,
    lastRefusal: null,
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
