/**
 * Closest approach between two independently propagated bodies (#61, FR-008).
 *
 * ## Bracket first, refine second — and the reason is that this is a *minimum*
 *
 * The other four finders look for a crossing: some quantity passes through a
 * threshold, and a sign change is a bracket. Separation has no threshold. It is a
 * smooth positive function with several local minima over a plan horizon — a chase
 * in a phasing orbit passes its target once per synodic beat — and the one the game
 * cares about is the *smallest*, not the first.
 *
 * That is why the search is in two stages, and why #61 asks for it in exactly those
 * words. A refinement started at the first sign of the bodies closing converges
 * beautifully on a local minimum that may be ten times the global one; the plan
 * would then be scored against an approach the spacecraft does not make. So every
 * bracket is found first, each is refined, and the global minimum is chosen from
 * the finished set.
 *
 * ## What is root-found
 *
 * The stationary points of the separation `ρ = |d|` are the roots of
 *
 * ```
 * f(t) = d · ḋ = ρ ρ̇
 * ```
 *
 * where `d = r₁ − r₂`. This is the range-rate scaled by the range, which is
 * positive, so it has exactly the same roots and exactly the same signs. It is used
 * in place of `ρ̇` because it needs no division: `ρ̇ = d · ḋ / ρ` is `0/0` for two
 * bodies at the same point, which is precisely the case a rendezvous contract
 * drives towards. The scaled form is a smooth polynomial-like quantity there, and
 * the range-rate is still what is *reported* — computed once, at the answer, where
 * dividing is safe.
 *
 * A bracket where `f` runs from negative to positive holds a **minimum**; one
 * running the other way holds a maximum and is discarded. That test is the whole of
 * the distinction, and it is why maxima cost nothing here.
 *
 * ## Endpoints are minima too, and are tagged rather than dropped
 *
 * If the bodies are still closing when the search interval ends, the smallest
 * separation *in the interval searched* is at its end. Refusing to report it would
 * answer "what is the closest approach in this window" with a number that is not
 * the closest approach in that window. So a bound is reported when the separation
 * does not decrease at `start`, or does not increase at `end`, and the `boundary`
 * field says which — the same clipping idea the interval finders use, for the same
 * reason. A caller stitching windows together keeps the interior minima and
 * re-compares the boundary ones.
 *
 * Note this is *not* the half-open rule being violated: the half-open rule governs
 * events, and a boundary minimum is not an event but a statement about where the
 * search stopped.
 *
 * ## Determinism and ties
 *
 * Results are ordered by epoch. Where two approaches have equal separation —
 * co-orbiting bodies at a fixed phase offset make every instant a tie — the global
 * minimum is the **earliest**, which §11.4 requires to be stated rather than left
 * to whichever comparison the sort happened to make.
 *
 * ## Performance
 *
 * §11.9 budgets a full 8-node timeline re-evaluation at 2 ms, and this runs inside
 * plan evaluation, so it is measured rather than assumed: `tools/bench/`. The cost
 * is `samplesPerRevolution` propagations per revolution per body, plus roughly a
 * dozen more per minimum found, and it is linear in the horizon. See
 * `docs/PHYSICS.md` for the measured figures.
 */
import type { Epoch, EciVector, State } from '@hh/astro';
import { eci, epoch } from '@hh/astro';
import type { Metres, MetresPerSec } from '@hh/math';
import { metres, metresPerSec, V } from '@hh/math';

import type { Arc } from './arc.js';
import type { EventOptions } from './events.js';
import {
  conicClock,
  refineRoot,
  requireSearchInterval,
  requireStateAt,
  sampleAt,
  sampleCount,
  timeGridStep,
} from './events.js';

/** Where a minimum sits relative to the search interval. */
export type ApproachBoundary = 'interior' | 'start' | 'end';

/** One local minimum of the separation between two bodies. */
export interface CloseApproach {
  /** When the minimum occurs. */
  readonly epoch: Epoch;
  /** Distance between the two bodies there, in metres. */
  readonly separation: Metres;
  /** Velocity of the first body relative to the second, in the inertial frame. */
  readonly relativeVelocity: EciVector<MetresPerSec>;
  /** Magnitude of `relativeVelocity` — the flyby speed. */
  readonly relativeSpeed: MetresPerSec;
  /**
   * `interior` for a genuine stationary point; `start` or `end` when the separation
   * was still monotone at that bound and the minimum is an artefact of where the
   * search stopped.
   */
  readonly boundary: ApproachBoundary;
}

/**
 * Samples per revolution when bracketing, by default.
 *
 * Chosen against the *shorter* of the two orbital periods, because that is the
 * timescale the relative geometry actually turns on. Relative range over a plan
 * horizon has a handful of extrema per revolution — a chase has one per synodic
 * beat, a crossing geometry one per revolution of the faster body — so 32 looks per
 * revolution brackets each of them several times over, and doubling it buys
 * nothing measurable. It is not the number a *conjunction* screening tool would
 * use; that is a different problem, with objects whose ephemerides are uncertain by
 * more than this grid resolves.
 */
