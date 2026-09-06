/**
 * #184's player-facing half, driven through the whole application.
 *
 * `storage.failure.test.ts` proves nothing throws. This proves the thing that actually
 * matters to a player in Safari with cookies blocked: **the game works, and they are
 * told.** FR-702's *"MUST remain fully playable when storage is unavailable, with a
 * non-blocking notice"* has two halves and the first one is the one that was silently
 * true and never checked.
 *
 * ## Why this is its own file
 *
 * `app.tsx` probes storage **once, at module scope** — `browserStorage()` performs a real
 * write, and repeating that per mount would be pointless. That makes the probe's answer a
 * property of the module rather than of the test, so the only honest way to test the
 * unavailable path is to stub the platform *before* the module is imported and reset the
 * registry between cases. Sharing a file with `app.test.tsx` would mean one of the two
 * suites running against the wrong storage.
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SAVE_KEY } from './save/index.js';

/**
 * Longer than the default, and it is a build cost rather than a slow test.
 *
 * Every case here calls `vi.resetModules()` and re-imports `app.js`, which makes Vite
 * re-transform the whole application graph — the planner, the renderer, `@hh/game` and
 * everything under it. Alone that takes a few hundred milliseconds; inside the full suite,
 * competing with a dozen other files for the same cores, the first one has occasionally
 * crossed five seconds. The work is real and finite, so the answer is room rather than a
 * retry.
 */
vi.setConfig({ testTimeout: 30_000 });

let container: HTMLElement;

/** A `DOMException`-shaped quota refusal. */
const quotaError = (): Error => {
  const error = new Error('quota');
  error.name = 'QuotaExceededError';
  Object.defineProperty(error, 'code', { value: 22 });
  return error;
};

/**
 * Replace `localStorage` for the next import of `app.js`.
 *
 * `writes: 'throw'` is the quota case — reads work, writes refuse — and `'absent'` is
 * Safari with cookies blocked, where touching the property throws before any method is
 * called. That is why `browserStorage` probes inside a try/catch rather than checking that
 * the object exists, and it is the case this reproduces.
 */
const stubStorage = (mode: 'absent' | 'quota'): void => {
  if (mode === 'absent') {
    vi.stubGlobal('localStorage', undefined);
    return;
  }
  const contents = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => contents.get(key) ?? null,
    setItem: (key: string, value: string) => {
      // The probe `browserStorage` writes must succeed, or this would be the unavailable
      // case rather than the quota one — a quota that refuses everything is a browser that
      // will not store, and the two get different words on purpose.
      if (key === SAVE_KEY) throw quotaError();
      contents.set(key, value);
    },
    removeItem: (key: string) => contents.delete(key),
  });
};

/** Import a fresh `app.js` against whatever storage is currently stubbed. */
const freshApp = async (): Promise<() => preact.JSX.Element> => {
  vi.resetModules();
  const module = await import('./app.js');
  return module.App;
};

const el = (testId: string): HTMLElement | null =>
  container.querySelector(`[data-testid="${testId}"]`);

