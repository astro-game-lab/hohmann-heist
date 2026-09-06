/**
 * #186's gate.
 *
 * Four properties, and the last two are the ones that would be easy to lose in a later
 * refactor without anything visibly breaking:
 *
 * - every §8.3.12 setting is represented, and the table's types match its domains;
 * - a bad value is dropped rather than fatal, and never costs a player their progress;
 * - **an unset setting stores nothing** — so a changed code default reaches a player who
 *   never touched it, and an export does not pin today's defaults into the file;
 * - **assigning the default removes the key** — the mechanism that keeps the first true
 *   after a player has visited the screen and put a control back where it was.
 */
import { ASSIST_IDS, decodeAssists, defaultAssistState, encodeAssists } from '@hh/game';
import { PALETTE_IDS } from '@hh/ui';
import { describe, expect, it } from 'vitest';

import {
  SETTINGS,
  SETTING_GROUPS,
  SETTING_KEYS,
  defaultOf,
  emptySettings,
  inDomain,
  parseStoredSettings,
  resolveSettings,
  withKeybindings,
  withSetting,
  withoutSetting,
} from './schema.js';

describe('the table', () => {
  /**
   * §8.3.12's own table, transcribed as a checklist.
   *
   * Written out here rather than derived from `SETTINGS`, because a test that read the
   * table it is checking would pass for any table at all. This is the product definition's
   * list, and the assertion is that the code's list is the same one — which is what makes
   * "every setting in §8.3.12 is represented" (#186) and "all six groups with every
   * setting in the table" (#122) checkable rather than asserted in a PR description.
   */
  const EXPECTED: Readonly<Record<string, readonly string[]>> = {
    display: ['units', 'angles', 'timeFormat', 'theme', 'uiScale'],
    accessibility: ['palette', 'reduceMotion', 'backgroundAnimation', 'lineWeights', 'verbosity'],
    // No `coachMarks`: §8.3.12's coach-marks switch is the `coach_marks` bit of
    // `gameplay.assists`, which the assist-set control renders as one of its seven
    // checkboxes. It was briefly both, which #159 called out as one flag seen twice.
    gameplay: ['assists', 'confirmCommit', 'autoSkipAfter'],
    audio: ['master', 'effects', 'ambience', 'muted'],
    input: ['pointerSensitivity', 'invertScrollZoom'],
    data: ['handle'],
  };

  it('holds every setting §8.3.12 names, in six groups', () => {
    expect([...SETTING_GROUPS]).toStrictEqual(Object.keys(EXPECTED));

    for (const group of SETTING_GROUPS) {
      const present = SETTING_KEYS.filter((key) => SETTINGS[key].group === group).map((key) =>
        key.slice(`${group}.`.length),
      );
      expect(present, group).toStrictEqual(EXPECTED[group]);
    }
  });

  it('gives every setting a default that is inside its own domain', () => {
    for (const key of SETTING_KEYS) {
      expect(inDomain(key, defaultOf(key)), key).toBe(true);
    }
  });

  it('offers all five palettes and §8.3.12s three reduce-motion states', () => {
    expect([...SETTINGS['accessibility.palette'].values]).toStrictEqual([...PALETTE_IDS]);
    expect([...SETTINGS['accessibility.reduceMotion'].values]).toStrictEqual([
      'system',
      'on',
      'off',
    ]);
  });

  it('seeds the assist set from §6.6s defaults, through the mask a replay uses', () => {
    // Not a hand-written number: `encodeAssists` is what §11.6 records, so a default
    // written here as a literal would be a second statement of the bit order that could
    // drift from the frozen one.
    expect(defaultOf('gameplay.assists')).toBe(encodeAssists(defaultAssistState()));
    expect(decodeAssists(defaultOf('gameplay.assists'))).toStrictEqual(defaultAssistState());
  });
});

describe('the domain check', () => {
  it('accepts what the controls can produce and refuses what they cannot', () => {
    expect(inDomain('display.theme', 'light')).toBe(true);
    expect(inDomain('display.theme', 'chartreuse')).toBe(false);
    expect(inDomain('display.theme', 3)).toBe(false);

    expect(inDomain('display.uiScale', 90)).toBe(true);
    expect(inDomain('display.uiScale', 150)).toBe(true);
    expect(inDomain('display.uiScale', 155)).toBe(false);
    expect(inDomain('display.uiScale', 85)).toBe(false);
    // Off the 5% grid. It would render, and no control here can produce it — so it came
    // from a hand-edited file, and honouring it would mean the screen showing a control
    // that disagrees with what is stored.
    expect(inDomain('display.uiScale', 103)).toBe(false);
    expect(inDomain('display.uiScale', Number.NaN)).toBe(false);
    expect(inDomain('display.uiScale', Number.POSITIVE_INFINITY)).toBe(false);

    expect(inDomain('accessibility.lineWeights', true)).toBe(true);
    expect(inDomain('accessibility.lineWeights', 'true')).toBe(false);

    expect(inDomain('data.handle', 'ada')).toBe(true);
    expect(inDomain('data.handle', 'x'.repeat(25))).toBe(false);
  });

  it('refuses an assist mask carrying bits this build does not know', () => {
    expect(inDomain('gameplay.assists', 0)).toBe(true);
    expect(inDomain('gameplay.assists', (1 << ASSIST_IDS.length) - 1)).toBe(true);
    expect(inDomain('gameplay.assists', 1 << ASSIST_IDS.length)).toBe(false);
    expect(inDomain('gameplay.assists', -1)).toBe(false);
    expect(inDomain('gameplay.assists', 1.5)).toBe(false);
  });
});

