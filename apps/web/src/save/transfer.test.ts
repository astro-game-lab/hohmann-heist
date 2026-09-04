import { describe, expect, it } from 'vitest';

import { emptySave, type ContractProgress, type SaveV1 } from './schema.js';
import { canonicalSave, exportSave, importSave, readSaveText, serialiseSave } from './transfer.js';
import type { Migration } from './migrate.js';

const populated = (): SaveV1 => ({
  v: 1,
  contracts: {
    'c05-tailgate': {
      medal: 'gold',
      bestDv_mps: 72.4,
      bestTime_s: 43_784,
      burns: 2,
      attempts: 7,
      bestReplay: '{"v":1,"s":"c05-tailgate","n":[[1251681,1091177,42,0]]}',
      firstCompletedAt: '2026-09-14T18:22:11Z',
    },
    'c03-cold-open': { medal: 'bronze', bestDv_mps: 118.0, attempts: 3 },
  },
  daily: {
    days: {
      '2026-09-02': { bestDv_mps: 288.1, submitted: false },
      '2026-09-01': { bestDv_mps: 312.9, submitted: true },
    },
    streak: 6,
  },
  settings: { theme: 'dark', reduceMotion: true, uiScale: 110 },
  // Already in canonical order, so the round-trip assertions below compare like with
  // like. That a save built in some *other* order normalises to this one is its own
  // test, two blocks down.
  flags: { coachMarksSeen: ['mark.c03.departureWindow'], codexRead: ['apsides', 'phasing'] },
});

describe('the canonical form', () => {
  /**
   * The property the whole round trip rests on.
   *
   * A save built by playing has its contracts in the order they were attempted; the same
   * save reconstructed from a file has them in the order they appeared in it. Those are
   * the same save, and without a canonical form they are different bytes.
   */
  it('does not depend on the order fields were built in', () => {
    const forwards = populated();
    const backwards: SaveV1 = {
      ...forwards,
      contracts: Object.fromEntries(Object.entries(forwards.contracts).reverse()),
      flags: {
        coachMarksSeen: [...forwards.flags.coachMarksSeen].reverse(),
        codexRead: [...forwards.flags.codexRead].reverse(),
      },
    };
    expect(serialiseSave(backwards)).toBe(serialiseSave(forwards));
  });

  it('sorts the maps by key, since those keys are ids and dates', () => {
    const days = Object.keys((canonicalSave(populated())['daily'] as { days: object }).days);
    expect(days).toStrictEqual(['2026-09-01', '2026-09-02']);
    expect(Object.keys(canonicalSave(populated())['contracts'] as object)).toStrictEqual([
      'c03-cold-open',
      'c05-tailgate',
    ]);
  });

  it('puts the version first, so a reader sees it before anything else', () => {
    expect(Object.keys(canonicalSave(populated()))[0]).toBe('v');
    expect(serialiseSave(emptySave()).startsWith('{"v":1')).toBe(true);
  });

  it('omits absent optional fields rather than writing null', () => {
    expect(serialiseSave(populated())).not.toContain('null');
    expect(serialiseSave(emptySave())).not.toContain('identity');
  });
});

describe('export and import', () => {
  // FR-703. There is no account and no server, so this file is the entire backup story.
  it('round-trips the same JSON, byte for byte', () => {
    for (const save of [emptySave(), populated()]) {
      const exported = exportSave(save);
      const imported = importSave(exported);
      expect(imported.ok).toBe(true);
      if (!imported.ok) continue;
      expect(imported.save).toStrictEqual(save);
      expect(exportSave(imported.save)).toBe(exported);
    }
  });

  /**
   * A round trip normalises order, and that is the point rather than a side effect.
   *
   * The exported file is the only backup, so two exports of the same progress have to be
   * the same file — otherwise a player diffing them, or a sync tool deduplicating them,
   * sees a change that is not one. What comes back is the same *save*, in canonical form.
   */
  it('normalises the order of what it read', () => {
    const shuffled: SaveV1 = {
      ...populated(),
      flags: { coachMarksSeen: ['mark.c03.departureWindow'], codexRead: ['phasing', 'apsides'] },
    };
    const imported = importSave(exportSave(shuffled));
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.save.flags.codexRead).toStrictEqual(['apsides', 'phasing']);
    expect(exportSave(imported.save)).toBe(exportSave(populated()));
  });

  it('survives being round-tripped repeatedly', () => {
    let text = exportSave(populated());
    for (let i = 0; i < 3; i += 1) {
      const imported = importSave(text);
      expect(imported.ok).toBe(true);
      if (!imported.ok) break;
      text = exportSave(imported.save);
    }
    expect(text).toBe(exportSave(populated()));
  });

  it('exports something a person can read, and stores something compact', () => {
    const save = populated();
    expect(exportSave(save)).toContain('\n');
    expect(exportSave(save).endsWith('\n')).toBe(true);
    expect(serialiseSave(save)).not.toContain('\n');
    expect(serialiseSave(save).length).toBeLessThan(exportSave(save).length);
    // Same document either way — only the whitespace differs.
    expect(JSON.parse(serialiseSave(save))).toStrictEqual(JSON.parse(exportSave(save)));
  });

  it('reports text that is not JSON rather than throwing', () => {
    for (const text of ['', 'not json', '{', '[1,2']) {
      const result = importSave(text);
      expect(result, text).toMatchObject({ ok: false, problem: { code: 'unreadable' } });
    }
  });

  it('reports JSON that is not a save', () => {
    expect(importSave('{"v":1}')).toMatchObject({ ok: false, problem: { code: 'unreadable' } });
    expect(importSave('[]')).toMatchObject({ ok: false });
  });

  it('refuses a file from a newer build', () => {
    expect(importSave('{"v":2,"contracts":{}}')).toMatchObject({
      ok: false,
      problem: { code: 'futureVersion', found: 2, supported: 1 },
    });
  });
});

