/**
 * §8.3.4's region ⑤ — FR-411, §6.6, #140.
 *
 * The central assertion of this file is that **the tray is not a list**. #140 asks for the
 * rendered set to be checked *"against #81's model rather than a literal list in the
 * component"*, so the expectations below are derived from `ASSIST_IDS` and `ASSISTS` too.
 * A test that spelled out seven rows would pass just as happily against a component that
 * spelled out the same seven, which is the arrangement the requirement exists to prevent.
 */
import {
  ASSISTS,
  ASSIST_IDS,
  defaultAssistState,
  restrictToAllowed,
  type AssistId,
  type AssistState,
} from '@hh/game';
import { createCatalogue } from '@hh/ui';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AssistTray } from './AssistTray.js';

const catalogue = createCatalogue();
let container: HTMLElement;

/** What every Act I contract actually offers — C03's list, which is the shipped case. */
const ACT_I_ALLOWED: readonly AssistId[] = [
  'closest_approach',
  'coach_marks',
  'constraints',
  'elements',
  'snapping',
];

const mount = async (
  allowed: readonly AssistId[] = ACT_I_ALLOWED,
  state?: AssistState,
): Promise<ReturnType<typeof vi.fn>> => {
  const onToggle = vi.fn();
  await act(() => {
    render(
      <AssistTray
        t={catalogue.resolve}
        assists={state ?? restrictToAllowed(defaultAssistState(), allowed)}
        allowed={allowed}
        onToggle={onToggle}
      />,
      container,
    );
  });
  return onToggle;
};

const el = (testId: string): HTMLElement | null =>
  container.querySelector(`[data-testid="${testId}"]`);

const expand = async (): Promise<void> => {
  await act(() => {
    el('assist-disclosure')?.click();
  });
};

const renderedIds = (): readonly string[] =>
  [...container.querySelectorAll('.hh-assists__row')]
    .map((row) => (row as HTMLElement).dataset['assist'] ?? '')
    .filter((id) => id !== 'prediction');

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
});

describe('the rendered set comes from #81’s model (#140)', () => {
  it('renders exactly the allowed assists, in the model’s order', async () => {
    await mount();
    await expand();
    // Derived from the model on both sides — see the file docstring.
    expect(renderedIds()).toEqual(ASSIST_IDS.filter((id) => ACT_I_ALLOWED.includes(id)));
  });

  it('renders every assist when a contract allows every one', async () => {
    await mount(ASSIST_IDS);
    await expand();
    expect(renderedIds()).toEqual([...ASSIST_IDS]);
  });

  it('omits an assist the contract does not allow, rather than disabling it', async () => {
    await mount();
    await expand();
    // §6.6's unlock is progression, not purchase: the targeting computer before C13 is not
    // a thing the player is being denied, it is a thing that does not exist yet.
    expect(el('assist-targeting_computer')).toBeNull();
    expect(el('assist-porkchop')).toBeNull();
  });

  it('gives every assist a name and a one-line description', async () => {
    await mount(ASSIST_IDS);
    await expand();
    for (const id of ASSIST_IDS) {
      const row = container.querySelector(`[data-assist="${id}"]`);
      expect(row?.textContent ?? '', id).not.toBe('');
      // The tray is where a player learns the vocabulary, so the hint is associated with
      // the control rather than merely near it.
      const hint = row?.querySelector('.hh-assists__hint');
      expect(el(`assist-${id}`)?.getAttribute('aria-describedby'), id).toBe(hint?.id);
    }
  });
});

describe('the medal effect, with its direction (FR-411)', () => {
  it('says an assist earns Blind when it is turned off', async () => {
    await mount(ASSIST_IDS);
    await expand();
    // `closest_approach` is `blindWhenDisabled` in the model; the assertion reads the model
    // rather than assuming which one it is.
    const id = ASSIST_IDS.find((candidate) => ASSISTS[candidate].effect === 'blindWhenDisabled');
    if (id === undefined) throw new Error('the model has no blindWhenDisabled assist');
    expect(el(`assist-${id}-effect`)?.textContent).toContain('off');
    expect(el(`assist-${id}-effect`)?.textContent).toContain('Blind');
  });

  it('says an assist caps the contract when it is turned on', async () => {
    await mount(ASSIST_IDS);
    await expand();
    const id = ASSIST_IDS.find((candidate) => ASSISTS[candidate].effect === 'capsWhenEnabled');
    if (id === undefined) throw new Error('the model has no capsWhenEnabled assist');
    expect(el(`assist-${id}-effect`)?.textContent).toContain('Using this');
    expect(el(`assist-${id}-effect`)?.textContent).toContain('Silver');
  });

  it('states the two directions differently, which is the whole point', async () => {
    await mount(ASSIST_IDS);
    await expand();
    const blind = ASSIST_IDS.find((id) => ASSISTS[id].effect === 'blindWhenDisabled');
    const caps = ASSIST_IDS.find((id) => ASSISTS[id].effect === 'capsWhenEnabled');
    if (blind === undefined || caps === undefined) throw new Error('model is missing an effect');
    // A uniform "affects medals" badge would be wrong about half of them.
    expect(el(`assist-${blind}-effect`)?.textContent).not.toBe(
      el(`assist-${caps}-effect`)?.textContent,
    );
  });

  it('says nothing about medals for an assist that is free', async () => {
    await mount(ASSIST_IDS);
    await expand();
    const id = ASSIST_IDS.find((candidate) => ASSISTS[candidate].effect === 'none');
    if (id === undefined) throw new Error('the model has no free assist');
    // Nothing, rather than "no effect on medals" — which would invite the reader to wonder
    // what the effect is.
    expect(el(`assist-${id}-effect`)).toBeNull();
  });
});

