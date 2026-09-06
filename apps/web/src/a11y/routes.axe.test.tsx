/**
 * axe-core over every route and every state, blocking on serious and critical — #170.
 *
 * > *"The UI MUST pass axe-core with zero serious or critical violations on every route"*
 * > — NFR-017, verified by FR-909's *"axe in CI, blocking"*. §14.1 makes **axe clean** an
 * > M3 exit criterion.
 *
 * Accessibility checked by hand at the end of a milestone regresses between milestones. A
 * blocking gate is the only version of that requirement that stays true, and this is it.
 *
 * ## Where it runs, and why there is no browser here
 *
 * The workspace has no Playwright dependency and no browser test runner (see `CLAUDE.md`
 * § CI and deployment — that is a standing decision, not an omission). It does have a
 * jsdom vitest project, and axe-core runs under jsdom. So this is a vitest project like
 * every other one: it joins `pnpm test:all` automatically, needs no new CI service, and
 * costs no new install.
 *
 * ## What jsdom cannot check, and saying so out loud
 *
 * jsdom has no layout and no rendering, so **`color-contrast` cannot run here** — it needs
 * computed pixels. The rule is therefore disabled *by name* in {@link AXE_OPTIONS}, with
 * its replacement named alongside it: #116's contrast matrix in `palette.test.ts`, which
 * checks every foreground against every background across all five palettes using
 * `contrastRatioOf`.
 *
 * Leaving it enabled would be worse than disabling it. Under jsdom the rule finds nothing
 * to measure and reports zero violations, and zero violations is indistinguishable from a
 * pass — a gate that implies coverage it does not have. `docs/PHYSICS.md` already has a
 * rule about exactly this failure ("a validation table that implies coverage it does not
 * have is worse than no table"), and it applies to accessibility unchanged. The summary
 * this suite writes says the rule did not run.
 *
 * ## The route list is derived, not retyped
 *
 * {@link ROUTES} is the router's own table, exported for this. {@link ROUTE_CASES} maps
 * each name to a concrete visitable hash and is a `Record<RouteName, string>`, so **a route
 * added to the router without a case here does not compile**, and a route deleted from the
 * router leaves a case with no name — also a compile error. A hand-written list could do
 * neither, and its failure mode is silence.
 *
 * ## Threshold, and what a suppression costs
 *
 * NFR-017's line exactly: **serious and critical fail**; moderate and minor are collected
 * and written to the job summary. A violation that is deliberately accepted is suppressed
 * in {@link SUPPRESSED} by rule *and* by selector with a written reason — never by lowering
 * the threshold, which would silently accept every future violation of that class too.
 */
import axe from 'axe-core';
import { appendFileSync } from 'node:fs';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { App } from '../app.js';
import { installCanvasHarness, type RemoveCanvasHarness } from '../planner/test-canvas.js';
import { ROUTES, type RouteName } from '../router.js';
import { SAVE_KEY } from '../save/index.js';

/**
 * The rules axe runs with.
 *
 * `color-contrast` is off because jsdom has no layout — see the module docstring. It is the
 * only rule disabled, and it is disabled by name rather than by tag so that turning off a
 * second one is a visible edit here rather than a quiet widening somewhere else.
 */
const AXE_OPTIONS: axe.RunOptions = {
  resultTypes: ['violations'],
  rules: {
    // Cannot run under jsdom: no layout, no computed colours, nothing to measure. Its
    // replacement is #116's contrast matrix — `apps/web/src/palette.test.ts` checks every
    // ink/ground pair in all five palettes with `contrastRatioOf`, which is a stronger
    // check than axe's because it covers palettes a player has not selected.
    'color-contrast': { enabled: false },
  },
};

/** The impacts that fail the build. NFR-017's threshold, and nothing wider. */
const BLOCKING: readonly (axe.ImpactValue | undefined)[] = ['serious', 'critical'];

/**
 * Deliberately accepted violations, by rule and by element.
 *
 * Empty, and that is the intended state — every route is clean at the point of merge. The
 * shape is here so that accepting one later is a change to *this* list with a reason and a
 * linked issue beside it, rather than a threshold quietly moved down.
 */
const SUPPRESSED: readonly {
  readonly rule: string;
  readonly selector: string;
  readonly why: string;
}[] = [];

/** Moderate and minor findings, accumulated across every case for the job summary. */
const reported: { readonly where: string; readonly rule: string; readonly impact: string }[] = [];

const isSuppressed = (rule: string, nodes: readonly axe.NodeResult[]): boolean =>
  SUPPRESSED.some(
    (entry) => entry.rule === rule && nodes.every((node) => node.target.includes(entry.selector)),
  );

