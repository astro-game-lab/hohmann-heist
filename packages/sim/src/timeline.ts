/**
 * `Timeline` — what a plan becomes when it is applied to a state.
 *
 * A plan is an ordered list of impulses and nothing else; it holds no state, no arcs
 * and no epoch of its own beyond its nodes'. Evaluating it against an initial state
 * over a horizon produces the alternating sequence FR-102 asks for:
 *
 * ```
 *  state0 --arc 0--> [node 0] --arc 1--> [node 1] --arc 2--> ... --> horizon
 *          Kepler      +dv0     Kepler     +dv1     Kepler
 * ```
 *
 * so `arcs.length === plan.nodes.length + 1` and `impulses.length === plan.nodes.length`,
 * always. The empty plan is not a special case in this module and has no branch of its
 * own: the fold below simply never enters its loop, and what falls out is one coasting
 * arc from the start epoch to the horizon.
 *
 * ## What each arc depends on, which is the whole of FR-104
 *
 * Arc *j* begins at node *j-1*'s epoch carrying the post-impulse state there, and ends
 * at node *j*'s epoch — or at the horizon, for the last one. Read that twice and the
 * dependency structure is explicit:
 *
 * - arc *j*'s **state** is a function of the initial state and nodes `0 .. j-1`;
 * - arc *j*'s **end epoch** is a function of node *j* alone.
 *
 * So if the first node that changed is *k*, arcs `0 .. k-1` cannot have changed, and
 * arc *k*'s defining state cannot have changed either — only where it stops. That is
 * why {@link withPlan} can restart the fold at *k* using arc *k*'s own start epoch and
 * state as the seed, and why the arcs before it are reused **by reference** rather than
 * rebuilt to equal values. Reference identity is what a test can observe: `toBe` on
 * arcs `0 .. k-1` is a direct assertion about which arcs were recomputed, not an
 * inference from the answer being right. It also keeps their element caches, which is
 * the difference between re-tessellating one orbit on a drag and re-tessellating all of
 * them.
 *
 * **Incremental re-evaluation is not a second implementation.** It is
 * {@link buildTimeline}'s own fold, entered at a later index with a different seed.
 * There is no separate code path that could drift from the full rebuild, which matters
 * because the failure mode FR-104 exists to prevent is a *fast wrong answer* — and a
 * fast wrong answer from a second implementation is exactly the bug nobody finds by
 * reading the output. `timeline.test.ts` still asserts the equality against a rebuild
 * from scratch, because "it is the same code" is an argument and the test is a fact.
 *
 * ## The endpoint rule is the one the event finders already use
 *
 * Arcs are half-open, `[startEpoch, endEpoch)`, except the last, which is closed at the
 * horizon so that `stateAt(horizon)` is defined. `events.ts` fixes that rule for
 * exactly this structure — abutting arcs, concatenated, each event reported once — and
 * a timeline that disagreed with its own event finders would put the burden of a
 * floating-point de-duplication on every caller.
 *
 * Stated in the form FR-103 needs it: **evaluating exactly at a node's epoch returns
 * the post-impulse state.** The arc that *starts* there owns the instant; the arc that
 * ends there does not. The pre-impulse state is not lost — it is on the {@link Impulse}
 * record, which is where a readout showing "before / after" should read it from — and
 * continuity across the boundary is a statement about the limit from the left, which is
 * what `timeline.property.test.ts` asserts (section 13.3).
 *
 * ## Two ways to fail, because there are two kinds of failure
 *
 * Building a timeline **returns** {@link TimelineResult} rather than throwing, for the
 * cases that depend on the data: a delta-v that leaves the spacecraft on a rectilinear
 * state with no orbital plane, and a propagation that does not converge. This is the
 * function the planner calls on every frame of a node drag, so throwing would turn
 * "that burn is not physical" into a crash, when the product (section 8.3.4) wants the
 * commit button disabled with the reason shown inline. That is the `RootResult` /
 * `KeplerResult` convention this repo already runs on, applied one layer up.
 *
 * The two are not equally close to hand, and it is worth saying which is which rather
 * than implying both are everyday. **The rectilinear case is reachable from a legal
 * plan**: a burn that cancels the transverse velocity leaves position and velocity
 * parallel, and delta-v counts run to `MAX_SAFE_INTEGER`, so nothing in FR-101 stops a
 * player authoring one. **Non-convergence was not reachable from any plan tried** —
 * delta-v up to 9e11 m/s over horizons up to 1e9 s all converged, because the
 * propagator's bracketed fallback cannot miss a root of a function that is monotone and
 * unbounded. What does reach it is a degenerate central body: at `mu = 1e-200` the
 * energy integral's `v^2 / mu` overflows and the solver reports `out-of-domain`, which
 * is what `timeline.test.ts` uses. The variant is carried because the propagator's
 * *contract* permits non-convergence, and the one thing a timeline must never do with a
 * non-answer is turn it into a plausible state.
 *
 * Building a timeline **throws** `RangeError` for the cases that are caller errors: a
 * horizon before the start epoch, or a node outside it. Those are not outcomes of a
 * legal call, they are the same class of mistake `createPlan` and `createArc` already
 * refuse, and handing them back as a value would ask every caller to handle a case that
 * means their own code is wrong.
 *
 * Looking a timeline up outside its horizon throws {@link EpochOutOfHorizonError},
 * which is a `RangeError` — so anything already catching one still catches this — with
 * the epoch and the bounds on it, so a scrubber can clamp against the real numbers
 * instead of parsing a message.
 */