describe('the current cap (FR-411)', () => {
  it('is Clean Job with the defaults, which is §6.7’s reading', async () => {
    await mount();
    // A player using every default assist is Clean Job eligible: the two capping assists
    // are off by default, and the other four affect a medal only by being switched off.
    expect(el('assist-cap')?.dataset['cap']).toBe('clean');
    expect(el('assist-cap')?.textContent).toContain('any medal');
  });

  it('is visible while the tray is collapsed', async () => {
    await mount();
    // The cap is the *consequence* of what is inside the tray, and FR-411 exists to make it
    // legible at the moment of choosing — putting it behind the disclosure would hide the
    // number the requirement is about.
    expect(el('assist-body')?.hasAttribute('hidden')).toBe(true);
    expect(el('assist-cap')).not.toBeNull();
  });

  it('drops to Silver as soon as a capping assist is on', async () => {
    const capping = ASSIST_IDS.find((id) => ASSISTS[id].effect === 'capsWhenEnabled');
    if (capping === undefined) throw new Error('the model has no capsWhenEnabled assist');
    await mount(ASSIST_IDS, {
      ...restrictToAllowed(defaultAssistState(), ASSIST_IDS),
      [capping]: true,
    });
    expect(el('assist-cap')?.dataset['cap']).toBe('silver');
    expect(el('assist-cap')?.textContent).toContain('Silver');
  });

  it('stays clean when a Blind-earning assist is switched off', async () => {
    const blind = ASSIST_IDS.find((id) => ASSISTS[id].effect === 'blindWhenDisabled');
    if (blind === undefined) throw new Error('the model has no blindWhenDisabled assist');
    await mount(ASSIST_IDS, {
      ...restrictToAllowed(defaultAssistState(), ASSIST_IDS),
      [blind]: false,
    });
    // Blind is a modifier beside the result, not a cap in the ladder. Reporting it as a cap
    // would tell the player that turning a marker off costs them Gold, which is false.
    expect(el('assist-cap')?.dataset['cap']).toBe('clean');
  });
});

describe('trajectory prediction (§6.6)', () => {
  it('is shown, with its reason', async () => {
    await mount();
    await expand();
    const row = el('assist-prediction');
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain('Always on');
  });

  it('is not a control', async () => {
    await mount();
    await expand();
    // §6.6 lists it as "On, cannot be disabled", and #81's model leaves it out of
    // `AssistId` on purpose. Offering a toggle would be offering a control that must not
    // exist; omitting the row entirely would leave a player hunting for it.
    expect(el('assist-prediction')?.querySelector('input')).toBeNull();
  });
});

describe('the disclosure (§8.3.4)', () => {
  it('is collapsed by default and says so', async () => {
    await mount();
    expect(el('assist-body')?.hasAttribute('hidden')).toBe(true);
    expect(el('assist-disclosure')?.getAttribute('aria-expanded')).toBe('false');
  });

  it('expands and collapses, and is a button so Space and Enter work', async () => {
    await mount();
    await expand();
    expect(el('assist-body')?.hasAttribute('hidden')).toBe(false);
    expect(el('assist-disclosure')?.getAttribute('aria-expanded')).toBe('true');
    await expand();
    expect(el('assist-body')?.hasAttribute('hidden')).toBe(true);
  });
});

describe('toggling (#140)', () => {
  it('reports the assist and its new state', async () => {
    const onToggle = await mount();
    await expand();
    const box = el('assist-snapping') as HTMLInputElement;
    box.checked = false;
    await act(() => {
      box.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onToggle).toHaveBeenCalledWith('snapping', false);
  });

  it('marks a row whose state is not its §6.6 default', async () => {
    await mount(ACT_I_ALLOWED, {
      ...restrictToAllowed(defaultAssistState(), ACT_I_ALLOWED),
      snapping: false,
    });
    await expand();
    expect(el('assist-snapping-changed')).not.toBeNull();
    // And an untouched one is not marked.
    expect(el('assist-elements-changed')).toBeNull();
  });
});
