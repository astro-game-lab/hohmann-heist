import { createCatalogue } from '@hh/ui';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { contractById } from '../contracts/registry.js';
import type { ContractProgress } from '../save/index.js';
import { Briefing } from './Briefing.js';

const catalogue = createCatalogue();
let container: HTMLElement;

/**
 * The real `c03-cold-open`, through `@hh/game`'s own loader.
 *
 * A fixture would let a unit error or a wrong Earth radius look perfectly reasonable — a
 * briefing that said "6 778 km circular" instead of "400 km circular" would render, pass
 * a shape assertion, and be nonsense. The shipped contract is a 400 km circular LEO with
 * a target 400 km above it, and those are numbers a reader can check by eye.
 */
const c03 = (): NonNullable<ReturnType<typeof contractById>> => {
  const scenario = contractById('c03-cold-open');
  if (scenario === undefined) throw new Error('c03-cold-open is not in the registry');
  return scenario;
};

const mount = async (props: Partial<Parameters<typeof Briefing>[0]> = {}): Promise<() => void> => {
  const onAccept = vi.fn();
  await act(() => {
    render(
      <Briefing
        t={catalogue.resolve}
        resolveDynamic={catalogue.resolveDynamic}
        scenario={c03()}
        onAccept={onAccept}
        {...props}
      />,
      container,
    );
  });
  return onAccept;
};

const el = (testId: string): HTMLElement | null =>
  container.querySelector(`[data-testid="${testId}"]`);

const text = (testId: string): string => el(testId)?.textContent ?? '';

/** What is on screen, with the visually-hidden SI values taken out. */
const visible = (testId: string): string => {
  const node = el(testId)?.cloneNode(true);
  if (!(node instanceof HTMLElement)) return '';
  for (const hidden of node.querySelectorAll('.hh-sr-only')) hidden.remove();
  return node.textContent;
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
});

