import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { App } from './app.js';
import { SCREEN_TRANSITION_MS, type MotionMediaQuery } from './motion.js';
import { SAVE_KEY, emptySave } from './save/index.js';

let container: HTMLElement;

// `act` flushes Preact's effects and pending state updates, which otherwise run
// after paint and would leave the assertions racing the renderer. It returns a
// thenable even for a synchronous callback, so it is awaited rather than dropped.
const mount = async (): Promise<void> => {
  await act(() => {
    render(<App />, container);
  });
};

/**
 * Change the hash the way a link or the back button does.
 *
 * jsdom does fire `hashchange` for an assignment, but not synchronously, and a test that
 * awaited it would be timing-dependent for no gain: the router listens for the event, so
 * dispatching it is a faithful account of what the browser will do.
 */
const goTo = async (hash: string): Promise<void> => {
  await act(() => {
    window.location.hash = hash;
    window.dispatchEvent(new Event('hashchange'));
  });
};

const el = (testId: string): HTMLElement | null =>
  container.querySelector(`[data-testid="${testId}"]`);

const text = (testId: string): string => el(testId)?.textContent ?? '';

beforeEach(() => {
  window.location.hash = '';
  // The app reads the save on its first render, so a test that left one behind would
  // hand the next one somebody else's attempt count.
  localStorage.removeItem(SAVE_KEY);
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
});

describe('routing', () => {
  /**
   * §8.2's routing table, verbatim.
   *
   * Written out rather than derived from `ROUTES` in `router.ts`, because deriving it
   * would make this test agree with the router by construction — the thing it is meant
   * to check is that the router agrees with the *product definition*. A route deleted
   * from the table would silently delete its own assertion.
   */
  const TABLE: readonly (readonly [hash: string, screen: string])[] = [
    ['', 'title'],
    ['#/', 'title'],
    ['#/board', 'board'],
    ['#/contract/c03-cold-open', 'contract'],
    ['#/daily', 'daily'],
    ['#/daily/2026-09-01', 'dailyDate'],
    ['#/leaderboard/2026-09-01', 'leaderboard'],
    ['#/codex/phasing', 'codex'],
    ['#/replay?s=c03&r=abc', 'replay'],
    ['#/settings', 'settings'],
  ];

  it('resolves every route in §8.2’s table to a screen with a heading', async () => {
    for (const [hash, screen] of TABLE) {
      window.location.hash = hash;
      await mount();
      expect(el('screen')?.dataset['screen'], hash).toBe(screen);
      expect(text('screen-heading').trim(), hash).not.toBe('');
      render(null, container);
    }
  });

  /**
   * §8.3.1: *"the physics ↗ … present on every screen's footer"*.
   *
   * Over the whole table plus the not-found screen, because the failure this catches is a
   * screen that simply never rendered one — and that was the state of the app: the footer
   * was rendered by the title and the board and by nothing else, so ten of the twelve
   * routes had no version anywhere on them. The version is the thing `Footer.tsx` exists
   * for (*"an identifier meant to be copied verbatim into a bug report"*), and the routes
   * that lacked it were the planner and execution — the ones a bug is reported from.
   */
  it("renders §8.3.1's footer, with its version, on every route", async () => {
    for (const [hash] of [...TABLE, ['#/nope'] as const]) {
      window.location.hash = hash;
      await mount();
      expect(el('footer'), hash).not.toBeNull();
      expect(el('footer-physics')?.getAttribute('href'), hash).toContain('docs/PHYSICS.md');
      // §14.4's two numbers: the release on screen, the commit reachable beside it.
      const build = el('footer-version');
      expect(build?.textContent, hash).not.toBe('');
      expect(build?.getAttribute('aria-label'), hash).toContain('commit');
      render(null, container);
    }
  });

  // P3's deep links: no navigation happened, the hash was read at start-up, and the
  // screen the URL named is the one that rendered — with the contract's own content on
  // it, not a shell waiting for a fetch.
  it('resolves a contract deep link from a cold load', async () => {
    window.location.hash = '#/contract/c03-cold-open';
    await mount();
    expect(text('screen-heading')).toBe('Contract 03 — “Cold Open”');
    expect(text('brief')).toContain('KESTREL-2');
  });

  // The Codex screen is #150's; its heading carrying the captured slug is what makes the
  // deep link checkable before the screen that consumes it exists.
  it('resolves a Codex deep link from a cold load', async () => {
    window.location.hash = '#/codex/phasing';
    await mount();
    expect(text('screen-heading')).toContain('phasing');
  });

  it('follows back and forward without a reload', async () => {
    window.location.hash = '#/';
    await mount();
    expect(el('screen')?.dataset['screen']).toBe('title');

    // `#/board` rather than `#/settings`: settings deliberately does *not* replace the
    // screen it was opened from — see the settings block below — so it is the one route
    // that cannot stand in for "any route" here.
    await goTo('#/board');
    expect(el('screen')?.dataset['screen']).toBe('board');

    // Back is a `hashchange` to the previous hash — the same path through the app.
    await goTo('#/');
    expect(el('screen')?.dataset['screen']).toBe('title');
  });

  /**
   * Every route the title offers is a hash route — #117, and the reason the router is
   * hash-based at all (a deep link has to survive a hard refresh on GitHub Pages).
   *
   * This used to assert that the title linked `#/board`. It does not, and that is
   * §8.3.1's decision rather than an omission: *"no menus between a stranger and the
   * game"*, so **Start goes to the briefing** and the board is reached from there. FR-901
   * is the requirement that makes it so, and `TitleScreen.test.tsx` counts the clicks.
   */
  it('renders navigation links as hash hrefs', async () => {
    await mount();
    const hrefs = [...container.querySelectorAll('nav a')].map((a) => a.getAttribute('href'));
    expect(hrefs.length).toBeGreaterThan(0);
    expect(hrefs.every((h) => h?.startsWith('#/'))).toBe(true);
    expect(hrefs.some((h) => h?.startsWith('#/contract/'))).toBe(true);
  });
});

