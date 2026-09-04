/**
 * The playback clock — FR-601, FR-602, FR-603, DEP-05, §8.3.8, #144, #145.
 *
 * > *Execution MUST play back the already-solved timeline; it MUST NOT recompute or
 * > diverge from the prediction.*
 *
 * This module is the whole of "play back". It advances an epoch and hands back the
 * events that epoch passed, and it does nothing else: no propagation, no evaluation, no
 * outcome. There is no code path from here to the simulation, which is FR-601 as a
 * property of the module graph rather than a claim about intent.
 *
 * ## Speed is a display rate, and that is why it cannot change the outcome
 *
 * §8.3.8: *"Playback speed is a **display** rate, not a simulation rate — the timeline
 * is already solved. Changing speed changes nothing about the outcome."*
 *
 * The speed appears in exactly one expression — how far the epoch moves per wall-clock
 * second — and the epoch is the only thing it touches. Every event the run reports
 * comes out of an array that was built before playback started and is indexed by a
 * cursor that only ever moves forward. So FR-602 is not something this module *checks*;
 * there is no quantity here that a speed could influence. A test still runs the same
 * plan at 1× and 100 000× and asserts the outcomes match, because "there is nothing for
 * it to affect" is an argument and the test is a fact.
 *
 * ## Frame-rate independence is the cursor, not a fixed timestep
 *
 * #144's last criterion: *"a slow frame skips or duplicates no events."*
 *
 * The usual answer is a fixed simulation timestep with an accumulator, which is right
 * when the step *computes* something — error would otherwise depend on how the time was
 * chopped up. Nothing is computed here, so a fixed step would buy nothing and cost the
 * one thing it is meant to protect: a 500 ms stall at 10 000× is 5 000 seconds of
 * mission time, which at a 1/60 s step is 300 000 iterations of a loop that does no
 * work, on the frame that was already late.
 *
 * Instead the epoch jumps straight to where it belongs and {@link drain} walks the
 * cursor over every event now behind it. One pass, proportional to the events actually
 * passed rather than to the time passed. Nothing is skipped because the cursor visits
 * every index in turn; nothing is duplicated because it never moves backwards.
 *
 * That is also, exactly, why **skipping to the end and watching it through produce the
 * same log** (#145, #146): {@link skipToEnd} is not a second code path, it is
 * {@link advance} with an infinite step, draining the same array through the same
 * cursor in the same order.
 *
 * ## Why the events are generic
 *
 * This takes anything with an `epoch`. It has no opinion about what an event is, which
 * keeps `@hh/game`'s flight log out of its type signature and lets `playback.test.ts`
 * drive it with plain objects at hand-chosen epochs — the cases that matter are two
 * events at the same instant and a step that spans forty of them, and constructing
 * those from a real trajectory would be arranging an orbit to prove a point about an
 * array index.
 *
 * ## No clock
 *
 * `advance` is handed the seconds that elapsed; it does not read them. `@hh/ui` sits in
 * the DOM-free TypeScript project, so `performance.now()` here is a type error before it
 * is a review comment — the same arrangement `framing.ts` uses, and for the same reason:
 * a module that read a clock could not be tested without faking one.
 */
import type { Epoch } from '@hh/astro';

/**
 * §8.5.3's `1`–`5`, reaching FR-602's cap.
 *
 * Five values, in order, so a key press is an index into this array and the HUD's
 * buttons are a map over it — neither has its own copy of the list. §8.3.8's mock shows
 * the first four; the fifth is FR-602's *"selectable up to 100 000×"*, and the
 * requirement is a ceiling rather than a suggestion.
 *
 * The steps are decades because the useful question at any moment is "an order of
 * magnitude faster?", not "twice as fast?" — a 14-hour contract watched at 2× is still
 * seven hours.
 */
export const PLAYBACK_SPEEDS = [1, 100, 1000, 10_000, 100_000] as const;

/** One of {@link PLAYBACK_SPEEDS}. */
export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

/** The rate a run starts at. */
export const DEFAULT_PLAYBACK_SPEED: PlaybackSpeed = 100;

