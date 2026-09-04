/**
 * Revolution completions (FR-604).
 *
 * When an arc's spacecraft has been round once, twice, three times. The flight log
 * (#146) quotes them — §8.3.8's feed reads `T+01:35:41  rev 1` — and FR-604 lists
 * revolutions beside burns, apsides, constraint entries and the closest approach as
 * something the log **must** record.
 *
 * ## Why this is not the apsis finder with a filter
 *
 * The obvious implementation is "count periapsis passages", and `findApsisCrossings`
 * already produces those. It is wrong here for two independent reasons.
 *
 * **It answers nothing below `e = 1e-3`.** #60 reports no apsides on a near-circular
 * orbit, deliberately and correctly: the periapsis direction is the first casualty of
 * cancellation in the eccentricity vector, so its epoch has no bounded error. Every
 * v1.0 contract is equatorial-*and* near-circular — `c03-cold-open`'s ship is `e = 0`
 * exactly — so a revolution counter built on apsides would report nothing at all for
 * the only orbits the game actually flies. A revolution is not an apsis and does not
 * inherit that limit: it is a *duration*, and a period is well conditioned at every
 * eccentricity below 1.
 *
 * **It counts from the wrong origin.** A periapsis passage is a fact about where the
 * conic points; §8.3.8's `rev 1` is a fact about how long the spacecraft has been
 * flying. The two differ by the phase between the arc's start and its periapsis, which
 * for a circular orbit is not merely unknown but undefined. So revolutions here are
 * anchored to **the arc's own start epoch**, which is a real instant on every conic:
 * the beginning of the mission for arc 0, and a burn for every arc after it.
 *
 * That anchoring is also the behaviour a player expects across a plan. A burn changes
 * the orbit, so it changes what one revolution *is* — the count restarting at the node
 * is the honest reading, and it is why this takes an arc rather than a timeline.
 * `@hh/game` concatenates across arcs and numbers the entries cumulatively.
 *
 * ## Closed form, indexed rather than accumulated
 *
 * There is no root to find. The k-th completion is `arc.startEpoch + k T`, and `T`
 * comes from the same {@link conicClock} the apsis finder uses — one clock per conic,
 * so a revolution and an apsis can never disagree about the period underneath them.
 *
 * Multiplying by `k` rather than adding `T` in a loop is #60's argument applied again:
 * the thousandth revolution then carries one rounding rather than a thousand, and
 * asking for a revolution in the middle of a long interval gives exactly the epoch a
 * search of the whole interval reports. Over `c03-cold-open`'s six-hour horizon that
 * is the difference between an event epoch good to float64 and one drifting by a
 * microsecond per lap.
 *
 * There is therefore no sampling floor and nothing to converge: this finder cannot
 * miss a revolution, however short the search interval.
 *
 * ## Open orbits have no revolutions
 *
 * A hyperbola and a parabola pass periapsis once and never return. {@link conicClock}
 * reports `Infinity` for their period, and an infinite period yields no completion
 * inside any finite interval — so this returns nothing rather than a plausible epoch,
 * which is the same absence-not-error rule #60 applies to a missing apoapsis.
 *
 * ## Validation
 *
 * The period is checked against Kepler's third law, `T = 2π√(a³/μ)`, which is a closed
 * form and not this implementation. The epochs are checked against the **DOP853
 * oracle**: at a returned epoch an independent Runge–Kutta integrator, started from
 * the arc's own state, must arrive back at that state — a full revolution is exactly
 * the statement that position and velocity return. See `revolution.test.ts` and
 * `docs/PHYSICS.md`.
 */
import type { Epoch } from '@hh/astro';
import { epoch as toEpoch } from '@hh/astro';

import type { Arc } from './arc.js';
import { conicClock, requireSearchInterval, withinSearch } from './events.js';

/** One completed revolution of an arc's conic. */
export interface RevolutionEvent {
  /** When the revolution completed. */
  readonly epoch: Epoch;
  /**
   * Which revolution of **this arc** completed here, counting from 1.
   *
   * Not a mission-wide count: an arc knows nothing about the ones before it. The
   * flight log renumbers when it concatenates.
   */
  readonly index: number;
  /** The orbital period this revolution took, in seconds. Constant along an arc. */
  readonly periodSeconds: number;
}

/**
 * Every revolution `arc`'s conic completes in `[start, end)`.
 *
 * Completions are measured from `arc.startEpoch` — see the module docstring on why
 * that, and not periapsis, is the origin. The half-open endpoint rule is
 * `events.ts`'s, shared with every other finder so that concatenating abutting arcs
 * reports each event exactly once.
 *
 * Returns an empty array for an open orbit, for an interval shorter than one period,
 * and for an interval that lies entirely before the arc's start.
 *
 * @throws RangeError when a bound is not finite, or `end` precedes `start`.
 */
export const findRevolutions = (arc: Arc, start: Epoch, end: Epoch): readonly RevolutionEvent[] => {
  requireSearchInterval(start, end);

  const { period } = conicClock(arc);
  // An open orbit, and the only way `period` is not a positive finite number. Guarding
  // on finiteness rather than on eccentricity keeps the one definition of "closed" in
  // the clock, where the parabolic band already lives.
  if (!Number.isFinite(period) || period <= 0) return [];

  const origin = arc.startEpoch;

  // The first completion at or after `start`, as an index rather than by stepping. A
  // `start` before the arc's own beginning gives a negative quotient, and `max(1, …)`
  // is what keeps revolution 0 — the origin itself, which is not a completion — out.
  const first = Math.max(1, Math.ceil((start - origin) / period));
  // `end` is excluded, so the last candidate is the greatest index strictly inside it.
  const last = Math.ceil((end - origin) / period) - 1;

  const events: RevolutionEvent[] = [];
  for (let index = first; index <= last; index++) {
    const at = toEpoch(origin + index * period);
    // The index arithmetic above is exact in the integers and approximate in the
    // epochs it produces, so the endpoint rule is applied to the epoch itself rather
    // than trusted from the bounds. One comparison, and it is what stops a completion
    // landing an ulp outside the interval it was derived from.
    if (withinSearch(at, start, end)) {
      events.push({ epoch: at, index, periodSeconds: period });
    }
  }
  return events;
};