/**
 * §8.3.12's screen, and the one thing about it that is not like the other routes — #122.
 *
 * *"Returning from settings goes back to where the player was, not to the board — a player
 * adjusting the palette mid-plan must not lose their plan."* `Screen` is keyed by route,
 * so routing to `#/settings` the ordinary way would unmount whatever was mounted. It
 * therefore renders **over** the previous screen, which stays mounted underneath.
 */
describe('the settings route', () => {
  it('opens over the screen it was reached from, leaving it mounted', async () => {
    window.location.hash = '#/board';
    await mount();
    expect(el('screen')?.dataset['screen']).toBe('board');

    await goTo('#/settings');
    // The frame is still the board's — that is the assertion. If this ever reads
    // `settings`, the screen underneath was unmounted and an uncommitted plan went with it.
    expect(el('screen')?.dataset['screen']).toBe('board');
    expect(el('settings-overlay')).not.toBeNull();
    expect(el('settings')).not.toBeNull();
  });

  it('renders as an ordinary screen on a cold load, where there is nothing underneath', async () => {
    window.location.hash = '#/settings';
    await mount();
    expect(el('screen')?.dataset['screen']).toBe('settings');
    expect(el('settings-overlay')).toBeNull();
    // The controls are the same ones either way.
    expect(el('settings')).not.toBeNull();
  });

  it('closes back to the screen underneath', async () => {
    window.location.hash = '#/board';
    await mount();
    await goTo('#/settings');
    expect(el('settings-overlay')).not.toBeNull();

    await goTo('#/board');
    expect(el('settings-overlay')).toBeNull();
    expect(el('screen')?.dataset['screen']).toBe('board');
  });

  it('shows all six of §8.3.12s groups', async () => {
    window.location.hash = '#/settings';
    await mount();
    for (const group of ['display', 'accessibility', 'gameplay', 'audio', 'input', 'data']) {
      expect(el(`settings-group-${group}`), group).not.toBeNull();
    }
  });
});

/**
 * §8.5.3's `?` — the help overlay, from anywhere (#124).
 *
 * The handler is the shell's rather than any screen's, which is what "from every screen"
 * means in practice: a per-screen handler is a handler a screen can forget to install.
 */
