/**
 * #122's gate, and the UI halves of #187 and #185.
 *
 * The screen is generated from `SETTINGS`, so "every setting is present" is checked
 * against the table rather than against a list written here — a hand-written list would
 * have to be remembered, and the thing being verified is precisely that nobody has to
 * remember. What *is* written out by hand is §8.3.12's six group names, because that list
 * is the product definition's and not the code's.
 */
import { createCatalogue } from '@hh/ui';
import { render, type JSX } from 'preact';
import { useState } from 'preact/hooks';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { emptySave, type SaveV1 } from '../save/index.js';
import type { Rebinds } from '../planner/keys.js';
import { SettingsScreen } from './SettingsScreen.js';
import {
  SETTINGS,
  SETTING_GROUPS,
  SETTING_KEYS,
  resolveSettings,
  withKeybindings,
  withSetting,
  type SettingKey,
  type StoredSettings,
} from './schema.js';

const catalogue = createCatalogue();
let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
});

const el = (id: string): HTMLElement | null =>
  container.querySelector<HTMLElement>(`[data-testid="${id}"]`);

const populated = (): SaveV1 => ({
  ...emptySave(),
  contracts: {
    'c01-first-light': { attempts: 2, medal: 'clean' },
    'c02-close-pass': { attempts: 3, medal: 'gold' },
    'c03-cold-open': { attempts: 7, medal: 'gold' },
    'c04-long-haul': { attempts: 4 },
  },
});

interface HarnessProps {
  readonly save?: SaveV1;
  readonly onReplace?: (save: SaveV1) => void;
  readonly onClear?: () => void;
  readonly onStored?: (stored: StoredSettings) => void;
}

/** The screen with its state above it, the way `app.tsx` holds it. */
const Harness = ({ save, onReplace, onClear, onStored }: HarnessProps): JSX.Element => {
  const [stored, setStored] = useState<StoredSettings>({});
  const update = (next: StoredSettings): void => {
    setStored(next);
    onStored?.(next);
  };

  return (
    <SettingsScreen
      t={catalogue.resolve}
      settings={resolveSettings(stored)}
      rebinds={stored.keybindings ?? {}}
      save={save ?? emptySave()}
      onSet={(key, value) => {
        update(withSetting(stored, key, value));
      }}
      onSetRebinds={(rebinds: Rebinds) => {
        update(withKeybindings(stored, rebinds));
      }}
      onResetAll={() => {
        update({});
      }}
      onReplaceSave={onReplace ?? (() => undefined)}
      onClearSave={onClear ?? (() => undefined)}
    />
  );
};

const mount = async (props: HarnessProps = {}): Promise<void> => {
  await act(() => {
    render(<Harness {...props} />, container);
  });
};

const click = async (id: string): Promise<void> => {
  await act(() => {
    el(id)?.click();
  });
};

describe('the six groups', () => {
  it('renders every one of §8.3.12s groups as a fieldset with a legend', async () => {
    await mount();
    // The product definition's list, written out — the code's list is what it is checked
    // against, and a test that read `SETTING_GROUPS` would pass for any grouping at all.
    for (const group of ['display', 'accessibility', 'gameplay', 'audio', 'input', 'data']) {
      const fieldset = el(`settings-group-${group}`);
      expect(fieldset, group).not.toBeNull();
      expect(fieldset?.tagName, group).toBe('FIELDSET');
      // §8.8: a screen reader has to announce which group a control belongs to, and only
      // a real legend does that. A styled heading would look identical and say nothing.
      expect(fieldset?.querySelector('legend')?.textContent, group).toBeTruthy();
    }
    expect([...SETTING_GROUPS]).toHaveLength(6);
  });

  it('renders a control for every setting in the table', async () => {
    await mount();
    for (const key of SETTING_KEYS) {
      expect(el(`setting-${key}`), key).not.toBeNull();
    }
  });

  it('puts each control in the group its row declares', async () => {
    await mount();
    for (const key of SETTING_KEYS) {
      const group = el(`settings-group-${SETTINGS[key].group}`);
      expect(group?.contains(el(`setting-${key}`)), key).toBe(true);
    }
  });

  it('has no Save button, and says so', async () => {
    await mount();
    // No button *submits* the settings. "Export save" and "Import save" are the Data
    // group's, and they are about the save file rather than about applying a change.
    const labels = [...container.querySelectorAll('button')].map((b) => b.textContent.trim());
    expect(labels).not.toContain('Save');
    expect(labels).not.toContain('Apply');
    expect(container.textContent).toContain('no Save button');
  });
});

