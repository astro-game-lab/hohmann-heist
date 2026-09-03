/**
 * Cylindrical umbra intervals (#64, FR-008, DEP-06).
 *
 * When an arc is inside the central body's shadow, modelled as a cylinder of the
 * body's radius projected anti-sunward.
 *
 * ## The Sun direction is a parameter, and that is the requirement
 *
 * DEP-06 — holding the Sun fixed for the duration of a contract — is a *gameplay*
 * simplification, and it lives in `@hh/game` where the departures table says it
 * does. Nothing in this module assumes the Sun does not move: it is handed a
 * direction and answers for that direction. A caller with an ephemeris passes a
 * different vector per call and gets the right answer without changing a line here.
 *
 * The body radius is a parameter for the same reason. This package's central body
 * is whatever `mu` says it is.
 *
 * ## The model, and what it costs
 *
 * A spacecraft is in umbra when it is on the anti-sunward side of the body and
 * within the body's radius of the body–Sun line:
 *
 * ```
 * along = r · ŝ                     inUmbra  ⟺  along < 0  and  |r − along ŝ| < R
 * perp  = |r − along ŝ|
 * ```
 *
 * The real umbra is a **cone**, not a cylinder — the Sun is a disc, not a point, so
 * the shadow converges and terminates about 1.4 million km behind Earth — and there
 * is a penumbra outside it where the Sun is partly occulted. This model has
 * neither. The cone is the one that costs something: because it converges, this
 * model's shadow is *wider* than the real umbra at every altitude, and increasingly
 * so with distance. Measured — at a 400 km circular orbit the eclipse comes out
 * **1.1% long** (36.11 min against 35.71), and at geostationary **3.2% long** (69.41
 * against 67.28). The penumbra is a band of partial shadow outside that, 0.8 min
 * wide at 400 km and 4.3 min at GEO, which this model reports as full sunlight.
 * `docs/PHYSICS.md` carries the same figures and their derivation, because a player
 * checking an eclipse window against a published one deserves to find the
 * discrepancy explained rather than to discover it.
 *
 * ## The terminator is not a boundary of the shadow, which is what makes this clean
 *
 * The umbra region is bounded by `perp = R` and, apparently, by `along = 0`. It is
 * not: where `along = 0` the spacecraft is over the terminator, so `perp = |r|`,
 * and `|r| > R` for any trajectory outside the body. The condition therefore cannot
 * flip across `along = 0`, and **every entry and exit is a root of `perp − R`** — a
 * single smooth function, with no discontinuity to bracket across and no need for a
 * piecewise shadow function.
 *
 * That argument assumes the trajectory stays outside the body. One that does not is
 * a trajectory that has hit the ground, which is the shell finder's question and
 * DEP-08's answer; here the bracket simply fails to straddle and no interval is
 * reported, rather than a wrong one being invented.
 *
 * ## Sampling in anomaly, refining in time
 *
 * The shadow condition depends only on *where* the spacecraft is, not on when, so
 * the sample grid is laid out in **true anomaly** — uniform in position around the
 * orbit rather than uniform in seconds. On an eccentric orbit that is the
 * difference between finding an eclipse near periapsis and missing it: a shadow
 * crossing near periapsis is short in seconds and perfectly ordinary in anomaly,
 * and a time-uniform grid would resolve the slow far end of the orbit it does not
 * need and skip the fast near end it does.
 *
 * Refinement then runs in *epoch*, through the propagator, so that
 * `toleranceSeconds` means what it says. Samples come from the arc's cached
 * elements and refinement from universal-variable propagation; the two agree to
 * round-off, and where they would not — a grazing shadow, where `perp − R` never
 * properly changes sign — the bracket fails and nothing is reported, which is
 * exactly what #64 asks for from a graze.
 */
import type { EciVector, Epoch } from '@hh/astro';
import { eci, elementsFromState, epoch } from '@hh/astro';
import { TAU, V } from '@hh/math';

import type { Arc } from './arc.js';
import type { EpochInterval, EventOptions } from './events.js';
import {
  conicClock,
  conicGeometry,
  refineRoot,
  requireSearchInterval,
  requireStateAt,
  revolutionRange,
} from './events.js';

/**
 * Samples per revolution when bracketing, by default.
 *
 * Sized for the shortest eclipse the game produces. A LEO eclipse spans roughly 40%
 * of a revolution and a GEO one about 5%, so 64 looks per revolution brackets the
 * GEO case three times over. Eclipses shorter than that exist — a GEO orbit weeks
 * from equinox has a shadow entry that shrinks to nothing — and those are the ones
 * a caller raises this for. They are also the ones whose *epochs* are worst
 * conditioned, so a search that misses one narrowly is failing where the answer was
 * least trustworthy anyway.
 */
export const DEFAULT_UMBRA_SAMPLES_PER_REVOLUTION = 64;

/** Distance from the body–Sun line, and which side of the terminator. */
interface ShadowGeometry {
  /** Component along the Sun direction. Negative on the shadowed side. */
  readonly along: number;
  /** Perpendicular distance from the body–Sun line, in metres. */
  readonly perp: number;
}

const shadowGeometryOf = (position: EciVector, sunHat: EciVector): ShadowGeometry => {
  const along = V.dot(position, sunHat);
  return {
    along,
    perp: Math.hypot(
      position.x - along * sunHat.x,
      position.y - along * sunHat.y,
      position.z - along * sunHat.z,
    ),
  };
};

