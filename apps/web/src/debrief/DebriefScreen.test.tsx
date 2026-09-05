/**
 * The debrief (#121, §8.3.9, FR-304, FR-305, FR-307).
 *
 * Driven with constructed outcomes rather than by playing a contract, because the
 * screen has to render results this build cannot yet produce from `c03-cold-open` — a
 * Gold run, a beaten par, a personal best to compare against. `ContractScreen.test.tsx`
 * covers the path a player actually takes; this covers what the screen does with each
 * shape of result once it gets there.
 */
import type { Outcome, ProximityEvaluation } from '@hh/game';
import { epoch } from '@hh/astro';
import { metres, metresPerSec } from '@hh/math';
import { createCatalogue } from '@hh/ui';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { contractById } from '../contracts/registry.js';
import { MEDAL_REVEAL_MS } from '../motion.js';
import { DebriefScreen } from './DebriefScreen.js';

const catalogue = createCatalogue({ onMissingKey: 'throw' });

let container: HTMLElement;

const c03 = (): NonNullable<ReturnType<typeof contractById>> => {
  const scenario = contractById('c03-cold-open');
  if (scenario === undefined) throw new Error('c03-cold-open is not in the registry');
  return scenario;
};

const proximity = (met: boolean, rangeM: number): ProximityEvaluation => ({
  kind: 'intercept',
  met,
  atEpoch: met ? epoch(4123) : null,
  achieved: {
    epoch: epoch(4123),
    rangeM: metres(rangeM),
    relativeSpeedMps: metresPerSec(42.7),
  },
  candidates: [],
  tolerance: { maxRangeM: metres(1000), maxRelativeSpeedMps: null },
});

const outcomeOf = (over: Partial<Outcome> = {}): Outcome => ({
  success: true,
  failure: null,
  medalCap: 'clean',
  cappedBy: [],
  dvUsedMps: 109.1177,
  dvBudgetMps: 300,
  metSeconds: 4123,
  deadlineSeconds: 10_800,
  burns: 1,
  medal: 'gold',
  par: { dvMps: 109.1177, timeSeconds: 4122.965, burns: 1 },
  parDelta: { dvFraction: 0, timeFraction: 0 },
  beatParDv: false,
  diagnosis: null,
  objective: proximity(true, 310),
  ...over,
});

const mount = async (
  outcome: Outcome,
  over: Partial<Parameters<typeof DebriefScreen>[0]> = {},
): Promise<void> => {
  await act(() => {
    render(
      <DebriefScreen
        t={catalogue.resolve}
        resolveDynamic={catalogue.resolveDynamic}
        scenario={c03()}
        outcome={outcome}
        onRetry={() => undefined}
        onNext={null}
        onShare={() => undefined}
        shareResult={null}
        onBoard={() => undefined}
        reportHref={null}
        {...over}
      />,
      container,
    );
  });
};

const el = (testId: string): HTMLElement | null =>
  container.querySelector(`[data-testid="${testId}"]`);

const text = (testId: string): string => el(testId)?.textContent ?? '';

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
});

describe('the success variant', () => {
  it('names the medal in words, never by colour alone', async () => {
    // §8.8: medals by shape and label. `data-medal` is for the palette; the text is what
    // carries the information.
    await mount(outcomeOf({ medal: 'gold' }));
    expect(text('debrief-medal')).toContain('Gold');
    expect(el('debrief-medal')?.dataset['medal']).toBe('gold');
  });

  it('names Clean Job', async () => {
    await mount(outcomeOf({ medal: 'clean' }));
    expect(text('debrief-medal')).toContain('Clean Job');
  });

  it('says so when a legal run earned no medal', async () => {
    await mount(outcomeOf({ medal: null }));
    expect(text('debrief-medal')).not.toBe('');
  });

  it('renders §8.3.9’s three rows', async () => {
    await mount(outcomeOf());
    for (const quantity of ['deltaV', 'time', 'burns']) {
      expect(el(`debrief-row-${quantity}`)).not.toBeNull();
    }
  });

  it('shows par beside every row — FR-304', async () => {
    await mount(outcomeOf());
    // Par is not a hidden developer score (§6.7): the row carries the player's number and
    // ours, in the same units, every time.
    expect(text('debrief-row-deltaV')).toContain('109.1');
  });

  it('shows an em dash for a personal best that does not exist yet', async () => {
    await mount(outcomeOf());
    expect(text('debrief-row-deltaV')).toContain('—');
  });

  it('shows the personal best when the save has one', async () => {
    await mount(outcomeOf(), { best: { dvMps: 108.4, timeSeconds: 4100, burns: 1 } });
    expect(text('debrief-row-deltaV')).toContain('108.4');
  });

  it('signs the delta against par', async () => {
    await mount(outcomeOf({ parDelta: { dvFraction: 0.006, timeFraction: -0.001 } }));
    expect(text('debrief-row-deltaV')).toContain('+0.6%');
  });

  it('quotes the encounter and the tolerance it was judged against', async () => {
    await mount(outcomeOf());
    expect(text('debrief-closest')).toContain('310 m');
    expect(text('debrief-closest')).toContain('1.0 km');
  });

  it('has no failure block', async () => {
    await mount(outcomeOf());
    expect(el('debrief-miss')).toBeNull();
    expect(el('debrief-missed')).toBeNull();
  });
});

