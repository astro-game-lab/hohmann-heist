/**
 * §8.7's empty, loading and failure states — #125.
 *
 * One file for the four components that render §8.7's rows, plus the skeleton that ships
 * in `index.html`. The error boundary has its own file because it is the only one with
 * behaviour rather than markup.
 *
 * The rule every case here checks, beyond the words on screen, is §8.7's own and NFR-014's:
 * **no state blocks play.** None of these is a modal, none traps focus, and every one that
 * is a dead end offers a route out.
 */
import { parseScenario } from '@hh/game';
import { createCatalogue } from '@hh/ui';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { contractById } from '../contracts/registry.js';

import { CanvasUnavailable } from './CanvasUnavailable.js';
import { LockedContract } from './LockedContract.js';
import { ReplayProblem } from './ReplayProblem.js';
import { ScenarioProblem } from './ScenarioProblem.js';

const catalogue = createCatalogue();
let container: HTMLElement;

const el = (testId: string): HTMLElement | null =>
  container.querySelector(`[data-testid="${testId}"]`);

const mount = async (node: preact.JSX.Element): Promise<void> => {
  await act(() => {
    render(node, container);
  });
};

/** Real loader errors, from a deliberately malformed contract. Never hand-written. */
const scenarioErrors = () => {
  const valid = contractById('c01-shakedown');
  if (valid === undefined) throw new Error('c01-shakedown is not in the registry');
  const result = parseScenario({
    ...(valid.document as unknown as Record<string, unknown>),
    horizonSeconds: 'forty thousand',
  });
  if (result.ok) throw new Error('the malformed fixture parsed, which defeats the test');
  return result.errors;
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
});

describe('a scenario that fails schema validation', () => {
  it('names the field that failed, in the loader’s own words', async () => {
    const errors = scenarioErrors();
    await mount(
      <ScenarioProblem
        t={catalogue.resolve}
        resolveDynamic={catalogue.resolveDynamic}
        id="c01-shakedown"
        errors={errors}
      />,
    );

    const fields = el('scenario-problem-fields');
    expect(fields).not.toBeNull();
    // A JSON pointer at the offending value — FR-202's field-level error, which is what
    // makes this useful to the contributor who could fix it.
    expect(fields?.textContent).toContain('/horizonSeconds');
    // And a resolved sentence, not a catalogue key leaking through.
    expect(fields?.textContent).not.toContain('scenario.error.');
    expect(fields?.textContent).not.toContain('⟦');
  });

  it('offers to report it, prefilled', async () => {
    await mount(
      <ScenarioProblem
        t={catalogue.resolve}
        resolveDynamic={catalogue.resolveDynamic}
        id="c01-shakedown"
        errors={scenarioErrors()}
      />,
    );

    const report = container.querySelector('.hh-state__action');
    expect(report?.tagName).toBe('A');
    const href = report?.getAttribute('href') ?? '';
    expect(href).toContain('/issues/new');
    expect(decodeURIComponent(href)).toContain('c01-shakedown');
    expect(decodeURIComponent(href)).toContain('/horizonSeconds');
  });

  it('does not block: it is a notice, not a modal', async () => {
    await mount(
      <ScenarioProblem
        t={catalogue.resolve}
        resolveDynamic={catalogue.resolveDynamic}
        id="c01-shakedown"
        errors={scenarioErrors()}
      />,
    );
    const state = el('scenario-problem-c01-shakedown');
    expect(state?.getAttribute('aria-modal')).toBeNull();
    expect(state?.getAttribute('role')).toBe('status');
  });
});

describe('a replay code that cannot be read', () => {
  it('tells the sender’s problem apart from the reader’s', async () => {
    await mount(<ReplayProblem t={catalogue.resolve} problem={{ kind: 'invalid' }} />);
    const invalid = el('replay-problem')?.textContent ?? '';

    await mount(
      <ReplayProblem
        t={catalogue.resolve}
        problem={{ kind: 'futureVersion', found: 2, supported: 1 }}
      />,
    );
    const future = el('replay-problem')?.textContent ?? '';

    // Distinct messages, which is the whole point of the row: re-copying an intact code
    // from a newer build would send the player round a loop with no exit.
    expect(invalid).not.toBe(future);
  });

  it('names the version mismatch', async () => {
    await mount(
      <ReplayProblem
        t={catalogue.resolve}
        problem={{ kind: 'futureVersion', found: 4, supported: 1 }}
      />,
    );
    const text = el('replay-problem')?.textContent ?? '';
    expect(text).toContain('4');
    expect(text).toContain('1');
  });

  it('links a release that can read it, and only for the version case', async () => {
    await mount(
      <ReplayProblem
        t={catalogue.resolve}
        problem={{ kind: 'futureVersion', found: 2, supported: 1 }}
      />,
    );
    expect(el('replay-problem-release')?.getAttribute('href')).toContain('/releases');

    await mount(<ReplayProblem t={catalogue.resolve} problem={{ kind: 'invalid' }} />);
    // A malformed code is not fixed by a newer build, so there is nothing to link to.
    expect(el('replay-problem-release')).toBeNull();
  });
});

