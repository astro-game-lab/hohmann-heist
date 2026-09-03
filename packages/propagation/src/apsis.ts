/**
 * Apsis crossings (#60, FR-008).
 *
 * Every periapsis and apoapsis an arc's conic reaches inside a bounded interval.
 *
 * ## There is no root to find here
 *
 * #60 asks for crossings "root-found on a monotone quantity to a stated tolerance,
 * **not** by time-stepping", and the obvious reading is to bisect the radial rate
 * `r · v` until it changes sign. That would work, and it would be strictly worse
 * than what this module does, because **on an unperturbed conic the apsis epochs
 * are closed-form**.
 *
 * Periapsis is true anomaly 0 and apoapsis is π — by definition, not by search —
 * and the epoch of a given true anomaly is Kepler's equation in the direction that
 * needs no solver: ν → E → M → t. So the answer is a handful of trigonometric calls
 * and a multiplication by the period, exact to float64 round-off, with nothing to
 * converge and nothing to fail. The stated tolerance is therefore round-off in the
 * period arithmetic rather than a solver setting, and the finder has no sampling
 * floor at all: it cannot miss an apsis, however short the search interval or
 * however eccentric the orbit.
 *
 * Revolutions are indexed and multiplied rather than accumulated — `t_p + k T`, not
 * `t += T` — so the thousandth periapsis carries one rounding rather than a
 * thousand, and asking for one revolution in the middle of a long interval gives
 * exactly the epoch a search of the whole interval reports.
 *
 * ## Near-circular orbits: the threshold is the renderer's
 *
 * At `e = 0` the apsides do not exist: every point is at the same radius and the
 * periapsis direction is undefined. Approaching zero they exist but stop being
 * *findable* — the periapsis direction is the first casualty of cancellation in the
 * eccentricity vector (`docs/PHYSICS.md`, numerical notes), so its angular error
 * grows as `5e-16 / e` and the epoch derived from it grows with it.
 *
 * The threshold here is **`e < 1e-3`**, and it is deliberately not `elements.ts`'s
 * `CIRCULAR_TOLERANCE` of `1e-8`. They answer different questions. `1e-8` is where
 * the *element set* stops reporting an argument of periapsis, and it is set by
 * float64. `1e-3` is §9.3's, where the *renderer* stops drawing apsis markers, and
 * it is set by what is meaningful to a player. #60 requires the two to agree,
 * because a finder that reported an apsis the renderer refuses to draw — or a
 * marker with no event behind it — would be the game contradicting itself on
 * screen. So this module returns nothing below §9.3's threshold, and the constant
 * is exported so the renderer can use this one rather than its own copy.
 *
 * Between `1e-8` and `1e-3` the apsides are real but poorly located; that band is
 * simply not reported, which is a stronger promise than reporting an epoch whose
 * error nobody has bounded.
 *
 * ## Open orbits
 *
 * A hyperbola and a parabola each pass periapsis exactly once and have **no
 * apoapsis** — `a` is negative or infinite and `p / (1 - e)` is a plausible-looking
 * number that is not a radius. #60 requires that this be an absence rather than an
 * error or a wrong epoch, so an open orbit simply yields at most one event, and it
 * is only yielded if that single passage falls inside the interval. An arc that is
 * still inbound at `end`, or already outbound at `start`, correctly gets nothing.
 *
 * ## Validation
 *
 * Checked against the definition rather than against this implementation: at every
 * returned epoch the state propagated by the **DOP853 oracle** — an independent
 * integrator, not the analytic propagator these epochs came from — has `r · v = 0`
 * and a radius equal to `a(1 ∓ e)`. Consecutive periapsis epochs are checked against
 * `T = 2π√(a³/μ)`, Kepler's third law. See `apsis.test.ts` and `docs/PHYSICS.md`.
 */
import type { Epoch } from '@hh/astro';
import { apoapsisRadius, periapsisRadius } from '@hh/astro';
import type { Metres } from '@hh/math';
import { metres } from '@hh/math';

import type { Arc } from './arc.js';
import { conicClock, requireSearchInterval, revolutionRange, withinSearch } from './events.js';

/** Which apsis. */
export type ApsisKind = 'periapsis' | 'apoapsis';

/** One apsis crossing. */
export interface ApsisEvent {
  /** When the crossing happens. */
  readonly epoch: Epoch;
  readonly kind: ApsisKind;
  /** The radius there — `a(1 - e)` at periapsis, `a(1 + e)` at apoapsis. */
  readonly radius: Metres;
}

/**
 * Below this eccentricity an orbit is treated as having no apsides.
 *
 * `docs/PRODUCT.md` §9.3: apsis markers are "suppressed for near-circular orbits
 * (e < 1e-3)". Exported so the renderer imports this rather than restating it — a
 * threshold written down twice is a threshold that will eventually disagree with
 * itself, which is exactly the disagreement #60 exists to prevent.
 */
export const APSIS_ECCENTRICITY_FLOOR = 1e-3;

/**
 * Every apsis crossing of `arc`'s conic in `[start, end)`.
 *
 * The interval is half-open: a crossing exactly at `start` is included, one exactly
 * at `end` is not. See `events.ts` for why.
 *
 * Results are ordered by epoch, and no two can share one: apsides are half a period
 * apart, so there is no tie to break.
 *
 * The number of events is proportional to the number of revolutions the interval
 * spans, which is the caller's choice and is not capped here: truncating would
 * silently answer a different question than the one asked.
 *
 * **There is no options parameter, and that is the contract rather than an
 * omission.** The other finders take a tolerance and a sample density; this search
 * is closed-form, so it has neither a tolerance to loosen nor a grid to refine, and
 * a parameter accepted and ignored would suggest otherwise.
 *
 * @param arc The conic to search. Its own span is ignored — an event search
 * legitimately asks about epochs outside it, exactly as `stateAt` does.
 *
 * @throws RangeError when a bound is not finite, or `end` precedes `start`.
 */
export const findApsisCrossings = (arc: Arc, start: Epoch, end: Epoch): readonly ApsisEvent[] => {
  requireSearchInterval(start, end);

  const elements = arc.elements;
  const e = elements.eccentricity;
  if (e < APSIS_ECCENTRICITY_FLOOR) return [];

  const clock = conicClock(arc);
  const { first, last } = revolutionRange(clock, start, end);

  const rPeriapsis = periapsisRadius(elements);
  const closed = Number.isFinite(clock.period);
  const rApoapsis = closed ? apoapsisRadius(elements) : metres(Number.NaN);

  const events: ApsisEvent[] = [];
  for (let k = first; k <= last; k++) {
    const periapsis = clock.epochAt(0, k);
    if (withinSearch(periapsis, start, end)) {
      events.push({ epoch: periapsis, kind: 'periapsis', radius: rPeriapsis });
    }
    if (!closed) continue;
    const apoapsis = clock.epochAt(Math.PI, k);
    if (withinSearch(apoapsis, start, end)) {
      events.push({ epoch: apoapsis, kind: 'apoapsis', radius: rApoapsis });
    }
  }

  // The loop already emits them in epoch order -- within a revolution periapsis
  // precedes apoapsis, and revolutions are walked forwards -- so this sort is a
  // no-op. It is here so that "ordered by epoch" is a property of the return value
  // rather than an argument about the loop, which is the form §11.4 wants.
  return events.sort((a, b) => a.epoch - b.epoch);
};
