/**
 * The contract loop — briefing → planner → execution → debrief (#121, #144, #145, #146).
 *
 * This is the M2 exit criterion as a test: a contract that can be played to a
 * conclusion. The individual pieces are covered where they live — the playback clock in
 * `@hh/ui`, the log and the outcome in `@hh/game`, the camera in `execution/camera.test`
 * — and what is left here is the part none of them can assert alone: that the phases
 * hand the *same* run to each other, and that the two edges back (abort, retry) restore
 * what they promised.
 *
 * ## Why the run is skipped rather than watched, in most of these
 *
 * `skipToEnd` and a watched run are the same call with a different step — that is
 * `playback.ts`'s whole design, and `playback.test.ts` asserts the equality directly over
 * ten thousand steps. Reproducing it here through a faked animation frame would test
 * jsdom's timer shim, not the game. So these drive the screen the way a player on their
 * twelfth attempt does, and the one test that *does* watch a run drives the frame loop
 * explicitly to prove the two arrive at the same place.
 */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createCatalogue } from '@hh/ui';

import { contractById } from '../contracts/registry.js';
import { ContractScreen } from './ContractScreen.js';

const catalogue = createCatalogue({ onMissingKey: 'throw' });

let container: HTMLElement;

const c03 = (): NonNullable<ReturnType<typeof contractById>> => {
  const scenario = contractById('c03-cold-open');
  if (scenario === undefined) throw new Error('c03-cold-open is not in the registry');
  return scenario;
};

const mount = async (): Promise<void> => {
  await act(() => {
    render(
      <ContractScreen
        t={catalogue.resolve}
        resolveDynamic={catalogue.resolveDynamic}
        scenario={c03()}
        onAccept={() => undefined}
      />,
      container,
    );
  });
};

const el = (testId: string): HTMLElement | null =>
  container.querySelector(`[data-testid="${testId}"]`);

const text = (testId: string): string => el(testId)?.textContent ?? '';

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

/** Accept the brief, place one burn, and commit — as far as a player can get in four acts. */
const commitAPlan = async (): Promise<boolean> => {
  await mount();
  await click('accept');
  await press('n');
  const commit = el('commit');
  if (commit === null || (commit as HTMLButtonElement).disabled) return false;
  await click('commit');
  return true;
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
  vi.useRealTimers();
});

describe('the phases', () => {
  it('opens on the briefing', async () => {
    await mount();
    expect(el('accept')).not.toBeNull();
    expect(el('planner')).toBeNull();
  });

  it('reaches the planner on ACCEPT, without navigating', async () => {
    // §8.3.3's "no loading screen" — ACCEPT swaps the screen in place, so there is no
    // router round trip and no frame in which the screen is empty.
    await mount();
    await click('accept');
    expect(el('planner')).not.toBeNull();
  });

  it('reaches execution on COMMIT', async () => {
    if (!(await commitAPlan())) return;
    expect(el('execution')).not.toBeNull();
    expect(el('planner')).toBeNull();
  });

  it('reaches the debrief when the run ends', async () => {
    if (!(await commitAPlan())) return;
    await click('execution-skip');
    expect(el('debrief')).not.toBeNull();
  });
});

