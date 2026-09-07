/**
 * §8.3.3's contract, carried into the planner — #264.
 *
 * The load-bearing test in this file is the first one: **the panel and the briefing render
 * identical text for the same scenario**. That is #264's second criterion and the reason
 * the content was extracted rather than re-rendered — two copies of "how a contract
 * describes itself" is two things to keep in step, and the one that drifts first is the one
 * the player sees least.
 *
 * Driven against **C07** rather than C03 wherever the content matters. C07 is the contract
 * #264 was raised from: its objective is *"hold a slot 3.00° east of your current longitude,
 * within 0.05°, drifting no more than 0.01°/day"* — three numbers, none of which the planner
 * showed and all of which are needed to plan the burn.
 */
import { createCatalogue } from '@hh/ui';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { contractById } from '../contracts/registry.js';
import { Briefing } from '../screens/Briefing.js';
import { PlannerScreen } from './PlannerScreen.js';

const catalogue = createCatalogue();
let container: HTMLElement;

const contract = (id: string): NonNullable<ReturnType<typeof contractById>> => {
  const scenario = contractById(id);
  if (scenario === undefined) throw new Error(`${id} is not in the registry`);
  return scenario;
};

const el = (testId: string): HTMLElement | null =>
  container.querySelector(`[data-testid="${testId}"]`);

const text = (testId: string): string => el(testId)?.textContent ?? '';

const press = async (key: string): Promise<void> => {
  await act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
};

const mountPlanner = async (id = 'c07-slot-machine'): Promise<void> => {
  await act(() => {
    render(
      <PlannerScreen
        t={catalogue.resolve}
        resolveDynamic={catalogue.resolveDynamic}
        scenario={contract(id)}
        onCommit={() => undefined}
        coachMarksSeen={[]}
        onCoachMarkSeen={() => undefined}
        onOpenCodex={() => undefined}
        onOpenHelp={() => undefined}
      />,
      container,
    );
  });
};

const mountBriefing = async (id = 'c07-slot-machine'): Promise<void> => {
  await act(() => {
    render(
      <Briefing
        t={catalogue.resolve}
        resolveDynamic={catalogue.resolveDynamic}
        scenario={contract(id)}
        onAccept={() => undefined}
      />,
      container,
    );
  });
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
});

describe('the panel and the briefing cannot drift (#264’s second criterion)', () => {
  const sameFor = async (id: string, testId: string): Promise<void> => {
    await mountBriefing(id);
    const fromBriefing = text(testId);
    render(null, container);

    await mountPlanner(id);
    const fromPanel = text(testId);

    expect(fromPanel, `${id} · ${testId}`).toBe(fromBriefing);
    expect(fromPanel, `${id} · ${testId}`).not.toBe('');
  };

  it('renders the same objective line', async () => {
    // C07's three-number objective — the reason this issue exists.
    await sameFor('c07-slot-machine', 'objective');
  });

  it('renders the same Δv budget, deadline and par', async () => {
    await sameFor('c07-slot-machine', 'value-dv-budget');
    await sameFor('c07-slot-machine', 'value-deadline');
    await sameFor('c07-slot-machine', 'value-par');
  });

  it('renders the same setup line for the ship', async () => {
    await sameFor('c07-slot-machine', 'setup-ship');
  });

  it('renders the same constraint rows', async () => {
    await sameFor('c04-long-haul', 'constraint-altitude_floor');
    // C04 is the first contract with a burn-count cap, which the briefing states and the
    // planner previously showed only as a bare `n / 2` readout.
    await sameFor('c04-long-haul', 'constraint-burn_count');
  });

  it('keeps the SI value behind the display value in both', async () => {
    // `Quantity`'s screen-reader span, which is the half a rendering could easily lose.
    await sameFor('c07-slot-machine', 'si-deadline');
  });
});

describe('the panel is always there (#264)', () => {
  it('is showing on a first visit, with no control to summon it', async () => {
    await mountPlanner();
    expect(el('contract-panel')).not.toBeNull();
    // The HUD's toggle and its `B` binding are gone with the collapsing: everyone who
    // opened the panel left it open, which is what the session preference was recording.
    expect(el('hud-contract-toggle')).toBeNull();
  });

  it('survives a contract change, because it is not a preference any more', async () => {
    await mountPlanner('c03-cold-open');
    expect(el('contract-panel')).not.toBeNull();

    render(null, container);
    await mountPlanner('c07-slot-machine');
    expect(el('contract-panel')).not.toBeNull();
    expect(text('contract-title')).toContain(contract('c07-slot-machine').document.title);
  });

  it('is one of four tabs in the narrow strip', async () => {
    await mountPlanner();
    // #123's strip already carried plan, readouts and assists; the fourth costs no new
    // state machinery because every panel is mounted at once and hidden with `hidden`.
    expect(el('planner-tab-contract')).not.toBeNull();
    await act(() => {
      el('planner-tab-contract')?.click();
    });
    expect(el('contract-panel')).not.toBeNull();
  });

  it('is not written to save data', async () => {
    await mountPlanner('c03-cold-open');
    // *"Not saved to storage: this is a view preference, and `apps/web/src/save/` is for
    // progress."* Nothing about the panel is a preference now, and the assertion is kept
    // as the guard it was: no route to persistence, checked against storage itself.
    const stored = Object.keys(localStorage).map((key) => localStorage.getItem(key) ?? '');
    expect(stored.some((value) => value.includes('contract') && value.includes('open'))).toBe(
      false,
    );
  });
});

describe('showing it changes nothing (§8.8, #264)', () => {
  it('leaves the plan, the selection and the scrub head alone', async () => {
    await mountPlanner('c03-cold-open');
    await press('n');
    await press(']');
    // The panel is on screen throughout — there is no opening act left to perform — so
    // what this asserts is the other half of #264's rule: a planner *with* the contract
    // showing edits exactly as one without it did. The panel takes a scenario and a
    // catalogue and no callbacks, which is why there is nothing here that could.
    expect(el('contract-panel')).not.toBeNull();
    expect(text('plan-panel')).toContain('1');
    expect(text('hud-met')).not.toBe('');
    expect(el('plan-node-0')?.getAttribute('aria-pressed')).toBe('true');
  });
});

describe('every string comes from the catalogue (FR-910, D14)', () => {
  it('resolves the brief itself by key', async () => {
    await mountPlanner();
    // The brief is data — a `briefKey` on the contract — so a panel showing it must go
    // through `resolveDynamic` rather than carrying prose.
    expect(text('contract-brief')).not.toBe('');
    expect(text('contract-brief')).not.toContain('briefKey');
  });

  it('names the contract by index and title', async () => {
    await mountPlanner();
    expect(text('contract-title')).toContain(contract('c07-slot-machine').document.title);
  });
});
