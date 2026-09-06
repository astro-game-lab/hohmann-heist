/**
 * When a coach mark appears — FR-902, §8.6, §8.8 (#159).
 *
 * §8.6 puts coach marks in the family of non-blocking feedback, and #159 names the real
 * design decision inside that: *"the trigger vocabulary is the framework's real design
 * decision — keep it small and declarative, and state it, because #160 writes against it
 * and a trigger that needs code per contract makes contracts stop being data."*
 *
 * So this file is the whole vocabulary, and it is deliberately five entries long. A mark
 * names a *moment*, and a game with three marks per contract in four contracts has very
 * few distinct moments to name: before you have done anything, after your first burn
 * exists, when one burn is plainly not going to be enough, when the plan will actually
 * commit, and when you are looking at a particular node. Anything a sixth trigger could
 * express is either one of those five or is contract-specific logic, which is the thing
 * the vocabulary exists to prevent.
 *
 * ## Latched, not live
 *
 * A trigger is evaluated against a snapshot of the plan, but its *result* is latched for
 * the attempt: once `firstNode` has been true it stays true even after the player deletes
 * the node again. Marks would otherwise flicker in and out during ordinary editing —
 * placing a node, disliking it, deleting it — which is both distracting and, for the
 * polite announcement §8.8 asks for, actively hostile: a live region that re-announces
 * every time a node count crosses one is a screen reader talking over the player.
 *
 * {@link latch} is that rule, kept here beside the predicates rather than in the hook, so
 * the whole "when" half of the framework reads in one file and is testable without a DOM.
 *
 * ## No trigger reads the clock
 *
 * There is no `afterSeconds`. A mark that appears because the player has been still for
 * ten seconds is a mark that appears because they were reading the contract, and it would
 * make the framework's output depend on wall-clock time — which the planner's own state
 * never does.
 */

/**
 * What a trigger is allowed to look at.
 *
 * Deliberately four scalars rather than the planner's state: a predicate that could see
 * the whole model could reach for anything, and the point of the vocabulary is that it
 * cannot. Everything here is already computed by the planner for its own reasons.
 */
export interface MarkFacts {
  /** How many manoeuvre nodes the plan has. */
  readonly nodeCount: number;
  /** Whether *Commit* would accept the plan — §8.5.1's `isCommittable`. */
  readonly committable: boolean;
  /** Whether a node is selected. */
  readonly nodeSelected: boolean;
  /** Whether the objective is met somewhere in the prediction (§8.6's green ✓). */
  readonly objectiveMet: boolean;
}

/** No plan, nothing selected, nothing achieved. What a contract opens on. */
export const NO_FACTS: MarkFacts = Object.freeze({
  nodeCount: 0,
  committable: false,
  nodeSelected: false,
  objectiveMet: false,
});

/**
 * The vocabulary. Five moments, and adding a sixth is a design change, not a content one.
 */
export type MarkTrigger =
  /** On arrival, before the player has placed anything. */
  | 'planEmpty'
  /** The first node exists. */
  | 'firstNode'
  /** One node, and it is not enough — the moment C02's second burn is the answer. */
  | 'onePlanNotEnough'
  /** The plan would commit. */
  | 'planLegal'
  /** A node is selected, so a mark about that node has something to point at. */
  | 'nodeSelected';

/** Every trigger, in the order they tend to fire. The order is for tests and docs only. */
export const MARK_TRIGGERS: readonly MarkTrigger[] = Object.freeze([
  'planEmpty',
  'firstNode',
  'onePlanNotEnough',
  'planLegal',
  'nodeSelected',
]);

/**
 * Whether a trigger's moment has arrived, given the facts.
 *
 * Total over the union by construction — a new trigger is a missing property, which is a
 * compile error rather than a silently unreachable mark.
 */
const PREDICATES: Readonly<Record<MarkTrigger, (facts: MarkFacts) => boolean>> = Object.freeze({
  planEmpty: (facts) => facts.nodeCount === 0,
  firstNode: (facts) => facts.nodeCount >= 1,
  // Not `nodeCount === 1 && !committable`: an intercept contract can be legal with one
  // node and still not *achieve* anything, which is exactly C02's lesson. Legality is
  // about the rules; the objective is about the job.
  onePlanNotEnough: (facts) => facts.nodeCount === 1 && !facts.objectiveMet,
  // `committable && nodeCount > 0`, and the second half was found by driving the running
  // app rather than by reading the code. §6.4 lets a player commit a plan that will not
  // work — L6 is advisory, the button stays enabled, and the reason sits under it — so an
  // **empty** plan on C01 is already committable, and a bare `committable` fired this
  // trigger on arrival. The mark that followed said "the plan is legal" over a plan with
  // nothing in it, and it did so *before* the mark naming the contract's actual lesson,
  // which needs a node to exist first. An empty plan is not a plan.
  planLegal: (facts) => facts.committable && facts.nodeCount > 0,
  nodeSelected: (facts) => facts.nodeSelected,
});

/** Whether `trigger`'s moment has arrived. Pure, and the only place a predicate lives. */
export const fires = (trigger: MarkTrigger, facts: MarkFacts): boolean =>
  PREDICATES[trigger](facts);

/**
 * Fold a new snapshot into the set of triggers that have fired this attempt.
 *
 * Monotonic: a trigger never leaves the set. See the module docstring — this is what stops
 * a mark flickering while the player edits, and what stops the live region repeating
 * itself.
 *
 * Returns the same set object when nothing changed, so a caller holding it in component
 * state gets a stable identity and does not re-render on every scrub.
 */
export const latch = (
  fired: ReadonlySet<MarkTrigger>,
  facts: MarkFacts,
): ReadonlySet<MarkTrigger> => {
  const added = MARK_TRIGGERS.filter((trigger) => !fired.has(trigger) && fires(trigger, facts));
  if (added.length === 0) return fired;
  return new Set([...fired, ...added]);
};
