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
import type { Outcome } from '@hh/game';
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import { contractById } from './contracts/registry.js';
import { screenTransitionMs, useReducedMotion } from './motion.js';
import { onRouteChange, parseHash, type Route } from './router.js';
import {
  browserStorage,
  loadSave,
  medalRank,
  writeSave,
  type LoadOutcome,
  type SaveV1,
} from './save/index.js';
import { UnknownContract } from './screens/Briefing.js';
import { ContractScreen } from './screens/ContractScreen.js';
import { NotFound } from './screens/NotFound.js';
import { Placeholder } from './screens/Placeholder.js';
import { SaveNotice } from './screens/SaveNotice.js';
import { Screen } from './screens/Screen.js';
import { ScenePage } from './scene-harness/ScenePage.js';

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
  ['/contract/c03-cold-open', t('nav.contract', { index: 3 })],
  ['/daily', t('nav.daily', {})],
  ['/codex/phasing', t('nav.codex', {})],
  ['/settings', t('nav.settings', {})],
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
    case 'contract': {
      // The contract's own number and title once it is known, and the raw id when it is
      // not — a heading that said "Contract" over a not-found body would be worse than
      // one that quotes the link that failed.
      const id = param(route, 'id');
      const scenario = contractById(id);
      return scenario === undefined
        ? resolve('screen.contract.heading', { id })
        : resolve('briefing.heading', {
            index: scenario.document.index,
            title: scenario.document.title,
          });
    }
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

/**
 * The storage the save lives in, decided once.
 *
 * Module scope rather than a hook: `browserStorage` probes with a real write, and there
 * is nothing to gain from repeating that per mount. `null` here is a browser that will
 * not store — the game runs anyway (FR-702).
 */
const storage = browserStorage();

/** What goes under the heading. */
const bodyFor = (
  route: Route,
  resolve: Catalogue['resolve'],
  save: SaveV1,
  onAccept: (id: string) => void,
  onComplete: (id: string, outcome: Outcome, replay: string) => void,
): JSX.Element => {
  switch (route.name) {
    case 'notFound':
      return <NotFound t={resolve} path={route.path} />;
    case 'title':
      return <Placeholder t={resolve} links={NAV} />;
    case 'contract': {
      const id = param(route, 'id');
      const scenario = contractById(id);
      if (scenario === undefined) return <UnknownContract t={resolve} id={id} />;
      const progress = save.contracts[id];
      return (
        <ContractScreen
          t={resolve}
          resolveDynamic={catalogue.resolveDynamic}
          scenario={scenario}
          {...(progress === undefined ? {} : { progress })}
          onAccept={() => {
            onAccept(id);
          }}
          onComplete={(outcome, replay) => {
            onComplete(id, outcome, replay);
          }}
        />
      );
    }
    default:
      return <Placeholder t={resolve} />;
  }
};

/**
 * The save, with one attempt counted.
 *
 * A pure function of the save it was given, so the write and the state update below are
 * the only effects and both take the same value. §11.7 counts an attempt per *accepted
 * briefing*, which is this moment and not the debrief: a plan abandoned halfway was still
 * an attempt at the contract.
 */
const withAttempt = (save: SaveV1, id: string): SaveV1 => {
  const previous = save.contracts[id];
  return {
    ...save,
    contracts: {
      ...save.contracts,
      [id]: { ...previous, attempts: (previous?.attempts ?? 0) + 1 },
    },
  };
};

/**
 * The save, with a completed run recorded — FR-302, §11.7.
 *
 * > *The system MUST record, per contract: best medal, best Δv, best time, burn count,
 * > attempt count, and the best run's replay code.*
 *
 * **Best, not last.** Every field here improves or stays; a worse second run does not
 * overwrite a better first one, and the medal follows §6.7's *"cumulative — earning Gold
 * does not remove Bronze"*. That is why the medal is compared by rank rather than
 * assigned, and why `bestReplay` moves with the Δv rather than with the most recent run:
 * a replay code that did not achieve the recorded best would fail its own verification
 * (§11.11).
 *
 * A failed run records nothing but the attempt it already counted. There is no result to
 * be the best of, and writing a `bestDv_mps` for a run that missed would make the debrief
 * compare against a number nobody achieved.
 *
 * `firstCompletedAt` is the one wall-clock read in this file, and it is a timestamp for
 * the player rather than an input to anything — §11.4's ban is on the simulation, and
 * this is a diary entry.
 */
const withResult = (save: SaveV1, id: string, outcome: Outcome, replay: string): SaveV1 => {
  const previous = save.contracts[id];
  if (!outcome.success || outcome.metSeconds === null) return save;

  const improved = previous?.bestDv_mps === undefined || outcome.dvUsedMps < previous.bestDv_mps;
  const medal =
    medalRank(outcome.medal ?? undefined) > medalRank(previous?.medal)
      ? (outcome.medal ?? previous?.medal)
      : previous?.medal;

  return {
    ...save,
    contracts: {
      ...save.contracts,
      [id]: {
        ...previous,
        attempts: previous?.attempts ?? 1,
        ...(medal === undefined ? {} : { medal }),
        ...(improved
          ? {
              bestDv_mps: outcome.dvUsedMps,
              bestTime_s: outcome.metSeconds,
              burns: outcome.burns,
              bestReplay: replay,
            }
          : {}),
        firstCompletedAt: previous?.firstCompletedAt ?? new Date().toISOString(),
      },
    },
  };
};

export const App = (): JSX.Element => {
  // Resolve the route during the first render rather than in an effect. Effects
  // run after paint, so deferring this would show a placeholder for a frame on
  // every load — and would make the route unobservable to a synchronous test.
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => onRouteChange(setRoute), []);

  const reducedMotion = useReducedMotion();

  // Read once, on the first render rather than in an effect: the briefing needs the
  // attempt count in the markup it first paints, and a save that arrived a frame later
  // would show "attempts: 0" and then correct itself.
  const [saved, setSaved] = useState<LoadOutcome>(() => loadSave(storage));

  const acceptContract = (id: string): void => {
    const next = withAttempt(saved.save, id);
    // A write that fails is not the player's problem right now — they are on their way to
    // the planner. #167 owns the notice; what matters here is that it cannot throw.
    writeSave(storage, next);
    setSaved({ status: 'loaded', save: next, migrated: false });
  };

  const completeContract = (id: string, outcome: Outcome, replay: string): void => {
    const next = withResult(saved.save, id, outcome, replay);
    if (next === saved.save) return;
    writeSave(storage, next);
    setSaved({ status: 'loaded', save: next, migrated: false });
  };

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

  // The orbit-scene harness, the one throwaway development instrument left. It does not
  // render inside the screen frame, because it is not a screen. The M1 spike that sat
  // beside it went with this PR: the planner is the thing it was measuring the
  // feasibility of, so keeping a page that drags a node at 60 fps next to one that
  // actually plans a mission would be keeping the prototype after the product.
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
      {saved.status === 'problem' ? <SaveNotice t={t} problem={saved.problem} /> : null}
      {bodyFor(route, t, saved.save, acceptContract, completeContract)}
    </Screen>
  );
};
