/**
 * The camera during playback — #147, FR-404, FR-601, §8.3.8, §8.4, §8.8.
 *
 * §8.3.8: *"orbit view, camera follows the ship, target framed"*. That sentence hides
 * three problems, and #147's criteria are each one of them.
 *
 * ## 1. Smoothing has to happen in simulation time, not per frame
 *
 * > *Framing is smoothed in simulation time rather than per frame, so it does not
 * > jitter at high playback speed.*
 *
 * The planner's policy — `framing.ts` — re-frames when the content moves 20% and eases
 * over 400 ms of **wall clock**. Both halves break here, in different ways.
 *
 * The ease breaks because at 10 000× a 400 ms ease covers 4 000 seconds of mission
 * time: the camera would spend its whole life chasing a ship that left before it
 * started moving, arriving everywhere late and never settling.
 *
 * The threshold breaks because it is discrete. A camera that holds still and then jumps
 * once the content has drifted a fifth of the way across the viewport is exactly right
 * for a planner, where the content changes when the *player* changes it, and exactly
 * wrong for a run, where the content changes continuously and the jumps would land at
 * whatever rate the speed happened to produce.
 *
 * So there is **no ease and no threshold here.** {@link followCamera} is a pure function
 * of the playback epoch: the same epoch gives the same camera at 1× and at 100 000×, on
 * a fast machine and a slow one. Smoothness comes from the *window* the framing is
 * computed over rather than from filtering the framing afterwards — see below — and
 * because that window is measured in seconds of mission time, it behaves identically at
 * every speed by construction rather than by tuning.
 *
 * ## 2. The window is what stops the framing breathing
 *
 * Framing the ship and the target *at an instant* is smooth in the mathematical sense
 * and unwatchable in practice. The separation between two orbiting bodies oscillates
 * once per revolution, so the framing would pulse with it — and at 10 000× a LEO
 * revolution passes in half a second, which is a 2 Hz throb of the entire view.
 *
 * Framing over a **window of mission time** removes it. The union is taken over the
 * positions the two bodies occupy across the window, so a full revolution of
 * oscillation is inside the box rather than moving it. The window slides continuously
 * with the epoch, which keeps the result continuous.
 *
 * ## 3. The window shrinks near the encounter, which is what kills the scale jump
 *
 * > *The transition from "far apart early" to "metres apart at closest approach" is
 * > handled without a jarring scale jump.*
 *
 * A fixed window would frame a whole revolution forever, and the encounter that the
 * contract is *about* would happen inside one pixel. The obvious fix — switch to a
 * close-up when the range drops below some distance — is a regime change, which §8.4
 * rejects for exactly this reason: *"regime changes are jarring"*.
 *
 * So the window length is itself a continuous function of how far the playback head is
 * from the closest approach, {@link followWindowSeconds}. Far from the encounter it is a
 * revolution of context; approaching it, it shrinks smoothly toward
 * {@link MIN_WINDOW_SECONDS}, and the union shrinks with it until the two craft fill the
 * view. Nothing switches. The zoom-in *is* the window closing, and it is continuous
 * because the function is.
 *
 * ## The camera cannot affect the outcome
 *
 * > *Camera behaviour has no effect on the outcome (FR-601).*
 *
 * Nothing in this module is reachable from anything that computes a result: it consumes
 * an epoch and two position lookups and produces a `Camera`, which only the renderer
 * reads. There is no back edge. `screens/ContractScreen.test.tsx` asserts it anyway, by
 * running the same plan twice — once with the camera left alone and once panned, zoomed
 * and recentred — and comparing the debriefs, because "there is no path" is an argument
 * and the test is a fact.
 *
 * ## Reduced motion
 *
 * §9.4 makes every transition 0 ms under the preference, and there is nothing here to
 * collapse: the camera is already a direct function of the epoch with no transition of
 * its own. §8.8's actual answer for playback is stronger and lives in the screen —
 * *"playback defaults to skip-to-end"* — so a player who has asked for less motion does
 * not watch the camera move at all.
 */