describe('the keyboard help overlay', () => {
  const press = async (key: string): Promise<void> => {
    await act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    });
  };

  it('opens on ? from a screen that has no keyboard handler of its own', async () => {
    await mount();
    expect(el('help-overlay')).toBeNull();
    await press('?');
    expect(el('help-overlay')).not.toBeNull();
  });

  it('opens on ? from every route in §8.2s table', async () => {
    await mount();
    for (const hash of [
      '#/',
      '#/board',
      '#/daily',
      '#/codex/phasing',
      '#/contract/c03-cold-open',
    ]) {
      await goTo(hash);
      await press('?');
      expect(el('help-overlay'), hash).not.toBeNull();
      await press('Escape');
      expect(el('help-overlay'), hash).toBeNull();
    }
  });

  it('opens from a visible affordance too — the keyboard path is not the only path', async () => {
    await mount();
    const open = el('open-help');
    expect(open).not.toBeNull();
    await act(() => {
      open?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(el('help-overlay')).not.toBeNull();
  });

  it('closes on Esc and on its own button', async () => {
    await mount();
    await press('?');
    await press('Escape');
    expect(el('help-overlay')).toBeNull();

    await press('?');
    await act(() => {
      el('help-close')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(el('help-overlay')).toBeNull();
  });

  it('does not fire while the player is typing', async () => {
    window.location.hash = '#/settings';
    await mount();
    const field = container.querySelector('input[type="text"]');
    expect(field).not.toBeNull();
    await act(() => {
      field?.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }));
    });
    // A handle containing a `?` is a handle, not a request for help.
    expect(el('help-overlay')).toBeNull();
  });

  it('does fire from a checkbox, which is most of the settings screen', async () => {
    window.location.hash = '#/settings';
    await mount();
    const checkbox = container.querySelector('input[type="checkbox"]');
    expect(checkbox).not.toBeNull();
    await act(() => {
      (checkbox as HTMLElement).focus();
      checkbox?.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true }));
    });
    // Found by driving the built app: the planner's typing guard treats every `<input>` as
    // typing, which would have made the overlay unreachable from the one screen a
    // confused player is most likely to be on.
    expect(el('help-overlay')).not.toBeNull();
  });

  it('lists the current scope first once a contract is open', async () => {
    window.location.hash = '#/contract/c03-cold-open';
    await mount();
    await press('?');
    const sections = [...container.querySelectorAll('[data-testid^="help-scope-"]')].map((s) =>
      s.getAttribute('data-testid'),
    );
    // The briefing is showing, so its bindings come first.
    expect(sections[0]).toBe('help-scope-briefing');
  });

  /**
   * #124: *"opening it during execution neither pauses nor advances playback; opening it
   * during planning does not mutate the plan."*
   */
  it('neither pauses nor advances a run, and does not touch a plan', async () => {
    window.location.hash = '#/contract/c03-cold-open';
    await mount();

    await act(() => {
      el('accept')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await press('n');
    const before = text('plan-panel');

    await press('?');
    expect(el('help-overlay')).not.toBeNull();
    // The planner is still mounted underneath and its plan is unchanged.
    expect(el('planner')).not.toBeNull();
    expect(text('plan-panel')).toBe(before);

    await press('Escape');
    expect(text('plan-panel')).toBe(before);
  });
});

describe('an unknown route', () => {
  it('renders a not-found screen rather than a blank one', async () => {
    window.location.hash = '#/nope';
    await mount();
    expect(el('screen')?.dataset['screen']).toBe('notFound');
    expect(text('screen-heading').trim()).not.toBe('');
    expect(text('not-found-path')).toContain('/nope');
  });

  it('offers a way back', async () => {
    window.location.hash = '#/nope';
    await mount();
    expect([...container.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toContain('#/');
  });
});

describe('focus', () => {
  const heading = (): Element | null => el('screen-heading');

  // Nobody has been stranded yet on a cold load, and taking focus off the document's
  // start would move a keyboard user past the browser's own controls for nothing.
  it('is left alone on the first screen', async () => {
    await mount();
    expect(document.activeElement).not.toBe(heading());
  });

  /*
   * `#/daily` and `#/codex/…` rather than `#/board`, which these used to use.
   *
   * The board is now the one route the shell does **not** move focus on: §8.3.2 lands
   * keyboard entry on `NEXT` and the board does that itself, so the shell stands down for
   * it (see `app.tsx`). That makes the board the worst possible example of the general
   * rule, and the block below tests the exception.
   */
  it('moves to the new screen’s heading on a route change', async () => {
    await mount();
    await goTo('#/daily');
    expect(document.activeElement).toBe(heading());
    expect(text('screen-heading').trim()).not.toBe('');
  });

  it('moves again on the next change, not only the first', async () => {
    await mount();
    await goTo('#/daily');
    await goTo('#/codex/phasing');
    expect(document.activeElement).toBe(heading());
    expect(el('screen')?.dataset['screen']).toBe('codex');
  });
});

describe('motion', () => {
  const stubMatchMedia = (matches: boolean): void => {
    const query: MotionMediaQuery = {
      matches,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: () => query,
    });
  };

  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia');
  });

  it('gives a screen change §9.4’s duration', async () => {
    stubMatchMedia(false);
    await mount();
    expect(el('screen')?.style.getPropertyValue('--hh-screen-in-duration')).toBe(
      `${String(SCREEN_TRANSITION_MS)}ms`,
    );
  });

  it('collapses it to zero under prefers-reduced-motion', async () => {
    stubMatchMedia(true);
    await mount();
    expect(el('screen')?.style.getPropertyValue('--hh-screen-in-duration')).toBe('0ms');
  });
});

