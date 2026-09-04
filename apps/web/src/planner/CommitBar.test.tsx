/**
 * #139's gate. The second criterion — *"`L6` does not disable Commit"* — is the one this
 * file exists for: a `blocking: true` typo on that row would quietly remove the most
 * important thing §6.4's failure loop does, and nothing else in the suite would notice.
 */
import type { Legality, LegalityReason } from '@hh/game';
import { createCatalogue } from '@hh/ui';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CommitBar } from './CommitBar.js';

const catalogue = createCatalogue();
let container: HTMLElement;

const reason = (
  code: LegalityReason['code'],
  blocking: boolean,
  message: LegalityReason['message'],
): LegalityReason => ({ code, blocking, message, epoch: null, intervals: [] });

const L1 = reason('L1', true, {
  key: 'legality.l1.overBudget',
  params: { usedMps: 274.4, budgetMps: 250, excessMps: 24.4 },
});
const L4 = reason('L4', true, {
  key: 'legality.l4.escapes',
  params: { arcIndex: 2, eccentricity: 1.4, metSeconds: 1200 },
});
const L6 = reason('L6', false, { key: 'legality.l6.objectiveNotMet', params: {} });

const legality = (reasons: readonly LegalityReason[]): Legality => ({
  evaluable: true,
  commitAllowed: !reasons.some((r) => r.blocking),
  reasons,
  constraints: {
    budget: {
      kind: 'dv_budget',
      violations: [],
      usedMps: 0,
      budgetMps: 250,
      remainingMps: 250,
      fraction: 0,
      level: 'ok',
      exceededAtNode: null,
    },
    deadline: {
      kind: 'deadline',
      violations: [],
      deadlineSeconds: 50_400,
      lastBurnMetSeconds: null,
      overrunSeconds: 0,
      firstLateNode: null,
    },
    altitudeFloor: {
      kind: 'altitude_floor',
      violations: [],
      floorAltitudeM: 100_000,
      referenceRadiusM: 6_378_137,
      totalSecondsBelow: 0,
    },
  },
});

const mount = async (value: Legality): Promise<ReturnType<typeof vi.fn>> => {
  const onCommit = vi.fn();
  await act(() => {
    render(
      <CommitBar
        t={catalogue.resolve}
        resolveDynamic={catalogue.resolveDynamic}
        legality={value}
        onCommit={onCommit}
      />,
      container,
    );
  });
  return onCommit;
};

const el = (testId: string): HTMLElement | null =>
  container.querySelector(`[data-testid="${testId}"]`);

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
});

describe('a legal plan', () => {
  it('enables Commit and shows no reasons', async () => {
    await mount(legality([]));
    expect((el('commit') as HTMLButtonElement).disabled).toBe(false);
    expect(el('commit-reasons')).toBeNull();
  });

  it('commits when pressed', async () => {
    const onCommit = await mount(legality([]));
    await act(() => {
      el('commit')?.click();
    });
    expect(onCommit).toHaveBeenCalledOnce();
  });
});

describe('L6 is a warning, never a gate (#139, §6.4)', () => {
  it('does not disable Commit', async () => {
    // The assertion this file exists for. §6.4: "Committing a plan you know will fail is
    // a legitimate way to learn, and the debrief for a near-miss is one of the best
    // teaching moments the game has."
    await mount(legality([L6]));
    expect((el('commit') as HTMLButtonElement).disabled).toBe(false);
  });

  it('still shows the reason, marked as non-blocking', async () => {
    await mount(legality([L6]));
    const row = el('commit-reason-L6');
    expect(row).not.toBeNull();
    expect(row?.getAttribute('data-blocking')).toBe('false');
    expect(row?.textContent).toContain('objective');
  });

  it('lets a blocking reason alongside it still disable Commit', async () => {
    await mount(legality([L1, L6]));
    expect((el('commit') as HTMLButtonElement).disabled).toBe(true);
    expect(el('commit-reason-L6')).not.toBeNull();
  });
});

describe('an illegal plan', () => {
  it('disables Commit', async () => {
    await mount(legality([L1]));
    expect((el('commit') as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows every simultaneous reason, not just the first', async () => {
    // §6.4's whole point: five problems discovered one commit at a time is the feedback
    // loop the "all failures at once" rule exists to prevent.
    await mount(legality([L1, L4, L6]));
    expect(el('commit-reasons')?.querySelectorAll('li')).toHaveLength(3);
    expect(el('commit-reason-L1')).not.toBeNull();
    expect(el('commit-reason-L4')).not.toBeNull();
    expect(el('commit-reason-L6')).not.toBeNull();
  });

  it('renders each reason from the catalogue with its parameters', async () => {
    await mount(legality([L1]));
    // "Over budget by 24 m/s" — the number comes from the reason's params, formatted by
    // the catalogue. Nothing in the component builds a sentence.
    expect(el('commit-reason-L1')?.textContent).toMatch(/24/);
  });

  it('associates the reasons with the button programmatically', async () => {
    // #139's fifth criterion. A paragraph of red text beside a dimmed button is invisible
    // to someone who tabs to it and hears "Commit plan, dimmed".
    await mount(legality([L1]));
    const describedBy = el('commit')?.getAttribute('aria-describedby');
    expect(describedBy).not.toBeNull();
    expect(container.querySelector(`#${String(describedBy)}`)).toBe(el('commit-reasons'));
  });
});

describe('a plan that produced no trajectory (§6.4’s non-evaluable case)', () => {
  it('disables Commit and says what actually happened', async () => {
    // Not "illegal, reason L4" — there was no trajectory to judge, and answering with a
    // legality code would be inventing a verdict.
    await mount({
      evaluable: false,
      commitAllowed: false,
      reason: { key: 'legality.plan.rectilinear', params: { nodeIndex: 0 } },
      failure: { ok: false, reason: 'rectilinear', nodeIndex: 0 },
    });
    expect((el('commit') as HTMLButtonElement).disabled).toBe(true);
    expect(el('commit-reason-plan')).not.toBeNull();
  });
});
