/**
 * §13.5's **E4**: C02 played from briefing to debrief with key events only — NFR-016, #141.
 *
 * > *Every action in the game is reachable by keyboard alone.*
 *
 * ## Why this is a walkthrough and not a table
 *
 * `keys.test.ts` proves the map says what §8.5.3 says, and it proves it cheaply because
 * `actionFor` is pure. What it cannot prove is that the map is *reachable*: a binding can be
 * correct in the table, be resolved by the right screen, and still be unusable because the
 * screen never installs the handler, or because focus is somewhere the document listener
 * cannot see, or because the next phase mounts a screen that does not listen at all.
 *
 * So this drives the real `ContractScreen` — the component that owns §8.2's whole loop —
 * with nothing but `keydown`, and asserts a debrief comes out the other end.
 *
 * ## The guard that makes it mean something
 *
 * A test that "uses the keyboard" while quietly calling `.click()` proves nothing, and the
 * failure would be invisible in review. So every pointer constructor and `HTMLElement.click`
 * is replaced with a throw for the duration of the walkthrough. If any code path under test
 * — or any line of the test itself — reaches for a pointer, the test fails rather than
 * passing for the wrong reason.
 *
 * That is #141's own criterion: *"asserting no pointer events were dispatched"*. Counting
 * dispatches after the fact would have been the weaker version; refusing to let one be
 * constructed at all is the version that cannot be got around by accident.
 *
 * ## What this is not
 *
 * Not #174's Playwright journey, which runs the same route in a real browser at M4. This is
 * the component-level version §13.5 asks for at M3: it proves the bindings connect, not that
 * the pixels are right.
 */
import { createCatalogue } from '@hh/ui';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { contractById } from '../contracts/registry.js';
import { ContractScreen } from '../screens/ContractScreen.js';
import { Screen } from '../screens/Screen.js';
import { installCanvasHarness, type RemoveCanvasHarness } from './test-canvas.js';

const catalogue = createCatalogue();
let container: HTMLElement;
let removeHarness: RemoveCanvasHarness;

const c02 = (): NonNullable<ReturnType<typeof contractById>> => {
  const scenario = contractById('c02-round-trip');
  if (scenario === undefined) throw new Error('c02-round-trip is not in the registry');
  return scenario;
};

const el = (testId: string): HTMLElement | null =>
  container.querySelector(`[data-testid="${testId}"]`);

/**
 * Make every pointer route throw for the duration of a block.
 *
 * `HTMLElement.click()` is included deliberately: it is not a pointer *event* constructor,
 * but it is the way a test accidentally stops being keyboard-only, and it is the one the
 * reviewer would not notice.
 */
const withoutPointers = async (body: () => Promise<void>): Promise<void> => {
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const forbid = (target: object, key: string): void => {
    saved.set(key, Object.getOwnPropertyDescriptor(target, key));
    Object.defineProperty(target, key, {
      configurable: true,
      writable: true,
      value: () => {
        throw new Error(`E4 is keyboard-only: ${key} was used`);
      },
    });
  };

  forbid(HTMLElement.prototype, 'click');
  const targets: [object, string][] = [
    [globalThis, 'PointerEvent'],
    [globalThis, 'MouseEvent'],
  ];
  for (const [target, key] of targets) forbid(target, key);

  try {
    await body();
  } finally {
    for (const [key, descriptor] of saved) {
      const target = key === 'click' ? HTMLElement.prototype : globalThis;
      if (descriptor === undefined) Reflect.deleteProperty(target, key);
      else Object.defineProperty(target, key, descriptor);
    }
  }
};

const press = async (key: string, modifiers: Partial<KeyboardEventInit> = {}): Promise<void> => {
  await act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...modifiers }));
  });
};

const mount = async (): Promise<void> => {
  await act(() => {
    render(
      <ContractScreen
        t={catalogue.resolve}
        resolveDynamic={catalogue.resolveDynamic}
        scenario={c02()}
        onAccept={() => undefined}
      />,
      container,
    );
  });
};