// The point of this: it proves the workspace packages resolve, bundle and run in a
// browser environment rather than only under Node. `@hh/ui` reaches `@hh/astro` for its
// mission-clock formatter, so a heading that is real text — rather than the `⟦key⟧`
// marker a missing catalogue produces — is that whole chain having worked.
describe('the workspace', () => {
  it('resolves catalogue text through @hh/ui in a browser', async () => {
    window.location.hash = '#/settings';
    await mount();
    const heading = text('screen-heading');
    expect(heading).not.toContain('⟦');
    expect(heading.trim().length).toBeGreaterThan(0);
  });
});

describe('the contract route', () => {
  const CONTRACT = '#/contract/c03-cold-open';

  it('renders the briefing for a contract that ships', async () => {
    window.location.hash = CONTRACT;
    await mount();
    expect(el('screen')?.dataset['screen']).toBe('contract');
    expect(text('brief')).toContain('KESTREL-2');
  });

  // The heading is the contract's own, which is also what makes a deep link's success
  // visible: "Contract 03" could not be rendered without the file having been read.
  it('titles the screen with the contract’s number and name', async () => {
    window.location.hash = CONTRACT;
    await mount();
    expect(text('screen-heading')).toBe('Contract 03 — “Cold Open”');
  });

  it('renders a not-found body for an id that does not ship', async () => {
    window.location.hash = '#/contract/c99-nope';
    await mount();
    expect(text('unknown-contract')).toContain('c99-nope');
    expect(el('brief')).toBeNull();
  });

  // §8.3.3: "straight to the planner; no loading screen". One route, two screens — so
  // accepting is a state change rather than a navigation, and the hash does not move.
  it('goes straight to the planner on ACCEPT, without navigating', async () => {
    window.location.hash = CONTRACT;
    await mount();
    await act(() => {
      el('accept')?.click();
    });
    expect(el('planner')).not.toBeNull();
    expect(el('brief')).toBeNull();
    expect(window.location.hash).toBe(CONTRACT);
  });

  it('accepts on Enter, from wherever the route change left focus', async () => {
    window.location.hash = '#/';
    await mount();
    await goTo(CONTRACT);
    await act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(el('planner')).not.toBeNull();
  });
});

/** The save, read and written through the screen that first has something to record. */
describe('progress', () => {
  const CONTRACT = '#/contract/c03-cold-open';

  it('starts at no best and no attempts', async () => {
    window.location.hash = CONTRACT;
    await mount();
    expect(text('record')).toContain('best: —');
    expect(text('record')).toContain('attempts: 0');
  });

  it('counts an accepted briefing and persists it', async () => {
    window.location.hash = CONTRACT;
    await mount();
    await act(() => {
      el('accept')?.click();
    });

    // Remounting is the honest version of a reload: the app re-reads the save.
    render(null, container);
    await mount();
    expect(text('record')).toContain('attempts: 1');
    expect(localStorage.getItem(SAVE_KEY)).toContain('"attempts":1');
  });
});

describe('a save that cannot be read', () => {
  it('says so, and the game still works', async () => {
    localStorage.setItem(SAVE_KEY, 'mangled');
    window.location.hash = '#/contract/c03-cold-open';
    await mount();

    expect(text('save-notice')).toContain('Nothing has been overwritten');
    // Still playable, with an empty save behind it (FR-702).
    expect(text('brief')).toContain('KESTREL-2');
    expect(text('record')).toContain('attempts: 0');
    // And still there — the game did not repair itself over the top of it.
    expect(localStorage.getItem(SAVE_KEY)).toBe('mangled');
  });

  it('names the version when a newer build wrote it', async () => {
    localStorage.setItem(SAVE_KEY, '{"v":9,"contracts":{}}');
    await mount();
    expect(text('save-notice')).toContain('newer version');
  });

  it('says nothing when there is nothing wrong', async () => {
    await mount();
    expect(el('save-notice')).toBeNull();
  });
});

