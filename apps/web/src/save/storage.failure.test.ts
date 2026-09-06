/**
 * #184's mechanical half: **no write path throws, in any of the four ways storage fails.**
 *
 * `storage.test.ts` covers the happy paths and the shapes. This is the adversarial one —
 * a stub that fails in each of the four ways `storage.ts` names, driven through every
 * entry point, asserting that the game is handed an outcome rather than an exception.
 * FR-702's *"remains fully playable"* is not achievable by wrapping call sites in
 * try/catch, because three of the four failures are silent.
 */
import { describe, expect, it } from 'vitest';

import { emptySave, type SaveV1 } from './schema.js';
import { clearSave, loadSave, writeSave, type StorageLike } from './storage.js';
import { exportSave } from './transfer.js';

/** A `DOMException`-shaped quota refusal, in each of the three spellings §11.15 needs. */
const quotaError = (name: string, code: number): Error => {
  const error = new Error('quota');
  error.name = name;
  Object.defineProperty(error, 'code', { value: code });
  return error;
};

const throwingOn = (
  failures: { read?: Error; write?: Error; remove?: Error },
  contents: string | null = null,
): StorageLike => ({
  getItem: () => {
    if (failures.read !== undefined) throw failures.read;
    return contents;
  },
  setItem: () => {
    if (failures.write !== undefined) throw failures.write;
  },
  removeItem: () => {
    if (failures.remove !== undefined) throw failures.remove;
  },
});

const populated = (): SaveV1 => ({
  ...emptySave(),
  contracts: { 'c03-cold-open': { attempts: 7, medal: 'gold' } },
});

describe('the four ways storage fails', () => {
  it('absent — a first run is an empty save, not a failure', () => {
    const outcome = loadSave(throwingOn({}, null));
    expect(outcome.status).toBe('empty');
    expect(outcome.save).toStrictEqual(emptySave());
  });

  it('unavailable — a null storage loads and writes without throwing', () => {
    expect(loadSave(null)).toMatchObject({ status: 'unavailable' });
    expect(writeSave(null, populated())).toStrictEqual({ status: 'unavailable' });
    expect(() => {
      clearSave(null);
    }).not.toThrow();
  });

  it('unavailable — a storage that throws on read is reported, not propagated', () => {
    const outcome = loadSave(throwingOn({ read: new Error('blocked') }));
    expect(outcome.status).toBe('unavailable');
    // And it still hands back a save, so the game has something to run on.
    expect(outcome.save).toStrictEqual(emptySave());
  });

  it('corrupt — the raw bytes come back so they can still be exported', () => {
    const outcome = loadSave(throwingOn({}, '{"v":1,"contracts":'));
    expect(outcome.status).toBe('problem');
    if (outcome.status !== 'problem') return;
    // Not repaired, not overwritten: the only copy of whatever was recoverable is kept.
    expect(outcome.raw).toBe('{"v":1,"contracts":');
  });

  it('full — every quota spelling is recognised as a quota, not as a generic failure', () => {
    for (const error of [
      quotaError('QuotaExceededError', 22),
      quotaError('NS_ERROR_DOM_QUOTA_REACHED', 1014),
      // Safari's private mode: the standard name, for a quota that is simply zero.
      quotaError('QuotaExceededError', 0),
    ]) {
      expect(writeSave(throwingOn({ write: error }), populated()), error.name).toStrictEqual({
        status: 'quotaExceeded',
      });
    }
  });

  it('distinguishes a quota refusal from an unavailable storage', () => {
    // Both are failures and only one of them means "this browser will never store".
    expect(writeSave(throwingOn({ write: new Error('nope') }), populated())).toStrictEqual({
      status: 'unavailable',
    });
  });

  it('never throws from any entry point, whatever storage does', () => {
    const hostile = throwingOn({
      read: new Error('read'),
      write: new Error('write'),
      remove: new Error('remove'),
    });
    expect(() => loadSave(hostile)).not.toThrow();
    expect(() => writeSave(hostile, populated())).not.toThrow();
    expect(() => {
      clearSave(hostile);
    }).not.toThrow();
  });
});

describe('the escape hatch', () => {
  /**
   * #184: *"export works when `localStorage` does not — the in-memory save is the source,
   * not a re-read."*
   *
   * The property is structural rather than defensive: `exportSave` takes a `SaveV1`, so
   * there is no arrangement in which it could consult storage. This states it, because
   * "reads the in-memory save" is the kind of thing a later refactor helpfully breaks by
   * adding a convenience that loads first.
   */
  it('exports the in-memory save in a browser that will not store', () => {
    const save = populated();
    expect(loadSave(null).status).toBe('unavailable');

    const text = exportSave(save);
    expect(text).toContain('c03-cold-open');
    expect(text).toContain('gold');
  });

  it('exports progress that was never persisted', () => {
    // The case a player in Safari with cookies blocked is actually in: they played a
    // contract, the write failed, and the only copy is the one in memory.
    const hostile = throwingOn({ write: quotaError('QuotaExceededError', 22) });
    const save = populated();
    expect(writeSave(hostile, save)).toStrictEqual({ status: 'quotaExceeded' });
    expect(exportSave(save)).toContain('c03-cold-open');
  });
});