import type { EciVector, Epoch, State } from '@hh/astro';
import { eci } from '@hh/astro';
import type { MetresPerSec } from '@hh/math';
import { V } from '@hh/math';
import type { Arc, PropagationOptions, PropagationResult } from '@hh/propagation';
import { createArc, stateAt as stateOnArc } from '@hh/propagation';

import { applyImpulse } from './maneuver.js';
import type { ManeuverNode, Plan } from './plan.js';

/** The non-convergent half of a propagation result. */
type PropagationFailure = Extract<PropagationResult, { readonly converged: false }>;

/**
 * One impulse in an evaluated timeline: the states either side of it, and the delta-v
 * that actually separated them.
 *
 * `deltaVEci` is not derivable from the plan alone, which is why it is recorded. The
 * node stores the burn in RTN, and the RTN basis is built from the state the burn is
 * applied to — so the inertial vector depends on where the spacecraft was and how fast
 * it was going, both of which are results of this evaluation rather than inputs to it.
 * It is also what a renderer draws.
 */
export interface Impulse {
  /** Index of the plan node this impulse came from. */
  readonly nodeIndex: number;
  /** The node's epoch. Equal to the preceding arc's `endEpoch` and the next one's `startEpoch`. */
  readonly epoch: Epoch;
  /** The state at `epoch` on the preceding arc, before the burn. */
  readonly before: State;
  /** The state at `epoch` after the burn. Identical to the next arc's `state`. */
  readonly after: State;
  /** The applied delta-v in the inertial frame — `after.velocity - before.velocity`. */
  readonly deltaVEci: EciVector<MetresPerSec>;
}

/** A plan evaluated against an initial state over a horizon. Frozen. */
export interface Timeline {
  /** Epoch of `initialState`, and the start of arc 0. */
  readonly startEpoch: Epoch;
  /** The end of the last arc. Prediction stops here; see section 6.3. */
  readonly horizon: Epoch;
  /** The state this timeline was evaluated from, at `startEpoch`. */
  readonly initialState: State;
  /** Gravitational parameter of the central body, in m^3 s^-2. */
  readonly mu: number;
  /** The plan this timeline evaluates. */
  readonly plan: Plan;
  /** The Keplerian segments, in epoch order. Always `plan.nodes.length + 1` of them. */
  readonly arcs: readonly Arc[];
  /** The impulses between them, in epoch order. Always `plan.nodes.length` of them. */
  readonly impulses: readonly Impulse[];
  /** Propagation tuning, reused by `stateAt` so a lookup agrees with the construction. */
  readonly options: PropagationOptions;
}