import type { Epoch, EciVector } from '@hh/astro';
import type { Metres } from '@hh/math';
import type { Camera, ViewBasis, ViewBounds, Viewport } from '@hh/render';
import { boundsOfPoints, frameBounds } from '@hh/render';

/**
 * The shortest window the camera ever frames, in seconds of mission time.
 *
 * At the closest approach the window's job is no longer to average out a revolution —
 * it is to hold the two craft still enough to look at. Sixty seconds of LEO motion is
 * about 460 km of along-track arc, which at a 100 m encounter is entirely the *relative*
 * geometry rather than the orbit, because both bodies move together.
 */
export const MIN_WINDOW_SECONDS = 60;

/**
 * How quickly the window opens as the encounter recedes.
 *
 * One second of window per second of distance from the closest approach. A plain
 * proportion rather than a curve: it is already clamped at both ends, and the two
 * clamps are what shape it. Anything steeper reaches full context before the player can
 * see the approach beginning; anything shallower keeps the view tight through minutes
 * of coasting when there is nothing to look at closely.
 */
export const WINDOW_OPENING_RATE = 1;

/**
 * The smallest box the camera will frame, in metres.
 *
 * Without it, two craft a metre apart produce a box a metre wide and a scale of
 * thousands of pixels per metre — a view of nothing, briefly, at the most important
 * moment of the run. Two hundred metres puts DEP-03's 100 m docking box comfortably
 * inside the viewport, which is the tightest framing any v1.0 contract needs.
 */
export const MIN_FRAME_EXTENT_M = 200;

/** How many points the window is sampled at, per body. */
export const WINDOW_SAMPLES = 24;

/** Where the two bodies are, and what the run's bounds are. */
export interface FollowContext {
  /** Ship position at an epoch. `null` for an epoch the timeline cannot answer. */
  readonly shipAt: (at: Epoch) => EciVector<Metres> | null;
  /** Target position at an epoch, or `null` throughout for a contract with no target. */
  readonly targetAt: ((at: Epoch) => EciVector<Metres> | null) | null;
  readonly startEpoch: Epoch;
  readonly endEpoch: Epoch;
  /**
   * Epoch of the closest approach, or `null` when the contract has no encounter.
   *
   * With no encounter the window stays open at its widest, which is the right answer
   * for a `reach_orbit` contract: there is nothing to close in on.
   */
  readonly encounterEpoch: Epoch | null;
  /** The ship's orbital period, in seconds. The widest context the camera ever shows. */
  readonly periodSeconds: number;
}

/** Clamp, spelled once. */
const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

/**
 * How long a window to frame at `at`, in seconds of mission time.
 *
 * Continuous in `at`, which is the whole requirement: a discontinuity here is the scale
 * jump #147 forbids, and there is none because this is a clamped linear function of a
 * distance.
 *
 * A run with no encounter gets the full window everywhere. A degenerate or unknown
 * period falls back to the minimum rather than to `NaN` — an open orbit has no period,
 * and `L4` makes one illegal to commit, but the view still has to render one.
 */
export const followWindowSeconds = (at: Epoch, context: FollowContext): number => {
  const widest = Number.isFinite(context.periodSeconds)
    ? Math.max(MIN_WINDOW_SECONDS, context.periodSeconds)
    : MIN_WINDOW_SECONDS;

  if (context.encounterEpoch === null) return widest;

  const away = Math.abs(at - context.encounterEpoch);
  return clamp(away * WINDOW_OPENING_RATE, MIN_WINDOW_SECONDS, widest);
};

/** Grow a box to at least `extent` metres on each axis, about its own centre. */
const atLeast = (bounds: ViewBounds, extent: number): ViewBounds => {
  const growU = Math.max(0, extent - (bounds.maxU - bounds.minU)) / 2;
  const growV = Math.max(0, extent - (bounds.maxV - bounds.minV)) / 2;
  return {
    minU: bounds.minU - growU,
    maxU: bounds.maxU + growU,
    minV: bounds.minV - growV,
    maxV: bounds.maxV + growV,
  };
};

