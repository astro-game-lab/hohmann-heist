/**
 * The application shell — §8.2.
 *
 * Its whole job is to turn a hash into a screen. `router.ts` decides *which* route a hash
 * names; this decides what that route renders, and `Screen` handles the two things that
 * must happen on every change regardless of which screen it is (focus, motion).
 *
 * ## Every route resolves, including the ones nobody has built
 *
 * §8.2's table has nine routes and M2 builds two of them. The rest render
 * `Placeholder` inside the real frame rather than being absent from the switch, because
 * #117's first criterion is that every route in the table *resolves* — and a route that
 * falls through to not-found cannot be told apart from a typo by the person looking at
 * it. Each placeholder still shows its own heading and its own captured parameters, which
 * is what makes "deep links to a contract and to a Codex entry work from a cold load"
 * checkable before either screen exists.
 *
 * ## Every string here comes from the catalogue
 *
 * NFR-028's ESLint rule refuses literal text in JSX, and this file is the first thing
 * it was pointed at. Screens take `t` as a prop rather than importing the catalogue
 * themselves, so the locale is decided in exactly one place and a component can be
 * rendered against a different message set in a test without touching a global.
 */
import { createCatalogue, type Catalogue } from '@hh/ui';
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import { screenTransitionMs, useReducedMotion } from './motion.js';
import { onRouteChange, parseHash, type Route } from './router.js';
import { NotFound } from './screens/NotFound.js';
import { Placeholder } from './screens/Placeholder.js';
import { Screen } from './screens/Screen.js';
import { ScenePage } from './scene-harness/ScenePage.js';
import { SpikePage } from './spike/SpikePage.js';

/**
 * The catalogue, and the one place the missing-key policy is decided.
 *
 * `@hh/ui` takes the policy as a parameter rather than reading a bundler global, so the
 * package stays plain TypeScript that runs under Node. Reading `import.meta.env.DEV` is
 * this layer's job: `apps/web` is the composition point (§11.2), and it is the only
 * thing here that knows it was built by Vite.
 *
 * A missing key therefore throws in `pnpm dev` and renders `⟦some.key⟧` in production —
 * loud where someone is watching, visible and stable where they are not, and never a
 * blank space.
 */
const catalogue = createCatalogue({
  onMissingKey: import.meta.env.DEV ? 'throw' : 'fallback',
});
const t = catalogue.resolve;

/**
 * Links offered from the title route.
 *
 * Temporary. §8.2 routes the player title → board → briefing, and neither the title
 * screen (#101) nor the board (#102) exists; until they do this is the only way to reach
 * a route without typing its hash, and it goes with them.
 */
const NAV: readonly (readonly [path: string, label: string])[] = [
  ['/board', t('nav.board', {})],
  ['/contract/5', t('nav.contract', { index: 5 })],
  ['/daily', t('nav.daily', {})],
  ['/codex/phasing', t('nav.codex', {})],
  ['/settings', t('nav.settings', {})],
  ['/spike', t('nav.spike', {})],
];

/** A captured route parameter. Absent is empty rather than `undefined` — it is text. */
const param = (route: Route, name: string): string => route.params[name] ?? '';

/**
 * The screen's `<h1>`.
 *
 * A switch rather than a lookup table keyed by route name, because the catalogue's
 * `resolve` checks each key against its own parameter type — which is the property worth
 * having here, since half of these headings carry a captured segment and half take none.
 * A `Record<RouteName, MessageKey>` would type-check the *names* and lose that.
 */
const headingFor = (route: Route, resolve: Catalogue['resolve']): string => {
  switch (route.name) {
    case 'title':
      return resolve('app.title', {});
    case 'board':
      return resolve('screen.board.heading', {});
    case 'contract':
      return resolve('screen.contract.heading', { id: param(route, 'id') });
    case 'daily':
      return resolve('screen.daily.heading', {});
    case 'dailyDate':
      return resolve('screen.dailyDate.heading', { date: param(route, 'date') });
    case 'leaderboard':
      return resolve('screen.leaderboard.heading', { date: param(route, 'date') });
    case 'codex':
      return resolve('screen.codex.heading', { slug: param(route, 'slug') });
    case 'replay':
      return resolve('screen.replay.heading', {});
    case 'settings':
      return resolve('screen.settings.heading', {});
    default:
      return resolve('screen.notFound.heading', {});
  }
};

/** What goes under the heading. */
const bodyFor = (route: Route, resolve: Catalogue['resolve']): JSX.Element => {
  switch (route.name) {
    case 'notFound':
      return <NotFound t={resolve} path={route.path} />;
    case 'title':
      return <Placeholder t={resolve} links={NAV} />;
    default:
      return <Placeholder t={resolve} />;
  }
};

export const App = (): JSX.Element => {
  // Resolve the route during the first render rather than in an effect. Effects
  // run after paint, so deferring this would show a placeholder for a frame on
  // every load — and would make the route unobservable to a synchronous test.
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => onRouteChange(setRoute), []);

  const reducedMotion = useReducedMotion();

  // Focus moves to the new screen's heading on every route change *except the first*.
  // On a cold load there is no previous screen to have stranded anyone on, and taking
  // focus off the document's start would move a keyboard user past the browser's own
  // controls for nothing. This ref is the whole distinction: false while the first
  // render is in flight, true from the effect that follows it onward.
  const rendered = useRef(false);
  const focusHeading = rendered.current;
  useEffect(() => {
    rendered.current = true;
  });

  // The two throwaway development instruments. Deleting `src/spike/` or
  // `src/scene-harness/` and its line here removes it completely — neither renders
  // inside the screen frame, because neither is a screen.
  if (route.name === 'spike') return <SpikePage />;
  if (route.name === 'scene') return <ScenePage />;

  return (
    // Keyed by path, so a route change unmounts one screen and mounts the next: that is
    // what re-runs the entry transition and what stops a screen's local state outliving
    // the contract it was opened for.
    <Screen
      key={route.path}
      name={route.name}
      heading={headingFor(route, t)}
      focusHeading={focusHeading}
      transitionMs={screenTransitionMs(reducedMotion)}
    >
      {bodyFor(route, t)}
    </Screen>
  );
};
