/**
 * DEP-07 — node snapping to an apsis within 30 s.
 *
 * > *Clicking the planned trajectory places a node at that point's epoch, snapped per
 * > DEP-07. Snapping to an apsis within 30 s is disableable from the assist tray; with it
 * > off the raw epoch is used.* — #133, §8.5.2
 *
 * A gameplay departure, so it lives in `@hh/game` with the rest of them and carries a row
 * in `docs/PHYSICS.md`'s departures table. The physics core knows nothing about it: the
 * plan it produces is an ordinary plan, and a player who turns the assist off gets exactly
 * the epoch they clicked.
 *
 * ## Why it exists
 *
 * A Hohmann transfer burns at periapsis and apoapsis, and hitting either with a pointer on
 * a 14-hour timeline means landing within a few pixels of a point the player cannot see
 * precisely. Without the snap the game would be testing mouse precision rather than
 * orbital reasoning, which is the opposite of G3. With it, "burn at apoapsis" is a thing a
 * player can *intend* and reliably do.
 *
 * It is a departure rather than a feature because it moves a burn to an epoch the player
 * did not choose. That is why it is disableable, why the caller is told what it did, and
 * why the window is a stated 30 s rather than a distance in pixels — a pixel threshold
 * would mean the same click snapped or did not depending on the zoom, which is the kind
 * of rule players correctly experience as the game being unreliable.
 *
 * ## The window is in seconds, and it is checked against the apsis rather than the arc
 *
 * `findApsisCrossings` searches a conic over an interval, so this asks for crossings in
 * `[t − 30 s, t + 30 s]` and takes the nearest. Two consequences worth naming. A
 * near-circular orbit has no apsides at all — `APSIS_ECCENTRICITY_FLOOR` — so the search
 * returns nothing and the raw epoch is used, which is right: there is no apsis to prefer
 * on a round orbit, and snapping to the arbitrary one the element set happens to carry
 * would move the burn for no reason. And an orbit whose period is under 60 s would put
 * two apsides inside the window; the nearest still wins, deterministically, because the
 * search returns them in epoch order and the comparison is a strict `<`.
 *
 * ## What it does not do
 *
 * It does not quantise. FR-105 quantises at *entry*, which is `createManeuverNode`'s job,
 * and doing it here as well would be the "re-applied downstream" mistake `plan.ts` spends
 * a paragraph ruling out. The snapped epoch goes into the node constructor and is
 * quantised there, once.
 *
 * It also does not snap to node crossings, which DEP-07's summary mentions. Nothing in
 * v1.0 places a burn at a node crossing — every contract is equatorial-equivalent, so the
 * line of nodes is undefined — and implementing it against no caller would be a rule with
 * no test that could distinguish it from being broken.
 */
import type { Epoch } from '@hh/astro';
import type { Arc } from '@hh/propagation';
import { findApsisCrossings } from '@hh/propagation';
import type { Timeline } from '@hh/sim';
import { arcAt } from '@hh/sim';

/**
 * DEP-07's window, in seconds.
 *
 * Stated once and exported, so the assist tray's hint quotes the same number the rule
 * applies. §8.3.5's epoch slider says "snaps to apsis within 30 s" and that sentence and
 * this constant have to be the same 30.
 */
export const SNAP_WINDOW_SECONDS = 30;

/** What the snap did. `kind` is `null` when the epoch was left alone. */
export interface SnapResult {
  /** The epoch to use. The raw one when nothing was snapped to. */
  readonly epoch: Epoch;
  /** Which apsis it snapped to, or `null`. */
  readonly kind: 'periapsis' | 'apoapsis' | null;
  /** How far the epoch moved, in seconds. Zero when nothing happened. */
  readonly movedSeconds: number;
}

/** No snap: the epoch as given. */
const unsnapped = (epoch: Epoch): SnapResult => ({ epoch, kind: null, movedSeconds: 0 });

/**
 * Snap `at` to the nearest apsis of `arc` within {@link SNAP_WINDOW_SECONDS}.
 *
 * The arc-level entry point, for a caller that already knows which arc it is on. Pure and
 * deterministic: the same arc and epoch always give the same answer, which is what keeps
 * a replayed plan identical to the one that was played (§11.4).
 */
export const snapToApsisOnArc = (
  arc: Arc,
  at: Epoch,
  windowSeconds: number = SNAP_WINDOW_SECONDS,
): SnapResult => {
  const start = (at - windowSeconds) as Epoch;
  const end = (at + windowSeconds) as Epoch;

  let best: { epoch: Epoch; kind: 'periapsis' | 'apoapsis'; distance: number } | null = null;
  for (const crossing of findApsisCrossings(arc, start, end)) {
    const distance = Math.abs(crossing.epoch - at);
    // Strict `<`, so the first of two equidistant crossings wins and the answer does not
    // depend on the iteration happening to be stable.
    if (best === null || distance < best.distance) {
      best = { epoch: crossing.epoch, kind: crossing.kind, distance };
    }
  }

  return best === null
    ? unsnapped(at)
    : { epoch: best.epoch, kind: best.kind, movedSeconds: best.epoch - at };
};

/**
 * Snap `at` to the nearest apsis of whichever arc owns it.
 *
 * The planner's entry point. `enabled` is DEP-07's assist toggle and short-circuits before
 * any search, so turning the assist off costs nothing and — more importantly — returns the
 * *identical* epoch rather than one that survived a round trip through the finder.
 *
 * An epoch outside the timeline's horizon is the caller's bug rather than a player's, and
 * `arcAt` already throws a typed `EpochOutOfHorizonError` for it; that is left to
 * propagate rather than being turned into a silent unsnapped result, which would hide a
 * placement that had gone off the end of the mission.
 */
export const snapToApsis = (
  timeline: Timeline,
  at: Epoch,
  enabled: boolean,
  windowSeconds: number = SNAP_WINDOW_SECONDS,
): SnapResult =>
  enabled ? snapToApsisOnArc(arcAt(timeline, at), at, windowSeconds) : unsnapped(at);