describe('the failure variant', () => {
  const missed = outcomeOf({
    success: false,
    failure: 'objectiveMissed',
    metSeconds: null,
    medal: null,
    parDelta: null,
    objective: proximity(false, 12_400),
  });

  it('replaces the result block with the diagnosis — §8.3.9', async () => {
    await mount(missed);
    expect(el('debrief-table')).toBeNull();
    expect(el('debrief-medal')).toBeNull();
    expect(el('debrief-miss')).not.toBeNull();
  });

  it('reports the closest approach achieved, what was needed, and the Δv used', async () => {
    // #121's second criterion, verbatim.
    await mount(missed);
    const block = text('debrief-miss');
    expect(block).toContain('12.4 km');
    expect(block).toContain('1.0 km');
    expect(block).toContain('109.1');
    expect(block).toContain('300');
  });

  it('keeps the same layout as a success rather than looking like a different screen', async () => {
    // §6.11: there is no lose state. The heading, the "what happened" section and the
    // four actions are all still there.
    await mount(missed);
    expect(el('debrief-heading')).not.toBeNull();
    expect(el('debrief-diagnosis')).not.toBeNull();
    for (const action of ['retry', 'next', 'share', 'board']) {
      expect(el(`debrief-${action}`)).not.toBeNull();
    }
  });
});

describe('FR-307 — the diagnosis', () => {
  it('renders the rule’s sentence when one matched', async () => {
    await mount(
      outcomeOf({
        success: false,
        failure: 'pastDeadline',
        medal: null,
        diagnosis: {
          key: 'debrief.diagnosis.pastDeadline',
          params: { metSeconds: 12_000, deadlineSeconds: 10_800, lateSeconds: 1200 },
        },
      }),
    );
    expect(text('debrief-diagnosis')).toContain('deadline');
  });

  it('says the numbers are the answer when no rule matched, rather than nothing', async () => {
    // The failure this rules out is a blank block, which reads as a screen that did not
    // load. FR-307's fallback is bare numbers *and* the admission that they are all the
    // game will say.
    await mount(outcomeOf({ diagnosis: null }));
    expect(text('debrief-diagnosis')).not.toBe('');
  });

  it('never speculates — an unmatched outcome says nothing about why', async () => {
    await mount(outcomeOf({ success: false, medal: null, diagnosis: null }));
    // No causal claim: the fallback says the game will not guess.
    expect(text('debrief-diagnosis')).toContain('does not guess');
  });
});

describe('D12 — beating par', () => {
  const beaten = outcomeOf({ beatParDv: true, dvUsedMps: 107.7177 });

  it('says our optimum was wrong rather than congratulating the player', async () => {
    await mount(beaten);
    expect(text('debrief-beat-par')).toContain('Our optimum was wrong');
  });

  it('quotes the margin', async () => {
    await mount(beaten);
    expect(text('debrief-beat-par')).toContain('1.4');
  });

  it('offers the prefilled report — FR-305', async () => {
    await mount(beaten, { reportHref: 'https://example.invalid/new' });
    const link = container.querySelector('.hh-debrief__beat-par a');
    expect(link?.getAttribute('href')).toBe('https://example.invalid/new');
  });

  it('shows nothing when par was merely equalled', async () => {
    await mount(outcomeOf({ beatParDv: false }));
    expect(el('debrief-beat-par')).toBeNull();
  });
});

describe('the actions', () => {
  it('enables NEXT when there is a next contract', async () => {
    await mount(outcomeOf(), { onNext: () => undefined });
    expect((el('debrief-next') as HTMLButtonElement).disabled).toBe(false);
    expect(el('debrief-next-note')).toBeNull();
  });

  it('disables NEXT and explains why when there is not', async () => {
    await mount(outcomeOf());
    expect((el('debrief-next') as HTMLButtonElement).disabled).toBe(true);
    // Bound to the button, so a screen reader hears the reason on the control itself.
    expect(el('debrief-next')?.getAttribute('aria-describedby')).toBe('hh-debrief-next-note');
  });

  it('reports a successful copy', async () => {
    await mount(outcomeOf(), { shareResult: 'copied' });
    expect(text('debrief-share-result')).toContain('copied');
  });

  it('reports a failed copy without hiding the code', async () => {
    await mount(outcomeOf(), { shareResult: 'failed' });
    expect(text('debrief-share-result')).not.toBe('');
  });

  it('says nothing about sharing before anything was shared', async () => {
    await mount(outcomeOf());
    expect(el('debrief-share-result')).toBeNull();
  });

  // §14.4: "the version is visible on the title screen and in the debrief". The title
  // screen is #118; this is the half that exists.
  it('names the build it is running', async () => {
    await mount(outcomeOf());
    const build = text('debrief-build');
    expect(build).toContain('Build');
    // The identifier's fallback under the test runner, which applies no `define`.
    expect(build).toContain('0.0.0 (unknown)');
  });

  it('shows the build on a failed run too, which is when it gets reported', async () => {
    await mount(
      outcomeOf({ success: false, failure: 'objectiveMissed', medal: null, parDelta: null }),
    );
    expect(text('debrief-build')).toContain('0.0.0 (unknown)');
  });
});

describe('§9.4’s medal reveal (#173)', () => {
  // jsdom's `matchMedia` answers `false` to everything, so this is the un-reduced branch.
  // The reduced one is covered in `motion.test.ts`, where the host is a parameter and both
  // branches can actually be driven — see that module's note on why the platform is
  // injected rather than reached for.
  it('runs the reveal, and carries its duration from motion.ts', async () => {
    await mount(outcomeOf({ medal: 'gold' }));

    const medal = el('debrief-medal');
    expect(medal?.dataset['reveal']).toBe('reveal');
    expect(medal?.getAttribute('style')).toContain('--hh-medal-duration');
    expect(medal?.getAttribute('style')).toContain(`${String(MEDAL_REVEAL_MS)}ms`);
  });
});
