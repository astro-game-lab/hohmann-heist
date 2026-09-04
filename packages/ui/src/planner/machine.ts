/**
 * The planner's state machine — §8.5.1.
 *
 * §8.5.1 draws six states and the edges between them. This is that diagram as types,
 * and the word in #143's acceptance criteria that decides the whole design is
 * **"impossible by construction, not merely unreachable through the current UI"**.
 *
 * ## Why there is no reducer
 *
 * The obvious shape is one `reduce(state, action)` over a union of states and a union
 * of actions, with a `switch` inside. That makes every illegal pair *representable* —
 * `reduce(idle, {type:'release'})` compiles — and pushes the rule into the default arm
 * of a switch, where it is enforced at run time by a branch someone can delete. It also
 * makes "illegal transitions are impossible" a claim about a function body rather than
 * about the type, which is exactly the distinction #143 draws.
 *
 * So each edge is its own function, and its parameter is the set of states that edge
 * legally leaves. {@link releaseDrag} takes a {@link DraggingState}; handing it an
 * {@link IdleState} is a type error, not a run-time no-op. There is no state a caller
 * can be in from which the wrong call type-checks, which is the property, stated once.
 *
 * `machine.test.ts` asserts this with `@ts-expect-error` rather than with a run-time
 * expectation, because that is the only way to test a compile-time claim: `pnpm
 * typecheck` fails if one of those edges ever *becomes* legal, and the test file is
 * inside the root project precisely so that it does.
 *
 * ## COMMITTED is gated by the type of its evidence
 *
 * §6.4 and #143 both say COMMITTED is reachable only from a legal EVALUATED state.
 * {@link commit} therefore takes a {@link CommittableLegality} — `@hh/game`'s `Legality`
 * narrowed to `evaluable: true` **and** `commitAllowed: true`. A caller holding a
 * `Legality` cannot pass it without narrowing first, and narrowing is exactly the check
 * §6.4 asks for. The gate is not a condition inside this function; it is the reason the
 * call compiles.
 *
 * Note what this does *not* do: it does not re-derive legality. §6.4's rules live in
 * `evaluateLegality` and #139's gate reads them, duplicating none — this only refuses to
 * move without the verdict in hand.
 *
 * ## SCRUBBING is a field, not a phase
 *
 * §8.5.1 puts SCRUBBING outside the diagram: *"orthogonal (view-only, never mutates),
 * can overlay any state."* A seventh phase would make it exclusive of the six, which is
 * the opposite of what that sentence says — a player can scrub while a node is selected,
 * and scrubbing must not deselect it.
 *
 * So it lives on {@link PlannerModel} beside the interaction rather than inside it, and
 * {@link scrubTo} returns a model whose `plan` **and** `interaction` are the very same
 * objects it was given. FR-403's "never mutates the plan" is then checkable by reference
 * identity rather than by deep equality, which is a stronger statement and a cheaper
 * test: `expect(next.plan).toBe(previous.plan)`.
 *
 * ## No DOM, no clock, no canvas
 *
 * #143's fifth criterion. Nothing here touches a browser, so the whole machine runs in
 * the `packages` Node project, and `@hh/ui`'s place in the root DOM-free TypeScript
 * project is what keeps that true rather than merely intended — a `document` here is a
 * type error before it is a review comment.
 */
import type { Epoch } from '@hh/astro';
import type { Legality } from '@hh/game';
import type { DeltaVCounts, Plan } from '@hh/sim';

/** A node's identity within the planner. Stable across an edit; not its index. */
export type NodeId = string;

/**
 * Which Δv handle a drag is pulling — §8.3.5's two v1.0 axes.
 *
 * Deliberately re-declared rather than imported from `@hh/render`'s `HandleAxisId`:
 * `@hh/ui` does not depend on `@hh/render` and must not start, because the layering rule
 * points render → game → sim and this package sits beside render, not above it. The two
 * declarations have to agree, and `apps/web` — the one place that imports both — asserts
 * that they do, in `planner/axes.test.ts`. A shared constant would have required exactly
 * the dependency the rule forbids.
 *
 * The normal component is absent, and that is §8.3.5's own decision: it is marked v1.1.
 */
