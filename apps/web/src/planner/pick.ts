/**
 * Turning a point on screen into an epoch on the trajectory — #133, #134, §8.5.2.
 *
 * > *Click the planned trajectory → place a node at that point's epoch.*
 * > *Drag a node marker along the trajectory → change its epoch.*
 *
 * Both need the same answer: given a pixel, which instant of the plan is drawn there?
 * `@hh/render`'s hit-test index answers *which arc* a click landed on, and stops there —
 * it indexes screen geometry and knows nothing about time. This is the other half.
 *
 * ## Why it is a search rather than an inversion
 *
 * The direct route is to invert the projection: unproject the pixel to a world point,
 * find the true anomaly of the nearest point on the conic, and convert that to an epoch
 * through Kepler's equation. It is exact and it is wrong here, for a reason that is easy
 * to miss — an orthographic projection of an inclined orbit is an ellipse, and the world
 * point under a pixel is only on the orbit if the click was exactly on the drawn curve.
 * Every real click is a few pixels off, and "the nearest point on the conic to a point
 * that is not on the conic's plane" is itself a minimisation. Inverting buys nothing and
 * costs a special case for every degeneracy the element set has.
 *
 * So this minimises screen distance over epoch directly, which is the quantity the player
 * actually aimed with: the answer is the instant whose *drawn* position is nearest the
 * cursor, at whatever zoom and orientation the camera happens to be at.
 *
 * ## Scan for every local minimum, refine them all, then choose
 *
 * Distance-to-cursor as a function of epoch is **not unimodal** over an arc: a projected
 * orbit crosses itself, and a closed one passes through the same pixel once per
 * revolution. A bare ternary search would converge on whichever minimum it started next
 * to, which is how a click on the near side of an orbit places a node on the far side.
 *
 * Taking the single best *coarse sample* and refining only that is not enough either, and
 * the reason is worth stating because it is not obvious. The scan steps in equal time, and
 * a revolution is not a whole number of steps, so each pass through the same pixel is
 * sampled at a different phase. One revolution may happen to have a sample two pixels
 * from the cursor while the revolution the player is actually looking at has its nearest
 * sample five pixels away — and the wrong pass then wins on distance before the tie-break
 * below ever gets to run.
 *
 * So: scan at {@link COARSE_SAMPLES} equal-time steps, keep **every** local minimum,
 * golden-section refine each one, and choose among the refined candidates. After
 * refinement every genuine pass sits within a float of zero distance, which is where the
 * tie-break can do its job. A few revolutions in a horizon give a handful of minima, so
 * this costs a few hundred Kepler solves — well inside a frame, and it runs on a click or
 * a drag rather than on every frame.
 *
 * ## A closed orbit is ambiguous, and the caller says which pass it means
 *
 * This is the part that is easy to miss until it produces a node three revolutions away.
 * A Keplerian orbit returns to the *same world position* every period, so it projects to
 * the same pixel every period, exactly — not approximately. "The epoch nearest this
 * pixel" therefore has as many equally-correct answers as there are revolutions in the
 * horizon, and picking whichever the scan happened to visit last is how a click on the
 * orbit in front of you places a burn four hours later.
 *
 * So every pick takes a `near` epoch and breaks ties toward it, within
 * {@link AMBIGUITY_TOLERANCE_PX}. The two callers want different references and both are
 * the obvious one: **placement** (#133) passes the scrub head, because the pass the
 * player is looking at is the one the scrub head is on; an **epoch drag** (#134) passes
 * the node's pre-drag epoch, because a drag moves a burn rather than teleporting it to
 * another revolution.
 *
 * The parameter is required rather than defaulted. A default would have been the
 * timeline's start, which is right for neither caller and wrong invisibly.
 *
 * ## It is a pure function of a timeline and a camera
 *
 * No DOM. `stateAt` and `worldToScreen` are both pure, so this is testable with plain
 * values and is deterministic — the same click at the same camera gives the same epoch on
 * every platform, which is what keeps a placement reproducible (§11.4).
 */
import type { Epoch } from '@hh/astro';
import type { Camera, ScreenPoint } from '@hh/render';
import { worldToScreen } from '@hh/render';
import type { Timeline } from '@hh/sim';
import { stateAt } from '@hh/sim';

/**
 * Equal-time samples per arc for the coarse scan.
 *
 * 256 puts a LEO revolution's samples about 22 s apart, which at any zoom that shows the
 * whole orbit is a few pixels — far finer than the separation between the two branches
 * of a projected self-intersection, which is what the bracket has to resolve. Raising it
 * costs a Kepler solve each and buys nothing the refine does not already deliver.
 */
export const COARSE_SAMPLES = 256;

/**
 * How close two candidates must be, in CSS pixels, to count as the same place.
 *
 * Below this, the tie is broken by epoch instead. A quarter of a pixel: the repeats this
 * exists to disambiguate are exact to float precision, so anything comfortably under a
 * pixel separates "the same point on a later revolution" from "a genuinely nearer point".
 */
export const AMBIGUITY_TOLERANCE_PX = 0.25;

/** Golden-section iterations. 40 takes a 14 h arc below a millisecond of epoch. */
const REFINE_ITERATIONS = 40;

/** The reciprocal golden ratio, for the section search. */
const INV_PHI = (Math.sqrt(5) - 1) / 2;

