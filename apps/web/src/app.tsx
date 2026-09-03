/**
 * The application shell.
 *
 * A skeleton: it proves routing works and that the simulation packages import and
 * run in a browser. It is not the game. The real screens are #101 through #109 and
 * arrive in M3; every route below renders a placeholder until then.
 *
 * ## Every string here comes from the catalogue
 *
 * NFR-028's ESLint rule refuses literal text in JSX, and this file is the first thing
 * it was pointed at. What was placeholder prose is now catalogue keys resolved through
 * `@hh/ui` — not because a skeleton needs translating, but because the rule has to be
 * true of the codebase on the day it lands, and a rule with an exemption for "the parts
 * that were already here" is a rule nobody trusts.
 *
 * The one place this shows in the markup is the split between a label and its value:
 * `app.geoSpeedLabel` is a sentence and `app.geoSpeedValue` is a quantity formatted with
 * its unit by `Intl`. They are two elements — a label and an `<output>` — rather than
 * one string with a hole in it, because that is what they are in the DOM.
 */
import { R_GEO, formatMet, met, MU_EARTH } from '@hh/astro';
import { createCatalogue } from '@hh/ui';
import { useEffect, useState } from 'preact/hooks';

import { hrefFor, onRouteChange, parseHash, type Route } from './router.js';
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

const NAV: readonly (readonly [path: string, label: string])[] = [
  ['/', t('nav.title', {})],
  ['/board', t('nav.board', {})],
  ['/contract/5', t('nav.contract', { index: 5 })],
  ['/daily', t('nav.daily', {})],
  ['/codex/phasing', t('nav.codex', {})],
  ['/settings', t('nav.settings', {})],
  ['/spike', t('nav.spike', {})],
];

/**
 * A live number computed by the simulation packages.
 *
 * Circular orbital speed at geostationary radius. This exists to prove the
 * workspace wiring end to end in a real browser rather than only under Node — if
 * `@hh/astro` failed to resolve or its float64 arithmetic behaved oddly once
 * bundled, this is where it would show.
 */
const geoSpeed = (): number => Math.sqrt(MU_EARTH / R_GEO);

export const App = (): preact.JSX.Element => {
  // Resolve the route during the first render rather than in an effect. Effects
  // run after paint, so deferring this would show a placeholder for a frame on
  // every load — and would make the route unobservable to a synchronous test.
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => onRouteChange(setRoute), []);

  // The one hook the spike has into the app. Deleting `src/spike/` and these two lines
  // removes it completely — #238 asks for a page nothing inherits from.
  if (route.name === 'spike') return <SpikePage />;

  return (
    <main>
      <h1>{t('app.title', {})}</h1>
      <p>{t('app.skeletonNotice', {})}</p>

      <nav aria-label={t('app.routesLabel', {})}>
        <ul>
          {NAV.map(([path, label]) => (
            <li key={path}>
              <a href={hrefFor(path)}>{label}</a>
            </li>
          ))}
        </ul>
      </nav>

      <section aria-labelledby="route-heading">
        <h2 id="route-heading">{t('app.currentRouteHeading', {})}</h2>
        <dl>
          <dt>{t('app.routeName', {})}</dt>
          <dd data-testid="route-name">{route.name}</dd>
          <dt>{t('app.routePath', {})}</dt>
          <dd data-testid="route-path">{route.path}</dd>
          <dt>{t('app.routeParams', {})}</dt>
          <dd data-testid="route-params">{JSON.stringify(route.params)}</dd>
        </dl>
      </section>

      <section aria-labelledby="sim-heading">
        <h2 id="sim-heading">{t('app.simulationHeading', {})}</h2>
        <p>
          {t('app.geoSpeedLabel', {})}{' '}
          <output data-testid="geo-speed">
            {t('app.geoSpeedValue', { speedMps: geoSpeed() })}
          </output>
        </p>
        <p>
          {t('app.missionClockLabel', {})}{' '}
          <output data-testid="met">{formatMet(met(43784))}</output>
        </p>
      </section>
    </main>
  );
};