/**
 * The box the camera frames at `at`.
 *
 * The window is centred on the playback head and clipped to the run — a head near the
 * start looks forward and one near the end looks back, rather than sampling epochs the
 * timeline would refuse. That clipping is also why the ship's *current* position is
 * always in the box: it is one of the samples, at every epoch.
 *
 * Earth is deliberately **not** in the union. §8.4: *"auto-framing to the orbits, not
 * to Earth — Earth is allowed to overflow the viewport"*, and following a ship means
 * following it rather than keeping the planet in shot.
 */
export const followBounds = (
  at: Epoch,
  context: FollowContext,
  basis: ViewBasis,
): ViewBounds | null => {
  const half = followWindowSeconds(at, context) / 2;
  const from = Math.max(context.startEpoch, at - half);
  const to = Math.min(context.endEpoch, at + half);

  const points: EciVector<Metres>[] = [];
  // `WINDOW_SAMPLES - 1` intervals across the window, so the first sample is `from` and
  // the last is `to`. The constant is fixed above at more than one, so there is no
  // division by zero to guard.
  const step = (to - from) / (WINDOW_SAMPLES - 1);
  for (let i = 0; i < WINDOW_SAMPLES; i++) {
    // The last sample is `to` exactly rather than `from + (n-1) * step`, so a window
    // clipped to the horizon reaches it instead of stopping an ulp short.
    const sample = (i === WINDOW_SAMPLES - 1 ? to : from + i * step) as Epoch;
    const ship = context.shipAt(sample);
    if (ship !== null) points.push(ship);
    const target = context.targetAt?.(sample) ?? null;
    if (target !== null) points.push(target);
  }

  // Nothing to frame: a timeline that answered no epoch in the window. The caller keeps
  // the camera it has rather than being handed a degenerate one.
  if (points.length === 0) return null;

  return atLeast(boundsOfPoints(points, basis), MIN_FRAME_EXTENT_M);
};

/**
 * Where the camera belongs at `at`.
 *
 * `null` when there is nothing to frame — see {@link followBounds}. `frameBounds`
 * applies §8.4's 12% margin, the same one the planner uses, so the two views agree
 * about how much air an orbit gets.
 */
export const followCamera = (
  at: Epoch,
  context: FollowContext,
  viewport: Viewport,
  basis: ViewBasis,
): Camera | null => {
  const bounds = followBounds(at, context, basis);
  if (bounds === null) return null;
  return frameBounds(bounds, viewport, basis);
};

/**
 * Whether the camera is following the run or the player — FR-404.
 *
 * Two values rather than a boolean, for `framing.ts`'s reason: the requirement says
 * manual pan or zoom *suspends* auto-framing "until explicitly recentred", and a
 * `manualOverride: boolean` reads equally well in both directions at a call site.
 */
export type FollowMode = 'follow' | 'suspended';

/** Where the camera is, and whether the run still owns it. */
export interface FollowState {
  readonly mode: FollowMode;
  readonly camera: Camera;
}

/** A camera following the run. */
export const createFollow = (camera: Camera): FollowState => ({ mode: 'follow', camera });

/**
 * Adopt the framing for a new epoch.
 *
 * A no-op while suspended, which is FR-404's *"until explicitly recentred"*: a player
 * who has panned away to look at something keeps looking at it, however far the run has
 * moved on. Returns the **same object** when nothing changed, so a caller can skip a
 * re-render on identity.
 */
export const followTo = (state: FollowState, camera: Camera | null): FollowState => {
  if (state.mode === 'suspended' || camera === null) return state;
  return { mode: 'follow', camera };
};

/**
 * The player panned or zoomed — FR-404, §8.5.2.
 *
 * The camera passed in is the one the gesture produced; this owns only the policy, the
 * same division `framing.ts` uses.
 */
export const manualFollow = (_state: FollowState, camera: Camera): FollowState => ({
  mode: 'suspended',
  camera,
});

/** The ⌖ recentre control, and `F` in §8.5.3. Hands the run its camera back. */
export const recentreFollow = (state: FollowState, camera: Camera | null): FollowState => ({
  mode: 'follow',
  camera: camera ?? state.camera,
});