export type HandleAxis = 'prograde' | 'radial';

/**
 * Where a node is about to be placed — §8.5.2, DEP-07.
 *
 * Carries both epochs because the player needs to be told what happened: the snap moved
 * their click, and a preview that showed only the result would look like the click had
 * missed. `snappedTo` is what the assist tray's toggle turns off (#133).
 */
export interface Placement {
  /** The epoch under the pointer, keyboard caret, or finger. */
  readonly rawEpoch: Epoch;
  /** After DEP-07's apsis snap — the same value when the assist is off or nothing was near. */
  readonly epoch: Epoch;
  /** What the snap caught, or `null` for a raw placement. */
  readonly snappedTo: 'periapsis' | 'apoapsis' | null;
}

/**
 * A node-epoch drag in flight — #134.
 *
 * `fromTicks` is the pre-drag epoch and it never changes during the gesture, which is
 * what lets Escape restore it exactly rather than approximately. Both are **ticks**, not
 * seconds: FR-105 quantises on release, and carrying the live value in the quantised
 * unit means the release is a copy rather than a rounding.
 */
export interface EpochDrag {
  readonly kind: 'epoch';
  /** The epoch the node had when the drag began. Escape restores this (#134). */
  readonly fromTicks: number;
  /** Where the pointer is now, in ticks. */
  readonly ticks: number;
}

/**
 * A Δv handle drag in flight — #135.
 *
 * Counts rather than metres per second, for the reason above: DEP-09's quantum is
 * 1e-4 m/s and the released value should be exactly the count that was released.
 */
export interface DeltaVDrag {
  readonly kind: 'deltaV';
  readonly axis: HandleAxis;
  /** The node's Δv when the drag began. Escape restores this (#135). */
  readonly fromCounts: DeltaVCounts;
  readonly counts: DeltaVCounts;
}

export type Drag = EpochDrag | DeltaVDrag;

/** Nothing selected, nothing in flight. */
export interface IdleState {
  readonly phase: 'IDLE';
}

/** A node is being positioned but does not exist yet — §8.5.1's `click orbit` edge. */
export interface PlacingState {
  readonly phase: 'PLACING';
  readonly placement: Placement;
}

/** One node carries the selection. */
export interface SelectedState {
  readonly phase: 'SELECTED';
  readonly nodeId: NodeId;
}

/**
 * A drag is in flight on the selected node.
 *
 * Generic in its drag so that {@link updateEpochDrag} and {@link updateDeltaVDrag} can
 * each name the one kind they understand. `DraggingState<EpochDrag>` and
 * `DraggingState<DeltaVDrag>` are distinct types, so feeding a Δv value into an epoch
 * drag does not compile — which is the same construction argument as the phases, applied
 * one level down, and it matters because the two carry different units.
 */
export interface DraggingState<D extends Drag = Drag> {
  readonly phase: 'DRAGGING';
  readonly nodeId: NodeId;
  readonly drag: D;
}

/**
 * The plan has changed and been re-evaluated; *Commit* is now answerable.
 *
 * `nodeId` survives the transition because releasing a drag should not deselect the node
 * that was dragged — the player is very likely to adjust it again. It is nullable for the
 * edits that have no node afterwards, deletion being the obvious one.
 */
export interface EvaluatedState {
  readonly phase: 'EVALUATED';
  readonly nodeId: NodeId | null;
}

/** The plan has been committed. §8.5.1's exit to EXECUTION; nothing returns from here. */
export interface CommittedState {
  readonly phase: 'COMMITTED';
  readonly plan: Plan;
}

/** §8.5.1's six states. */
export type Interaction =
  IdleState | PlacingState | SelectedState | DraggingState | EvaluatedState | CommittedState;

/**
 * A legality verdict that permits committing.
 *
 * `Legality` is a union whose non-evaluable arm fixes `commitAllowed: false`, so this
 * intersection collapses to "evaluable, and allowed". Spelled as a named type because it
 * is the precondition §6.4 states, and a caller that has to write the narrowing has to
 * have done the check.
 */
export type CommittableLegality = Extract<Legality, { readonly evaluable: true }> & {
  readonly commitAllowed: true;
};