/**
 * Where a run is.
 *
 * `ended` is a status rather than a derived predicate because §8.3.8's controls change
 * when it is reached — pause and skip stop meaning anything — and a screen branching on
 * `epoch >= endEpoch` in four places would be four chances to disagree.
 */
export type PlaybackStatus = 'playing' | 'paused' | 'ended';

/** Anything the clock can carry. The flight log's entries satisfy this. */
export interface TimedEvent {
  readonly epoch: Epoch;
}

/** A run in progress. Frozen; every transition returns a new one. */
export interface PlaybackState {
  /** Where the run has reached. Never outside `[startEpoch, endEpoch]`. */
  readonly epoch: Epoch;
  readonly startEpoch: Epoch;
  /** Where the run stops. The timeline's horizon (§6.3). */
  readonly endEpoch: Epoch;
  readonly speed: PlaybackSpeed;
  readonly status: PlaybackStatus;
  /**
   * Index of the first event not yet reported.
   *
   * Monotonic: it is the reason an event cannot be reported twice, and the reason a
   * long frame reports the events it passed rather than only the last of them.
   */
  readonly cursor: number;
}

/** A transition, and what it passed. */
export interface PlaybackStep<E extends TimedEvent> {
  readonly state: PlaybackState;
  /** The events this step passed, in the order they appear in the log. */
  readonly crossed: readonly E[];
}

/** What a run is started from. */
export interface PlaybackSpec {
  readonly startEpoch: Epoch;
  readonly endEpoch: Epoch;
  readonly speed?: PlaybackSpeed;
  /**
   * Start paused.
   *
   * §8.8's Motion row makes reduced motion default playback to skip-to-end; a run that
   * begins paused is the gentler half of that, used by the screen when the player has
   * asked for less movement but not for no run at all.
   */
  readonly paused?: boolean;
}

const frozen = (state: PlaybackState): PlaybackState => Object.freeze(state);

/**
 * A run at its start, with nothing yet reported.
 *
 * The cursor is 0 rather than "past the events at `startEpoch`", so the first
 * {@link advance} — even one with a zero step — reports ignition. That is the intended
 * reading of "the run has begun": the opening entry is something that happened, not
 * something that had already happened before anyone was watching.
 */
export const createPlayback = (spec: PlaybackSpec): PlaybackState => {
  if (!(spec.endEpoch >= spec.startEpoch)) {
    throw new RangeError(
      `playback ends before it starts: [${String(spec.startEpoch)}, ${String(spec.endEpoch)}]`,
    );
  }
  return frozen({
    epoch: spec.startEpoch,
    startEpoch: spec.startEpoch,
    endEpoch: spec.endEpoch,
    speed: spec.speed ?? DEFAULT_PLAYBACK_SPEED,
    status: spec.paused === true ? 'paused' : 'playing',
    cursor: 0,
  });
};

/**
 * Move the cursor over every event at or before `at`, collecting them.
 *
 * The comparison is `<=`, and the guard against reporting one twice is the cursor
 * rather than a strict inequality on the epoch. That distinction is the whole reason
 * two events at the same instant both get reported: a rule of "epoch strictly greater
 * than last time" would report the first and silently drop the second, and the flight
 * log deliberately puts a burn and the apsis it sits on at the same epoch.
 */
const drain = <E extends TimedEvent>(
  events: readonly E[],
  cursor: number,
  at: Epoch,
): { readonly cursor: number; readonly crossed: readonly E[] } => {
  let next = cursor;
  while (next < events.length) {
    const event = events[next];
    if (event === undefined || event.epoch > at) break;
    next += 1;
  }
  return next === cursor
    ? { cursor, crossed: [] }
    : { cursor: next, crossed: events.slice(cursor, next) };
};

/** Where the epoch lands after `wallDeltaSeconds` at the current rate. Clamped to the end. */
const nextEpoch = (state: PlaybackState, wallDeltaSeconds: number): Epoch => {
  // A negative delta is a clock that went backwards, which some platforms do across a
  // suspend. Playback does not run backwards, so it is floored at zero rather than
  // rewinding the cursor — the alternative would report events a second time.
  const simSeconds = Math.max(0, wallDeltaSeconds) * state.speed;
  return Math.min(state.endEpoch, state.epoch + simSeconds) as Epoch;
};

