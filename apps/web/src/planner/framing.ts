/**
 * Auto-framing policy — #103, FR-404, §8.4, §8.5.2, §9.4.
 *
 * #230 landed the framing *mathematics* in `@hh/render`: `frameBounds`, `needsReframe`,
 * `easeTo`, `clampScale`, `unionOf`. What it deliberately did not land is the policy that
 * drives them, and `camera.ts`'s docstring says why — a `Camera` is a projection, and
 * "the player has taken manual control" is not a property of a projection. #103's fifth
 * criterion states the same thing as a requirement: *"The suspend flag lives in
 * application state, not on `Camera`."*
 *
 * This is that application state.
 *
 * ## Why it is here and not in `@hh/ui`
 *
 * It is a state machine over `Camera` values, so it has to name the type — and `@hh/ui`
 * does not depend on `@hh/render` and must not start, because the layering rule runs
 * render → game → sim and the two packages sit side by side. `apps/web` is the only layer
 * that legitimately sees both, which is what §11.2 means by calling it the composition
 * point. Making the module generic in its camera to keep it in `@hh/ui` was the
 * alternative, and it would have bought nothing: every one of its three call sites would
 * have had to inject `needsReframe` and `easeTo` back in.
 *
 * It is still pure. No canvas, no clock, no DOM — #103's last criterion — so the whole
 * of it is exercised by plain function calls in `framing.test.ts`.
 *
 * ## The clock is the caller's
 *
 * `easeTo` takes normalised progress, not a duration, and this keeps that arrangement:
 * {@link advanceFraming} is handed the seconds that elapsed since the last frame and
 * accumulates them. The alternative — reading `performance.now()` here — would make the
 * module untestable without faking a global and would put a wall-clock read inside the
 * planner's state, which is the thing §11.4 spends a page ruling out of the simulation
 * and is no more welcome here.
 *
 * The accumulated fraction is clamped to 1 before it reaches `easeTo`. That is #103's
 * *"a long frame lands exactly on the target rather than past it"*: a 500 ms stall
 * during a 400 ms ease produces `t = 1.25`, and `easeInOut` is a cubic — it does not
 * saturate, it overshoots, so the camera would sail past the framing and settle back.
 * The clamp is one `Math.min` and it is the difference between an ease and a bounce.
 *
 * ## `prefers-reduced-motion` collapses the ease rather than skipping it
 *
 * §9.4 makes every transition 0 ms under the preference, and {@link advanceFraming}
 * implements that by passing `t = 1` on the first frame rather than by declining to start
 * an ease at all. The distinction matters: the target camera is still adopted, the
 * `needsReframe` gate still applies, and the only thing that changes is that the player
 * arrives immediately. Skipping the machinery instead would have left a reduced-motion
 * player on a stale camera whenever the content changed.
 */
import type { Camera } from '@hh/render';
import { REFRAME_DURATION_SECONDS, easeTo, needsReframe } from '@hh/render';

/** An ease in flight: where it started, where it is going, and how far in it is. */
export interface Ease {
  readonly from: Camera;
  readonly to: Camera;
  /** Seconds accumulated since the ease began, from the caller's clock. */
  readonly elapsedSeconds: number;
}

/**
 * Whether the camera is following the content or the player.
 *
 * Two values rather than a boolean because the names are the requirement: FR-404 says
 * manual pan or zoom *suspends* auto-framing "until explicitly recentred", and a
 * `manualOverride: boolean` reads equally well in both directions at the call site.
 */
export type FramingMode = 'auto' | 'suspended';

export interface FramingState {
  readonly mode: FramingMode;
  /** The ease in flight, or `null` when the camera is at rest. */
  readonly ease: Ease | null;
  /** Where the camera is right now. The value the renderer is handed. */
  readonly camera: Camera;
}

/** A camera at rest, following the content. */
export const createFraming = (camera: Camera): FramingState => ({
  mode: 'auto',
  ease: null,
  camera,
});

/**
 * The content changed; re-frame if it changed enough.
 *
 * `needsReframe`'s 20% threshold is what keeps the view still during an ordinary scrub
 * (§8.4, #103's second criterion): the ship marker moves every frame and the union it
 * belongs to barely does, so this returns the state unchanged and the camera does not
 * twitch. Returning the *same object* when nothing is needed is deliberate — it lets the
 * caller skip a re-render on identity, and it is what the test asserts.
 *
 * Suspended is suspended: a manual camera is not re-framed by new content, however far it
 * has drifted. Only {@link recentreFraming} lifts that.
 */
export const contentChanged = (state: FramingState, target: Camera): FramingState => {
  if (state.mode === 'suspended') return state;

  // Compare against where the ease is *going*, not where the camera is now. Mid-ease the
  // camera is somewhere between two framings, and measuring from there would re-trigger
  // on the ease's own motion — a re-frame that never converges because it keeps chasing
  // its own tail.
  const reference = state.ease?.to ?? state.camera;
  if (!needsReframe(reference, target)) return state;

  return {
    mode: 'auto',
    ease: { from: state.camera, to: target, elapsedSeconds: 0 },
    camera: state.camera,
  };
};

/**
 * Advance an ease by `deltaSeconds`.
 *
 * Returns the same object when there is nothing in flight, so an idle planner does no
 * work and triggers no re-render.
 */
export const advanceFraming = (
  state: FramingState,
  deltaSeconds: number,
  reducedMotion: boolean,
): FramingState => {
  const { ease } = state;
  if (ease === null) return state;

  const elapsedSeconds = ease.elapsedSeconds + Math.max(0, deltaSeconds);
  // §9.4 under the preference: one frame, landing on the target. Not "no ease" — see
  // the docstring.
  const t = reducedMotion ? 1 : Math.min(1, elapsedSeconds / REFRAME_DURATION_SECONDS);
  const camera = easeTo(ease.from, ease.to, t);

  return t >= 1
    ? { mode: state.mode, ease: null, camera: ease.to }
    : { mode: state.mode, ease: { ...ease, elapsedSeconds }, camera };
};

/**
 * The player panned or zoomed — FR-404, §8.5.2.
 *
 * Suspends auto-framing and abandons any ease in flight. Abandoning it is the point: a
 * pan that fought a running re-frame for the next 300 ms would feel like the camera was
 * resisting, and the player's input is the more recent statement of intent.
 *
 * The camera passed in is the one the pan or zoom produced, so the caller stays
 * responsible for applying `pan`/`zoomAt` and this stays responsible only for the policy.
 */
export const manualCamera = (_state: FramingState, camera: Camera): FramingState => ({
  mode: 'suspended',
  ease: null,
  camera,
});

/**
 * The ⌖ recentre control — FR-404, §8.5.2, and `F` in §8.5.3.
 *
 * Restores auto-framing *and* eases to the target, rather than only clearing the flag and
 * waiting for the content to change. #103's sixth criterion asks for both, and the reason
 * is that the common case is a player who has panned away from a plan that has not
 * changed since: with only the flag cleared, `needsReframe` would compare the target
 * against itself, decline, and leave the player looking at the same off-centre view they
 * pressed the button to escape.
 *
 * The ease runs unconditionally here for the same reason — the 20% gate exists to stop
 * *content* from twitching the view, and an explicit press is not content.
 */
export const recentreFraming = (state: FramingState, target: Camera): FramingState => ({
  mode: 'auto',
  ease: { from: state.camera, to: target, elapsedSeconds: 0 },
  camera: state.camera,
});

/** Whether an ease is running. The condition for asking for another animation frame. */
export const isEasing = (state: FramingState): boolean => state.ease !== null;