/**
 * Whether a verdict permits committing — §6.4's check, as a narrowing.
 *
 * A type predicate rather than a cast, so that {@link commit}'s precondition is
 * discharged by *performing* the check rather than by asserting it away. This is the one
 * function that turns a `Legality` into the evidence COMMITTED requires, which makes it
 * the single place §6.4's gate is spelled — #139's disabled state reads the same verdict
 * and the same reasons, and neither re-derives them.
 *
 * Note it deliberately does not look at `reasons`: a non-blocking `L6` leaves
 * `commitAllowed` true, and reading the array here would be a second implementation of
 * the rule that `evaluateLegality` already applied. §6.4's "`L6` is a warning" survives
 * because this asks the verdict, not the list.
 */
export const isCommittable = (legality: Legality): legality is CommittableLegality =>
  legality.evaluable && legality.commitAllowed;

/** Where the scrub head is. Orthogonal to {@link Interaction} — see the docstring. */
export interface ScrubState {
  readonly epoch: Epoch;
  /** Whether a scrub gesture is in flight. Presentation only; nothing branches on it. */
  readonly scrubbing: boolean;
}

/** The planner's whole state: the plan, where the interaction is, and where time is. */
export interface PlannerModel {
  readonly plan: Plan;
  readonly interaction: Interaction;
  readonly scrub: ScrubState;
}

/** The starting state. */
export const IDLE: IdleState = Object.freeze({ phase: 'IDLE' });

/** A fresh model over `plan`, with the scrub head at `epoch`. */
export const createModel = (plan: Plan, epoch: Epoch): PlannerModel =>
  Object.freeze({
    plan,
    interaction: IDLE,
    scrub: Object.freeze({ epoch, scrubbing: false }),
  });

// ── §8.5.1's edges ─────────────────────────────────────────────────────────────
//
// One function per edge. The parameter type of each is the set of states that edge
// leaves, so the diagram is the signature list and nothing else has to agree with it.

/** IDLE → PLACING. Clicking the planned trajectory (§8.5.2), `N` (§8.5.3), or a tap. */
export const beginPlacement = (_state: IdleState, placement: Placement): PlacingState => ({
  phase: 'PLACING',
  placement,
});

/** PLACING → PLACING. The preview follows the pointer; nothing is committed yet. */
export const movePlacement = (state: PlacingState, placement: Placement): PlacingState => ({
  phase: 'PLACING',
  placement: { ...state.placement, ...placement },
});

/** PLACING → IDLE. Escape, or a click that turned out to miss. */
export const cancelPlacement = (_state: PlacingState): IdleState => IDLE;

/**
 * PLACING → SELECTED. The node now exists and carries the selection.
 *
 * The node's *creation* is not this function's job — that is `@hh/game`'s plan edit, which
 * can refuse with `L5` (#133). This runs only once the edit has succeeded and produced an
 * id, which is why the id is a parameter rather than something invented here.
 */
export const commitPlacement = (_state: PlacingState, nodeId: NodeId): SelectedState => ({
  phase: 'SELECTED',
  nodeId,
});

/**
 * → SELECTED. Clicking a node marker, a plan-panel row, or `Tab` (§8.5.2, §8.5.3, #130).
 *
 * Legal from IDLE, from SELECTED (changing the selection) and from EVALUATED. **Not**
 * from DRAGGING — a drag has to end before the selection can move, or the release would
 * apply to a node the player is no longer holding — and not from COMMITTED.
 */
export const select = (
  _state: IdleState | SelectedState | EvaluatedState,
  nodeId: NodeId,
): SelectedState => ({ phase: 'SELECTED', nodeId });

/** → IDLE. Clicking empty space (§8.5.2). */
export const deselect = (_state: SelectedState | EvaluatedState): IdleState => IDLE;

/** SELECTED → DRAGGING. §8.5.1's `drag t` and `drag Δv` edges. */
export const beginDrag = <D extends Drag>(state: SelectedState, drag: D): DraggingState<D> => ({
  phase: 'DRAGGING',
  nodeId: state.nodeId,
  drag,
});