/** What a timeline is evaluated from. */
export interface TimelineSpec {
  readonly startEpoch: Epoch;
  readonly initialState: State;
  readonly plan: Plan;
  readonly horizon: Epoch;
  readonly mu: number;
  readonly options?: PropagationOptions;
}

/** Why a timeline could not be evaluated. See the module docstring on how each is reached. */
export type TimelineFailure =
  | {
      readonly ok: false;
      /**
       * The propagation up to node `nodeIndex` did not converge. Not reachable from any
       * plan tried; a central body whose `mu` overflows the energy integral reaches it.
       */
      readonly reason: 'non-convergent';
      readonly nodeIndex: number;
      /** The failed result, for diagnostics. Its `best` is explicitly not a solution. */
      readonly propagation: PropagationFailure;
    }
  | {
      readonly ok: false;
      /**
       * The burn at `nodeIndex` left position and velocity parallel. The orbital plane
       * is then undefined, there are no elements, and there is no arc to continue on.
       */
      readonly reason: 'rectilinear';
      readonly nodeIndex: number;
    };

/** What evaluating a plan returns. */
export type TimelineResult = { readonly ok: true; readonly timeline: Timeline } | TimelineFailure;

/**
 * An epoch outside the timeline's horizon.
 *
 * A `RangeError`, so a caller already handling one is not surprised, and carrying the
 * bounds so a caller that wants to clamp does not have to read the message to find
 * them. FR-103 evaluates *within* the horizon; a state beyond it would be an
 * extrapolation of a plan that says nothing about that time.
 */
export class EpochOutOfHorizonError extends RangeError {
  override readonly name = 'EpochOutOfHorizonError';
  /** The epoch that was asked for. */
  readonly epoch: Epoch;
  /** The timeline's first evaluable epoch. */
  readonly startEpoch: Epoch;
  /** The timeline's last evaluable epoch. */
  readonly horizon: Epoch;

  constructor(at: Epoch, startEpoch: Epoch, horizon: Epoch) {
    super(
      `epoch ${String(at)} s is outside the timeline's horizon ` +
        `[${String(startEpoch)}, ${String(horizon)}] s. See FR-103.`,
    );
    this.epoch = at;
    this.startEpoch = startEpoch;
    this.horizon = horizon;
  }
}

/**
 * `items[i]`, with `noUncheckedIndexedAccess`'s `undefined` removed by a check.
 *
 * The lint config forbids both `!` and the widening cast, and every index handed to
 * this is one the caller has already bounded — the binary search's own invariant, or a
 * divergence index taken from a length. The throw is therefore unreachable, and says so
 * rather than being an assertion that hides a real out-of-range read if it ever is.
 */
const nth = <T>(items: readonly T[], i: number): T => {
  const item = items[i];
  if (item === undefined) {
    throw new RangeError(`index ${String(i)} is out of range for ${String(items.length)} items`);
  }
  return item;
};

/**
 * Whether a state has no orbital plane.
 *
 * The same test `createArc` applies, deliberately duplicated rather than imported: this
 * one converts the condition into a returned failure and that one converts it into a
 * thrown `RangeError`, and they must agree on what the condition *is*.
 */
const isRectilinear = (state: State): boolean =>
  V.norm(V.cross(state.position, state.velocity)) === 0;

/** Everything the fold needs, with the optional tuning resolved. */
interface Context {
  readonly startEpoch: Epoch;
  readonly initialState: State;
  readonly plan: Plan;
  readonly horizon: Epoch;
  readonly mu: number;
  readonly options: PropagationOptions;
}