describe('changing a setting', () => {
  /**
   * A radio by its value, read as a *property* rather than as an attribute.
   *
   * Preact assigns `value` to the DOM property for inputs and does not always reflect it
   * to the attribute, so `input[value="on"]` misses a control that is plainly there. The
   * property is what the browser submits and what the click handler reads, so it is also
   * the honest thing to select on.
   */
  const radio = (settingKey: SettingKey, value: string): HTMLInputElement | null =>
    [
      ...(el(`setting-${settingKey}`)?.querySelectorAll<HTMLInputElement>('input[type="radio"]') ??
        []),
    ].find((input) => input.value === value) ?? null;

  it('applies immediately and stores only what changed', async () => {
    const onStored = vi.fn();
    await mount({ onStored });

    await act(() => {
      radio('accessibility.palette', 'tritanopia')?.click();
    });

    expect(onStored).toHaveBeenLastCalledWith({ 'accessibility.palette': 'tritanopia' });
    expect(radio('accessibility.palette', 'tritanopia')?.checked).toBe(true);
  });

  it('removes the key again when a control goes back to its default', async () => {
    const onStored = vi.fn();
    await mount({ onStored });

    await act(() => {
      radio('display.theme', 'light')?.click();
    });
    await act(() => {
      radio('display.theme', 'dark')?.click();
    });
    // Disabled control, so the clicks do nothing at all — see the inert-control test.
    expect(onStored).not.toHaveBeenCalled();

    await act(() => {
      radio('accessibility.verbosity', 'verbose')?.click();
    });
    expect(onStored).toHaveBeenLastCalledWith({ 'accessibility.verbosity': 'verbose' });
    await act(() => {
      radio('accessibility.verbosity', 'terse')?.click();
    });
    expect(onStored).toHaveBeenLastCalledWith({});
  });

  it('offers all five palettes', async () => {
    await mount();
    const options = el('setting-accessibility.palette')?.querySelectorAll('input[type="radio"]');
    expect(options).toHaveLength(5);
    for (const id of ['default', 'deuteranopia', 'protanopia', 'tritanopia', 'high-contrast']) {
      expect(radio('accessibility.palette', id), id).not.toBeNull();
    }
  });

  it('offers reduce motion in three states, not two', async () => {
    await mount();
    for (const state of ['system', 'on', 'off']) {
      expect(radio('accessibility.reduceMotion', state), state).not.toBeNull();
    }
  });

  it('scales the interface across §8.3.12s 90–150%, in steps a control can produce', async () => {
    await mount();
    const slider = el('setting-display.uiScale')?.querySelector<HTMLInputElement>('input');
    expect(slider?.min).toBe('90');
    expect(slider?.max).toBe('150');
    expect(el('value-display.uiScale')?.textContent).toBe('100%');
  });

  it('renders the assist set as §6.6s seven assists, not as a number', async () => {
    await mount();
    expect(el('setting-gameplay.assists')?.querySelectorAll('input[type="checkbox"]')).toHaveLength(
      7,
    );
    // The defaults §6.6 declares, through the same encoding a replay code uses.
    expect(el('assist-elements')).toHaveProperty('checked', true);
    expect(el('assist-porkchop')).toHaveProperty('checked', false);
  });

  it('resets everything to the code defaults', async () => {
    const onStored = vi.fn();
    await mount({ onStored });
    await act(() => {
      radio('accessibility.verbosity', 'verbose')?.click();
    });
    await click('reset-all-settings');
    expect(onStored).toHaveBeenLastCalledWith({});
  });
});