/** DRAGGING → DRAGGING, for an epoch drag. Continuous; not quantised until release (#134). */
export const updateEpochDrag = (
  state: DraggingState<EpochDrag>,
  ticks: number,
): DraggingState<EpochDrag> => ({ ...state, drag: { ...state.drag, ticks } });

/** DRAGGING → DRAGGING, for a Δv drag. Continuous; not quantised until release (#135). */
export const updateDeltaVDrag = (
  state: DraggingState<DeltaVDrag>,
  counts: DeltaVCounts,
): DraggingState<DeltaVDrag> => ({ ...state, drag: { ...state.drag, counts } });

/**
 * DRAGGING → SELECTED, discarding the drag. Escape (#134, #135).
 *
 * Returns to SELECTED rather than to EVALUATED because nothing changed: the pre-drag
 * value is restored by the caller from `drag.fromTicks` / `drag.fromCounts`, and a plan
 * that is byte-for-byte what it already was does not need re-evaluating.
 */
export const cancelDrag = (state: DraggingState): SelectedState => ({
  phase: 'SELECTED',
  nodeId: state.nodeId,
});

/** DRAGGING → EVALUATED. §8.5.1's `release → recompute arcs k…n`. */
export const releaseDrag = (state: DraggingState): EvaluatedState => ({
  phase: 'EVALUATED',
  nodeId: state.nodeId,
});

/**
 * → EVALUATED, for a plan change that was not a drag.
 *
 * The node editor's fields (#137), the keyboard nudges of §8.5.3, and deletion all change
 * the plan without a gesture, and all of them have to reach the state where *Commit* is
 * answerable. Excluded from COMMITTED, which is terminal, and from DRAGGING, which must
 * go through {@link releaseDrag} so that a release is never skipped.
 */
export const evaluated = (
  _state: IdleState | PlacingState | SelectedState | EvaluatedState,
  nodeId: NodeId | null,
): EvaluatedState => ({ phase: 'EVALUATED', nodeId });

/**
 * EVALUATED → COMMITTED, and only with a verdict that allows it.
 *
 * See the docstring: the narrowing the caller must perform to produce a
 * {@link CommittableLegality} *is* §6.4's check, so there is no condition in this body
 * and no way to reach COMMITTED around it.
 */
export const commit = (
  _state: EvaluatedState,
  _legality: CommittableLegality,
  plan: Plan,
): CommittedState => ({ phase: 'COMMITTED', plan });

// ── The orthogonal axis ────────────────────────────────────────────────────────

/**
 * Move the scrub head. FR-403: view-only, over any interaction state.
 *
 * `plan` and `interaction` are passed through **by reference**, which is what makes
 * #128's invariant assertable with `toBe`. There is no phase in which scrubbing is
 * illegal, so this takes the model rather than a state — that is what "orthogonal" means.
 */
export const scrubTo = (model: PlannerModel, epoch: Epoch): PlannerModel => ({
  plan: model.plan,
  interaction: model.interaction,
  scrub: { epoch, scrubbing: model.scrub.scrubbing },
});

/** Begin or end a scrub gesture. Also view-only, and also passes the plan through. */
export const setScrubbing = (model: PlannerModel, scrubbing: boolean): PlannerModel => ({
  plan: model.plan,
  interaction: model.interaction,
  scrub: { epoch: model.scrub.epoch, scrubbing },
});

/**
 * The node the interaction is about, or `null`.
 *
 * Spelled once because four regions need it — the plan panel's highlight, the orbit
 * view's selection ring, the node editor's subject and the keyboard handler's target —
 * and four `switch` statements over the phase would be four chances to forget that
 * DRAGGING has a node too.
 */
export const activeNodeId = (interaction: Interaction): NodeId | null => {
  switch (interaction.phase) {
    case 'SELECTED':
    case 'DRAGGING':
      return interaction.nodeId;
    case 'EVALUATED':
      return interaction.nodeId;
    case 'IDLE':
    case 'PLACING':
    case 'COMMITTED':
      return null;
  }
};

/** Whether a drag is in flight — the cheap-evaluation path's condition (NFR-011). */
export const isDragging = (interaction: Interaction): interaction is DraggingState =>
  interaction.phase === 'DRAGGING';
