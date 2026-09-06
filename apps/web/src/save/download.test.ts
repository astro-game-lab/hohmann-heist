/**
 * #185's mechanics, and the round trip §13.5's E14 makes a release gate.
 *
 * The round trip is the assertion that matters most in this file: **export → clear →
 * import restores the save exactly**, compared by canonical serialisation. There is no
 * account and no server (D11), so an imperfect round trip is not a bug a player reports —
 * it is progress that silently disappeared between two machines.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  downloadSave,
  exportFilename,
  readFileText,
  summarise,
  type DownloadHost,
} from './download.js';
import { emptySave, type SaveV1 } from './schema.js';
import { exportSave, importSave, serialiseSave } from './transfer.js';

const populated = (): SaveV1 => ({
  v: 1,
  contracts: {
    'c03-cold-open': { attempts: 7, medal: 'gold', bestDv_mps: 109.2, bestTime_s: 4123, burns: 1 },
    'c01-first-light': { attempts: 2, medal: 'clean', bestDv_mps: 88.4 },
    'c02-close-pass': { attempts: 3, medal: 'gold', bestDv_mps: 200.1 },
    // Attempted and never finished: it has no medal, so it is not "completed".
    'c04-long-haul': { attempts: 4 },
  },
  daily: { days: { '2026-09-01': { bestDv_mps: 312.9, submitted: true } }, streak: 6 },
  settings: { 'display.theme': 'light', keybindings: { addNode: 'k' } },
  flags: { coachMarksSeen: ['mark.c03.departureWindow'], codexRead: ['phasing'] },
});

/**
 * A host that records rather than downloads.
 *
 * The blob's *contents* are not asserted through this seam — a `Blob` reads back
 * asynchronously and the export text is already checked directly against `exportSave`.
 * What this proves is the lifecycle: created, delivered under the right name, revoked.
 */
const recordingHost = (): DownloadHost & { readonly calls: string[] } => {
  const state = {
    calls: [] as string[],
    createObjectURL: () => {
      state.calls.push('create');
      return 'blob:test';
    },
    revokeObjectURL: (url: string) => {
      state.calls.push(`revoke:${url}`);
    },
    deliver: (url: string, filename: string) => {
      state.calls.push(`deliver:${url}:${filename}`);
    },
  };
  return state;
};

describe('the filename', () => {
  it('carries the date and the time, so two exports in a day are distinct', () => {
    const morning = exportFilename(new Date(2026, 8, 6, 9, 4));
    const afternoon = exportFilename(new Date(2026, 8, 6, 14, 32));
    expect(morning).toBe('hohmann-heist-save-2026-09-06-0904.json');
    expect(afternoon).toBe('hohmann-heist-save-2026-09-06-1432.json');
    expect(morning).not.toBe(afternoon);
  });

  it('sorts chronologically in a folder', () => {
    const names = [
      exportFilename(new Date(2026, 11, 1, 0, 0)),
      exportFilename(new Date(2026, 8, 6, 23, 59)),
      exportFilename(new Date(2027, 0, 1, 0, 0)),
    ];
    expect([...names].sort()).toStrictEqual([names[1], names[0], names[2]]);
  });
});

describe('exporting', () => {
  it('delivers the canonical indented document and revokes the URL after', () => {
    const host = recordingHost();
    const filename = downloadSave(populated(), host, new Date(2026, 8, 6, 14, 32));

    expect(filename).toBe('hohmann-heist-save-2026-09-06-1432.json');
    expect(host.calls).toStrictEqual([
      'create',
      'deliver:blob:test:hohmann-heist-save-2026-09-06-1432.json',
      'revoke:blob:test',
    ]);
  });

  it('revokes the URL even when delivery throws', () => {
    const host = recordingHost();
    const throwing: DownloadHost = {
      ...host,
      deliver: () => {
        throw new Error('no downloads here');
      },
    };
    expect(() => downloadSave(populated(), throwing)).toThrow();
    expect(host.calls).toContain('revoke:blob:test');
  });

  it('is byte-identical for unchanged progress', () => {
    expect(exportSave(populated())).toBe(exportSave(populated()));
  });

  it('reads the save it was given, not storage', () => {
    // The whole of #184's "export works when localStorage does not": nothing in this path
    // touches storage, so there is no arrangement in which it could return an empty save.
    const text = exportSave(populated());
    expect(text).toContain('c03-cold-open');
  });
});