/**
 * #122: a group with no consumer is *"shown with an honest note or deferred"* and **never
 * shown as working when it is not**.
 */
describe('the groups that are stored and inert', () => {
  it('disables the theme control and says why', async () => {
    await mount();
    const control = el('setting-display.theme');
    for (const input of control?.querySelectorAll('input') ?? []) {
      expect(input.disabled).toBe(true);
    }
    expect(control?.textContent).toContain('Only the dark theme is built');
  });

  it('shows the audio group with an honest note rather than hiding it', async () => {
    await mount();
    const audio = el('settings-group-audio');
    expect(audio?.textContent).toContain('There is no sound yet');
    // Present and operable: the levels are stored now so they are already the player's
    // when playback lands (M4).
    expect(el('setting-audio.master')).not.toBeNull();
    expect(el('setting-audio.muted')).not.toBeNull();
  });

  it('labels the handle as having nowhere to go yet', async () => {
    await mount();
    expect(el('setting-data.handle')?.textContent).toContain('does not exist yet');
  });
});

describe('the Input group — remapping (#187)', () => {
  const capture = async (bindingId: string): Promise<void> => {
    await click(`capture-${bindingId}`);
  };

  const press = async (bindingId: string, key: string, init: KeyboardEventInit = {}) => {
    await act(() => {
      el(`capture-${bindingId}`)?.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
      );
    });
  };

  it('lists every binding in §8.5.3s table', async () => {
    await mount();
    // Pending rows included — a binding the remapper could not offer is a binding a player
    // could not reach once its feature lands. `C` for the Codex is the remaining one;
    // `?` stopped being pending when #124 landed.
    expect(el('binding-addNode')).not.toBeNull();
    expect(el('binding-help')).not.toBeNull();
    expect(el('binding-codex')?.textContent).toContain('Not built yet');
    expect(el('binding-help')?.textContent).not.toContain('Not built yet');
  });

  it('binds a key and shows it, without a reload', async () => {
    const onStored = vi.fn();
    await mount({ onStored });
    await capture('addNode');
    await press('addNode', 'k');

    expect(onStored).toHaveBeenLastCalledWith({ keybindings: { addNode: 'k' } });
    expect(el('binding-addNode')?.querySelector('kbd')?.textContent).toBe('k');
  });

  it('refuses a reserved key and says so, rather than trapping the player', async () => {
    const onStored = vi.fn();
    await mount({ onStored });
    await capture('addNode');
    await press('addNode', 'Enter');

    expect(onStored).not.toHaveBeenCalled();
    expect(el('binding-addNode')?.textContent).toContain('reserved');
  });

  it('leaves capture on Escape without binding anything', async () => {
    const onStored = vi.fn();
    await mount({ onStored });
    await capture('addNode');
    await press('addNode', 'Escape');
    expect(onStored).not.toHaveBeenCalled();
    expect(el('capture-addNode')?.getAttribute('aria-pressed')).toBe('false');
  });

  it('reports a same-scope conflict by name, and binds nothing until answered', async () => {
    const onStored = vi.fn();
    await mount({ onStored });
    await capture('addNode');
    await press('addNode', 'e');

    expect(onStored).not.toHaveBeenCalled();
    expect(el('binding-addNode')?.textContent).toContain('Open the selected burn');
    expect(el('swap-addNode')).not.toBeNull();
  });

  it('swaps the two rather than leaving one unbound', async () => {
    const onStored = vi.fn();
    await mount({ onStored });
    await capture('addNode');
    await press('addNode', 'e');
    await click('swap-addNode');

    expect(onStored).toHaveBeenLastCalledWith({ keybindings: { addNode: 'e', editNode: 'n' } });
  });

  it('cancels a conflict without changing anything', async () => {
    const onStored = vi.fn();
    await mount({ onStored });
    await capture('addNode');
    await press('addNode', 'e');
    await click('cancel-addNode');
    expect(onStored).not.toHaveBeenCalled();
  });

  it('accepts a cross-scope reuse without asking', async () => {
    const onStored = vi.fn();
    await mount({ onStored });
    // `s` is skip-to-end during execution and nothing in the planner.
    await capture('recentre');
    await press('recentre', 's');
    expect(onStored).toHaveBeenLastCalledWith({ keybindings: { recentre: 's' } });
  });

  it('resets one binding, and the whole map', async () => {
    const onStored = vi.fn();
    await mount({ onStored });
    await capture('addNode');
    await press('addNode', 'k');
    expect(el('reset-addNode')).not.toBeNull();

    await click('reset-addNode');
    expect(onStored).toHaveBeenLastCalledWith({});

    await capture('addNode');
    await press('addNode', 'k');
    await click('reset-all-bindings');
    expect(onStored).toHaveBeenLastCalledWith({});
  });

  it('offers no reset for a binding still at its default', async () => {
    await mount();
    expect(el('reset-addNode')).toBeNull();
  });
});