beforeEach(() => {
  removeHarness = installCanvasHarness();
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
  removeHarness();
});

describe('E4 — C02 from cold load to debrief, keyboard only (§13.5, NFR-016)', () => {
  it('accepts, plans, commits, runs and reaches the debrief without a pointer', async () => {
    await withoutPointers(async () => {
      await mount();

      // ── The briefing ────────────────────────────────────────────────────────────
      expect(el('brief')).not.toBeNull();
      // §8.5.3's "Commit / confirm". The briefing binds it to ACCEPT — one row in the
      // table, resolved differently by two screens.
      await press('Enter');

      // ── The planner ─────────────────────────────────────────────────────────────
      expect(el('planner')).not.toBeNull();

      // Place a burn at the scrub head, then give it some Δv. Both are §8.5.3 bindings and
      // neither has a pointer-free alternative route being used instead: `N` and `↑` are
      // the keys a player would press.
      await press('n');
      expect(el('plan-node-0')).not.toBeNull();
      for (let i = 0; i < 5; i++) await press('ArrowUp');

      // Scrub, nudge, and undo — the editing verbs, exercised so the walkthrough covers
      // more than the two keys that advance the phase.
      await press(']');
      await press('.');
      await press('z', { ctrlKey: true });

      // The contract panel and the node menu, both added in this PR, both keyboard-only
      // routes to things that were pointer-only before it.
      await press('b');
      expect(el('contract-panel')).not.toBeNull();
      await press('b');
      await press('F10', { shiftKey: true });
      expect(el('node-menu')).not.toBeNull();
      await press('Escape');

      // ── Commit ──────────────────────────────────────────────────────────────────
      await press('Enter');
      expect(el('execution')).not.toBeNull();

      // ── Execution ───────────────────────────────────────────────────────────────
      // `1`–`5` set the playback speed and `S` skips to the end. Both are execution's own
      // scope in the table — the planner resolves neither.
      await press('3');
      await press('s');

      // ── The debrief ─────────────────────────────────────────────────────────────
      expect(el('debrief')).not.toBeNull();
    });
  });

  it('refuses to pass if the walkthrough reaches for a pointer', async () => {
    // The guard, tested. Without this, a later edit could quietly reintroduce a `.click()`
    // and the suite would go on reporting that the game is keyboard-operable.
    await expect(
      withoutPointers(async () => {
        await mount();
        const anything = el('brief');
        if (anything === null) throw new Error('expected the briefing to render');
        anything.click();
      }),
    ).rejects.toThrow('keyboard-only');
  });
});

describe('§8.8’s skip-to-content link (#141)', () => {
  // Against `Screen` rather than `ContractScreen`: the shell is what every route is wrapped
  // in by `app.tsx`, so testing it here covers the skip link on every screen at once rather
  // than on the one this file happens to walk through.
  const mountScreen = async (): Promise<void> => {
    await act(() => {
      render(
        <Screen
          name="planner"
          heading="Contract"
          focusHeading={false}
          transitionMs={0}
          t={catalogue.resolve}
        >
          <p data-testid="screen-child" />
        </Screen>,
        container,
      );
    });
  };

  it('is present, and points at the heading a route change focuses', async () => {
    await mountScreen();
    const skip = el('skip-to-content');
    expect(skip).not.toBeNull();
    const target = skip?.getAttribute('href')?.slice(1) ?? '';
    // The same element the router moves focus to, so a player who uses both the skip link
    // and a route change does not learn two different "top of the screen"s.
    expect(document.getElementById(target)).toBe(el('screen-heading'));
  });

  it('comes before the main content in the DOM', async () => {
    await mountScreen();
    const skip = el('skip-to-content');
    const main = container.querySelector('main');
    if (skip === null || main === null) throw new Error('expected a skip link and a main');
    // A skip link that is not first is a link a keyboard user reaches after the thing it
    // was meant to skip.
    expect(skip.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
