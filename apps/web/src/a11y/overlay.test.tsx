/**
 * The focus policy itself — §8.8, NFR-016, #169.
 *
 * `a11y/overlay.ts` is the one statement of what an overlay owes a keyboard user, so this
 * is where that statement is checked. Two halves:
 *
 * - **The behaviour**, driven against a harness rather than against a real overlay. A
 *   harness can be empty, can lose its opener, and can be switched between modal and
 *   non-modal in one line — none of which a real overlay can be talked into doing, and all
 *   of which are cases the policy has to get right.
 * - **The census.** Behaviour tests prove the hook works; they cannot prove anything about
 *   an overlay that never calls it. So the last block reads the sources and requires every
 *   component declaring `role="dialog"` or `role="menu"` to use the hook — which is #169's
 *   *"every overlay in the app uses it and none implements its own trap or restore"*,
 *   enforced rather than reviewed.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { JSX } from 'preact';
import { render } from 'preact';
import { useRef } from 'preact/hooks';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CONTENT_HEADING_ID, focusableWithin, restoreFocus } from './focus.js';
import { useOverlay, type OverlayOptions } from './overlay.js';

let container: HTMLElement;

/** Labels as variables: literal text in JSX is banned in this workspace, tests included. */
const FIRST = 'first';
const LAST = 'last';

const Harness = ({
  options,
  empty = false,
}: {
  readonly options: OverlayOptions;
  readonly empty?: boolean;
}): JSX.Element => {
  const ref = useOverlay<HTMLDivElement>(options);
  return (
    <div ref={ref} data-testid="overlay">
      {empty ? null : (
        <>
          <button type="button" data-testid="first">
            {FIRST}
          </button>
          <button type="button" data-testid="last">
            {LAST}
          </button>
        </>
      )}
    </div>
  );
};

const el = (testId: string): HTMLElement | null =>
  document.body.querySelector(`[data-testid="${testId}"]`);

const mount = async (node: JSX.Element): Promise<void> => {
  await act(() => {
    render(node, container);
  });
};

const unmount = async (): Promise<void> => {
  await act(() => {
    render(null, container);
  });
};

const press = async (key: string, modifiers: Partial<KeyboardEventInit> = {}): Promise<boolean> => {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...modifiers,
  });
  await act(() => {
    document.dispatchEvent(event);
  });
  return event.defaultPrevented;
};

/** An opener outside the overlay, focused, the way a button that opened one would be. */
const openerButton = (): HTMLButtonElement => {
  const opener = document.createElement('button');
  opener.type = 'button';
  opener.dataset['testid'] = 'opener';
  document.body.append(opener);
  opener.focus();
  return opener;
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
  document.body.querySelector('[data-testid="opener"]')?.remove();
  document.getElementById(CONTENT_HEADING_ID)?.remove();
});

describe('a modal overlay', () => {
  it('moves focus to the first focusable thing on open', async () => {
    openerButton();
    await mount(<Harness options={{ modal: true, onClose: () => undefined }} />);
    expect(document.activeElement).toBe(el('first'));
  });

  it('focuses itself when it has nothing focusable inside', async () => {
    // A dialog with nothing to focus is still a thing a screen reader should read, and
    // leaving focus outside it would announce the page behind.
    await mount(<Harness empty options={{ modal: true, onClose: () => undefined }} />);
    expect(document.activeElement).toBe(el('overlay'));
    expect(el('overlay')?.tabIndex).toBe(-1);
  });

  it('closes on Esc', async () => {
    let closed = false;
    await mount(
      <Harness
        options={{
          modal: true,
          onClose: () => {
            closed = true;
          },
        }}
      />,
    );
    expect(await press('Escape')).toBe(true);
    expect(closed).toBe(true);
  });

  it('wraps Tab at the end and Shift+Tab at the start, rather than blocking either', async () => {
    await mount(<Harness options={{ modal: true, onClose: () => undefined }} />);

    // Forward off the last element lands on the first — a wrap, not a block. §8.8 forbids
    // a trap a player cannot leave; `Esc` above is the way out.
    el('last')?.focus();
    expect(await press('Tab')).toBe(true);
    expect(document.activeElement).toBe(el('first'));

    expect(await press('Tab', { shiftKey: true })).toBe(true);
    expect(document.activeElement).toBe(el('last'));
  });

  it('leaves Tab alone in the middle of the overlay', async () => {
    // Only the two ends are intercepted. Preventing every `Tab` would make the browser's
    // own ordering unreachable and is how a wrap becomes a trap.
    await mount(<Harness options={{ modal: true, onClose: () => undefined }} />);
    el('first')?.focus();
    expect(await press('Tab')).toBe(false);
  });

  it('returns focus to the opener on close', async () => {
    const opener = openerButton();
    await mount(<Harness options={{ modal: true, onClose: () => undefined }} />);
    expect(document.activeElement).not.toBe(opener);
    await unmount();
    expect(document.activeElement).toBe(opener);
  });
});