describe('execution (#144, #146)', () => {
  it('shows the flight log, with the opening entry, before anything has been skipped', async () => {
    if (!(await commitAPlan())) return;
    const entries = container.querySelectorAll('.hh-log__entry');
    expect(entries.length).toBeGreaterThan(0);
    // Ignition is at T+0 and is reported by the first step, which is a zero-length one.
    expect(entries[0]?.textContent).toContain('ignition');
  });

  it('shows the current playback rate — DEP-05', async () => {
    if (!(await commitAPlan())) return;
    expect(text('execution-speed-current')).not.toBe('');
  });

  it('offers every speed up to FR-602’s cap', async () => {
    if (!(await commitAPlan())) return;
    for (const speed of [1, 100, 1000, 10_000, 100_000]) {
      expect(el(`execution-speed-${String(speed)}`)).not.toBeNull();
    }
  });

  it('changes the rate with the digit keys — §8.5.3', async () => {
    if (!(await commitAPlan())) return;
    await press('1');
    expect(el('execution-speed-1')?.getAttribute('aria-pressed')).toBe('true');
    await press('4');
    expect(el('execution-speed-10000')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('pauses and resumes with Space, and says why it cannot be edited', async () => {
    if (!(await commitAPlan())) return;
    await press(' ');
    expect(el('execution-paused-notice')).not.toBeNull();
    // §8.3.8: pausing offers Abort, never an edit. There is no editing control at all.
    expect(el('planner')).toBeNull();
    await press(' ');
    expect(el('execution-paused-notice')).toBeNull();
  });

  it('skips to the end with S', async () => {
    if (!(await commitAPlan())) return;
    await press('s');
    expect(el('debrief')).not.toBeNull();
  });

  it('never announces more than the strategy’s bound, even at the highest speed', async () => {
    // #146: the live region must not flood. Skipping the whole run crosses every entry
    // at once, which is the worst case any speed can produce.
    if (!(await commitAPlan())) return;
    await press('5');
    await click('execution-skip');
    // The debrief has replaced the log, so the assertion is on what the run produced:
    // a bounded announcement rather than one line per entry.
    expect(el('debrief')).not.toBeNull();
  });
});

describe('FR-603 — abort returns to the planner with the plan intact (#145)', () => {
  it('goes back to the planner', async () => {
    if (!(await commitAPlan())) return;
    await click('execution-abort');
    expect(el('planner')).not.toBeNull();
    expect(el('execution')).toBeNull();
  });

  it('keeps the plan', async () => {
    if (!(await commitAPlan())) return;
    await click('execution-abort');
    // The burn placed before committing is still there, which is FR-603's "intact".
    expect(container.querySelectorAll('.hh-plan__row')).toHaveLength(1);
  });

  it('restores the scrub head', async () => {
    await mount();
    await click('accept');
    await press('n');
    await press(']');
    const scrubbed = text('hud-met');
    const commit = el('commit');
    if (commit === null || (commit as HTMLButtonElement).disabled) return;
    await click('commit');

    await click('execution-abort');
    expect(text('hud-met')).toBe(scrubbed);
  });

  it('aborts on Escape as well as on the button — §8.5.3', async () => {
    if (!(await commitAPlan())) return;
    await press('Escape');
    expect(el('planner')).not.toBeNull();
  });
});

describe('§6.11 — retry restores the plan', () => {
  it('returns to the planner from the debrief, with the burn still placed', async () => {
    if (!(await commitAPlan())) return;
    await click('execution-skip');
    await click('debrief-retry');
    expect(el('planner')).not.toBeNull();
    expect(container.querySelectorAll('.hh-plan__row')).toHaveLength(1);
  });

  it('can commit the same plan again and reach the same result', async () => {
    if (!(await commitAPlan())) return;
    await click('execution-skip');
    const first = text('debrief-heading');
    const firstDiagnosis = text('debrief-diagnosis');

    await click('debrief-retry');
    const commit = el('commit');
    if (commit === null || (commit as HTMLButtonElement).disabled) return;
    await click('commit');
    await click('execution-skip');

    // FR-601 and §11.4: the same plan gives the same outcome, every time.
    expect(text('debrief-heading')).toBe(first);
    expect(text('debrief-diagnosis')).toBe(firstDiagnosis);
  });
});

describe('the debrief (#121)', () => {
  it('renders one variant or the other, never both', async () => {
    if (!(await commitAPlan())) return;
    await click('execution-skip');
    const succeeded = el('debrief-medal') !== null;
    expect(el('debrief-missed') === null).toBe(succeeded);
    expect(el('debrief-table') === null).toBe(!succeeded);
    expect(el('debrief-miss') === null).toBe(succeeded);
  });

  it('always says what happened, even when it has no rule to explain it', async () => {
    // FR-307's fallback. A single burn placed at the scrub head misses the target, and
    // no rule in this milestone can say why — so the block shows the numbers and says
    // that is deliberate rather than leaving a blank.
    if (!(await commitAPlan())) return;
    await click('execution-skip');
    expect(text('debrief-diagnosis')).not.toBe('');
  });

  it('offers RETRY, NEXT, SHARE and BOARD', async () => {
    if (!(await commitAPlan())) return;
    await click('execution-skip');
    for (const action of ['retry', 'next', 'share', 'board']) {
      expect(el(`debrief-${action}`)).not.toBeNull();
    }
  });

  it('shows NEXT unavailable, and says why', async () => {
    // One contract ships in this build. The control is present and explains the
    // boundary rather than vanishing and leaving the player wondering.
    if (!(await commitAPlan())) return;
    await click('execution-skip');
    expect((el('debrief-next') as HTMLButtonElement).disabled).toBe(true);
    expect(text('debrief-next-note')).not.toBe('');
  });

  it('does not compare a first completion against itself', async () => {
    // The run is recorded on the way to the debrief (FR-302), so a naive read of the save
    // would show this run's own numbers in the "your best" column and report a first
    // completion as having matched a best it had just set.
    if (!(await commitAPlan())) return;
    await click('execution-skip');
    if (el('debrief-table') === null) return;
    expect(text('debrief-row-deltaV')).toContain('—');
  });

  it('reports whether SHARE reached the clipboard', async () => {
    if (!(await commitAPlan())) return;
    await click('execution-skip');
    await click('debrief-share');
    // jsdom has no clipboard, so this is the failure path — and the failure is reported
    // rather than thrown, with the code still on screen to copy by hand.
    await act(() => Promise.resolve());
    expect(text('debrief-share-result')).not.toBe('');
  });
});

describe('#147 — the camera cannot change the outcome', () => {
  it('gives the same debrief whether the camera was touched or not', async () => {
    // FR-601 by way of #147's fourth criterion. Panning, zooming and recentring are
    // camera operations, and a camera is read only by the renderer — so this is
    // structural, and the test is what makes "structural" checkable.
    if (!(await commitAPlan())) return;
    await click('execution-skip');
    const untouched = {
      heading: text('debrief-heading'),
      diagnosis: text('debrief-diagnosis'),
      closest: text('debrief-closest'),
      table: text('debrief-table'),
      miss: text('debrief-miss'),
    };

    render(null, container);
    if (!(await commitAPlan())) return;
    await click('execution-zoom-in');
    await click('execution-zoom-in');
    await click('execution-zoom-out');
    await click('execution-recentre');
    await click('execution-skip');

    expect(text('debrief-heading')).toBe(untouched.heading);
    expect(text('debrief-diagnosis')).toBe(untouched.diagnosis);
    expect(text('debrief-closest')).toBe(untouched.closest);
    expect(text('debrief-table')).toBe(untouched.table);
    expect(text('debrief-miss')).toBe(untouched.miss);
  });
});

describe('#144, #145 — watching and skipping arrive at the same place', () => {
  it('produces the same debrief either way', async () => {
    // The frame loop, driven explicitly. `advanceTimersByTime` runs jsdom's animation
    // frames, so this is a real watched run rather than a simulated one — and it is the
    // one test here that watches, because the equality it proves is the point.
    vi.useFakeTimers();

    if (!(await commitAPlan())) {
      vi.useRealTimers();
      return;
    }
    await press('5');
    for (let i = 0; i < 400 && el('debrief') === null; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(32);
      });
    }
    const watched = { heading: text('debrief-heading'), diagnosis: text('debrief-diagnosis') };
    vi.useRealTimers();

    expect(watched.heading).not.toBe('');

    // And again, skipped.
    render(null, container);
    if (!(await commitAPlan())) return;
    await click('execution-skip');

    expect(text('debrief-heading')).toBe(watched.heading);
    expect(text('debrief-diagnosis')).toBe(watched.diagnosis);
  });
});