describe('a browser whose canvas will not draw', () => {
  it('states §11.15’s support matrix', async () => {
    await mount(<CanvasUnavailable t={catalogue.resolve} />);
    const text = el('canvas-unavailable')?.textContent ?? '';
    expect(text).toContain('Chrome');
    expect(text).toContain('Safari 17');
    expect(text).toContain('Samsung Internet');
  });

  /**
   * §8.8's canvas-parity rule underneath NFR-014: everything the orbit view draws has a
   * DOM equivalent, so a player with no canvas can still play. This is a notice beside a
   * working game, never a screen replacing it.
   */
  it('does not block play', async () => {
    await mount(<CanvasUnavailable t={catalogue.resolve} />);
    const state = el('canvas-unavailable');
    expect(state?.getAttribute('aria-modal')).toBeNull();
    expect(state?.tagName).toBe('SECTION');
  });
});

describe('a locked contract reached by its URL', () => {
  it('shows the unlock rule instead of the briefing', async () => {
    await mount(
      <LockedContract t={catalogue.resolve} lock={{ requiredAct: 1, required: 3, earned: 1 }} />,
    );
    const rule = el('locked-contract-rule')?.textContent ?? '';
    expect(rule).toContain('Act I');
    expect(rule).toContain('3');
    expect(rule).toContain('1');
  });

  it('offers a route back to the board', async () => {
    await mount(
      <LockedContract t={catalogue.resolve} lock={{ requiredAct: 1, required: 3, earned: 0 }} />,
    );
    expect(container.querySelector('.hh-state__action')?.getAttribute('href')).toBe('#/board');
  });
});

/**
 * §8.7's first-load row, which is markup in `index.html` rather than a component.
 *
 * > *Inline skeleton of the title screen; the app is < 400 kB gzip and should be
 * > interactive before a spinner would appear (NFR-020). If it takes > 800 ms, a minimal
 * > progress bar.*
 *
 * The criterion that matters is *"a test that asserts it is absent at 0 ms"*. It is met
 * structurally rather than by a timer: the bar's reveal is a CSS animation with an 800 ms
 * delay, so at 0 ms it is `opacity: 0` and there is nothing to be absent from — no script,
 * no timeout, and nothing that can race the bundle.
 */
describe('the first-load skeleton', () => {
  const html = readFileSync(join(process.cwd(), 'apps', 'web', 'index.html'), 'utf8');

  it('ships inside the mount point, so the first paint replaces it', () => {
    expect(html).toMatch(/<div id="app">[\s\S]*id="hh-boot"/);
  });

  it('is hidden from assistive technology — it is a picture of a screen, not a screen', () => {
    expect(html).toMatch(/id="hh-boot"[^>]*aria-hidden="true"/);
    expect(html).toMatch(/id="hh-boot"[^>]*aria-busy="true"/);
  });

  it('shows no progress bar at 0 ms', () => {
    // Transparent until the animation that reveals it runs, and that animation is delayed.
    expect(html).toMatch(/\.hh-boot__bar\s*\{[^}]*opacity:\s*0/);
    expect(html).toMatch(/animation:\s*hh-boot-appear[^;]*800ms/);
  });

  it('reveals it only past §8.7’s 800 ms', () => {
    expect(html).toMatch(/animation:\s*hh-boot-progress[^;]*800ms/);
  });

  /**
   * §8.8: *"no element animates purely decoratively"* under `prefers-reduced-motion`.
   *
   * The bar still *appears* past 800 ms — it is information, not decoration, and removing
   * it would leave a player who asked for less motion with no indication that anything was
   * loading. What stops is the sweep: it becomes a full-width bar rather than a moving one.
   */
  it('stops the bar moving under reduced motion without removing it', () => {
    expect(html).toMatch(
      /prefers-reduced-motion[\s\S]*hh-boot__bar::after[\s\S]*animation:\s*none/,
    );
    expect(html).toMatch(/prefers-reduced-motion[\s\S]*hh-boot__bar::after[\s\S]*width:\s*100%/);
  });
});
