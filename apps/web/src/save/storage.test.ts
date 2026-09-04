import { describe, expect, it } from 'vitest';

import { SAVE_KEY, emptySave, type SaveV1 } from './schema.js';
import { serialiseSave } from './transfer.js';
import { browserStorage, clearSave, loadSave, writeSave, type StorageLike } from './storage.js';

/** A `localStorage` whose failures the test chooses. */
const fakeStorage = (
  options: { readonly throwOnRead?: boolean; readonly failWrite?: Error } = {},
): StorageLike & { readonly map: Map<string, string> } => {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => {
      if (options.throwOnRead === true) throw new Error('storage disabled');
      return map.get(key) ?? null;
    },
    setItem: (key, value) => {
      if (options.failWrite !== undefined) throw options.failWrite;
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
};

/** A `DOMException`-shaped quota refusal, in each of the spellings browsers use. */
const quotaError = (name: string, code: number): Error =>
  Object.assign(new Error('quota'), { name, code });

const populated = (): SaveV1 => ({
  ...emptySave(),
  contracts: { 'c03-cold-open': { medal: 'bronze', attempts: 4 } },
});

describe('loading', () => {
  it('gives a first-time player an empty save', () => {
    expect(loadSave(fakeStorage())).toStrictEqual({ status: 'empty', save: emptySave() });
  });

  it('reads back what was written', () => {
    const storage = fakeStorage();
    expect(writeSave(storage, populated())).toStrictEqual({ status: 'written' });
    const outcome = loadSave(storage);
    expect(outcome.status).toBe('loaded');
    expect(outcome.save).toStrictEqual(populated());
  });

  it('uses one key, so export, import and clear are each one operation', () => {
    const storage = fakeStorage();
    writeSave(storage, populated());
    expect([...storage.map.keys()]).toStrictEqual([SAVE_KEY]);
  });

  it('stores the compact form', () => {
    const storage = fakeStorage();
    writeSave(storage, populated());
    expect(storage.map.get(SAVE_KEY)).toBe(serialiseSave(populated()));
  });
});

describe('when storage is unavailable', () => {
  // FR-702: the game stays playable. Every outcome carries a save, so no caller has to
  // branch just to get one.
  it('still hands back a save when there is no storage at all', () => {
    expect(loadSave(null)).toStrictEqual({ status: 'unavailable', save: emptySave() });
  });

  it('still hands back a save when reading throws', () => {
    expect(loadSave(fakeStorage({ throwOnRead: true }))).toStrictEqual({
      status: 'unavailable',
      save: emptySave(),
    });
  });

  it('reports a write it could not make, rather than throwing', () => {
    expect(writeSave(null, populated())).toStrictEqual({ status: 'unavailable' });
    expect(writeSave(fakeStorage({ failWrite: new Error('nope') }), populated())).toStrictEqual({
      status: 'unavailable',
    });
  });

  it('clears without complaint when there is nothing to clear from', () => {
    expect(() => {
      clearSave(null);
    }).not.toThrow();
  });
});

describe('when the quota is full', () => {
  // §11.7 calls ~15 kB "well within any quota", which is true and is not the same as
  // impossible: a quota can be lowered, and Safari's private mode has reported zero.
  it('recognises the quota in each spelling browsers use', () => {
    const spellings = [
      quotaError('QuotaExceededError', 22),
      quotaError('NS_ERROR_DOM_QUOTA_REACHED', 1014),
      // A name this build has never seen, with the standard code. Matching on the name
      // alone would misread this as an ordinary failure.
      quotaError('SomethingElse', 22),
    ];
    for (const failWrite of spellings) {
      expect(writeSave(fakeStorage({ failWrite }), populated()), failWrite.name).toStrictEqual({
        status: 'quotaExceeded',
      });
    }
  });

  it('does not mistake an unrelated failure for a full quota', () => {
    expect(writeSave(fakeStorage({ failWrite: new Error('security') }), populated())).toStrictEqual(
      { status: 'unavailable' },
    );
  });
});

describe('when the stored data is corrupt', () => {
  const corrupt = (raw: string): ReturnType<typeof loadSave> => {
    const storage = fakeStorage();
    storage.map.set(SAVE_KEY, raw);
    return loadSave(storage);
  };

  it('reports it rather than bricking the game', () => {
    const outcome = corrupt('{"v":1,"contracts":');
    expect(outcome.status).toBe('problem');
    expect(outcome.save).toStrictEqual(emptySave());
  });

  /**
   * The part that makes it recoverable.
   *
   * A game that repaired itself by overwriting would destroy the only copy of whatever
   * was left. The bytes come back with the problem so they can still be exported, and
   * nothing is written until something explicitly asks for it.
   */
  it('hands back the bytes and leaves them where they were', () => {
    const storage = fakeStorage();
    storage.map.set(SAVE_KEY, 'mangled');
    const outcome = loadSave(storage);
    expect(outcome).toMatchObject({ status: 'problem', raw: 'mangled' });
    expect(storage.map.get(SAVE_KEY)).toBe('mangled');
  });

  it('reports a save from a newer build as a version problem, not as corruption', () => {
    const outcome = corrupt('{"v":9,"contracts":{}}');
    expect(outcome).toMatchObject({
      status: 'problem',
      problem: { code: 'futureVersion', found: 9, supported: 1 },
    });
  });

  it('leaves a newer build’s save untouched', () => {
    const storage = fakeStorage();
    const future = '{"v":9,"contracts":{},"medals":"in some new shape"}';
    storage.map.set(SAVE_KEY, future);
    loadSave(storage);
    expect(storage.map.get(SAVE_KEY)).toBe(future);
  });
});

describe('clearing', () => {
  it('removes the save (FR-703)', () => {
    const storage = fakeStorage();
    writeSave(storage, populated());
    clearSave(storage);
    expect(storage.map.size).toBe(0);
    expect(loadSave(storage).status).toBe('empty');
  });
});

describe('browserStorage', () => {
  // jsdom provides a working `localStorage`, which is the case worth checking here: the
  // probe writes and removes rather than merely checking the object exists, because a
  // storage that is present and throws on every `setItem` is what actually happens.
  it('finds the real one and leaves no probe behind', () => {
    const storage = browserStorage();
    expect(storage).not.toBeNull();
    expect(globalThis.localStorage.getItem(`${SAVE_KEY}:probe`)).toBeNull();
  });

  it('round-trips through the real one', () => {
    const storage = browserStorage();
    expect(writeSave(storage, populated())).toStrictEqual({ status: 'written' });
    expect(loadSave(storage).save).toStrictEqual(populated());
    clearSave(storage);
  });
});
