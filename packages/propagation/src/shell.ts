/**
 * Altitude-shell crossings (#62, FR-008).
 *
 * When an arc is inside a sphere of a given radius about the central body, and when
 * it crosses the surface of that sphere.
 *
 * ## Geometry only
 *
 * The radius is a **parameter**, and arbitrary radii are supported. The 100 km
 * altitude floor that this exists to serve is DEP-08 — a game rule standing in for
 * atmospheric drag, which this model does not have — and it lives in `@hh/game`
 * along with the decision that touching it fails a contract. Nothing here knows
 * about Earth, about altitude, or about failure; it reports where a conic meets a
 * sphere. The same call answers "when am I inside the target's keep-out sphere" and
 * "when am I above the deployment altitude" without either being special.
 *
 * ## Closed-form, like the apsis finder and for the same reason
 *
 * On a conic, `r = p / (1 + e cos ν)`, so `r = R` is one equation in `cos ν` with a
 * closed solution. No sampling, no bracketing, no iteration, no floor on the
 * shortest crossing that can be found — a grazing pass lasting a microsecond is
 * located by exactly the same arithmetic as one lasting an hour.
 *
 * The half-angle form is used rather than an inverse cosine:
 *
 * ```
 * cos ν* = (p/R − 1) / e            ν* = 2 atan2(√(1 − cos ν*), √(1 + cos ν*))
 * ```
 *
 * `Math.acos` is banned outright (NFR-006), but even where it were not this form is
 * the better one: `acos` loses half its significant digits as its argument
 * approaches ±1, which is exactly the near-tangential case, and the half-angle form
 * stays well conditioned at both ends because each surd goes to zero in only one of
 * them.
 *
 * ## The intervals are symmetric about periapsis, and that is the whole algorithm
 *
 * The two solutions are `±ν*`: the conic crosses the sphere inbound at `−ν*` and
 * outbound at `+ν*`, and `t(−ν) = −t(ν)` because mean anomaly is odd in true
 * anomaly. So the span spent inside the sphere is exactly
 *
 * ```
 * [t_periapsis − Δ, t_periapsis + Δ]        Δ = timeSincePeriapsis(ν*)
 * ```
 *
 * one such span per revolution, centred on the periapsis passage. Building the
 * intervals directly from that symmetry rather than by pairing up a list of
 * crossings is what makes a duplicated or unpaired crossing structurally impossible
 * rather than a thing to test for — there is no pairing step to get wrong.
 *
 * ## Degenerate cases
 *
 * | Case | Result |
 * | --- | --- |
 * | `cos ν* ≥ 1` — periapsis is outside the sphere | No intervals. The trajectory never enters. |
 * | `cos ν* ≤ −1` — apoapsis is inside the sphere | One interval covering the whole search span, clipped at both ends. Tangency from the inside is included here: the excluded instant at apoapsis is a point, not an interval, and splitting the search at it would report a crossing where nothing crosses. |
 * | `cos ν* = 1` exactly — a tangential graze at periapsis | No interval, and therefore no crossings. The set `{r < R}` is a single point; reporting it would be an entry and an exit at the same epoch, which is the duplicated crossing #62 asks not to see. |
 * | `e` at or below the cancellation floor | Circular to the precision of the state, so entirely inside or entirely outside. See `SHELL_CIRCULAR_FLOOR`. |
 * | Open orbit | At most one interval, since there is one periapsis passage. |
 *
 * "Inside" is `r < R`, strictly. That is what makes a graze produce nothing, and it
 * is the convention DEP-08 wants too — a trajectory tangent to the floor has not
 * gone below it.
 *
 * ## Conditioning
 *
 * Near a tangential crossing the interval endpoints are ill-conditioned, and no
 * choice of method fixes it: `dr/dt` goes to zero there, so an error `δR` in where
 * the sphere is becomes an error in the epoch that grows without bound. This finder
 * inherits that from the geometry rather than adding to it — the closed form has no
 * convergence tolerance of its own — and the measured scaling is in
 * `docs/PHYSICS.md`.
 */
import type { Epoch } from '@hh/astro';
import { epoch } from '@hh/astro';

import type { Arc } from './arc.js';
import type { EpochInterval } from './events.js';
import { conicClock, requireSearchInterval, revolutionRange, withinSearch } from './events.js';

/**
 * Below this eccentricity the orbit is treated as circular: entirely inside the
 * sphere or entirely outside it, never crossing.
 *
 * **This threshold is not a convenience, it is the point where the question stops
 * having an answer.** `cos ν* = (p/R − 1) / e` divides one small number by another,
 * and `docs/PHYSICS.md`'s numerical notes measure the eccentricity magnitude as
 * carrying about `5e-16` of absolute error *however it is computed* — that floor is
 * the float64 representation of the state, not a property of the algebra, so no
 * better formulation exists. An `e` at or below it is indistinguishable from zero,
 * the ratio is noise over noise, and the two crossing epochs it produces describe
 * round-off in the eccentricity vector rather than the trajectory.
 *
 * The failure is not hypothetical. A state built from `e = 0` comes back from
 * `elementsFromState` with `e ≈ 1e-16`, so a circular orbit sitting exactly on the
 * sphere satisfies `r_p < R < r_a` in float64 and the crossing branch dutifully
 * reports being inside for half of every revolution — for a radius excursion of a
 * nanometre. Circular orbits are the common case in this game (every v1.0 contract
 * is equatorial-equivalent), so this is the ordinary path rather than an edge case.
 *
 * Note the *other* two answers stay available and stay right: a circular orbit
 * genuinely is entirely inside or entirely outside a sphere, and that is exactly
 * what DEP-08 asks about a circular parking orbit.
 */
