/**
 * The application shell — §8.2.
 *
 * Its whole job is to turn a hash into a screen. `router.ts` decides *which* route a hash
 * names; this decides what that route renders, and `Screen` handles the two things that
 * must happen on every change regardless of which screen it is (focus, motion).
 *
 * ## Every route resolves, including the ones nobody has built
 *
 * §8.2's table has nine routes and the Codex's index makes ten. M3 builds the title
 * (#118), the board (#119), the briefing, the planner, the execution phase, the debrief,
 * settings and the Codex (#161); the daily, the leaderboard and the replay *viewer* are
 * M6–M7 and render `Placeholder` inside the real frame rather than being absent from the
 * switch, because #117's first criterion is that every route in the table *resolves* — and
 * a route that falls through to not-found cannot be told apart from a typo by the person
 * looking at it.
 *
 * ## Everything below is wrapped in an error boundary
 *
 * #125. An unhandled throw in any screen renders a recoverable state naming what failed,
 * rather than unmounting the tree and leaving an empty document. It sits inside `Screen`,
 * so a failure keeps the heading, the skip link and the footer — the frame is the part
 * most likely to still be sound, and it is what carries the route back out.
 *
 * ## Every string here comes from the catalogue
 *
 * NFR-028's ESLint rule refuses literal text in JSX, and this file is the first thing
 * it was pointed at. Screens take `t` as a prop rather than importing the catalogue
 * themselves, so the locale is decided in exactly one place and a component can be
 * rendered against a different message set in a test without touching a global.
 */
import { createCatalogue, entryBySlug, type Catalogue } from '@hh/ui';
import type { PaletteId } from '@hh/ui';
import { progression, type LockReason, type ProgressionContract } from '@hh/game';
import type { Outcome } from '@hh/game';
import type { JSX } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';

import { contractById, contracts } from './contracts/registry.js';
import { screenTransitionMs, useReducedMotion } from './motion.js';
import { navigate, onRouteChange, parseHash, type Route } from './router.js';
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
import { HelpOverlay } from './help/HelpOverlay.js';
import { actionFor, isTextEntryTarget, type Screen as KeyScope } from './planner/keys.js';
import { KeyboardScopeProvider } from './planner/scope.js';
import { downloadSave } from './save/download.js';
import { SettingsOverlay } from './settings/SettingsOverlay.js';
import { SettingsScreen } from './settings/SettingsScreen.js';
import { SettingsProvider, useSettings } from './settings/context.js';
import { applyDocumentSettings } from './settings/document.js';
import { UnknownContract } from './screens/Briefing.js';
import { BoardScreen } from './board/BoardScreen.js';
import { CanvasUnavailable } from './screens/CanvasUnavailable.js';
import { ContractScreen } from './screens/ContractScreen.js';
import { ErrorBoundary } from './screens/ErrorBoundary.js';
import { LockedContract } from './screens/LockedContract.js';
import { NotFound } from './screens/NotFound.js';
import { Placeholder } from './screens/Placeholder.js';
import { CodexOverlay } from './codex/CodexOverlay.js';
import { CodexScreen } from './codex/CodexScreen.js';
import { conceptFor } from './codex/current.js';
import { ReplayProblem } from './screens/ReplayProblem.js';
import { TitleScreen } from './title/TitleScreen.js';
import { diagnoseReplay } from './replay/diagnose.js';
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

/** A captured route parameter. Absent is empty rather than `undefined` — it is text. */
const param = (route: Route, name: string): string => route.params[name] ?? '';

/**
 * The contract a route is inside, or `null`.
 *
 * One route covers all four contract screens — §8.2 puts the briefing, the planner, the
 * execution phase and the debrief under `/contract/:id`, with §8.5.1's phase deciding
 * which is drawn. So "which contract is the player in" is a question about the route and
 * not about the screen, which is what lets `C` answer it from the shell.
 */
const contractIdOf = (route: Route | null): string | null =>
  route !== null && route.name === 'contract' ? param(route, 'id') : null;

