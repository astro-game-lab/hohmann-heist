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
 * the system one in both directions.
 *
 * ## Three states, not two
 *
 * That override is why {@link MotionPreference} has three values rather than being a
 * boolean. §8.3.12's control is "reduce motion", and a player has to be able to say
 * **on** despite a system that does not ask for it — a laptop whose OS setting they
 * cannot change, a shared machine — and **off** despite one that does, because a
 * preference set once for an operating system is not consent for every page in it.
 *
 * A boolean can only express the second of those, and only by lying about which of the
 * two sources it came from. So the resolution is a function of both, in one place, and
 * every consumer reads its result rather than asking `matchMedia` itself.
 *
 * The stored value is #186's, and the control that sets it is #122's. Until they land the
 * preference is always `system` and this resolves exactly as it did before — which is why
 * this can ship ahead of them rather than waiting.
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

/** What §8.3.12's "reduce motion" control can be set to. */
export type MotionPreference = 'system' | 'on' | 'off';

/** The value before anyone has chosen: follow the operating system. */
export const DEFAULT_MOTION_PREFERENCE: MotionPreference = 'system';

/**
 * Whether motion is reduced, given the setting and what the system asks for.
 *
 * The whole of the three-state rule, in one expression, so that no component has to
 * remember which way round the override goes.
 */
export const resolveReducedMotion = (
  preference: MotionPreference,
  systemPrefersReduced: boolean,
): boolean => {
  switch (preference) {
    case 'on':
      return true;
    case 'off':
      return false;
    case 'system':
      return systemPrefersReduced;
  }
};

/** §9.4: a screen change cross-fades over 160 ms, ease-out. */
export const SCREEN_TRANSITION_MS = 160;

/**
 * §9.4: a panel expands or collapses over 120 ms, ease-out.
 *
 * **Nothing in the application expands yet.** The assist tray is the row's first consumer
 * and it becomes collapsible with #140; the node editor is anchored rather than disclosed,
 * and FR-406's precision reveal toggles `display`, which cannot be transitioned.
 *
 * The rule is stated here anyway, with its collapse and its test, because §9.4's table is
 * what this module exists to be — and because the alternative is #140 inventing a second
 * duration for the same row. What is deliberately *not* here is a matching CSS custom
 * property: a token no rule reads is dead weight in every byte the stylesheet ships, and
 * unlike a documented constant it cannot be found by looking for its callers.
 */
export const PANEL_TRANSITION_MS = 120;

/**
 * §9.4: the medal reveal takes 600 ms — *"one deliberate flourish, the only one in the
 * game"*.
 *
 * It is also the one row of §9.4's table that does **not** become 0 ms under reduced
 * motion. §9.4 says it *"becomes a cross-fade"* instead, and the distinction is the
 * point: every other animation in the game is a transition between two states a player
 * can already see, so removing it costs nothing. The medal reveal is the game's only
 * moment of ceremony, and deleting it outright would take away a signal rather than an
 * ornament. A cross-fade keeps the beat without the movement.
 */
export const MEDAL_REVEAL_MS = 600;

/** The cross-fade §9.4 substitutes for the reveal under reduced motion. */
export const MEDAL_CROSSFADE_MS = 200;

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

/** §9.4's panel row, collapsing the same way. */
export const panelTransitionMs = (reducedMotion: boolean): number =>
  reducedMotion ? 0 : PANEL_TRANSITION_MS;

/**
 * §9.4's medal reveal — the one row that shortens rather than vanishing.
 *
 * Returned as a duration *and* a kind, because the two differ in more than length: the
 * reveal scales and the cross-fade does not, and a component given only a number would
 * have to decide that for itself, which is where the two would drift.
 */
export const medalReveal = (
  reducedMotion: boolean,
): { readonly ms: number; readonly kind: 'reveal' | 'crossfade' } =>
  reducedMotion
    ? { ms: MEDAL_CROSSFADE_MS, kind: 'crossfade' }
    : { ms: MEDAL_REVEAL_MS, kind: 'reveal' };

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
export const useReducedMotion = (
  preference: MotionPreference = DEFAULT_MOTION_PREFERENCE,
  host: MotionHost = window,
): boolean => {
  const [systemReduced, setSystemReduced] = useState(() => prefersReducedMotion(host));
  useEffect(() => observeReducedMotion(setSystemReduced, host), [host]);
  return resolveReducedMotion(preference, systemReduced);
};
