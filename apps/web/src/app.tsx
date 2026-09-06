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
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';

import { contractById } from './contracts/registry.js';
import { screenTransitionMs, useReducedMotion } from './motion.js';
import { onRouteChange, parseHash, type Route } from './router.js';
import {
  browserStorage,
  clearSave,
  emptySave,
  loadSave,
  medalRank,
  writeSave,
  type LoadOutcome,
  type SaveV1,
  type StoredSettings,
} from './save/index.js';
import { downloadSave } from './save/download.js';
import { SettingsOverlay } from './settings/SettingsOverlay.js';
import { SettingsScreen } from './settings/SettingsScreen.js';
import { SettingsProvider, useSettings } from './settings/context.js';
import { applyDocumentSettings } from './settings/document.js';
import { UnknownContract } from './screens/Briefing.js';
import { ContractScreen } from './screens/ContractScreen.js';
import { NotFound } from './screens/NotFound.js';
import { Placeholder } from './screens/Placeholder.js';
import { SaveNotice } from './screens/SaveNotice.js';
import { StorageNotice, type StorageProblem } from './screens/StorageNotice.js';
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

/**
 * The shell, inside the settings context.
 *
 * Split from {@link App} for one structural reason: a component cannot consume a context
 * it provides. `App` owns the save — which is where the settings live — and this reads
 * them back through the same context every other consumer uses, so there is exactly one
 * path from a stored setting to a rendered value and no shortcut for the shell.
 */
const AppShell = ({
  saved,
  storageProblem,
  onAccept,
  onComplete,
  onExportSave,
  onDismissStorageNotice,
  onReplaceSave,
  onClearSave,
}: AppShellProps): JSX.Element => {
  // Resolve the route during the first render rather than in an effect. Effects
  // run after paint, so deferring this would show a placeholder for a frame on
  // every load — and would make the route unobservable to a synchronous test.
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => onRouteChange(setRoute), []);

  const { settings, keybindings, set, resetAll, setKeybindings } = useSettings();
  const reducedMotion = useReducedMotion(settings['accessibility.reduceMotion']);

  // §9.2's palette and the other three document-level settings, published onto the root
  // element so every rule and every canvas below resolves against the same values
  // (#116, #186). An effect rather than a render-time write because it touches the
  // document outside this tree; the stylesheet already carries the defaults, so the first
  // paint is correct before this runs and this only ever changes it.
  useEffect(() => {
    applyDocumentSettings(document.documentElement, settings);
  }, [settings]);

  /**
   * The screen Settings is showing over — #122's *"returning goes back to where the player
   * was"*.
   *
   * A ref rather than state, and it is the whole mechanism. `Screen` is keyed by
   * `route.path`, so routing to `#/settings` would unmount whatever was mounted and take
   * an uncommitted plan with it. Holding the last non-settings route means `app.tsx` can
   * keep rendering *that* screen, under its own unchanged key, and put the settings dialog
   * over the top: nothing unmounts, so there is no state to preserve.
   *
   * Written in an effect so it lags by exactly one route — during the render in which
   * `route` is settings, this still holds where the player came from. Null on a cold load
   * at `#/settings`, which is the case that renders as an ordinary full screen.
   */
  const cameFrom = useRef<Route | null>(null);
  useEffect(() => {
    if (route.name !== 'settings') cameFrom.current = route;
  }, [route]);

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

  const settingsProps = {
    t,
    settings,
    rebinds: keybindings,
    save: saved.save,
    onSet: set,
    onSetRebinds: setKeybindings,
    onResetAll: resetAll,
    onReplaceSave,
    onClearSave,
  };

  // Settings over a screen, or Settings as a screen. `beneath` is null exactly when there
  // is nothing to go back to.
  const beneath = route.name === 'settings' ? cameFrom.current : null;
  const framed = beneath ?? route;

  return (
    // Keyed by path, so a route change unmounts one screen and mounts the next: that is
    // what re-runs the entry transition and what stops a screen's local state outliving
    // the contract it was opened for. When Settings opens over a screen the key is that
    // screen's and does not change, which is what keeps its state alive.
    <Screen
      key={framed.path}
      name={framed.name}
      heading={headingFor(framed, t)}
      focusHeading={focusHeading}
      transitionMs={screenTransitionMs(reducedMotion)}
      t={t}
    >
      {saved.status === 'problem' ? <SaveNotice t={t} problem={saved.problem} /> : null}
      {storageProblem === null ? null : (
        <StorageNotice
          t={t}
          problem={storageProblem}
          onExport={onExportSave}
          onDismiss={onDismissStorageNotice}
        />
      )}
      {route.name === 'settings' && beneath === null ? (
        <SettingsScreen {...settingsProps} />
      ) : (
        bodyFor(framed, t, saved.save, onAccept, onComplete)
      )}
      {beneath === null ? null : (
        <SettingsOverlay
          {...settingsProps}
          onClose={() => {
            // Back rather than a fixed route: the browser knows where the player came
            // from, and this makes its own Back button and this one agree.
            window.history.back();
          }}
        />
      )}
    </Screen>
  );
};