describe('readSaveText', () => {
  /** A document from before `settings` existed, which today's validator would reject. */
  const ancient = JSON.stringify({
    v: 0,
    contracts: {},
    daily: { days: {}, streak: 0 },
    flags: { coachMarksSeen: [], codexRead: [] },
  });

  const migrate_0_1: Migration = {
    from: 0,
    to: 1,
    apply: (save) => ({ ...save, v: 1, settings: {} }),
  };

  // Migrate, *then* validate. Validating first would reject every older save, which is
  // the entire point of having a chain — and this document is exactly that case: valid
  // for its own version, invalid for the current one until the step has run.
  it('migrates before validating, so an older document can still be read', () => {
    const result = readSaveText(ancient, [migrate_0_1]);
    expect(result).toMatchObject({ ok: true, migrated: true });
    if (result.ok) expect(result.save.settings).toStrictEqual({});
  });

  it('refuses the same document when no step reaches it', () => {
    expect(readSaveText(ancient)).toMatchObject({
      ok: false,
      problem: { code: 'unknownVersion' },
    });
  });

  it('reports a document that survived migration but not validation', () => {
    const incomplete: Migration = { from: 0, to: 1, apply: (save) => ({ ...save, v: 1 }) };
    expect(readSaveText(ancient, [incomplete])).toMatchObject({
      ok: false,
      problem: { code: 'unreadable' },
    });
  });
});

/**
 * §11.7: *"Total size for a completed campaign: ~15 kB."*
 *
 * A budget rather than a physical quantity, so it is checked rather than re-derived — but
 * the number it is checked against is the one this build actually produces, printed here
 * so a change to the shape shows up as a number moving rather than as a test that still
 * passes.
 */
describe('size', () => {
  const REPLAY_CHARS = 300;

  /** §6.8: six acts, eighteen contracts, all completed. */
  const completedCampaign = (): SaveV1 => {
    const contracts: Record<string, ContractProgress> = {};
    for (let i = 1; i <= 18; i += 1) {
      const id = `c${String(i).padStart(2, '0')}-contract-name`;
      contracts[id] = {
        medal: 'gold',
        bestDv_mps: 100 + i,
        bestTime_s: 4000 + i,
        burns: 3,
        attempts: 12,
        bestReplay: 'e'.repeat(REPLAY_CHARS),
        firstCompletedAt: '2026-09-14T18:22:11Z',
      };
    }
    return {
      ...emptySave(),
      contracts,
      // §6.12 lists a dozen learning outcomes; FR-902 caps coach marks at three per
      // contract in C01–C04.
      flags: {
        coachMarksSeen: Array.from({ length: 12 }, (_unused, i) => `mark.c0${String(i)}.something`),
        codexRead: Array.from({ length: 12 }, (_unused, i) => `codex-entry-${String(i)}`),
      },
    };
  };

  it('keeps a completed campaign around §11.7’s 15 kB', () => {
    const bytes = new TextEncoder().encode(serialiseSave(completedCampaign())).length;
    // Measured at 8 729 bytes, of which 5 400 is eighteen 300-character replay codes.
    // The budget is not tight; what would make it tight is the replay length, so that
    // is the number to watch when §11.6's codes get longer.
    expect(bytes).toBeLessThan(15_000);
  });

  /**
   * The daily record is the part that grows without bound, and §11.7's figure does not
   * cover it.
   *
   * One `{ "2026-09-01": { "bestDv_mps": 312.9, "submitted": true } }` entry costs about
   * 51 bytes, so a year of play measures 18 728 — more than twice the completed campaign's
   * 8 729, and past the stated budget on its own. Nothing is done about it here: the daily challenge
   * is #163 and the leaderboard is M7, and pruning is their decision to make. This test
   * exists so the decision is made with the number in front of it rather than discovered
   * by a player who cannot save.
   */
  it('records what a year of dailies costs, which §11.7’s figure does not cover', () => {
    const days: Record<string, { bestDv_mps: number; submitted: boolean }> = {};
    for (let i = 0; i < 365; i += 1) {
      const date = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
      days[date] = { bestDv_mps: 300.5, submitted: true };
    }
    const save: SaveV1 = { ...emptySave(), daily: { days, streak: 365 } };
    const bytes = new TextEncoder().encode(serialiseSave(save)).length;
    // Measured at 18 728 bytes for 365 days, on its own, with no contracts at all.
    expect(bytes).toBeGreaterThan(15_000);
    expect(bytes).toBeLessThan(25_000);
  });
});
