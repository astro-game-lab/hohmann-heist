import { describe, expect, it } from 'vitest';

import { CURRENT_SAVE_VERSION, emptySave, parseSaveV1, type SaveV1 } from './schema.js';

/** A save with something in every field, so a validator that ignores one is caught. */
const populated = (): SaveV1 => ({
  v: 1,
  contracts: {
    'c03-cold-open': {
      medal: 'gold',
      bestDv_mps: 109.2,
      bestTime_s: 4123,
      burns: 1,
      attempts: 7,
      bestReplay: '{"v":1,"s":"c03-cold-open"}',
      firstCompletedAt: '2026-09-04T10:00:00Z',
    },
  },
  daily: { days: { '2026-09-01': { bestDv_mps: 312.9, submitted: true } }, streak: 6 },
  settings: { 'display.theme': 'light', 'display.uiScale': 110 },
  flags: { coachMarksSeen: ['mark.c03.departureWindow'], codexRead: ['phasing'] },
});

describe('emptySave', () => {
  it('is what a first-time player has', () => {
    const save = emptySave();
    expect(save.v).toBe(CURRENT_SAVE_VERSION);
    expect(save.contracts).toStrictEqual({});
    expect(save.daily).toStrictEqual({ days: {}, streak: 0 });
    expect(save.flags).toStrictEqual({ coachMarksSeen: [], codexRead: [] });
  });

  it('is a fresh object each time, so one game does not share it with the next', () => {
    expect(emptySave()).not.toBe(emptySave());
    expect(emptySave().contracts).not.toBe(emptySave().contracts);
  });
});

describe('parseSaveV1', () => {
  it('accepts a save with every field populated, unchanged', () => {
    const save = populated();
    const result = parseSaveV1(JSON.parse(JSON.stringify(save)));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.save).toStrictEqual(save);
  });

  it('accepts an empty save', () => {
    const result = parseSaveV1(JSON.parse(JSON.stringify(emptySave())));
    expect(result.ok).toBe(true);
  });

  it('accepts the optional identity M7 will add', () => {
    const result = parseSaveV1({
      ...JSON.parse(JSON.stringify(emptySave())),
      identity: { handle: 'perijove', publicKey: 'abc' },
    });
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.save.identity).toStrictEqual({ handle: 'perijove', publicKey: 'abc' });
  });

  /**
   * What this build does not understand, it does not keep.
   *
   * The save is rebuilt field by field rather than spread, so a document carrying extra
   * properties cannot smuggle them through a load and back out through an export — where
   * they would look, to anyone reading the file, like something the game wrote.
   */
  it('drops properties it does not know about', () => {
    const result = parseSaveV1({
      ...JSON.parse(JSON.stringify(emptySave())),
      contracts: { 'c03-cold-open': { attempts: 1, cheatMode: true } },
      somethingElse: 42,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.save.contracts['c03-cold-open']).toStrictEqual({ attempts: 1 });
    expect(Object.keys(result.save)).not.toContain('somethingElse');
  });

  it('rejects a document that is not an object', () => {
    for (const value of [null, undefined, 'save', 7, [1]]) {
      expect(parseSaveV1(value), String(value)).toMatchObject({ ok: false });
    }
  });

  it('rejects a document that is not version 1', () => {
    expect(parseSaveV1({ ...emptySave(), v: 2 })).toMatchObject({ ok: false });
    expect(parseSaveV1({ ...emptySave(), v: '1' })).toMatchObject({ ok: false });
  });

  it('names the field that failed, for a bug report', () => {
    const result = parseSaveV1({ ...emptySave(), contracts: { c03: { attempts: 'many' } } });
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.problem.detail).toContain('contracts.c03');
  });

  it('rejects each malformed branch', () => {
    const base = JSON.parse(JSON.stringify(populated())) as Record<string, unknown>;
    const broken: readonly Record<string, unknown>[] = [
      { ...base, contracts: [] },
      { ...base, contracts: { c03: { attempts: -1 } } },
      { ...base, contracts: { c03: { attempts: 1, medal: 'platinum' } } },
      { ...base, contracts: { c03: { attempts: 1, bestDv_mps: Number.NaN } } },
      { ...base, daily: { days: {} } },
      { ...base, daily: { days: { '2026-09-01': { bestDv_mps: 1 } }, streak: 0 } },
      { ...base, daily: { days: [], streak: 0 } },
      { ...base, flags: { coachMarksSeen: [1], codexRead: [] } },
      { ...base, flags: { coachMarksSeen: [] } },
      { ...base, identity: { handle: 'x' } },
    ];
    for (const document of broken) {
      expect(parseSaveV1(document), JSON.stringify(document).slice(0, 80)).toMatchObject({
        ok: false,
      });
    }
  });

  /**
   * Settings are the one block that cannot make a save unreadable — #186, FR-701.
   *
   * Every other field here refuses a document it does not understand, and that is right:
   * a contract record with a negative attempt count is a corrupted save and pretending
   * otherwise would report progress nobody made. Settings are the opposite case. They are
   * the least important thing in the document and the most likely to be hand-edited —
   * §11.7 invites the player to open the file — so a typo in one must cost that setting
   * and nothing else. A save whose whole medal history was refused because `uiScale` said
   * `"large"` would be the worst bug this module could have.
   */
  it('never refuses a save over its settings — a bad one is dropped, not fatal', () => {
    const base = JSON.parse(JSON.stringify(populated())) as Record<string, unknown>;
    const survivors: readonly Record<string, unknown>[] = [
      { ...base, settings: { 'display.theme': { nested: true } } },
      { ...base, settings: { 'display.theme': 'chartreuse' } },
      { ...base, settings: { 'display.uiScale': 103 } },
      { ...base, settings: { 'display.uiScale': Number.NaN } },
      { ...base, settings: { 'no.such.setting': 1 } },
      { ...base, settings: [] },
      { ...base, settings: 'dark' },
    ];
    for (const document of survivors) {
      const result = parseSaveV1(document);
      expect(result.ok, JSON.stringify(document['settings'])).toBe(true);
      // And the progress it was carrying is untouched, which is the point.
      if (result.ok) expect(result.save.contracts['c03-cold-open']?.medal).toBe('gold');
    }
  });

  it('drops an unknown settings key and an out-of-domain value, keeping the rest', () => {
    const base = JSON.parse(JSON.stringify(populated())) as Record<string, unknown>;
    const result = parseSaveV1({
      ...base,
      settings: {
        'display.theme': 'light',
        'display.uiScale': 103,
        'no.such.setting': true,
        keybindings: { addNode: 'k', bogus: 4 },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // `light` is in domain and kept; 103 is off the 5% step grid and dropped, so the
    // default applies; the unknown key never enters the document; and a rebind whose
    // value is not a string goes with it.
    expect(result.save.settings).toStrictEqual({
      'display.theme': 'light',
      keybindings: { addNode: 'k' },
    });
  });

  // `Infinity` and `NaN` do not survive `JSON.stringify` — they come back as `null` —
  // so a save holding one would be silently corrupted by its own export.
  it('rejects non-finite numbers', () => {
    expect(
      parseSaveV1({ ...populated(), daily: { days: {}, streak: Number.POSITIVE_INFINITY } }),
    ).toMatchObject({ ok: false });
  });
});