/**
 * Run axe over the document and assert the blocking threshold.
 *
 * Against `document.body` rather than the mount container: overlays, the skip link and the
 * document-level landmarks are what a screen reader meets, and a check scoped to one `div`
 * would miss exactly the things this gate exists to catch.
 */
const expectAxeClean = async (where: string): Promise<void> => {
  const results = await axe.run(document.body, AXE_OPTIONS);

  const blocking = results.violations.filter(
    (violation) =>
      BLOCKING.includes(violation.impact) && !isSuppressed(violation.id, violation.nodes),
  );

  for (const violation of results.violations) {
    if (BLOCKING.includes(violation.impact)) continue;
    reported.push({ where, rule: violation.id, impact: violation.impact ?? 'unknown' });
  }

  expect(
    blocking.map((violation) => `${violation.id} (${violation.impact ?? '?'}): ${violation.help}`),
    `${where} has serious or critical axe violations`,
  ).toEqual([]);
};

/**
 * One concrete hash per route name — §8.2's table, made visitable.
 *
 * A `Record<RouteName, string>` on purpose: the compiler requires a case for every name
 * the router can produce, which is what makes "derived from the router's own table" true
 * rather than aspirational.
 */
const ROUTE_CASES: Record<RouteName, string> = {
  title: '#/',
  board: '#/board',
  contract: '#/contract/c01-shakedown',
  daily: '#/daily',
  dailyDate: '#/daily/2026-09-01',
  leaderboard: '#/leaderboard/2026-09-01',
  codexIndex: '#/codex',
  codex: '#/codex/phasing',
  replay: '#/replay?s=c01&r=abc',
  settings: '#/settings',
  scene: '#/scene',
  // Not in `ROUTES` — it is the fallback `parseHash` returns for anything unmatched — but
  // it is a screen a player can reach by typing, so it is a route this gate visits.
  notFound: '#/nothing-here',
};

let container: HTMLElement;
let removeHarness: RemoveCanvasHarness;

const mount = async (hash: string): Promise<void> => {
  window.location.hash = hash;
  await act(() => {
    render(<App />, container);
  });
};

const press = async (key: string, modifiers: Partial<KeyboardEventInit> = {}): Promise<void> => {
  await act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...modifiers }));
  });
};

const el = (testId: string): HTMLElement | null =>
  document.body.querySelector(`[data-testid="${testId}"]`);

beforeEach(() => {
  removeHarness = installCanvasHarness();
  window.location.hash = '';
  localStorage.removeItem(SAVE_KEY);
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
  removeHarness();
});

/**
 * The moderate and minor findings, and the rule that did not run.
 *
 * Written to the step summary rather than only to the log, because a finding nobody reads
 * is a finding nobody acts on — and because the `color-contrast` line is the one that keeps
 * this gate honest about its own coverage.
 */
afterAll(() => {
  const path = process.env['GITHUB_STEP_SUMMARY'];
  if (path === undefined || path === '') return;

  const lines = [
    '### Accessibility (axe-core, #170)',
    '',
    `Serious and critical: **0** — the build fails on any. Suppressed: **${String(SUPPRESSED.length)}**.`,
    '',
    '`color-contrast` **did not run**: jsdom has no layout, so the rule has nothing to',
    "measure. Contrast is checked instead by #116's matrix in `apps/web/src/palette.test.ts`,",
    'across all five palettes. No route below claims a contrast check.',
    '',
  ];

  if (reported.length === 0) {
    lines.push('No moderate or minor findings.');
  } else {
    lines.push('| Where | Rule | Impact |', '| --- | --- | --- |');
    for (const entry of reported)
      lines.push(`| ${entry.where} | ${entry.rule} | ${entry.impact} |`);
  }

  appendFileSync(path, `${lines.join('\n')}\n`);
});

describe('every route in §8.2’s table (NFR-017, FR-909)', () => {
  // Derived from the router rather than retyped — see the module docstring. A route the
  // router gained and this file has not is a compile error above; this asserts the reverse,
  // that every name the table produces is one of the cases below.
  it('has a case for every name the router can produce', () => {
    const fromRouter = new Set<RouteName>(ROUTES.map(([, name]) => name));
    fromRouter.add('notFound');
    expect([...fromRouter].sort()).toEqual(Object.keys(ROUTE_CASES).sort());
  });

  for (const [name, hash] of Object.entries(ROUTE_CASES)) {
    it(`is clean at ${hash}`, async () => {
      await mount(hash);
      await expectAxeClean(`route ${name}`);
    });
  }
});

