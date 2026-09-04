import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { App } from './app.js';
import { SCREEN_TRANSITION_MS, type MotionMediaQuery } from './motion.js';

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

  // P3's deep links. The heading carries the captured segment, which is what makes
  // "resolved from a cold load" observable before the screen that consumes it exists.
  it('resolves a deep link from a cold load', async () => {
    window.location.hash = '#/contract/c03-cold-open';
    await mount();
    expect(text('screen-heading')).toContain('c03-cold-open');
  });

  it('resolves a Codex deep link from a cold load', async () => {
    window.location.hash = '#/codex/phasing';
    await mount();
    expect(text('screen-heading')).toContain('phasing');
  });

  it('follows back and forward without a reload', async () => {
    window.location.hash = '#/';
    await mount();
    expect(el('screen')?.dataset['screen']).toBe('title');

    await goTo('#/settings');
    expect(el('screen')?.dataset['screen']).toBe('settings');

    // Back is a `hashchange` to the previous hash — the same path through the app.
    await goTo('#/');
    expect(el('screen')?.dataset['screen']).toBe('title');
  });

  it('renders navigation links as hash hrefs', async () => {
    await mount();
    const hrefs = [...container.querySelectorAll('nav a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('#/board');
    expect(hrefs.every((h) => h?.startsWith('#/'))).toBe(true);
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

  it('moves to the new screen’s heading on a route change', async () => {
    await mount();
    await goTo('#/settings');
    expect(document.activeElement).toBe(heading());
    expect(text('screen-heading').trim()).not.toBe('');
  });

  it('moves again on the next change, not only the first', async () => {
    await mount();
    await goTo('#/settings');
    await goTo('#/board');
    expect(document.activeElement).toBe(heading());
    expect(el('screen')?.dataset['screen']).toBe('board');
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