/**
 * §6.8's progression, computed once from the contracts the registry actually ships.
 *
 * The **one** call. The title's *Continue*, the board's locks and `NEXT`, and the
 * direct-URL guard below all read this result, which is what makes it impossible for the
 * three of them to disagree about whether a contract is open — see `progression.ts` and
 * §8.3.3.
 */
const progressionFor = (save: SaveV1) => {
  const shipped = contracts();
  const asContracts: readonly ProgressionContract[] = shipped.map((scenario) => ({
    id: scenario.id,
    act: scenario.document.act,
    index: scenario.document.index,
  }));
  return progression(asContracts, save.contracts);
};

/**
 * The screen's `<h1>`.
 *
 * A switch rather than a lookup table keyed by route name, because the catalogue's
 * `resolve` checks each key against its own parameter type — which is the property worth
 * having here, since half of these headings carry a captured segment and half take none.
 * A `Record<RouteName, MessageKey>` would type-check the *names* and lose that.
 */
const headingFor = (route: Route, resolve: Catalogue['resolve'], save: SaveV1): string => {
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
      if (scenario === undefined) return resolve('screen.contract.heading', { id });

      // A **locked** contract's title stays hidden here too. §8.3.2 keeps it off the card
      // to preserve the reveal, and a heading that printed it over the unlock rule would
      // give away by the back door exactly what the card is careful not to say. The
      // number is fine — the board shows that much — so this falls back to the neutral
      // heading, which quotes the id rather than the name.
      if (progressionFor(save).locks[id] !== undefined) {
        return resolve('screen.contract.heading', { id });
      }

      return resolve('briefing.heading', {
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
    case 'codexIndex':
      return resolve('codex.heading', {});
    case 'codex': {
      // The entry's own title once the slug names one, and the slug itself when it does
      // not. Same rule as the contract heading above, and for the same reason: a heading
      // that said "Codex" over §8.7's named failure would hide the thing that failed.
      const slug = param(route, 'slug');
      const entry = entryBySlug(slug);
      return entry === undefined
        ? resolve('screen.codex.heading', { slug })
        : resolve(entry.titleKey, {});
    }
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

/** What `bodyFor` needs beyond the route. Grown past a positional list. */
interface BodyContext {
  readonly resolve: Catalogue['resolve'];
  readonly save: SaveV1;
  readonly palette: PaletteId;
  /** §9.4 and §8.3.12 together: whether decorative motion is allowed. */
  readonly still: boolean;
  readonly canvasUnavailable: boolean;
  readonly onCanvasUnavailable: () => void;
  readonly onAccept: (id: string) => void;
  readonly onComplete: (id: string, outcome: Outcome, replay: string) => void;
  /** `flags.codexRead`, and the way to add to it — #161. */
  readonly onCodexRead: (slug: string) => void;
  /** `flags.coachMarksSeen`'s writer — FR-902's permanent dismissal (#159). */
  readonly onCoachMarkSeen: (key: string) => void;
  /** Open the Codex over the planner, without unmounting it. See `CodexOverlay`. */
  readonly onOpenCodex: (slug: string) => void;
}

/** §8.7's replay rows, for `/#/replay?s=…&r=…`. */
const replayBody = (route: Route, resolve: Catalogue['resolve']): JSX.Element => {
  const code = new URLSearchParams(route.search).get('r');
  // No code at all is not a failure — it is the bare route, which the viewer (M6) will
  // own. A failure state here would call an empty address malformed.
  if (code === null || code === '') return <Placeholder t={resolve} />;

  const diagnosis = diagnoseReplay(code);
  if (diagnosis.kind === 'ok') return <Placeholder t={resolve} />;
  return (
    <ReplayProblem
      t={resolve}
      problem={
        diagnosis.kind === 'futureVersion'
          ? { kind: 'futureVersion', found: diagnosis.found, supported: diagnosis.supported }
          : { kind: 'invalid' }
      }
    />
  );
};

/** What goes under the heading. */
const bodyFor = (route: Route, context: BodyContext): JSX.Element => {
  const { resolve, save } = context;

  switch (route.name) {
    case 'notFound':
      return <NotFound t={resolve} path={route.path} />;
    case 'title': {
      const state = progressionFor(save);

      /*
       * §8.3.1: *"Continue appears only with saved progress."*
       *
       * **Two conditions, not one.** `next` alone is not enough, and assuming it was is a
       * bug the browser caught: on a completely fresh save `progression().next` is C01 —
       * correctly, because it is the first unstarted unlocked contract — so the title
       * offered *Continue* to a first-time player, pointing at the same contract Start
       * did. Two entries, one destination, and one of them promising progress that does
       * not exist.
       *
       * So the entry needs something to *resume*: at least one contract the player has
       * touched. `attempts` is the marker, since §11.7 counts one per accepted briefing —
       * a contract opened and abandoned is still somewhere to go back to.
       *
       * `next` is still the destination, and still the only one (#82). It is null again
       * once every unlocked contract is Bronzed, and the entry is absent for that too.
       */
      const hasProgress = Object.values(save.contracts).some((record) => record.attempts > 0);
      const continueId = hasProgress ? state.next : null;
      const act = continueId === null ? null : (contractById(continueId)?.document.act ?? null);
      return (
        <>
          {context.canvasUnavailable ? <CanvasUnavailable t={resolve} /> : null}
          <TitleScreen
            t={resolve}
            resolveDynamic={catalogue.resolveDynamic}
            continueId={continueId}
            continueAct={act}
            palette={context.palette}
            still={context.still}
            onCanvasUnavailable={context.onCanvasUnavailable}
          />
        </>
      );
    }
    case 'board':
      return (
        <BoardScreen
          t={resolve}
          resolveDynamic={catalogue.resolveDynamic}
          records={save.contracts}
        />
      );
    case 'replay':
      return replayBody(route, resolve);
    case 'codexIndex':
    case 'codex':
      return (
        <CodexScreen
          t={resolve}
          slug={route.name === 'codex' ? param(route, 'slug') : null}
          search={route.search}
          read={save.flags.codexRead}
          onRead={context.onCodexRead}
        />
      );
    case 'contract': {
      const id = param(route, 'id');
      const scenario = contractById(id);
      if (scenario === undefined) return <UnknownContract t={resolve} id={id} />;

      // §8.3.3: *"locked (unreachable by UI; direct-URL access shows the unlock rule)"*.
      // The same `progression` result the board renders from, so the two cannot disagree.
      const lock: LockReason | undefined = progressionFor(save).locks[id];
      if (lock !== undefined) return <LockedContract t={resolve} lock={lock} />;

      const progress = save.contracts[id];
      return (
        <ContractScreen
          t={resolve}
          resolveDynamic={catalogue.resolveDynamic}
          scenario={scenario}
          {...(progress === undefined ? {} : { progress })}
          onAccept={() => {
            context.onAccept(id);
          }}
          onComplete={(outcome, replay) => {
            context.onComplete(id, outcome, replay);
          }}
          coachMarksSeen={save.flags.coachMarksSeen}
          onCoachMarkSeen={context.onCoachMarkSeen}
          onOpenCodex={context.onOpenCodex}
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
  onCodexRead,
  onCoachMarkSeen,
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

  const palette = settings['accessibility.palette'];

  /**
   * Whether decorative motion is allowed — §9.4, §8.8, §8.3.12.
   *
   * Two independent reasons to stop, and either is sufficient: §8.8 says the title
   * background stops under `prefers-reduced-motion`, and §8.3.12's `backgroundAnimation`
   * is a separate control for a player who wants the animation off without declaring a
   * motion sensitivity to their operating system. This is that setting's first consumer.
   */
  const still = reducedMotion || !settings['accessibility.backgroundAnimation'];

  /**
   * §8.7's canvas-unavailable row (#125), reported upward by whatever tried to draw.
   *
   * Latched rather than re-probed: a browser that refused a 2-D context once will refuse
   * the next one, and re-asking per screen would mean the notice appearing and vanishing
   * as the player moved around. It stays for the session.
   */
  const [canvasUnavailable, setCanvasUnavailable] = useState(false);
  const reportCanvasUnavailable = useCallback(() => {
    setCanvasUnavailable(true);
  }, []);

  /**
   * §8.5.3's `?` — the help overlay (#124).
   *
   * The handler lives here rather than on any screen, for the reason `?` is scoped to
   * *everywhere*: the overlay is not a planner feature, and a screen that had to install
   * it would be a screen that could forget. The two screens that do handle keys return on
   * the `help` action before their own `preventDefault`, so opening the overlay during a
   * run neither pauses playback nor advances it and opening it while planning does not
   * touch the plan.
   *
   * The scope is reported upward by whichever screen is showing — see `planner/scope.ts`.
   * `?` resolves on every scope, so it is only the overlay's section order that depends on
   * it; `'briefing'` is a safe stand-in for resolution when there is no contract open.
   */
  // The current route, for the document-level key handler below. That listener is
  // reinstalled only when the bindings or the scope change, so it must not close over a
  // route — this ref is how it reads the live one. Written during render rather than in an
  // effect because the handler can fire before effects have run after a hash change.
  const routeRef = useRef<Route>(route);
  routeRef.current = route;

  const [scope, setScope] = useState<KeyScope | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  /**
   * §8.5.3's `C` — the Codex for the current concept (#161).
   *
   * Held here for the same reason `?` is: the binding is scoped to *everywhere*, so no
   * screen owns it and a screen that installed it could forget to. What it opens is an
   * **overlay** rather than a navigation — `CodexOverlay` says why at length, and the short
   * version is that routing away from the planner would unmount the plan.
   *
   * Off a contract there is no current concept, so `C` navigates to the index instead:
   * `conceptFor` returns null and there is nothing to put in an overlay.
   */
  const [codexSlug, setCodexSlug] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // `isTextEntryTarget`, not `isTypingTarget`: most of the settings screen is
      // checkboxes and radios, and treating those as typing would make the overlay
      // unreachable from the screen a confused player is most likely to be on. Typing `?`
      // into the handle field still does not open it.
      if (isTextEntryTarget(event.target)) return;
      const action = actionFor(
        scope ?? 'briefing',
        event.key,
        { shift: event.shiftKey, ctrl: event.ctrlKey },
        keybindings,
      );
      if (action?.kind === 'help') {
        event.preventDefault();
        setHelpOpen((open) => !open);
        return;
      }

      if (action?.kind !== 'codex') return;
      event.preventDefault();
      setCodexSlug((current) => {
        if (current !== null) return null;
        // `routeRef` rather than `route`: this effect is keyed on the bindings and the
        // scope, not on the route, so closing over the route would open the concept for
        // whichever screen was showing when the listener was last installed.
        const concept = conceptFor(contractIdOf(routeRef.current));
        if (concept === null) navigate('/codex');
        return concept;
      });
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [keybindings, scope]);

  const scopeApi = useMemo(() => ({ scope, setScope }), [scope]);

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

  /**
   * Whether the shell moves focus to the heading on this route change.
   *
   * Everywhere except the board. §8.3.2 lands keyboard entry on `NEXT`, so the board moves
   * focus itself — and without standing down here the two fight and the shell wins, because
   * Preact runs child effects before parent ones and the shell's is the parent's. The board
   * opened with focus on its heading as a result.
   *
   * Found by driving the running app, not by reading the code: under jsdom the board's own
   * test mounts it directly, with no shell above it to be overridden by. `BoardScreen`
   * carries the rest of the reasoning, including what it focuses when there is no next
   * contract to land on.
   */
  const shellMovesFocus = focusHeading && framed.name !== 'board';

  return (
    <KeyboardScopeProvider value={scopeApi}>
      {/* Keyed by path, so a route change unmounts one screen and mounts the next: that is
        what re-runs the entry transition and what stops a screen's local state outliving
        the contract it was opened for. When Settings opens over a screen the key is that
        screen's and does not change, which is what keeps its state alive. */}
      <Screen
        key={framed.path}
        name={framed.name}
        heading={headingFor(framed, t, saved.save)}
        focusHeading={shellMovesFocus}
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
        {/*
          #125's boundary, inside the frame rather than around it. A screen that throws
          keeps its heading, its skip link and the route back — the frame is the part most
          likely to still be sound, and wrapping the whole `Screen` would take the escape
          hatch down with the failure. Keyed by path so navigating away clears it.
        */}
        <ErrorBoundary t={t} resetKey={framed.path}>
          {route.name === 'settings' && beneath === null ? (
            <SettingsScreen {...settingsProps} />
          ) : (
            bodyFor(framed, {
              resolve: t,
              save: saved.save,
              palette,
              still,
              canvasUnavailable,
              onCanvasUnavailable: reportCanvasUnavailable,
              onAccept,
              onComplete,
              onCodexRead,
              onCoachMarkSeen,
              onOpenCodex: setCodexSlug,
            })
          )}
        </ErrorBoundary>
        {/*
        §8.5.3's `?` needs a pointer route too — the keyboard-only path cannot be the only
        path (#124). One affordance in the shell rather than one per screen, for the same
        reason the handler is here.
      */}
        <button
          type="button"
          class="hh-help-affordance"
          data-testid="open-help"
          onClick={() => {
            setHelpOpen(true);
          }}
        >
          {t('help.open', {})}
        </button>
        {helpOpen ? (
          <HelpOverlay
            t={t}
            rebinds={keybindings}
            scope={scope}
            onClose={() => {
              setHelpOpen(false);
            }}
          />
        ) : null}
        {codexSlug === null ? null : (
          <CodexOverlay
            t={t}
            slug={codexSlug}
            onRead={onCodexRead}
            onClose={() => {
              setCodexSlug(null);
            }}
          />
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
    </KeyboardScopeProvider>
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
  /** #161's `flags.codexRead`. */
  readonly onCodexRead: (slug: string) => void;
  /** FR-902's permanent dismissal — `flags.coachMarksSeen` (#159). */
  readonly onCoachMarkSeen: (key: string) => void;
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
   * FR-902's permanent dismissal, and #161's read marker.
   *
   * One function, because they are the same operation on two sibling arrays: append a
   * string to a set that is stored as a list, and do nothing if it is already there. Two
   * copies of "read, check, append, persist, set state" would be two chances to forget the
   * idempotence, and the idempotence is what stops a save growing a duplicate every time a
   * player reopens an entry.
   *
   * Sorted on the way in. The arrays are sets and their order carries no meaning, so
   * leaving it as insertion order would make two saves with identical progress differ
   * byte-for-byte on export — which `transfer.ts`'s canonical form exists to prevent.
   */
  const addFlag = useCallback(
    (field: 'coachMarksSeen' | 'codexRead', value: string): void => {
      setSaved((current) => {
        if (current.save.flags[field].includes(value)) return current;
        const next: SaveV1 = {
          ...current.save,
          flags: {
            ...current.save.flags,
            [field]: [...current.save.flags[field], value].sort(),
          },
        };
        persist(next);
        return { status: 'loaded', save: next, migrated: false };
      });
    },
    [persist],
  );

  const markCodexRead = useCallback(
    (slug: string): void => {
      addFlag('codexRead', slug);
    },
    [addFlag],
  );

  const markCoachMarkSeen = useCallback(
    (key: string): void => {
      addFlag('coachMarksSeen', key);
    },
    [addFlag],
  );

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
        onCodexRead={markCodexRead}
        onCoachMarkSeen={markCoachMarkSeen}
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