describe('the states that are not routes — §8.2’s four phases', () => {
  /**
   * The same key sequence `keyboard-walkthrough.test.tsx` drives, for the same reason: it
   * is the route a player actually takes, and it reaches all four phases without a pointer.
   * Here it exists to *arrive* at each phase rather than to prove the keys work.
   */
  it('is clean at the briefing, the planner, the execution phase and the debrief', async () => {
    await mount('#/contract/c01-shakedown');
    expect(el('brief')).not.toBeNull();
    await expectAxeClean('phase briefing');

    await press('Enter');
    expect(el('planner')).not.toBeNull();
    await expectAxeClean('phase planner');

    await press('n');
    for (let i = 0; i < 5; i++) await press('ArrowUp');
    await press('Enter');
    expect(el('execution')).not.toBeNull();
    await expectAxeClean('phase execution');

    await press('s');
    expect(el('debrief')).not.toBeNull();
    await expectAxeClean('phase debrief');
  });
});

describe('every overlay, open', () => {
  it('is clean with the help overlay open', async () => {
    await mount('#/board');
    await press('?');
    expect(el('help-overlay')).not.toBeNull();
    await expectAxeClean('overlay help');
  });

  it('is clean with the Codex overlay open', async () => {
    await mount('#/contract/c01-shakedown');
    await press('Enter');
    await press('c');
    expect(el('codex-overlay')).not.toBeNull();
    await expectAxeClean('overlay codex');
  });

  it('is clean with the settings overlay open over a screen', async () => {
    await mount('#/board');
    await act(() => {
      window.location.hash = '#/settings';
      window.dispatchEvent(new Event('hashchange'));
    });
    // The overlay, not the settings *screen* — §8.3.12 renders settings over whatever the
    // player was on, and only a cold load at `#/settings` gets the full-screen version
    // (which `ROUTE_CASES.settings` above is the case for).
    expect(el('settings-overlay')).not.toBeNull();
    await expectAxeClean('overlay settings');
  });

  it('is clean with the node context menu open', async () => {
    await mount('#/contract/c01-shakedown');
    await press('Enter');
    await press('n');
    await press('F10', { shiftKey: true });
    expect(el('node-menu')).not.toBeNull();
    await expectAxeClean('overlay node menu');
  });

  it('is clean with the node editor open', async () => {
    await mount('#/contract/c01-shakedown');
    await press('Enter');
    await press('n');
    // `e`, not `Enter`. §8.5.3 binds `Enter` to *commit* on the planner, so pressing it
    // here would leave the execution screen on display and axe it under the name of the
    // node editor — a case that passes while checking something else entirely.
    await press('e');
    expect(el('node-editor')).not.toBeNull();
    await expectAxeClean('overlay node editor');
  });

  it('is clean with a coach mark showing', async () => {
    await mount('#/contract/c01-shakedown');
    await press('Enter');
    // C01 declares two marks and both are latched behind a trigger (`marks.ts`), so an
    // untouched planner shows none — placing the first node is what fires one. FR-902's
    // marks then show on any save that has not dismissed them, which a fresh one has not.
    //
    // The `role="status"` container is always mounted (see `CoachMark.tsx`), so the
    // assertion looks for the *card* rather than the region: querying the region would
    // pass on an empty planner and axe nothing that this case is named for.
    await press('n');
    expect(document.body.querySelector('[data-testid^="coach-mark-"]')).not.toBeNull();
    await expectAxeClean('overlay coach mark');
  });
});

describe('the failure states', () => {
  it('is clean on an unknown contract', async () => {
    await mount('#/contract/no-such-contract');
    expect(el('unknown-contract')).not.toBeNull();
    await expectAxeClean('state unknown contract');
  });

  it('is clean on a malformed replay code', async () => {
    await mount('#/replay?s=c01&r=not-a-replay');
    expect(el('replay-problem')).not.toBeNull();
    await expectAxeClean('state replay problem');
  });
});

describe('the gate itself', () => {
  /**
   * #170's criterion: *"the suite fails when a deliberate violation is introduced"* — the
   * same demonstration the layering and DOM guardrails carry.
   *
   * A gate nobody has watched fail is a gate nobody knows works. This introduces a button
   * with no accessible name — `button-name`, which axe rates **critical** — and asserts the
   * checker rejects it, then removes it again.
   */
  it('fails on a deliberate violation', async () => {
    await mount('#/board');
    const broken = document.createElement('div');
    // Built from a string rather than JSX: a button with no name is exactly what is being
    // introduced, and `no-restricted-syntax` forbids literal text in JSX here anyway.
    broken.innerHTML = '<button type="button"></button>';
    document.body.append(broken);

    try {
      // Both halves, because either one alone would pass for the wrong reason: that axe
      // *sees* the violation, and that the threshold above turns seeing it into a failure.
      // A checker that swallowed every result would satisfy the second on its own.
      const results = await axe.run(document.body, AXE_OPTIONS);
      expect(results.violations.map((violation) => violation.id)).toContain('button-name');
      await expect(expectAxeClean('deliberate violation')).rejects.toThrow(/serious or critical/);
    } finally {
      broken.remove();
    }
  });
});