describe('the §8.3.3 layout', () => {
  it('names the client and the fee', async () => {
    await mount();
    expect(text('client')).toContain('withheld');
    expect(text('fee')).toContain('6 kcr');
  });

  it('renders the brief from its catalogue key, not from the scenario file', async () => {
    await mount();
    const brief = text('brief');
    expect(brief).toContain('KESTREL-2');
    // The key itself must never reach the screen, and neither must the missing marker.
    expect(brief).not.toContain('brief.c03');
    expect(brief).not.toContain('⟦');
  });

  it('states the objective with its target and tolerance', async () => {
    await mount();
    // DEP-04's intercept range for C03 is 1 000 m, which reads as a kilometre.
    expect(text('objective')).toBe('Intercept KESTREL-2 within 1.0 km');
  });

  it('shows the Δv budget and the deadline in display units', async () => {
    await mount();
    // The contract's own numbers: a 300 m/s tank and a 3-hour deadline.
    expect(visible('value-dv-budget')).toBe('300 m/s');
    expect(visible('value-deadline')).toBe('3 h 00 m');
  });

  // D12: par is not a hidden developer score.
  it('always shows par', async () => {
    await mount();
    const par = visible('value-par');
    expect(par).toContain('109.1 m/s');
    expect(par).toContain('1 h 09 m');
    // "1 burn", not "1 burns".
    expect(par).toContain('1 burn');
    expect(par).not.toContain('1 burns');
  });

  it('describes the ship and the target, the target with its phase', async () => {
    await mount();
    // 6 778 137 m − 6 378 137 m = 400 km, and the target sits 400 km above that.
    expect(text('setup-ship')).toBe('400 km circular');
    // 0.244 346 rad is 14.0°, and the sign is shown because a phase can be either way.
    expect(text('setup-KESTREL-2')).toBe('800 km circular, +14.0° true anomaly');
  });

  it('gives every §6.5 constraint a row with an icon and one line', async () => {
    await mount();
    const row = el('constraint-altitude_floor');
    expect(row?.textContent).toBe('Never below 100 km');
    expect(row?.querySelector('svg')).not.toBeNull();
    // The icon says nothing the line does not; §8.8's rule about single channels.
    expect(row?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });
});

/**
 * §8.3.3: *"Every value has a tooltip with the SI value."*
 *
 * Both renderings, and the SI one in the DOM as well as in `title` — a `title` is
 * invisible to touch and unreliable to a screen reader.
 */
describe('SI tooltips', () => {
  it('carries the unrounded SI value on every quantity that has one', async () => {
    await mount();
    for (const [name, si] of [
      ['deadline', '10,800 s'],
      ['par', '109.1177 m/s'],
    ] as const) {
      expect(el(`value-${name}`)?.getAttribute('title'), name).toBe(si);
      expect(text(`si-${name}`), name).toBe(si);
    }
  });

  /**
   * A value whose display rendering *is* its SI rendering carries no tooltip.
   *
   * The Δv budget is 300 m/s both ways, so a tooltip would reveal nothing while putting a
   * dotted underline under it and making a screen reader say the quantity twice. Found by
   * looking at the built page; each spelling was correct on its own.
   */
  it('leaves a value alone when there is nothing more to say about it', async () => {
    await mount();
    expect(text('value-dv-budget')).toBe('300 m/s');
    expect(el('value-dv-budget')?.getAttribute('title')).toBeNull();
    expect(el('si-dv-budget')).toBeNull();
  });

  it('shows the display value, with the SI value hidden behind it', async () => {
    await mount();
    // The deadline reads "3 h 00 m" and carries 10 800 s — the same quantity, and the
    // reason the tooltip is worth having is the precision rather than the unit.
    expect(visible('value-deadline')).toBe('3 h 00 m');
    expect(el('value-deadline')?.textContent).toContain('10,800 s');
  });
});

describe('accepting', () => {
  it('has a button', async () => {
    const onAccept = await mount();
    await act(() => {
      el('accept')?.click();
    });
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  // §8.3.3: bound to `Enter`, and reachable from wherever the route change left focus.
  it('is bound to Enter', async () => {
    const onAccept = await mount();
    await act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it('stands down for a modifier, so a browser shortcut still works', async () => {
    const onAccept = await mount();
    for (const modifier of ['ctrlKey', 'metaKey', 'altKey', 'shiftKey'] as const) {
      await act(() => {
        window.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, [modifier]: true }),
        );
      });
    }
    expect(onAccept).not.toHaveBeenCalled();
  });

  // Otherwise activating the focused button with the keyboard would accept twice.
  it('stands down when the event came from a control that handles Enter itself', async () => {
    const onAccept = await mount();
    await act(() => {
      el('accept')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('stops listening once it is gone', async () => {
    const onAccept = await mount();
    render(null, container);
    await act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(onAccept).not.toHaveBeenCalled();
  });
});

/** §8.3.3's four states. */
describe('states', () => {
  const best: ContractProgress = { medal: 'gold', bestDv_mps: 109.2, burns: 1, attempts: 7 };

  it('first attempt: no best, no attempts', async () => {
    await mount();
    expect(text('record')).toContain('best: —');
    expect(text('record')).toContain('attempts: 0');
    expect(el('accept')).not.toBeNull();
  });

  it('replay: shows the best and the attempt count', async () => {
    await mount({ progress: best });
    expect(text('record')).toContain('109.2 m/s');
    expect(text('record')).toContain('gold');
    expect(text('record')).toContain('attempts: 7');
  });

  it('daily variant: shows the date and links to that day’s leaderboard', async () => {
    await mount({ dailyDate: '2026-09-01' });
    expect(text('daily-variant')).toContain('2026-09-01');
    const link = el('daily-variant')?.querySelector('a');
    expect(link?.getAttribute('href')).toBe('#/leaderboard/2026-09-01');
  });

  it('is not a daily variant unless it is told it is', async () => {
    await mount();
    expect(el('daily-variant')).toBeNull();
  });

  /**
   * Locked, reached by direct URL.
   *
   * A prop rather than something this screen works out — §6.8's unlock rule lives once,
   * in `tools/content/reachability.ts`, and moves to `@hh/game` with progression (#82).
   * The state is exercised here because the screen owns *rendering* it.
   */
  it('locked: states the unlock rule instead of offering ACCEPT', async () => {
    await mount({ locked: true });
    expect(el('accept')).toBeNull();
    const locked = text('locked');
    expect(locked).toContain('Bronze');
    // C03 is in act 1, and the rule quotes the act it is stating a gate for.
    expect(locked).toContain('Act 1');
  });

  it('locked: does not accept on Enter either', async () => {
    const onAccept = await mount({ locked: true });
    await act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(onAccept).not.toHaveBeenCalled();
  });
});
