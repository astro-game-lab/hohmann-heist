/**
 * The `localStorage` slot — FR-701, FR-702, §11.7.
 *
 * Everything here is written so that **no failure of storage can stop the game**. The
 * loader always hands back a save, the writer always hands back an outcome, and nothing
 * throws. That is FR-702's requirement (*"MUST remain fully playable when storage is
 * unavailable"*), and it is not achievable by wrapping calls in try/catch at the call
 * sites, because there are four distinct ways this fails and three of them are silent.
 *
 * ## The four ways
 *
 * - **Absent.** No save yet. The overwhelmingly common case, and not a failure: a first
 *   run returns an empty save with `status: 'empty'`.
 * - **Unavailable.** Safari with cookies blocked throws on *reading the
 *   `localStorage` property itself*, before any method is called — which is why
 *   {@link browserStorage} probes inside a try/catch and returns `null` rather than
 *   handing back an object that will throw later. Firefox with `dom.storage.enabled`
 *   off is the same shape.
 * - **Corrupt.** Something else wrote to the key, a quota-exceeded write truncated it, a
 *   sync extension mangled it. Reported, and — this is the part that matters — **not
 *   written over**. The raw text comes back with the problem so it can still be exported.
 *   A game that repaired itself by overwriting would destroy the only copy of whatever
 *   was recoverable.
 * - **Full.** The quota is per origin and shared with everything else the origin stores.
 *   §11.7 calls ~15 kB "well within any quota", which is true and is not the same as
 *   impossible: a quota can be lowered by the user, and Safari's private mode has
 *   historically reported a quota of zero. A write that cannot happen is a returned
 *   outcome, never an exception on the path of whatever the player just did.
 */
import { SAVE_KEY, emptySave, type SaveProblem, type SaveV1 } from './schema.js';
import { readSaveText, serialiseSave } from './transfer.js';

/** The part of `Storage` this module uses. Named so a test needs no browser. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type LoadOutcome =
  | { readonly status: 'loaded'; readonly save: SaveV1; readonly migrated: boolean }
  | { readonly status: 'empty'; readonly save: SaveV1 }
  | { readonly status: 'unavailable'; readonly save: SaveV1 }
  | {
      readonly status: 'problem';
      readonly save: SaveV1;
      readonly problem: SaveProblem;
      /** The bytes that were there. Kept so the player can still export them. */
      readonly raw: string;
    };

export type WriteOutcome =
  | { readonly status: 'written' }
  | { readonly status: 'quotaExceeded' }
  | { readonly status: 'unavailable' };

/**
 * Whether a thrown value is the quota saying no.
 *
 * Three spellings, because the standard name is recent and the game supports browsers
 * that predate it (§11.15). Chromium and modern Firefox throw a `DOMException` named
 * `QuotaExceededError` with code 22; older Firefox throws `NS_ERROR_DOM_QUOTA_REACHED`
 * with code 1014; Safari's private mode has thrown `QuotaExceededError` with code 22 for
 * a quota that is simply zero. Matching on the name alone would miss the second, and on
 * the code alone would misread an unrelated `DOMException`.
 */
const isQuotaExceeded = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  return (
    error.name === 'QuotaExceededError' ||
    error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
    code === 22 ||
    code === 1014
  );
};

/**
 * The browser's `localStorage`, or `null` if it cannot be used.
 *
 * Probed with a real write rather than by checking that the object exists: a storage that
 * is present and throws on every `setItem` is the case that actually happens, and it is
 * indistinguishable from a working one until something is written to it.
 */
export const browserStorage = (): StorageLike | null => {
  try {
    // Reached through a type that admits its absence. `lib.dom` declares
    // `globalThis.localStorage` as always present, which is the assumption this function
    // exists to not make: Safari with cookies blocked throws on the property access
    // itself, and a build running under Node has no such property at all.
    const storage = (globalThis as { localStorage?: StorageLike }).localStorage;
    if (storage === undefined) return null;
    const probe = `${SAVE_KEY}:probe`;
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
};

/** Read the save. Always returns one — see the note at the top of this file. */
export const loadSave = (storage: StorageLike | null): LoadOutcome => {
  if (storage === null) return { status: 'unavailable', save: emptySave() };

  let raw: string | null;
  try {
    raw = storage.getItem(SAVE_KEY);
  } catch {
    return { status: 'unavailable', save: emptySave() };
  }

  if (raw === null) return { status: 'empty', save: emptySave() };

  const result = readSaveText(raw);
  if (!result.ok) {
    return { status: 'problem', save: emptySave(), problem: result.problem, raw };
  }
  return { status: 'loaded', save: result.save, migrated: result.migrated };
};

/** Write the save. Never throws; the caller decides what a failure means to the player. */
export const writeSave = (storage: StorageLike | null, save: SaveV1): WriteOutcome => {
  if (storage === null) return { status: 'unavailable' };
  try {
    storage.setItem(SAVE_KEY, serialiseSave(save));
    return { status: 'written' };
  } catch (error) {
    return { status: isQuotaExceeded(error) ? 'quotaExceeded' : 'unavailable' };
  }
};

/** FR-703's "clear all local data". Never throws. */
export const clearSave = (storage: StorageLike | null): void => {
  if (storage === null) return;
  try {
    storage.removeItem(SAVE_KEY);
  } catch {
    // Nothing to do and nothing to tell the player: the data they asked to be rid of is
    // in a storage that cannot be reached, which is as cleared as this build can make it.
  }
};