/**
 * §8.3.3's direct-URL guard — #119.
 *
 * > *locked (unreachable by UI; direct-URL access shows the unlock rule)*
 *
 * The board renders no link to a locked card, so this is the *only* way to reach one. It
 * is an app-level test rather than a component one because the guard lives in the router's
 * body switch, and what it proves is that the guard and the board read the same
 * `progression()` result — a second rule here is exactly what §6.8 forbids.
 */
describe('a locked contract reached by its URL', () => {
  it('shows the unlock rule instead of the briefing', async () => {
    // Act II is locked on an empty save: Act I has four contracts, so §6.8's ⌈2/3⌉ wants
    // three Bronzes and there are none.
    window.location.hash = '#/contract/c05-tailgate';
    await mount();

    expect(el('locked-contract')).not.toBeNull();
    // Not the briefing, and — the part that matters — not the contract's title either.
    expect(el('brief')).toBeNull();
    expect(text('screen')).not.toContain('Tailgate');
  });

  it('opens it once the act is unlocked', async () => {
    // Built from `emptySave()` rather than hand-written: §11.7's document has required
    // `daily` and `flags` blocks, and a fixture missing them is *unreadable* rather than
    // empty — which would have made this test pass for the wrong reason.
    const save = emptySave();
    localStorage.setItem(
      SAVE_KEY,
      JSON.stringify({
        ...save,
        contracts: Object.fromEntries(
          ['c01-shakedown', 'c02-round-trip', 'c03-cold-open'].map((id) => [
            id,
            { attempts: 1, medal: 'bronze', firstCompletedAt: '2026-09-14T18:22:11Z' },
          ]),
        ),
      }),
    );

    window.location.hash = '#/contract/c05-tailgate';
    await mount();

    expect(el('locked-contract')).toBeNull();
    expect(el('brief')).not.toBeNull();
  });

  it('leaves an unlocked contract alone', async () => {
    window.location.hash = '#/contract/c01-shakedown';
    await mount();
    expect(el('locked-contract')).toBeNull();
    expect(el('brief')).not.toBeNull();
  });
});

/**
 * §8.7's replay rows, on the route that carries the code — #125.
 *
 * `/#/replay?s=…&r=…` is §11.6's share URL, and the code is its whole payload. The viewer
 * itself is M6; what M3 owes is that a code which cannot be read says so, and says which
 * of the two reasons applies.
 */
describe('the replay route', () => {
  it('renders the placeholder when no code is offered', async () => {
    // A bare `#/replay` is not a failure — it is the route the viewer will own. Calling an
    // empty address malformed would be inventing a problem.
    window.location.hash = '#/replay';
    await mount();
    expect(el('replay-problem')).toBeNull();
    expect(el('placeholder-notice')).not.toBeNull();
  });

  it('reports a malformed code', async () => {
    window.location.hash = '#/replay?s=c03-cold-open&r=not-a-code';
    await mount();
    expect(el('replay-problem')?.dataset['kind']).toBe('invalid');
  });

  it('names the mismatch for a code from a newer schema', async () => {
    const future = encodeURIComponent(
      JSON.stringify({ v: 99, s: 'c03-cold-open', e: 1, n: [], a: 0, c: { dv: 0, t: 0 } }),
    );
    window.location.hash = `#/replay?s=c03-cold-open&r=${future}`;
    await mount();

    const problem = el('replay-problem');
    expect(problem?.dataset['kind']).toBe('futureVersion');
    expect(problem?.textContent).toContain('99');
  });
});

/**
 * §8.3.1's *Continue*, at the level where its inputs are real — #118.
 *
 * `TitleScreen.test.tsx` checks the entry renders from the props it is given. This checks
 * the props, which is where the bug was: `progression().next` is C01 on a *completely
 * empty* save — correctly, since it is the first unstarted unlocked contract — so a title
 * that took `next` as its only condition offered Continue to a first-time player, pointing
 * at the same contract Start did. Found in the browser, and this is the test that would
 * have found it first.
 */