/** Where the fold starts, and what it starts from. */
interface Seed {
  /** Arcs `0 .. from-1`, already evaluated and reused as they are. */
  readonly arcs: readonly Arc[];
  /** Impulses `0 .. from-1`, likewise. */
  readonly impulses: readonly Impulse[];
  /** Index of the first arc to evaluate. */
  readonly from: number;
  /** Where that arc begins. */
  readonly startEpoch: Epoch;
  /** Its defining state, at `startEpoch`. */
  readonly state: State;
}

const requireHorizon = (startEpoch: Epoch, horizon: Epoch): void => {
  if (!Number.isFinite(startEpoch) || !Number.isFinite(horizon)) {
    throw new RangeError(
      `timeline epochs must be finite, got start ${String(startEpoch)} s and horizon ${String(horizon)} s`,
    );
  }
  if (horizon < startEpoch) {
    throw new RangeError(
      `timeline horizon ${String(horizon)} s is before its start epoch ${String(startEpoch)} s`,
    );
  }
};

/**
 * Every node must lie inside the horizon.
 *
 * A node before the start epoch would make arc 0 run backwards, and one after the
 * horizon would make the last arc do the same; both would surface as `createArc`
 * complaining about an arc that ends before it starts, which names the symptom rather
 * than the mistake. The plan's own FR-101 ordering means checking the ends would be
 * enough, but iterating costs nothing next to a Kepler solve and does not make this
 * module's correctness depend on another one's invariant.
 */
const requireNodesWithinHorizon = (
  nodes: readonly ManeuverNode[],
  startEpoch: Epoch,
  horizon: Epoch,
): void => {
  for (const [i, node] of nodes.entries()) {
    if (node.epoch < startEpoch || node.epoch > horizon) {
      throw new RangeError(
        `plan node ${String(i)} at ${String(node.epoch)} s lies outside the timeline's horizon ` +
          `[${String(startEpoch)}, ${String(horizon)}] s`,
      );
    }
  }
};

/**
 * The fold: arcs and impulses from `seed.from` onward, appended to what came before.
 *
 * This is the only place a timeline is evaluated. {@link buildTimeline} enters it at
 * zero with the initial state; {@link withPlan} enters it at the first changed node
 * with that arc's own start and state. Same arithmetic, same order, same inputs — which
 * is what makes the incremental result identical to a rebuild rather than merely close
 * to one.
 */
const evaluate = (context: Context, seed: Seed): TimelineResult => {
  const { plan, horizon, mu, options } = context;
  const arcs: Arc[] = [...seed.arcs];
  const impulses: Impulse[] = [...seed.impulses];

  let startEpoch = seed.startEpoch;
  let state = seed.state;

  // `slice` rather than an index loop: the work is O(nodes after the edit), which is
  // the complexity FR-104 asks for, and `noUncheckedIndexedAccess` stays out of the
  // way. The reused prefix is never touched.
  for (const [offset, node] of plan.nodes.slice(seed.from).entries()) {
    const nodeIndex = seed.from + offset;
    const arc = createArc({ startEpoch, endEpoch: node.epoch, state, mu });
    arcs.push(arc);

    const propagation = stateOnArc(arc, node.epoch, options);
    if (!propagation.converged) {
      return { ok: false, reason: 'non-convergent', nodeIndex, propagation };
    }

    const before = propagation.state;
    const after = applyImpulse(before, node.deltaVRtn);
    if (isRectilinear(after)) {
      return { ok: false, reason: 'rectilinear', nodeIndex };
    }

    impulses.push(
      Object.freeze({
        nodeIndex,
        epoch: node.epoch,
        before,
        after,
        deltaVEci: eci(V.sub(after.velocity, before.velocity)),
      }),
    );

    startEpoch = node.epoch;
    state = after;
  }

  // The last arc runs to the horizon. On an empty plan — or after every node has been
  // deleted — the loop above did nothing and this is the single coasting arc.
  arcs.push(createArc({ startEpoch, endEpoch: horizon, state, mu }));

  return {
    ok: true,
    timeline: Object.freeze({
      startEpoch: context.startEpoch,
      horizon,
      initialState: context.initialState,
      mu,
      plan,
      arcs: Object.freeze(arcs),
      impulses: Object.freeze(impulses),
      options,
    }),
  };
};