describe('the Data group — export, import, clear (#185)', () => {
  it('states what is being replaced in concrete terms, not an abstract question', async () => {
    await mount({ save: populated() });
    await click('clear-save');

    const summary = el('data-confirm-summary')?.textContent ?? '';
    // Three contracts finished, not the four that have progress: the fourth was attempted
    // and never completed, and telling a player they are losing it would be wrong.
    expect(summary).toContain('3 contracts finished');
    expect(summary).toContain('1 Clean Job');
    expect(summary).toContain('2 Gold');
  });

  it('offers to export first, from inside the confirmation', async () => {
    await mount({ save: populated() });
    await click('clear-save');
    expect(el('confirm-export-first')).not.toBeNull();
  });

  it('dismisses with Esc without acting', async () => {
    const onClear = vi.fn();
    await mount({ save: populated(), onClear });
    await click('clear-save');

    await act(() => {
      el('data-confirm')?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    });

    expect(el('data-confirm')).toBeNull();
    expect(onClear).not.toHaveBeenCalled();
  });

  it('clears only when confirmed', async () => {
    const onClear = vi.fn();
    await mount({ save: populated(), onClear });

    await click('clear-save');
    await click('confirm-cancel');
    expect(onClear).not.toHaveBeenCalled();

    await click('clear-save');
    await click('confirm-proceed');
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(el('data-outcome')?.textContent).toContain('cleared');
  });

  it('says so honestly when there is nothing to lose', async () => {
    await mount();
    await click('clear-save');
    expect(el('data-confirm-summary')?.textContent).toContain('nothing stored to lose');
  });

  it('links §11.12s "what we store"', async () => {
    await mount();
    expect(el('what-we-store')?.getAttribute('href')).toBe('#/codex/what-we-store');
  });

  it('every action is keyboard-operable and has an accessible name', async () => {
    await mount();
    for (const id of ['export-save', 'import-save', 'clear-save']) {
      const button = el(id);
      expect(button?.tagName, id).toBe('BUTTON');
      expect(button?.textContent.trim(), id).toBeTruthy();
    }
  });
});

describe('every control', () => {
  it('is reachable by keyboard — nothing is a click-only affordance', async () => {
    await mount();
    const interactive = container.querySelectorAll('input, button, select, textarea, a[href]');
    expect(interactive.length).toBeGreaterThan(0);
    for (const element of interactive) {
      // A negative tabindex would take it out of the tab order; nothing here sets one
      // except the file picker, which the Import button drives and names.
      const tabIndex = element.getAttribute('tabindex');
      if (element.getAttribute('data-testid') === 'import-file') continue;
      expect(tabIndex === null || Number(tabIndex) >= 0, element.outerHTML.slice(0, 60)).toBe(true);
    }
  });
});