export const SHELL_CIRCULAR_FLOOR = 5e-16;

/** Which way a crossing goes. */
export type ShellCrossingDirection = 'entry' | 'exit';

/** One crossing of the shell surface. */
export interface ShellCrossing {
  readonly epoch: Epoch;
  /** `entry` on the inbound crossing, `exit` on the outbound one. */
  readonly direction: ShellCrossingDirection;
}

/**
 * Spans of `[start, end)` during which the arc is strictly inside a sphere of
 * `radius` about the central body.
 *
 * Ordered by start epoch, non-overlapping, and half-open at the search bounds: a
 * span already in progress at `start` is returned clipped with `clippedStart` set,
 * rather than dropped. See `events.ts` for the endpoint rule.
 *
 * There is no options parameter: this search is closed-form, so it has neither a
 * tolerance to loosen nor a sample grid to refine, and accepting one for the sake
 * of a uniform signature would suggest it had.
 *
 * @param radius Sphere radius in metres, measured from the central body's centre —
 * not an altitude. Converting an altitude to a radius means choosing an Earth
 * model, and that choice belongs at the boundary.
 *
 * @throws RangeError when `radius` is not finite and positive, or when the search
 * interval is malformed.
 */
export const findShellIntervals = (
  arc: Arc,
  radius: number,
  start: Epoch,
  end: Epoch,
): readonly EpochInterval[] => {
  requireSearchInterval(start, end);
  if (!(radius > 0) || !Number.isFinite(radius)) {
    throw new RangeError(`shell radius must be finite and positive, got ${String(radius)} m`);
  }
  if (end === start) return [];

  const elements = arc.elements;
  const e = elements.eccentricity;

  // Circular to the precision of the state: the radius does not vary enough for a
  // crossing to be a fact about the orbit. Answered from the radius itself, which is
  // well conditioned, rather than from a ratio of two round-off-level quantities.
  // This also disposes of the exact `e = 0` case, where that ratio is `0/0`.
  if (e <= SHELL_CIRCULAR_FLOOR) {
    return elements.semiLatusRectum < radius
      ? [{ start, end, clippedStart: true, clippedEnd: true }]
      : [];
  }

  const cosNuStar = (elements.semiLatusRectum / radius - 1) / e;

  // Periapsis at or outside the sphere: the trajectory never gets inside.
  if (cosNuStar >= 1) return [];

  // Apoapsis at or inside the sphere: always inside, so the answer is the search
  // interval itself. Only reachable on a closed orbit — an open one runs to infinite
  // radius, so `cos ν*` cannot be at or below −1 unless periapsis is outside too.
  if (cosNuStar <= -1) {
    return [{ start, end, clippedStart: true, clippedEnd: true }];
  }

  // Half-angle form: tan(ν*/2) = sqrt((1 − cos ν*) / (1 + cos ν*)).
  const nuStar = 2 * Math.atan2(Math.sqrt(1 - cosNuStar), Math.sqrt(1 + cosNuStar));

  const clock = conicClock(arc);
  const halfWidth = clock.timeSincePeriapsis(nuStar);
  const open = !Number.isFinite(clock.period);
  const range = revolutionRange(clock, start, end);

  // One revolution of margin each side, so an interval straddling a search bound is
  // found rather than dropped: its periapsis can lie outside `[start, end)` while
  // the interval itself overlaps.
  const first = open ? 0 : range.first - 1;
  const last = open ? 0 : range.last + 1;

  const intervals: EpochInterval[] = [];
  for (let k = first; k <= last; k++) {
    const centre = clock.epochAt(0, k);
    const rawStart = centre - halfWidth;
    const rawEnd = centre + halfWidth;

    const lo = Math.max(rawStart, start);
    const hi = Math.min(rawEnd, end);
    if (hi <= lo) continue;

    intervals.push({
      start: epoch(lo),
      end: epoch(hi),
      clippedStart: rawStart < start,
      clippedEnd: rawEnd > end,
    });
  }
  return intervals;
};

/**
 * The individual shell crossings in `[start, end)`.
 *
 * Derived from `findShellIntervals` rather than computed alongside it, so the two
 * cannot disagree about whether a graze happened or about where an interval ends. A
 * clipped bound contributes no crossing: the trajectory was already inside when the
 * search began, so nothing crossed at `start`.
 *
 * Ordered by epoch. An entry always precedes its exit, and within an interval the
 * two are distinct by construction — a zero-width interval is never produced.
 */
export const findShellCrossings = (
  arc: Arc,
  radius: number,
  start: Epoch,
  end: Epoch,
): readonly ShellCrossing[] => {
  const crossings: ShellCrossing[] = [];
  for (const interval of findShellIntervals(arc, radius, start, end)) {
    if (!interval.clippedStart) crossings.push({ epoch: interval.start, direction: 'entry' });
    // The `withinSearch` test is not redundant with `clippedEnd`: an exit landing
    // exactly on `end` is not a clip -- nothing was truncated -- but the half-open
    // rule still excludes it, so that concatenating two adjacent searches reports it
    // once, from the span that owns it.
    if (!interval.clippedEnd && withinSearch(interval.end, start, end)) {
      crossings.push({ epoch: interval.end, direction: 'exit' });
    }
  }
  return crossings;
};