/**
 * Evaluate a plan against an initial state over a horizon (FR-102).
 *
 * A pure function of its argument: no clock, no ambient randomness, no iteration over
 * an unordered container. Called twice with the same spec it produces the same numbers,
 * which `timeline.test.ts` asserts rather than assumes.
 *
 * @throws RangeError when the horizon is not finite or precedes the start epoch, when a
 * node lies outside `[startEpoch, horizon]`, when `mu` is not finite and positive, or
 * when the initial state is rectilinear. All of those are caller errors; see the module
 * docstring for why data-dependent failures come back as a {@link TimelineResult}.
 */
export const buildTimeline = (spec: TimelineSpec): TimelineResult => {
  requireHorizon(spec.startEpoch, spec.horizon);
  requireNodesWithinHorizon(spec.plan.nodes, spec.startEpoch, spec.horizon);

  return evaluate(
    {
      startEpoch: spec.startEpoch,
      initialState: spec.initialState,
      plan: spec.plan,
      horizon: spec.horizon,
      mu: spec.mu,
      options: spec.options ?? {},
    },
    {
      arcs: [],
      impulses: [],
      from: 0,
      startEpoch: spec.startEpoch,
      state: spec.initialState,
    },
  );
};

/** Whether two nodes are the same impulse, compared on the integer counts (DEP-09). */
const sameNode = (a: ManeuverNode, b: ManeuverNode): boolean =>
  a.epochTicks === b.epochTicks &&
  a.deltaVCounts[0] === b.deltaVCounts[0] &&
  a.deltaVCounts[1] === b.deltaVCounts[1] &&
  a.deltaVCounts[2] === b.deltaVCounts[2];

/**
 * Index of the first node that differs, or `undefined` when the plans are identical.
 *
 * On the integer counts, so the comparison is exact and needs no tolerance — which is
 * the point of quantising at entry. A node is fully determined by its ticks and counts,
 * so two structurally equal nodes are the same impulse and there is nothing else to
 * compare.
 *
 * Where one plan is a prefix of the other, the first difference is at the shorter
 * length: that is where a node was appended or removed, and it is the right place to
 * resume from in both directions.
 */
const firstDivergence = (
  before: readonly ManeuverNode[],
  after: readonly ManeuverNode[],
): number | undefined => {
  const common = Math.min(before.length, after.length);

  for (const [i, node] of before.slice(0, common).entries()) {
    if (!sameNode(node, nth(after, i))) {
      return i;
    }
  }
  return before.length === after.length ? undefined : common;
};

/**
 * Re-evaluate a timeline against an edited plan, recomputing only what changed
 * (FR-104, NFR-011).
 *
 * Moving a node, inserting one and deleting one all arrive here as "the plan is
 * different from index *k* onward", so none of them is a special case and none of them
 * can take a path the others do not. Arcs and impulses before *k* are carried over by
 * reference; arcs `k .. n` are recomputed by the same fold {@link buildTimeline} uses.
 *
 * An unchanged plan returns the timeline it was given, unchanged and by reference.
 *
 * One saving is deliberately left on the table. A change to node *k*'s delta-v alone
 * leaves arc *k* equal in value — only its end epoch depends on that node, and the
 * epoch did not move — so it could be reused too, and section 6.3's "dragging the last
 * node's Δv re-solves one arc" reads as though it is. It is recomputed anyway: telling
 * the two kinds of edit apart would add a second path through the fold, and the one
 * thing FR-104 exists to prevent is a fast wrong answer. The saving is a single Kepler
 * solve — about 1 microsecond against a 16.7 ms frame — and one path that is provably
 * identical to a rebuild is worth more than that.
 *
 * The initial state, horizon and `mu` are not editable here — a change to any of them
 * invalidates arc 0 and therefore everything, so it is a {@link buildTimeline} call
 * rather than an incremental one, and pretending otherwise would put a second diff in
 * the hot path for no saving.
 *
 * @throws RangeError when a node in the new plan lies outside the horizon.
 */