/**
 * Spans of `[start, end)` during which the arc is inside the cylindrical umbra.
 *
 * Ordered by start epoch and non-overlapping. An eclipse already in progress at
 * `start`, or still in progress at `end`, is returned clipped with the
 * corresponding flag set rather than dropped.
 *
 * Returns an empty array — never an error — for an orbit that is never eclipsed and
 * for one that is permanently in sunlight. The two are the same computation: the
 * predicate is false at every sample and never flips.
 *
 * @param sunDirection Direction **towards** the Sun, in the inertial frame.
 * Normalised internally, so any non-zero length will do.
 * @param bodyRadius Radius of the occulting body in metres.
 *
 * @throws RangeError when the Sun direction is the zero vector, the body radius is
 * not finite and positive, or the search interval is malformed.
 */
export const findUmbraIntervals = (
  arc: Arc,
  sunDirection: EciVector,
  bodyRadius: number,
  start: Epoch,
  end: Epoch,
  options: EventOptions = {},
): readonly EpochInterval[] => {
  requireSearchInterval(start, end);
  if (!(bodyRadius > 0) || !Number.isFinite(bodyRadius)) {
    throw new RangeError(`body radius must be finite and positive, got ${String(bodyRadius)} m`);
  }
  if (V.normSq(sunDirection) === 0) {
    throw new RangeError('the Sun direction cannot be the zero vector');
  }
  if (end === start) return [];

  const unitSun = eci(V.normalize(sunDirection));

  const clock = conicClock(arc);
  const geometry = conicGeometry(arc);
  const samplesPerRevolution = options.samplesPerRevolution ?? DEFAULT_UMBRA_SAMPLES_PER_REVOLUTION;

  const epochs = sampleEpochs(arc, clock, start, end, samplesPerRevolution);

  /** Positive outside the shadow cylinder's lateral surface, negative inside it. */
  const surface = (t: number): number =>
    shadowGeometryOf(requireStateAt(arc, t).position, unitSun).perp - bodyRadius;

  const inUmbraAt = (t: number, nu: number | undefined): boolean => {
    const position = nu === undefined ? requireStateAt(arc, t).position : geometry.positionAt(nu);
    const { along, perp } = shadowGeometryOf(position, unitSun);
    return along < 0 && perp < bodyRadius;
  };

  const intervals: EpochInterval[] = [];
  let previous = inUmbraAt(epochs[0]?.t ?? start, epochs[0]?.nu);
  let openedAt: number | undefined = previous ? start : undefined;
  let clippedStart = previous;

  for (let i = 1; i < epochs.length; i++) {
    const here = epochs[i];
    const before = epochs[i - 1];
    if (here === undefined || before === undefined) continue;
    const current = inUmbraAt(here.t, here.nu);

    if (current !== previous) {
      const root = refineRoot(surface, before.t, here.t, options);
      if (root !== undefined) {
        if (current) {
          openedAt = root;
          clippedStart = false;
        } else if (openedAt !== undefined) {
          intervals.push({
            start: epoch(openedAt),
            end: epoch(root),
            clippedStart,
            clippedEnd: false,
          });
          openedAt = undefined;
          clippedStart = false;
        }
      }
    }
    previous = current;
  }

  if (openedAt !== undefined) {
    intervals.push({ start: epoch(openedAt), end, clippedStart, clippedEnd: true });
  }
  return intervals;
};

/** One point of the sample grid: an epoch and, where known, the anomaly it came from. */
interface Sample {
  readonly t: number;
  /** The true anomaly this epoch was generated from, or `undefined` at a clipped bound. */
  readonly nu: number | undefined;
}

/**
 * The sample grid, laid out uniformly in true anomaly and returned in epoch order.
 *
 * A closed orbit is walked one revolution at a time, so the grid stays uniform in
 * anomaly however many revolutions the search spans. An open orbit has no
 * revolutions to walk: its anomaly range is bounded by the search interval rather
 * than by the conic, so the two ends are located first — by propagating to them and
 * reading the anomaly back — and the grid is spread between them.
 *
 * The hyperbolic anomaly is unwrapped to `(-pi, pi]` before that, because the
 * element set normalises to `[0, 2pi)` and an inbound leg at 5.5 rad followed by an
 * outbound one at 0.8 rad is not an interval a loop can walk. On an open orbit
 * there is no wrap to preserve: the trajectory is traversed once, so the anomaly is
 * monotone and the unwrapped form is the one that says so.
 */
const sampleEpochs = (
  arc: Arc,
  clock: ReturnType<typeof conicClock>,
  start: Epoch,
  end: Epoch,
  samplesPerRevolution: number,
): readonly Sample[] => {
  const samples: Sample[] = [{ t: start, nu: undefined }];

  if (Number.isFinite(clock.period)) {
    const { first, last } = revolutionRange(clock, start, end);
    for (let k = first; k <= last; k++) {
      for (let j = 0; j < samplesPerRevolution; j++) {
        const nu = (TAU * j) / samplesPerRevolution;
        const t = clock.epochAt(nu, k);
        if (t > start && t < end) samples.push({ t, nu });
      }
    }
  } else {
    const unwrap = (nu: number): number => (nu > Math.PI ? nu - TAU : nu);
    const anomalyAt = (t: Epoch): number => {
      const state = requireStateAt(arc, t);
      return unwrap(elementsFromState(state.position, state.velocity, arc.mu).trueAnomaly);
    };
    const nuStart = anomalyAt(start);
    const nuEnd = anomalyAt(end);
    for (let j = 1; j < samplesPerRevolution; j++) {
      const nu = nuStart + ((nuEnd - nuStart) * j) / samplesPerRevolution;
      const t = clock.epochAt(nu, 0);
      if (t > start && t < end) samples.push({ t, nu });
    }
  }

  samples.push({ t: end, nu: undefined });
  return samples;
};
