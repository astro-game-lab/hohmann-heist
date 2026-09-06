/**
 * The title screen's background transfer — §8.3.1, #118.
 *
 * > *A real, propagated LEO→GEO transfer looping at ~2 000×. It is the actual sim, not an
 * > animation — the first honesty signal.*
 *
 * That sentence is a claim this module has to be able to keep, so everything here is the
 * game's own machinery: `hohmannTransfer` from `@hh/astro` sizes the two burns,
 * `buildTimeline` from `@hh/sim` propagates them, and the component that draws it advances
 * nothing but the **scrub epoch** — the same value the planner's timeline scrubber moves.
 * There are no keyframes, no interpolated path, and no second copy of the trajectory: what
 * is on screen at any instant is `stateAt(timeline, t)`, evaluated the way a committed plan
 * would be.
 *
 * ## Why it is built here rather than loaded from a contract
 *
 * The obvious shortcut is to reuse C01 or C04. Both are the wrong shape: §8.3.1's mockup
 * wants a transfer whose two circles are far enough apart to read as *two* circles at
 * thumbnail size, and the shipped contracts are tuned for play rather than for silhouette
 * — C01–C03 sit inside a few hundred kilometres of each other, which at title-card scale
 * is one thick line. LEO→GEO is the transfer the genre is named after and the one whose
 * picture is legible.
 *
 * It also keeps the title independent of content: a contract retuned for difficulty should
 * not silently restyle the front door, and deleting a contract should not blank it.
 *
 * ## Pure, and testable without a browser
 *
 * Nothing here touches the DOM, the clock, or `Math.random` — it is a function from
 * nothing to a `Timeline`, so `background.test.ts` can check the burns against the closed
 * form under Node. The canvas work lives in `TitleBackground.tsx`; this file is the part
 * that has to be *right*, and it is checked rather than looked at.
 */
import {
  MU_EARTH,
  R_EARTH_EQ,
  R_GEO,
  addSeconds,
  epoch,
  hohmannTransfer,
  period,
  stateFromElements,
  type Epoch,
  type State,
} from '@hh/astro';
import { metres, radians, seconds } from '@hh/math';
import {
  DELTA_V_COUNTS_PER_MPS,
  EPOCH_TICKS_PER_SECOND,
  buildTimeline,
  createPlan,
  maneuverNodeFromCounts,
  type Timeline,
} from '@hh/sim';

/**
 * The parking orbit: a 400 km circular equatorial LEO.
 *
 * 400 km because it is the altitude the game already uses for its opening contracts and
 * the one a reader is most likely to recognise; equatorial because §8.3.1's background is
 * drawn face-on and an inclined orbit would project to an ellipse that reads as an
 * eccentric one, which would be the *opposite* of an honesty signal.
 */
export const PARKING_ALTITUDE_M = 400_000;

/** Radius of the departure orbit, from the equatorial radius the rest of the game uses. */
export const PARKING_RADIUS_M = R_EARTH_EQ + PARKING_ALTITUDE_M;

/**
 * How much of the parking orbit is flown before the first burn.
 *
 * Half a revolution, so the loop opens on the ship already moving on the inner circle
 * rather than on a burn: the point of the background is that something is being
 * *propagated*, and a loop that began at the impulse would look like an animation starting.
 */
const PARKING_COAST_FRACTION = 0.5;

/**
 * How much of the destination orbit is flown before the loop restarts.
 *
 * A quarter revolution. A full GEO orbit is 86 164 s, which even at 2 000× is 43 seconds
 * of a nearly stationary dot — the loop would be mostly dead air. A quarter is long enough
 * to show the circularisation took and short enough that the transfer, which is the
 * interesting part, is most of what anyone sees.
 */
const DESTINATION_COAST_FRACTION = 0.25;

/** §8.3.1's *"looping at ~2 000×"*. Simulated seconds per wall-clock second. */
export const BACKGROUND_TIME_SCALE = 2000;

/** A circular equatorial orbit at `radius`, at the ascending node. */
const circularState = (radius: number): State =>
  stateFromElements(
    {
      // Circular: the semi-latus rectum *is* the radius. Stated through `p` rather than
      // `a` for the reason the element set is built on it — see `docs/PHYSICS.md`.
      semiLatusRectum: metres(radius),
      eccentricity: 0,
      inclination: radians(0),
      raan: radians(0),
      argp: radians(0),
      trueAnomaly: radians(0),
    },
    MU_EARTH,
  );

/** A prograde impulse of `dvMps`, as DEP-09's quantised RTN counts. */
const progradeCounts = (dvMps: number): readonly [number, number, number] => [
  0,
  Math.round(dvMps * DELTA_V_COUNTS_PER_MPS),
  0,
];

/** What the background is, as numbers the screen can also report. */
export interface BackgroundTransfer {
  readonly timeline: Timeline;
  /** Where the loop restarts. The transfer's own end, not the propagation horizon. */
  readonly loopEnd: Epoch;
  /** Δv of the two burns, in m/s, from the closed form that sized them. */
  readonly firstBurnMps: number;
  readonly secondBurnMps: number;
  /** Time of flight on the transfer ellipse, in seconds. */
  readonly transferSeconds: number;
  /** Largest radius the scene has to frame, for the camera. */
  readonly maxRadiusM: number;
}

/**
 * Build the transfer.
 *
 * Deterministic and total: same inputs, same trajectory, and the only failure mode is a
 * timeline that will not build, which is thrown rather than returned because it cannot
 * happen for a two-burn coplanar transfer between two circles — reaching it means
 * `buildTimeline` has broken, and the error boundary (#125) is a better place to hear
 * about that than a silently empty canvas.
 */
export const buildBackgroundTransfer = (): BackgroundTransfer => {
  const r1 = PARKING_RADIUS_M;
  const r2 = R_GEO;

  // The two burns, from `@hh/astro`'s closed form rather than from a Lambert solve or a
  // hand-tuned number. This is the one place the screen's honesty claim is decided.
  const transfer = hohmannTransfer(metres(r1), metres(r2), MU_EARTH);

  const parkingCoast = period(metres(r1), MU_EARTH) * PARKING_COAST_FRACTION;
  const destinationCoast = period(metres(r2), MU_EARTH) * DESTINATION_COAST_FRACTION;

  const start = epoch(0);
  const firstBurnAt = parkingCoast;
  const secondBurnAt = firstBurnAt + transfer.timeOfFlight;
  const loopEndSeconds = secondBurnAt + destinationCoast;

  const ticks = (atSeconds: number): number => Math.round(atSeconds * EPOCH_TICKS_PER_SECOND);

  const plan = createPlan([
    maneuverNodeFromCounts(ticks(firstBurnAt), progradeCounts(transfer.firstBurn)),
    maneuverNodeFromCounts(ticks(secondBurnAt), progradeCounts(transfer.secondBurn)),
  ]);

  const result = buildTimeline({
    startEpoch: start,
    initialState: circularState(r1),
    plan,
    // A hair past the loop point, so `stateAt` at the loop's last frame is inside the
    // horizon rather than exactly on it.
    horizon: addSeconds(start, seconds(loopEndSeconds + 1)),
    mu: MU_EARTH,
  });

  if (!result.ok) {
    throw new Error(`title background timeline failed to build: ${result.reason}`);
  }

  return {
    timeline: result.timeline,
    loopEnd: addSeconds(start, seconds(loopEndSeconds)),
    firstBurnMps: transfer.firstBurn,
    secondBurnMps: transfer.secondBurn,
    transferSeconds: transfer.timeOfFlight,
    maxRadiusM: r2,
  };
};
