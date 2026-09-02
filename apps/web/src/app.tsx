/**
 * The application shell.
 *
 * A skeleton: it proves routing works and that the simulation packages import and
 * run in a browser. It is not the game. The real screens are #101 through #109 and
 * arrive in M3; every route below renders a placeholder until then.
 */
import { R_GEO, formatMet, met, MU_EARTH } from '@hh/astro';
import { useEffect, useState } from 'preact/hooks';

import { hrefFor, onRouteChange, parseHash, type Route } from './router.js';

const NAV: readonly (readonly [path: string, label: string])[] = [
  ['/', 'Title'],
  ['/board', 'Contract board'],
  ['/contract/5', 'Contract 05'],
  ['/daily', 'Daily'],
  ['/codex/phasing', 'Codex'],
  ['/settings', 'Settings'],
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

  return (
    <main>
      <h1>Hohmann Heist</h1>
      <p>
        Skeleton build. Routing and the simulation packages are wired; the screens are not built
        yet.
      </p>

      <nav aria-label="Routes">
        <ul>
          {NAV.map(([path, label]) => (
            <li key={path}>
              <a href={hrefFor(path)}>{label}</a>
            </li>
          ))}
        </ul>
      </nav>

      <section aria-labelledby="route-heading">
        <h2 id="route-heading">Current route</h2>
        <dl>
          <dt>name</dt>
          <dd data-testid="route-name">{route.name}</dd>
          <dt>path</dt>
          <dd data-testid="route-path">{route.path}</dd>
          <dt>params</dt>
          <dd data-testid="route-params">{JSON.stringify(route.params)}</dd>
        </dl>
      </section>

      <section aria-labelledby="sim-heading">
        <h2 id="sim-heading">Simulation packages</h2>
        <p>
          Circular speed at geostationary radius:{' '}
          <output data-testid="geo-speed">{geoSpeed().toFixed(2)} m/s</output>
        </p>
        <p>
          Mission clock formatting: <output data-testid="met">{formatMet(met(43784))}</output>
        </p>
      </section>
    </main>
  );
};
