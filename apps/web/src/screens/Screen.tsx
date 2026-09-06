/**
 * The frame every screen renders inside — §8.2, §8.8, §9.4.
 *
 * One component, so that the two things #117 asks for on *every* route change happen
 * once rather than being remembered nine times:
 *
 * - **Focus moves to the new screen's heading.** Changing the hash replaces the whole
 *   document body but leaves focus where it was — on a link that no longer exists, which
 *   the browser resolves by dropping focus to `<body>`. A keyboard user is then at the
 *   top of a page with no idea it changed, and a screen-reader user hears nothing at all.
 *   Moving focus to the new `<h1>` announces the screen and puts the next Tab in the
 *   right place.
 * - **The entry transition respects `prefers-reduced-motion`.** §9.4 gives a screen
 *   change 160 ms of ease-out cross-fade and then says it becomes 0 ms under the
 *   preference. The duration arrives as a prop rather than being read here, so the
 *   decision is made in one place (`motion.ts`) for every animated thing in the game.
 *
 * ## The heading is the focus target, not a wrapper
 *
 * `tabIndex={-1}` makes the heading programmatically focusable without adding it to the
 * tab order — the standard treatment for a "you are now here" target. Focus lands on the
 * element whose text names the screen, so what a screen reader announces is the screen's
 * name. Focusing the `<main>` instead would announce the entire screen's contents, and
 * focusing a wrapper `<div>` would announce nothing.
 *
 * The focus ring is deliberately left alone. §8.8: *"Visible focus ring, never
 * suppressed"* — a heading that has been focused should look focused, including for
 * someone who arrived there with a pointer and wonders why the outline appeared.
 *
 * ## Why the caller keys this by route
 *
 * `app.tsx` renders `<Screen key={route.path}>`, so a route change unmounts one screen
 * and mounts another rather than re-rendering one in place. That is what makes the entry
 * animation re-run, and it is also what makes a screen's local state — the briefing's
 * accepted flag, later a planner's selection — belong to the contract it was opened for
 * rather than leaking into the next one.
 */
import type { Catalogue } from '@hh/ui';
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

/**
 * The heading's id, shared by the skip link and by every screen.
 *
 * One id rather than one per screen because only one `Screen` is mounted at a time — the
 * router keys this component by route — so it cannot collide with itself, and a stable
 * fragment means `#content` works the same way on every screen.
 */
const HEADING_ID = 'hh-content';

export interface ScreenProps {
  /** Machine name of the screen, for styling hooks and tests. Never rendered. */
  readonly name: string;
  /** The screen's `<h1>`, already resolved from the catalogue. */
  readonly heading: string;
  /**
   * Whether to move focus to the heading once mounted.
   *
   * False for the app's very first screen: there is no previous screen to have stranded
   * anyone on, and stealing focus on load moves a keyboard user past the browser's own
   * starting point for no reason.
   */
  readonly focusHeading: boolean;
  /** §9.4's screen-change duration, already collapsed to 0 under reduced motion. */
  readonly transitionMs: number;
  /** For §8.8's skip link. The one string this shell renders of its own. */
  readonly t: Catalogue['resolve'];
  readonly children?: ComponentChildren;
}

export const Screen = ({
  name,
  heading,
  focusHeading,
  transitionMs,
  t,
  children,
}: ScreenProps): JSX.Element => {
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  // Mount is the route change: the caller keys this component by route, so this effect
  // runs exactly once per screen. Empty deps rather than `[heading]` for that reason —
  // a screen that changes its own heading (the briefing does not, but the debrief will)
  // should not yank focus back.
  useEffect(() => {
    if (focusHeading) headingRef.current?.focus();
  }, []);

  return (
    <>
      {/*
        §8.8's skip-to-content link (#141).
        
        First in the DOM and visible only on focus, which is the whole point: a keyboard
        user tabbing into a screen should reach the content without walking the HUD, and a
        pointer user should never see a link they cannot use. It targets the heading rather
        than the `<main>` because the heading is already focusable — `Screen` gives it
        `tabIndex={-1}` so a route change can move focus there — so the skip link and the
        route change land in the same place, and a player who uses both does not learn two
        different "top of the screen"s.
      */}
      <a class="hh-skip-link" href={`#${HEADING_ID}`} data-testid="skip-to-content">
        {t('app.skipToContent', {})}
      </a>
      <main
        class="hh-screen"
        data-screen={name}
        data-testid="screen"
        style={`--hh-screen-in-duration:${String(transitionMs)}ms`}
      >
        <h1
          class="hh-screen__heading"
          id={HEADING_ID}
          tabIndex={-1}
          ref={headingRef}
          data-testid="screen-heading"
        >
          {heading}
        </h1>
        {children}
      </main>
    </>
  );
};