describe('Continue on the title screen', () => {
  const withProgress = (contracts: Record<string, unknown>): void => {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ ...emptySave(), contracts }));
  };

  it('is absent on a fresh save, even though NEXT is C01', async () => {
    window.location.hash = '#/';
    await mount();

    expect(el('title-start')).not.toBeNull();
    expect(el('title-continue')).toBeNull();
  });

  /**
   * Accepted-and-abandoned counts as progress, and `NEXT` moves past it.
   *
   * *"Unstarted is stronger than unfinished: a contract the player has attempted and not
   * beaten is not where the board should be pointing them, because they already know where
   * it is."* — `progression.ts`. So an attempt on C01 both **enables** Continue and sends
   * it to C02, and those are two different facts about the same record: `attempts` is what
   * makes there be something to resume, and `next` is where resuming goes.
   */
  it('appears once a contract has been accepted', async () => {
    withProgress({ 'c01-shakedown': { attempts: 1 } });
    window.location.hash = '#/';
    await mount();

    expect(el('title-continue')).not.toBeNull();
    expect(el('title-continue')?.getAttribute('href')).toBe('#/contract/c02-round-trip');
  });

  it('follows NEXT past a contract that is finished', async () => {
    withProgress({
      'c01-shakedown': { attempts: 2, medal: 'gold', firstCompletedAt: '2026-09-14T18:22:11Z' },
    });
    window.location.hash = '#/';
    await mount();

    expect(el('title-continue')?.getAttribute('href')).toBe('#/contract/c02-round-trip');
  });

  it('is absent again once every unlocked contract is Bronzed', async () => {
    withProgress(
      Object.fromEntries(
        [
          'c01-shakedown',
          'c02-round-trip',
          'c03-cold-open',
          'c04-long-haul',
          'c05-tailgate',
          'c06-overtake',
          'c07-slot-machine',
        ].map((id) => [
          id,
          { attempts: 1, medal: 'bronze', firstCompletedAt: '2026-09-14T18:22:11Z' },
        ]),
      ),
    );
    window.location.hash = '#/';
    await mount();

    expect(el('title-continue')).toBeNull();
    // Start is still there: a finished campaign is still replayable from the top.
    expect(el('title-start')).not.toBeNull();
  });
});

/**
 * §8.7's first-load skeleton comes down when the app goes up — #125.
 *
 * `render(vnode, parent)` diffs against whatever is already in `parent` rather than
 * clearing it, so the skeleton survived the mount and left a second, dead "Hohmann Heist"
 * at the bottom of every screen — visible, and in the accessibility tree. Found in the
 * browser; asserted here.
 */
describe('the first-load skeleton', () => {
  it('is gone once the application has mounted', async () => {
    // `main.tsx` owns the removal, so this reproduces the shape it runs against: a mount
    // point that already contains the skeleton.
    const skeleton = document.createElement('div');
    skeleton.id = 'hh-boot';
    container.append(skeleton);

    document.getElementById('hh-boot')?.remove();
    await mount();

    expect(document.getElementById('hh-boot')).toBeNull();
    expect(container.querySelectorAll('[data-testid="screen-heading"]')).toHaveLength(1);
  });
});

/**
 * §8.3.2's entry focus, *through the shell* — #119, #117.
 *
 * `BoardScreen.test.tsx` mounts the board on its own, where nothing can override it. This
 * mounts the whole app, which is where the bug was: `Screen` moves focus to the `<h1>` on
 * every route change (#117) and Preact runs child effects before parent ones, so the
 * board's focus was set and then immediately overridden — and the board opened with focus
 * on its heading. Only reproducible with the shell above it, and only found by driving the
 * running app.
 */
describe('arriving at the board', () => {
  it('lands keyboard focus on NEXT, not on the heading', async () => {
    window.location.hash = '#/';
    await mount();
    await goTo('#/board');

    const next = container.querySelector('[data-next="true"] a');
    expect(next).not.toBeNull();
    expect(document.activeElement).toBe(next);
  });

  it('lands on NEXT on a cold load too', async () => {
    window.location.hash = '#/board';
    await mount();

    expect(document.activeElement).toBe(container.querySelector('[data-next="true"] a'));
  });

  /** Every other route keeps #117's behaviour — the shell only stands down for the board. */
  it('still moves focus to the heading on other routes', async () => {
    window.location.hash = '#/';
    await mount();
    await goTo('#/settings');

    expect(el('screen-heading')).not.toBeNull();
    expect(document.activeElement).not.toBe(container.querySelector('[data-next="true"] a'));
  });
});