interface AppShellProps {
  readonly saved: LoadOutcome;
  /** #184: which storage state to report, or null for none and for one dismissed. */
  readonly storageProblem: StorageProblem | null;
  readonly onExportSave: () => void;
  readonly onDismissStorageNotice: () => void;
  readonly onAccept: (id: string) => void;
  readonly onComplete: (id: string, outcome: Outcome, replay: string) => void;
  /** #185's import: the whole save, replaced. */
  readonly onReplaceSave: (save: SaveV1) => void;
  /** #185's "clear all local data". */
  readonly onClearSave: () => void;
}

export const App = (): JSX.Element => {
  // Read once, on the first render rather than in an effect: the briefing needs the
  // attempt count in the markup it first paints, and a save that arrived a frame later
  // would show "attempts: 0" and then correct itself.
  const [saved, setSaved] = useState<LoadOutcome>(() => loadSave(storage));

  /**
   * #184's notice state — which storage problem to report, and whether it was dismissed.
   *
   * `unavailable` is known at load and is true for the whole session. `full` is discovered
   * at a write and is a *change*: saving used to work and has stopped, which is why it has
   * to appear at that moment rather than at the next load.
   *
   * Dismissal is per problem rather than a single boolean, so dismissing the
   * load-time notice does not also suppress a quota failure that happens an hour later —
   * that is a different thing going wrong and the player has not been told about it.
   * Within a problem it stays dismissed for the session: a quota notice that reappeared on
   * every subsequent write would be a modal built out of a banner.
   */
  const [storageProblem, setStorageProblem] = useState<StorageProblem | null>(
    // Derived from the load above rather than by probing again: `loadSave` is already the
    // one place that decides a browser will not store, and asking twice invites the two
    // answers to differ.
    saved.status === 'unavailable' ? 'unavailable' : null,
  );
  const [dismissed, setDismissed] = useState<readonly StorageProblem[]>([]);

  /**
   * Every write goes through here, so a failed one cannot be dropped at a call site.
   *
   * Before #184 each caller called `writeSave` and discarded the outcome — safe, because
   * it never throws, and silent, which was the bug. The write still cannot stop anything:
   * the state update happens either way and the return value only decides whether a notice
   * appears.
   */
  const persist = useCallback((next: SaveV1): void => {
    const outcome = writeSave(storage, next);
    if (outcome.status === 'quotaExceeded') setStorageProblem('full');
    else if (outcome.status === 'unavailable') setStorageProblem('unavailable');
  }, []);

  const acceptContract = (id: string): void => {
    const next = withAttempt(saved.save, id);
    persist(next);
    setSaved({ status: 'loaded', save: next, migrated: false });
  };

  const completeContract = (id: string, outcome: Outcome, replay: string): void => {
    const next = withResult(saved.save, id, outcome, replay);
    if (next === saved.save) return;
    persist(next);
    setSaved({ status: 'loaded', save: next, migrated: false });
  };

  /**
   * A settings change, persisted and applied.
   *
   * Stable across renders (`useCallback`), because the provider memoises its context value
   * on this function: a fresh one every render would rebuild the context every render and
   * re-run every consumer's effects with it, which for the palette means repainting
   * thirteen custom properties on every keystroke in the planner.
   */
  const changeSettings = useCallback(
    (stored: StoredSettings): void => {
      setSaved((current) => {
        const next: SaveV1 = { ...current.save, settings: stored };
        persist(next);
        return { status: 'loaded', save: next, migrated: false };
      });
    },
    [persist],
  );

  /**
   * #185's import. The imported document replaces the save wholesale.
   *
   * Applied to memory first and persisted second, and a failed write is **not** undone:
   * FR-702's rule is that storage failing must not stop the game, and discarding progress
   * the player just restored because the quota is full would be the most destructive
   * possible reading of it. The session keeps it, and #184's notice says it will not
   * survive a reload.
   */
  const replaceSave = useCallback(
    (next: SaveV1): void => {
      persist(next);
      setSaved({ status: 'loaded', save: next, migrated: false });
    },
    [persist],
  );

  /** #185's "clear all local data" — the one key removed, and the game keeps running. */
  const clearAll = useCallback((): void => {
    clearSave(storage);
    setSaved({ status: 'empty', save: emptySave() });
  }, []);

  /**
   * #184's escape hatch, and #185's export, from one place.
   *
   * Reads `saved.save` — the in-memory document — and never storage. That is what makes it
   * work in the state it exists to rescue: a re-read would return nothing, which is the
   * problem being reported.
   */
  const exportNow = useCallback((): void => {
    downloadSave(saved.save);
  }, [saved.save]);

  const showing =
    storageProblem !== null && !dismissed.includes(storageProblem) ? storageProblem : null;

  return (
    <SettingsProvider stored={saved.save.settings} onChange={changeSettings}>
      <AppShell
        saved={saved}
        storageProblem={showing}
        onAccept={acceptContract}
        onComplete={completeContract}
        onExportSave={exportNow}
        onDismissStorageNotice={() => {
          if (storageProblem !== null) setDismissed((current) => [...current, storageProblem]);
        }}
        onReplaceSave={replaceSave}
        onClearSave={clearAll}
      />
    </SettingsProvider>
  );
};