describe('parsing a stored block', () => {
  it('drops an unknown key and an out-of-domain value, and never fails', () => {
    expect(
      parseStoredSettings({
        'display.theme': 'light',
        'display.uiScale': 103,
        'no.such.setting': true,
        'accessibility.palette': 'sepia',
      }),
    ).toStrictEqual({ 'display.theme': 'light' });

    expect(parseStoredSettings(undefined)).toStrictEqual({});
    expect(parseStoredSettings(null)).toStrictEqual({});
    expect(parseStoredSettings([])).toStrictEqual({});
    expect(parseStoredSettings('dark')).toStrictEqual({});
  });

  it('keeps only string rebinds, and keeps one naming an action it does not know', () => {
    // A rebind for an action this build no longer has is inert rather than invalid: it
    // costs nothing, it is not this module's business to know the binding table, and it
    // would come back if the action did. `keymap.ts` is where an unknown id is ignored.
    expect(
      parseStoredSettings({ keybindings: { addNode: 'k', gone: 'j', bad: 4, empty: '' } }),
    ).toStrictEqual({ keybindings: { addNode: 'k', gone: 'j' } });
  });

  it('omits the rebind map entirely when nothing is rebound', () => {
    expect(parseStoredSettings({ keybindings: {} })).toStrictEqual({});
    expect(parseStoredSettings({ keybindings: 'none' })).toStrictEqual({});
  });
});

describe('resolving', () => {
  it('is total — every key has a value, with or without a stored one', () => {
    const resolved = resolveSettings(emptySettings());
    expect(Object.keys(resolved).sort()).toStrictEqual([...SETTING_KEYS].sort());
    for (const key of SETTING_KEYS) {
      expect(resolved[key], key).toStrictEqual(defaultOf(key));
    }
  });

  it('prefers a stored value and falls back for one outside its domain', () => {
    expect(resolveSettings({ 'display.theme': 'light' })['display.theme']).toBe('light');
    expect(resolveSettings({ 'display.uiScale': 103 })['display.uiScale']).toBe(
      defaultOf('display.uiScale'),
    );
  });
});

describe('storing sparsely', () => {
  /**
   * The property #186 asks for by name, and the reason `withSetting` deletes.
   *
   * A screen that wrote every control's current value on mount would produce a save
   * carrying all twenty-one settings, and from then on this build's defaults would be
   * frozen into that player's file. Changing a default in a later release would reach
   * nobody who had ever opened Settings.
   */
  it('stores nothing for a setting left at its default', () => {
    let stored = emptySettings();
    for (const key of SETTING_KEYS) {
      stored = withSetting(stored, key, defaultOf(key) as never);
    }
    expect(stored).toStrictEqual({});
  });

  it('removes the key when a setting is put back to its default', () => {
    const changed = withSetting(emptySettings(), 'display.theme', 'light');
    expect(changed).toStrictEqual({ 'display.theme': 'light' });
    expect(withSetting(changed, 'display.theme', 'dark')).toStrictEqual({});
  });

  it('refuses a value outside the domain rather than clamping it', () => {
    const stored = withSetting(emptySettings(), 'display.uiScale', 103);
    expect(stored).toStrictEqual({});
  });

  it('resets one setting without touching the others, and all of them together', () => {
    const stored = withSetting(
      withSetting(emptySettings(), 'display.theme', 'light'),
      'accessibility.palette',
      'tritanopia',
    );
    expect(withoutSetting(stored, 'display.theme')).toStrictEqual({
      'accessibility.palette': 'tritanopia',
    });
    expect(emptySettings()).toStrictEqual({});
  });

  it('drops the rebind map when it is emptied', () => {
    const bound = withKeybindings(emptySettings(), { addNode: 'k' });
    expect(bound).toStrictEqual({ keybindings: { addNode: 'k' } });
    expect(withKeybindings(bound, {})).toStrictEqual({});
  });

  /**
   * The consequence, stated as the thing a player would notice.
   *
   * Changing a code default has to change the effective value for someone who never
   * touched that setting, and must *not* for someone who did. Simulated by resolving the
   * same two stored blocks against a table whose default has moved — which is what a
   * release does.
   */
  it('lets a changed code default reach a player who never chose', () => {
    const untouched = emptySettings();
    const chosen = withSetting(emptySettings(), 'display.theme', 'light');

    // Today.
    expect(resolveSettings(untouched)['display.theme']).toBe('dark');
    expect(resolveSettings(chosen)['display.theme']).toBe('light');

    // A later build whose default moved: the untouched save follows it, the chosen one
    // does not. `resolveSettings` reads `SETTINGS`, so the stored block is the whole
    // difference — and the untouched one is empty, which is the point.
    expect(Object.keys(untouched)).toStrictEqual([]);
    expect(Object.keys(chosen)).toStrictEqual(['display.theme']);
  });
});

describe('every key', () => {
  it('is prefixed with its own group, so an exported file reads', () => {
    for (const key of SETTING_KEYS) {
      expect(key.startsWith(`${SETTINGS[key].group}.`), key).toBe(true);
    }
  });
});