export const withPlan = (timeline: Timeline, plan: Plan): TimelineResult => {
  requireNodesWithinHorizon(plan.nodes, timeline.startEpoch, timeline.horizon);

  const k = firstDivergence(timeline.plan.nodes, plan.nodes);
  if (k === undefined) {
    return { ok: true, timeline };
  }

  // Arc `k` survives the edit in everything but where it ends: its state is a function
  // of nodes `0 .. k-1`, and those are what did not change. So it is also the seed.
  const seedArc = nth(timeline.arcs, k);

  return evaluate(
    {
      startEpoch: timeline.startEpoch,
      initialState: timeline.initialState,
      plan,
      horizon: timeline.horizon,
      mu: timeline.mu,
      options: timeline.options,
    },
    {
      arcs: timeline.arcs.slice(0, k),
      impulses: timeline.impulses.slice(0, k),
      from: k,
      startEpoch: seedArc.startEpoch,
      state: seedArc.state,
    },
  );
};

/**
 * Index of the arc that owns `at` — a binary search over arc start epochs (FR-103).
 *
 * O(log n) in the number of nodes, and no iteration over time steps at any n. The
 * search returns the **last** arc whose `startEpoch` does not exceed `at`, which is the
 * half-open rule stated as an algorithm: at a node's epoch two arcs touch, and the one
 * that starts there wins. It also settles the degenerate case where a plan's first node
 * sits exactly on the start epoch and arc 0 has zero length — the empty arc is never
 * selected, because a later one starts at the same instant.
 *
 * @throws EpochOutOfHorizonError when `at` is outside `[startEpoch, horizon]`, or is
 * not a number at all.
 */
export const arcIndexAt = (timeline: Timeline, at: Epoch): number => {
  const { arcs, startEpoch, horizon } = timeline;

  // Negated comparisons so that `NaN` fails both and is rejected rather than being
  // silently carried into a propagation that would return `NaN` for everything.
  if (!(at >= startEpoch) || !(at <= horizon)) {
    throw new EpochOutOfHorizonError(at, startEpoch, horizon);
  }

  let lo = 0;
  let hi = arcs.length - 1;
  while (lo < hi) {
    // Round the midpoint up: `lo` is a candidate answer and `hi` moves to `mid - 1`, so
    // rounding down would leave `lo === mid` and spin forever when `hi === lo + 1`.
    const mid = lo + ((hi - lo + 1) >> 1);
    if (nth(arcs, mid).startEpoch <= at) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return lo;
};

/**
 * The arc that owns `at`.
 *
 * @throws EpochOutOfHorizonError when `at` is outside the horizon.
 */
export const arcAt = (timeline: Timeline, at: Epoch): Arc =>
  nth(timeline.arcs, arcIndexAt(timeline, at));

/**
 * The state on this timeline at `at` (FR-103).
 *
 * One arc lookup and one Kepler solve, whatever the epoch and whatever the plan: this
 * is section 11.9's 5 microsecond budget, and `tools/bench/timeline.bench.test.ts` is
 * where it is measured rather than claimed.
 *
 * Returns a `PropagationResult`, the same union `@hh/propagation`'s own `stateAt`
 * returns — a composition of two calls should not invent a third convention for what
 * non-convergence looks like.
 *
 * At a node's epoch this is the **post-impulse** state; see the module docstring for
 * the rule and `Impulse.before` for the other side of it.
 *
 * @throws EpochOutOfHorizonError when `at` is outside the horizon.
 */
export const stateAt = (timeline: Timeline, at: Epoch): PropagationResult =>
  stateOnArc(arcAt(timeline, at), at, timeline.options);