export const DEFAULT_APPROACH_SAMPLES_PER_REVOLUTION = 32;

/** `d · ḋ`: the range-rate scaled by the range. Zero exactly at a stationary point. */
const rangeRateScaled = (a: State, b: State): number =>
  V.dot(V.sub(a.position, b.position), V.sub(a.velocity, b.velocity));

const approachAt = (a: Arc, b: Arc, t: number, boundary: ApproachBoundary): CloseApproach => {
  const first = requireStateAt(a, t);
  const second = requireStateAt(b, t);
  const relativeVelocity = eci(V.sub(first.velocity, second.velocity));
  return {
    epoch: epoch(t),
    separation: metres(V.distance(first.position, second.position)),
    relativeVelocity,
    relativeSpeed: metresPerSec(V.norm(relativeVelocity)),
    boundary,
  };
};

/**
 * Every local minimum of the separation between two arcs over `[start, end]`.
 *
 * Ordered by epoch. Both arcs are propagated independently — neither is assumed to
 * share the other's central body epoch, plane or conic class — and both are
 * evaluated outside their own spans if the search interval asks for it, exactly as
 * `stateAt` allows.
 *
 * The set returned is **all qualifying approaches**, not only the global minimum.
 * #61 requires that contract to be explicit, and this is the useful half of it: a
 * plan that passes its target three times is a different plan from one that passes
 * once, and only the caller knows which of those facts it needs.
 * `findClosestApproach` reduces to the global minimum for callers that want it.
 *
 * @throws RangeError when the search interval is malformed, or when either arc
 * fails to propagate at a sample epoch.
 */
export const findCloseApproaches = (
  a: Arc,
  b: Arc,
  start: Epoch,
  end: Epoch,
  options: EventOptions = {},
): readonly CloseApproach[] => {
  requireSearchInterval(start, end);
  if (end === start) return [approachAt(a, b, start, 'start')];

  const samplesPerRevolution =
    options.samplesPerRevolution ?? DEFAULT_APPROACH_SAMPLES_PER_REVOLUTION;
  const step = timeGridStep(
    [conicClock(a).period, conicClock(b).period],
    end - start,
    samplesPerRevolution,
  );
  const count = sampleCount(end - start, step);

  const f = (t: number): number => rangeRateScaled(requireStateAt(a, t), requireStateAt(b, t));

  const found: CloseApproach[] = [];
  let previous = f(start);

  // A bound counts as a minimum when the separation is not decreasing away from it.
  // Added before the interior scan so that a minimum landing exactly on a bound
  // keeps the boundary tag, which is the more informative of the two.
  if (previous >= 0) found.push(approachAt(a, b, start, 'start'));

  for (let i = 1; i <= count; i++) {
    const hi = sampleAt(start, end, i, count);
    const current = f(hi);
    // Negative to positive: the separation stopped shrinking and started growing.
    // The other direction is a maximum and is discarded here rather than refined
    // and filtered later, which is what keeps maxima free.
    if (previous <= 0 && current > 0) {
      const lo = sampleAt(start, end, i - 1, count);
      const root = refineRoot(f, lo, hi, options);
      if (root !== undefined) found.push(approachAt(a, b, root, 'interior'));
    }
    previous = current;
  }

  if (previous <= 0) found.push(approachAt(a, b, end, 'end'));

  found.sort((x, y) => x.epoch - y.epoch);

  // Drop an epoch reported twice — a stationary point sitting exactly on a bound is
  // both a bracket root and a boundary minimum. The sort is stable and the boundary
  // entries were pushed first, so the survivor is the tagged one.
  return found.filter(
    (approach, index) => index === 0 || approach.epoch !== found[index - 1]?.epoch,
  );
};

/**
 * The single closest approach between two arcs over `[start, end]`.
 *
 * The global minimum of `findCloseApproaches`, with ties broken by the earliest
 * epoch. `undefined` only if the search returns nothing at all, which cannot happen
 * for a well-formed interval — every interval has at least one bound that qualifies
 * — and is handled rather than asserted away.
 */
export const findClosestApproach = (
  a: Arc,
  b: Arc,
  start: Epoch,
  end: Epoch,
  options: EventOptions = {},
): CloseApproach | undefined => {
  let best: CloseApproach | undefined;
  // Strictly less than, over a list already ordered by epoch: the first of several
  // equal separations wins, which is the stated tie-break.
  for (const approach of findCloseApproaches(a, b, start, end, options)) {
    if (best === undefined || approach.separation < best.separation) best = approach;
  }
  return best;
};