describe('a non-modal overlay', () => {
  it('moves focus in', async () => {
    await mount(<Harness options={{ modal: false }} />);
    expect(document.activeElement).toBe(el('first'));
  });

  it('honours initialFocus over the first focusable element', async () => {
    // The node editor's arrangement: focus lands on the heading that names what just
    // opened, rather than on whichever stepper happens to be first in the markup — so what
    // a screen reader announces is the thing itself and not one of its controls.
    const WithInitialFocus = (): JSX.Element => {
      const headingRef = useRef<HTMLHeadingElement | null>(null);
      const ref = useOverlay<HTMLDivElement>({ modal: false, initialFocus: headingRef });
      return (
        <div ref={ref} data-testid="overlay">
          <h3 tabIndex={-1} ref={headingRef} data-testid="heading">
            {FIRST}
          </h3>
          <button type="button" data-testid="first">
            {LAST}
          </button>
        </div>
      );
    };

    await mount(<WithInitialFocus />);
    expect(document.activeElement).toBe(el('heading'));
  });

  it('does not trap Tab', async () => {
    await mount(<Harness options={{ modal: false }} />);
    el('last')?.focus();
    // Untouched: the browser moves focus out of the overlay and into the live screen
    // behind it, which for a non-modal overlay is the correct behaviour rather than a leak.
    expect(await press('Tab')).toBe(false);
    expect(await press('Tab', { shiftKey: true })).toBe(false);
  });

  it('does not answer Esc, so the screen behind can', async () => {
    // The planner binds `Escape` on every screen and runs an innermost-first cascade with
    // it. An overlay that also listened would fire from a position where it cannot know
    // what else is open — see the module docstring.
    await mount(<Harness options={{ modal: false }} />);
    expect(await press('Escape')).toBe(false);
  });

  it('still returns focus to the opener on close', async () => {
    const opener = openerButton();
    await mount(<Harness options={{ modal: false }} />);
    await unmount();
    expect(document.activeElement).toBe(opener);
  });
});

describe('when the opener no longer exists', () => {
  /**
   * The case #169 names, and the one that actually strands people: an overlay opened from
   * a control that the overlay's own action removed. `opener.focus()` on a detached element
   * is a silent no-op, so focus lands on `<body>` — the top of the document, unannounced.
   */
  it('falls back to the screen heading rather than the document body', async () => {
    const heading = document.createElement('h1');
    heading.id = CONTENT_HEADING_ID;
    heading.tabIndex = -1;
    document.body.append(heading);

    const opener = openerButton();
    await mount(<Harness options={{ modal: true, onClose: () => undefined }} />);
    opener.remove();
    await unmount();

    expect(document.activeElement).toBe(heading);
    expect(document.activeElement).not.toBe(document.body);
  });

  it('leaves focus alone when there is no heading either', () => {
    // The last rung does nothing rather than reaching for `document.body`: a screen with no
    // heading is a bug elsewhere, and focusing the body is what the browser already did.
    const elsewhere = openerButton();
    const detached = document.createElement('button');
    restoreFocus(detached);
    expect(document.activeElement).toBe(elsewhere);
  });

  it('prefers the opener while it is still connected', () => {
    const opener = openerButton();
    const heading = document.createElement('h1');
    heading.id = CONTENT_HEADING_ID;
    heading.tabIndex = -1;
    document.body.append(heading);
    heading.focus();

    restoreFocus(opener);
    expect(document.activeElement).toBe(opener);
  });
});

describe('what counts as focusable', () => {
  it('skips tabindex="-1" targets and disabled controls', () => {
    const root = document.createElement('div');
    // `tabindex="-1"` is how a "you are here" target like the screen heading is marked:
    // programmatically focusable, deliberately not in the tab order.
    root.innerHTML =
      '<h1 tabindex="-1"></h1><button type="button" disabled></button><button type="button" id="real"></button>';
    document.body.append(root);
    try {
      expect(focusableWithin(root).map((element) => element.id)).toEqual(['real']);
    } finally {
      root.remove();
    }
  });
});

describe('the census — every overlay uses the shared policy', () => {
  /**
   * #169's first criterion, mechanically.
   *
   * A behaviour test cannot see an overlay that never calls the hook, and "we reviewed it"
   * does not survive the seventh overlay. So this reads the sources: anything declaring
   * itself a dialog or a menu is an overlay, and an overlay that does not call `useOverlay`
   * is one that has written its own focus handling — the thing this module exists to stop.
   *
   * Deliberately crude, and that is fine. A false positive is a component that says
   * `role="dialog"` in a comment, which is worth being told about anyway.
   */
  const sourcesUnder = (directory: string): string[] =>
    readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return sourcesUnder(path);
      if (!entry.name.endsWith('.tsx') || entry.name.includes('.test.')) return [];
      return [path];
    });

  /** An overlay that handles its own focus: the thing `a11y/overlay.ts` exists to prevent. */
  const optsOut = (source: string): boolean =>
    (source.includes('role="dialog"') || source.includes('role="menu"')) &&
    !source.includes('useOverlay');

  it('leaves no overlay implementing its own trap or restore', () => {
    const root = join(process.cwd(), 'apps', 'web', 'src');
    const offenders = sourcesUnder(root).filter((path) => optsOut(readFileSync(path, 'utf8')));

    expect(
      offenders.map((path) => path.slice(root.length + 1)),
      'these declare an overlay role but do not use the shared focus policy in a11y/overlay.ts',
    ).toEqual([]);
  });

  it('would catch an overlay that opted out, and clears one that did not', () => {
    // The census, tested through the same predicate the scan uses rather than a restatement
    // of it — the same demonstration the layering guardrails carry. Without this, a scan
    // whose matching had quietly broken would report a clean app forever.
    expect(optsOut('<div role="dialog" aria-modal="true">')).toBe(true);
    expect(optsOut('const ref = useOverlay({ modal: true, onClose });\n<div role="dialog">')).toBe(
      false,
    );
    // And a component that is not an overlay at all is not swept up by it.
    expect(optsOut('<div role="status">')).toBe(false);
  });
});
