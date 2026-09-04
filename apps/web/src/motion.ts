/**
 * `prefers-reduced-motion` — §9.4, §8.8, FR-908.
 *
 * §9.4 gives every transition in the game a duration and then says all of them become
 * 0 ms under `prefers-reduced-motion`, except the debrief's medal reveal. This module is
 * where the app learns the preference; the durations themselves live beside the thing
 * they animate.
 *
 * ## Why the platform is a parameter
 *
 * `matchMedia` is the only way to read the preference, and it is a *live* query rather
 * than a one-off read — someone toggling the setting in their OS while the game is open
 * should see the animations stop, not see them stop on the next reload. So this
 * subscribes.
 *
 * The host is an argument with `window` as its default, following
 * `packages/render/src/resize.ts`: a structural interface naming exactly the two members
 * used means a test drives both branches with a plain object, rather than depending on
 * whether the test environment's `matchMedia` is a real implementation or a stub that
 * answers `false` to everything. jsdom's is the latter, and a test that can only observe
 * `false` would leave the reduced branch — the one that matters — unexercised.
 *
 * ## Why the media query is also written in CSS
 *
 * `app.css` carries the same query, and that is deliberate duplication rather than an
 * oversight. The CSS applies before the first script runs and keeps applying if this
 * module is ever unmounted; the JavaScript exists because §8.3.12 makes "reduce motion"
 * a *setting* as well as a system preference, and a setting has to be able to override
 * the system one in both directions. Until that setting lands (#169) the two agree.
 */

import { useEffect, useState } from 'preact/hooks';

/** The part of `MediaQueryList` this module uses. */
export interface MotionMediaQuery {
  readonly matches: boolean;
  addEventListener(type: 'change', listener: () => void): void;
  removeEventListener(type: 'change', listener: () => void): void;
}

/** The part of the platform this module needs, named so a test can supply it. */
export interface MotionHost {
  matchMedia(query: string): MotionMediaQuery;
}

/** The query §8.8 names. */
export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** §9.4: a screen change cross-fades over 160 ms, ease-out. */
export const SCREEN_TRANSITION_MS = 160;

/**
 * How long a screen change takes, given the preference.
 *
 * A function rather than a conditional at the call site, because §9.4's "all of the
 * above become 0 ms" is a rule about the whole table and this is the first row of it —
 * the camera re-frame and the panel expand follow, and they should collapse through the
 * same statement rather than three separate ternaries.
 */
export const screenTransitionMs = (reducedMotion: boolean): number =>
  reducedMotion ? 0 : SCREEN_TRANSITION_MS;

/** Whether the host reports the preference right now. `false` if it cannot be asked. */
export const prefersReducedMotion = (host: MotionHost): boolean => {
  // A host without `matchMedia` is not a browser this game supports (§11.15), but
  // reading the preference must never be the thing that breaks the page: the failure
  // mode of guessing wrong here is an animation, and the failure mode of throwing is a
  // blank screen.
  if (typeof host.matchMedia !== 'function') return false;
  return host.matchMedia(REDUCED_MOTION_QUERY).matches;
};

/**
 * Subscribe to the preference.
 *
 * Fires immediately with the current value, then on every change, so a caller never has
 * to read it separately. Returns an unsubscribe function.
 */
export const observeReducedMotion = (
  onChange: (reducedMotion: boolean) => void,
  host: MotionHost,
): (() => void) => {
  if (typeof host.matchMedia !== 'function') {
    onChange(false);
    return () => undefined;
  }

  const query = host.matchMedia(REDUCED_MOTION_QUERY);
  const emit = (): void => {
    onChange(query.matches);
  };
  query.addEventListener('change', emit);
  emit();
  return () => {
    query.removeEventListener('change', emit);
  };
};

/**
 * The preference, as a value a component can render from.
 *
 * The host defaults to `window` here rather than in {@link observeReducedMotion}, so
 * that the module's plain functions stay free of any ambient global and only the hook —
 * which already assumes a browser, because it assumes a renderer — reaches for one.
 */
export const useReducedMotion = (host: MotionHost = window): boolean => {
  const [reduced, setReduced] = useState(() => prefersReducedMotion(host));
  useEffect(() => observeReducedMotion(setReduced, host), [host]);
  return reduced;
};