/** Squared screen distance from `point` to the trajectory at `epoch`. */
const distanceSquaredAt = (
  timeline: Timeline,
  camera: Camera,
  point: ScreenPoint,
  epoch: Epoch,
): number => {
  const propagation = stateAt(timeline, epoch);
  // A non-convergent solve has no position to measure, so it is infinitely far away and
  // simply loses the comparison. Throwing would turn one bad sample into a dead click.
  if (!propagation.converged) return Number.POSITIVE_INFINITY;
  const at = worldToScreen(camera, propagation.state.position);
  const dx = at.x - point.x;
  const dy = at.y - point.y;
  return dx * dx + dy * dy;
};

export interface Pick {
  readonly epoch: Epoch;
  /** Screen distance from the cursor to the trajectory there, in CSS pixels. */
  readonly distancePx: number;
}

/**
 * Whether `candidate` beats `best`, preferring the epoch nearer `near` on a tie.
 *
 * Lexicographic on (distance, |epoch − near|) with a pixel tolerance on the first key —
 * see the docstring on why the tolerance is what makes a closed orbit answerable at all.
 */
const better = (candidate: Pick, best: Pick, near: Epoch): boolean => {
  if (candidate.distancePx < best.distancePx - AMBIGUITY_TOLERANCE_PX) return true;
  if (candidate.distancePx > best.distancePx + AMBIGUITY_TOLERANCE_PX) return false;
  return Math.abs(candidate.epoch - near) < Math.abs(best.epoch - near);
};

/** Golden-section minimisation of screen distance on `[lower, upper]`. */
const refine = (
  timeline: Timeline,
  camera: Camera,
  point: ScreenPoint,
  lower: number,
  upper: number,
): Pick => {
  let a = lower;
  let b = upper;
  let c = b - INV_PHI * (b - a);
  let d = a + INV_PHI * (b - a);
  let fc = distanceSquaredAt(timeline, camera, point, c as Epoch);
  let fd = distanceSquaredAt(timeline, camera, point, d as Epoch);

  for (let i = 0; i < REFINE_ITERATIONS; i++) {
    if (fc < fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - INV_PHI * (b - a);
      fc = distanceSquaredAt(timeline, camera, point, c as Epoch);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + INV_PHI * (b - a);
      fd = distanceSquaredAt(timeline, camera, point, d as Epoch);
    }
  }

  const epoch = ((a + b) / 2) as Epoch;
  return { epoch, distancePx: Math.sqrt(distanceSquaredAt(timeline, camera, point, epoch)) };
};

/**
 * The epoch in `[start, end]` whose drawn position is nearest `point`.
 *
 * `near` breaks ties between revolutions. Bounds outside the timeline's horizon are a
 * caller bug and `stateAt` will say so.
 */
export const pickEpochInSpan = (
  timeline: Timeline,
  camera: Camera,
  point: ScreenPoint,
  start: Epoch,
  end: Epoch,
  near: Epoch,
): Pick => {
  const at = (epoch: Epoch): Pick => ({
    epoch,
    distancePx: Math.sqrt(distanceSquaredAt(timeline, camera, point, epoch)),
  });

  const span = end - start;
  if (!(span > 0)) return at(start);

  const step = span / COARSE_SAMPLES;
  const epochOf = (i: number): Epoch => (start + step * i) as Epoch;

  // One pass for the samples, so each epoch costs one Kepler solve rather than three
  // once the neighbour comparisons below start reading them.
  const distances: number[] = [];
  for (let i = 0; i <= COARSE_SAMPLES; i++) {
    distances.push(distanceSquaredAt(timeline, camera, point, epochOf(i)));
  }

  // Every local minimum, endpoints included — a minimum genuinely can sit at an arc
  // bound, which is where a burn at the very start or end of a span lives. `<=` on both
  // sides so a flat pair still yields a bracket rather than being skipped by both tests.
  const candidates: Pick[] = [];
  for (let i = 0; i <= COARSE_SAMPLES; i++) {
    const here = distances[i] ?? Number.POSITIVE_INFINITY;
    const before =
      i === 0 ? Number.POSITIVE_INFINITY : (distances[i - 1] ?? Number.POSITIVE_INFINITY);
    const after =
      i === COARSE_SAMPLES
        ? Number.POSITIVE_INFINITY
        : (distances[i + 1] ?? Number.POSITIVE_INFINITY);
    if (!(here <= before && here <= after)) continue;

    candidates.push(
      refine(
        timeline,
        camera,
        point,
        Math.max(start, epochOf(i - 1)),
        Math.min(end, epochOf(i + 1)),
      ),
    );
  }

  // A span with no interior minimum at all — a straight run across the viewport — still
  // has to answer, and its answer is whichever endpoint is nearer.
  if (candidates.length === 0) candidates.push(at(start), at(end));

  return candidates.reduce((best, candidate) => (better(candidate, best, near) ? candidate : best));
};

/**
 * The epoch nearest `point` anywhere on the timeline, preferring one near `near`.
 *
 * Searches every arc and takes the best, rather than trusting the hit-test's arc id. The
 * two normally agree; where they do not is a click near a joint, and the honest answer is
 * the nearest instant rather than the nearest instant *on the arc whose polyline happened
 * to win the priority tie*.
 */
export const pickEpoch = (
  timeline: Timeline,
  camera: Camera,
  point: ScreenPoint,
  near: Epoch,
): Pick =>
  timeline.arcs
    .map((arc) => pickEpochInSpan(timeline, camera, point, arc.startEpoch, arc.endEpoch, near))
    .reduce((best, candidate) => (better(candidate, best, near) ? candidate : best), {
      epoch: timeline.startEpoch,
      distancePx: Number.POSITIVE_INFINITY,
    });