const click = async (testId: string): Promise<void> => {
  const target = el(testId);
  if (target === null) throw new Error(`no element with data-testid="${testId}"`);
  await act(() => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
};

const press = async (key: string): Promise<void> => {
  await act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
};

beforeEach(() => {
  window.location.hash = '';
  container = document.createElement('div');
  document.body.append(container);
  // The export affordance builds an object URL, and jsdom implements neither method.
  // Patched onto the real `URL` rather than replacing the global: `new URL(...)` is used
  // elsewhere in the app, and a stub object has no constructor. The download path's own
  // behaviour is asserted in `download.test.ts` against a recording host; here it only has
  // to not explode.
  const url = URL as unknown as Record<string, unknown>;
  url['createObjectURL'] = () => 'blob:test';
  url['revokeObjectURL'] = () => undefined;
});

afterEach(() => {
  render(null, container);
  container.remove();
  const url = URL as unknown as Record<string, unknown>;
  delete url['createObjectURL'];
  delete url['revokeObjectURL'];
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('a browser that will not store', () => {
  const mountUnavailable = async (hash = ''): Promise<void> => {
    stubStorage('absent');
    const App = await freshApp();
    window.location.hash = hash;
    await act(() => {
      render(<App />, container);
    });
  };

  it('shows a non-blocking notice on first load', async () => {
    await mountUnavailable();
    const notice = el('storage-notice');
    expect(notice).not.toBeNull();
    expect(notice?.dataset['problem']).toBe('unavailable');
    // §8.6 and #183's precedent: polite, not assertive. Nothing is waiting on it, and an
    // alert would interrupt whatever the screen reader was saying about the screen.
    expect(notice?.getAttribute('role')).toBe('status');
    expect(notice?.getAttribute('aria-modal')).toBeNull();
  });

  it('does not block anything — the screen is fully rendered and interactive', async () => {
    await mountUnavailable();
    expect(el('screen')).not.toBeNull();
    expect(el('placeholder-notice')).not.toBeNull();
    // Nothing is trapping focus, and the notice is not covering the screen.
    expect(document.activeElement).not.toBe(el('storage-notice'));
  });

  /**
   * #184's first criterion, end to end.
   *
   * A contract accepted, planned, committed, flown and debriefed, with every write to
   * storage failing throughout. Every one of those steps calls through `app.tsx`'s persist
   * path, so a write that threw rather than returning an outcome would end the run here.
   */
  it('plays a contract from briefing to debrief', async () => {
    await mountUnavailable('#/contract/c03-cold-open');

    await click('accept');
    expect(el('planner')).not.toBeNull();

    await press('n');
    const commit = el('commit');
    // The plan is legal for this contract with one burn at the scrub head; if the content
    // ever changes so that it is not, this stops asserting rather than failing falsely.
    if (commit === null || (commit as HTMLButtonElement).disabled) return;

    await click('commit');
    expect(el('execution')).not.toBeNull();

    await click('execution-skip');
    expect(el('debrief')).not.toBeNull();

    // And the notice is still there, still not in the way.
    expect(el('storage-notice')).not.toBeNull();
  });

  it('offers export, and dismisses for the session', async () => {
    await mountUnavailable();
    expect(el('storage-notice-export')).not.toBeNull();

    // Export reads the in-memory save, so it works in exactly the state that broke saving.
    await click('storage-notice-export');
    expect(el('storage-notice')).not.toBeNull();

    await click('storage-notice-dismiss');
    expect(el('storage-notice')).toBeNull();
  });
});

describe('a quota that runs out mid-session', () => {
  const mountQuota = async (hash = ''): Promise<void> => {
    stubStorage('quota');
    const App = await freshApp();
    window.location.hash = hash;
    await act(() => {
      render(<App />, container);
    });
  };

  it('says nothing until a write actually fails', async () => {
    await mountQuota();
    // Storage is readable and the save is absent, so nothing has gone wrong yet. A notice
    // here would be crying wolf at every player whose quota is merely finite.
    expect(el('storage-notice')).toBeNull();
  });

  it('appears at the moment of the failed write, naming the right problem', async () => {
    await mountQuota('#/contract/c03-cold-open');
    expect(el('storage-notice')).toBeNull();

    // Accepting a contract counts an attempt, which is a write.
    await click('accept');

    const notice = el('storage-notice');
    expect(notice).not.toBeNull();
    expect(notice?.dataset['problem']).toBe('full');
    expect(notice?.getAttribute('role')).toBe('status');
  });

  it('does not reappear on every subsequent write once dismissed', async () => {
    await mountQuota('#/contract/c03-cold-open');
    await click('accept');
    expect(el('storage-notice')).not.toBeNull();

    await click('storage-notice-dismiss');
    expect(el('storage-notice')).toBeNull();

    // More writes, all of them failing. A notice that came back would be a modal built out
    // of a banner.
    await press('n');
    await press('n');
    expect(el('storage-notice')).toBeNull();
  });

  it('keeps the progress in memory even though it was not written', async () => {
    await mountQuota('#/contract/c03-cold-open');
    await click('accept');
    // The attempt was counted in the save the app is holding; only the write failed. The
    // planner is showing, which is the whole of "still playable".
    expect(el('planner')).not.toBeNull();
  });
});