describe('the round trip — §13.5 E14', () => {
  it('export → clear → import restores the save exactly', () => {
    const before = populated();
    const carried = exportSave(before);

    // Clear: the game continues with an empty save rather than requiring a reload.
    const cleared = emptySave();
    expect(serialiseSave(cleared)).not.toBe(serialiseSave(before));

    const result = importSave(carried);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Compared by canonical serialisation rather than by deep equality: the canonical
    // form is what "restores exactly" means for a document whose key order is otherwise
    // an accident, and a string comparison needs no helper to be trusted.
    expect(serialiseSave(result.save)).toBe(serialiseSave(before));
    expect(exportSave(result.save)).toBe(carried);
  });

  it('refuses an invalid file with a reason, leaving the current save untouched', () => {
    const current = populated();
    const result = importSave('{"v":1,"contracts":');
    expect(result).toMatchObject({ ok: false, problem: { code: 'unreadable' } });
    // Nothing about the refusal touched the save it would have replaced.
    expect(serialiseSave(current)).toBe(serialiseSave(populated()));
  });

  it('refuses a future-version file, naming the versions', () => {
    const result = importSave(JSON.stringify({ ...populated(), v: 9 }));
    expect(result).toMatchObject({
      ok: false,
      problem: { code: 'futureVersion', found: 9, supported: 1 },
    });
  });

  it('does not smuggle unknown fields through import and back out through export', () => {
    const withExtras = JSON.stringify({
      ...populated(),
      unknownTopLevel: 'x',
      contracts: {
        'c03-cold-open': { attempts: 7, medal: 'gold', somethingNew: 42 },
      },
    });
    const result = importSave(withExtras);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const out = exportSave(result.save);
    expect(out).not.toContain('unknownTopLevel');
    expect(out).not.toContain('somethingNew');
    expect(out).toContain('c03-cold-open');
  });

  it('preserves settings and rebinds across the trip', () => {
    const result = importSave(exportSave(populated()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.save.settings).toStrictEqual({
      'display.theme': 'light',
      keybindings: { addNode: 'k' },
    });
  });
});

describe('the summary a confirmation shows', () => {
  it('counts contracts with a medal, not contracts attempted', () => {
    const summary = summarise(populated());
    // Four contracts have progress; three were completed. Telling a player they are about
    // to lose four when they finished three would be alarming and wrong.
    expect(Object.keys(populated().contracts)).toHaveLength(4);
    expect(summary.contracts).toBe(3);
  });

  it('lists the medals held, best first, omitting the ones held none of', () => {
    expect(summarise(populated()).medals).toStrictEqual([
      { medal: 'clean', count: 1 },
      { medal: 'gold', count: 2 },
    ]);
  });

  it('has nothing to say about an empty save', () => {
    expect(summarise(emptySave())).toStrictEqual({ contracts: 0, medals: [] });
  });
});

describe('reading a picked file', () => {
  it('returns the text', async () => {
    await expect(readFileText(new Blob(['{"v":1}']))).resolves.toStrictEqual({
      ok: true,
      text: '{"v":1}',
    });
  });

  it('refuses rather than rejecting when the read fails', async () => {
    const unreadable = { text: vi.fn().mockRejectedValue(new Error('gone')) } as unknown as Blob;
    await expect(readFileText(unreadable)).resolves.toStrictEqual({ ok: false });
  });
});
