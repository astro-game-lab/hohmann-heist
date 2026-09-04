/**
 * Hash routing.
 *
 * **Hash, not history.** The site is static on GitHub Pages, where a deep link to
 * `/contract/5` would 404 on a hard refresh because there is no server to rewrite
 * it. Everything after the `#` never reaches the server, so every route survives a
 * reload, a bookmark, and a shared link.
 *
 * Hand-rolled rather than taken from a package: the whole router is below, the
 * route table is nine entries, and the initial bundle has a 400 kB budget to
 * defend (NFR-020).
 *
 * Route table follows `docs/PRODUCT.md` §8.2.
 */

/** A parsed route. `params` holds the named segments the pattern captured. */
export interface Route {
  readonly name: RouteName;
  readonly params: Readonly<Record<string, string>>;
  readonly path: string;
}

export type RouteName =
  | 'title'
  | 'board'
  | 'contract'
  | 'daily'
  | 'dailyDate'
  | 'leaderboard'
  | 'codex'
  | 'replay'
  | 'settings'
  | 'scene'
  | 'notFound';

/**
 * Patterns, in match order. A `:name` segment captures one path segment.
 *
 * Order matters: `/daily/:date` must be tried before `/daily`, or the more general
 * pattern would swallow the specific one.
 */
const ROUTES: readonly (readonly [pattern: string, name: RouteName])[] = [
  ['', 'title'],
  ['/', 'title'],
  ['/board', 'board'],
  ['/contract/:id', 'contract'],
  ['/daily/:date', 'dailyDate'],
  ['/daily', 'daily'],
  ['/leaderboard/:date', 'leaderboard'],
  ['/codex/:slug', 'codex'],
  ['/replay', 'replay'],
  ['/settings', 'settings'],
  // The orbit-scene harness (M2 PR 3). Also throwaway: it exists so §9.3 can be looked
  // at before the planner screen exists, and goes the same way.
  ['/scene', 'scene'],
];

const segmentsOf = (path: string): string[] =>
  path.split('/').filter((segment) => segment.length > 0);

const matchPattern = (
  pattern: string,
  path: string,
): Readonly<Record<string, string>> | undefined => {
  const patternSegments = segmentsOf(pattern);
  const pathSegments = segmentsOf(path);
  if (patternSegments.length !== pathSegments.length) return undefined;

  const params: Record<string, string> = {};
  for (const [i, expected] of patternSegments.entries()) {
    const actual = pathSegments[i] ?? '';
    if (expected.startsWith(':')) {
      params[expected.slice(1)] = decodeURIComponent(actual);
    } else if (expected !== actual) {
      return undefined;
    }
  }
  return params;
};

/**
 * Parse a location hash into a route.
 *
 * Accepts the hash with or without its leading `#`, and with or without the `/`
 * that follows it, so `#/board`, `#board` and `/board` all resolve the same way.
 * An unrecognised path resolves to `notFound` rather than throwing — a bad URL is
 * a thing to render, not a crash.
 */
export const parseHash = (hash: string): Route => {
  const withoutHash = hash.startsWith('#') ? hash.slice(1) : hash;
  const query = withoutHash.indexOf('?');
  const path = query === -1 ? withoutHash : withoutHash.slice(0, query);

  for (const [pattern, name] of ROUTES) {
    const params = matchPattern(pattern, path);
    if (params !== undefined) return { name, params, path };
  }
  return { name: 'notFound', params: {}, path };
};

/** Build a hash for a route, for use in an `href`. */
export const hrefFor = (path: string): string => `#${path.startsWith('/') ? path : `/${path}`}`;

/**
 * Subscribe to route changes.
 *
 * Fires immediately with the current route so a caller never has to read the
 * location itself, then on every `hashchange`. Returns an unsubscribe function.
 */
export const onRouteChange = (handler: (route: Route) => void): (() => void) => {
  const emit = (): void => {
    handler(parseHash(window.location.hash));
  };
  window.addEventListener('hashchange', emit);
  emit();
  return () => {
    window.removeEventListener('hashchange', emit);
  };
};

/**
 * Go to a route.
 *
 * Assigning to `location.hash` rather than calling `history.pushState` is what keeps
 * back and forward working for free: a hash assignment pushes a history entry and fires
 * `hashchange`, which is the event {@link onRouteChange} is already listening for, so
 * programmatic navigation and a clicked `<a href="#/…">` take exactly the same path
 * through the app. `pushState` fires nothing and would need every caller to notify the
 * router itself — two ways to navigate, one of which silently does not update the URL.
 *
 * Assigning the same hash twice is a no-op in every browser: no history entry, no event.
 * That is the desired behaviour rather than a quirk to work around — ACCEPT pressed
 * twice should not put a second copy of the planner in the back stack.
 */
export const navigate = (path: string): void => {
  window.location.hash = hrefFor(path);
};