/**
 * Advance a run by `wallDeltaSeconds` of real time.
 *
 * Returns the events the step passed. A paused or ended run does not move, but is still
 * drained: that is what makes the first call after {@link createPlayback} report
 * ignition whether or not the run started paused.
 */
export const advance = <E extends TimedEvent>(
  state: PlaybackState,
  events: readonly E[],
  wallDeltaSeconds: number,
): PlaybackStep<E> => {
  const epoch = state.status === 'playing' ? nextEpoch(state, wallDeltaSeconds) : state.epoch;
  const { cursor, crossed } = drain(events, state.cursor, epoch);

  // Ending is reaching the horizon, not exhausting the array: the log's last entry is
  // *at* the horizon, so the two coincide — but a caller passing a shorter list should
  // still see the run finish where the timeline does, and a caller passing a longer one
  // should not have the run continue past it.
  const status: PlaybackStatus = epoch >= state.endEpoch ? 'ended' : state.status;

  return {
    state: frozen({ ...state, epoch, cursor, status }),
    crossed,
  };
};

/**
 * Skip to the end — FR-603, §8.3.8's *"prominent, not hidden"*.
 *
 * > *A player on their 12th attempt should not watch 12 hours of coasting again.*
 *
 * One call to {@link advance} with an unbounded step. Written this way rather than as
 * its own function that sets the epoch and copies the array, because the criterion this
 * has to meet is that skipping and watching produce *the same* result (#145, #146) —
 * and the only implementation that cannot drift from `advance` is `advance`.
 */
export const skipToEnd = <E extends TimedEvent>(
  state: PlaybackState,
  events: readonly E[],
): PlaybackStep<E> => advance({ ...state, status: 'playing' }, events, Number.POSITIVE_INFINITY);

/**
 * `Space` — §8.3.8, §8.5.3.
 *
 * Toggles between playing and paused, and does nothing to a run that has ended. Note
 * what pausing does **not** do: it does not permit editing. §8.3.8 is explicit that
 * editing here *"would break the 'prediction is truth' promise"*, and the reason it
 * cannot happen is structural rather than a disabled button — there is no plan on this
 * state and no transition from it that produces one. The screen offers Abort instead.
 */
export const togglePause = (state: PlaybackState): PlaybackState =>
  state.status === 'ended'
    ? state
    : frozen({ ...state, status: state.status === 'playing' ? 'paused' : 'playing' });

/** Explicitly pause. Idempotent. */
export const pause = (state: PlaybackState): PlaybackState =>
  state.status === 'playing' ? frozen({ ...state, status: 'paused' }) : state;

/** Explicitly resume. Idempotent, and a no-op on an ended run. */
export const resume = (state: PlaybackState): PlaybackState =>
  state.status === 'paused' ? frozen({ ...state, status: 'playing' }) : state;

/**
 * Change the rate — DEP-05, §8.5.3's `1`–`5`.
 *
 * Does not move the epoch and does not touch the cursor, which is FR-602 restated as a
 * signature: there is nothing in the returned state a later event could be read from
 * differently. Changing speed mid-run is therefore exactly as safe as not changing it.
 */
export const setSpeed = (state: PlaybackState, speed: PlaybackSpeed): PlaybackState =>
  state.speed === speed ? state : frozen({ ...state, speed });

/** Fraction of the run elapsed, in `[0, 1]`. For the progress bar and nothing else. */
export const progressOf = (state: PlaybackState): number => {
  const span = state.endEpoch - state.startEpoch;
  return span <= 0 ? 1 : Math.min(1, Math.max(0, (state.epoch - state.startEpoch) / span));
};

/** Mission elapsed seconds at the playback head. What the HUD's MET readout shows. */
export const elapsedSeconds = (state: PlaybackState): number => state.epoch - state.startEpoch;
