/**
 * Reading and writing the save as text — FR-703, §11.7.
 *
 * > *Export/import is the same JSON, downloadable. This is also the only "cloud save":
 * > the player carries it.*
 *
 * That sentence is the requirement this file has to be worthy of. There is no account and
 * no server (D11), so the exported file is the *entire* backup story — if it round-trips
 * imperfectly, a player moving between machines silently loses whatever the gap was.
 *
 * ## One canonical form, so a round trip is byte-identical
 *
 * `JSON.stringify` emits keys in insertion order, and insertion order is an accident:
 * a save built by playing has its contracts in the order they were attempted, and the
 * same save reconstructed by `parseSaveV1` has them in the order they appeared in the
 * file. Those are the same save and would serialise to different bytes.
 *
 * So everything goes through {@link canonicalSave} first — fields in a declared order,
 * every map sorted by key. Round-tripping is then checkable by string comparison rather
 * than by a deep-equality helper that has to be trusted, and two exports of the same
 * progress are the same file, which is what makes them diffable and what stops a
 * "nothing changed" write from churning storage.
 *
 * ## Two forms, because the file and the slot are not the same thing
 *
 * {@link exportSave} is indented: it is a file a person may open, and §11.7 offers it as
 * the thing they carry. {@link serialiseSave} is compact: it is what occupies the
 * `localStorage` quota, and indentation there would be a third of the budget spent on
 * whitespace nobody reads. Both are canonical, so importing an exported file and
 * re-exporting it gives the same bytes back.
 */
import {
  parseSaveV1,
  type ContractProgress,
  type DailyProgress,
  type SaveProblem,
  type SaveV1,
} from './schema.js';
import { migrate, type Migration } from './migrate.js';

/** Sort a record's entries by key, so serialisation does not depend on insertion order. */
const sorted = <T>(record: Readonly<Record<string, T>>): [string, T][] =>
  Object.entries(record).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

/**
 * Fields in a declared order, absent ones omitted.
 *
 * Written out per type rather than done generically, because "in a declared order" is
 * exactly the thing a generic key sort would get wrong: `attempts` before `bestDv_mps` is
 * alphabetical by luck, and the moment a field is added the file's shape would reshuffle
 * for every player at once. Maps are sorted by key — those keys are contract ids and
 * dates, where alphabetical *is* the meaningful order.
 */
const canonicalContract = (progress: ContractProgress): Record<string, unknown> => {
  const out: Record<string, unknown> = { attempts: progress.attempts };
  if (progress.medal !== undefined) out['medal'] = progress.medal;
  if (progress.bestDv_mps !== undefined) out['bestDv_mps'] = progress.bestDv_mps;
  if (progress.bestTime_s !== undefined) out['bestTime_s'] = progress.bestTime_s;
  if (progress.burns !== undefined) out['burns'] = progress.burns;
  if (progress.bestReplay !== undefined) out['bestReplay'] = progress.bestReplay;
  if (progress.firstCompletedAt !== undefined) out['firstCompletedAt'] = progress.firstCompletedAt;
  return out;
};

const canonicalDay = (day: DailyProgress): Record<string, unknown> => ({
  bestDv_mps: day.bestDv_mps,
  submitted: day.submitted,
});

const fromEntries = <T>(entries: readonly (readonly [string, T])[]): Record<string, T> =>
  Object.fromEntries(entries);

/** The save as a plain object with a defined key order. What both serialisers stringify. */
export const canonicalSave = (save: SaveV1): Record<string, unknown> => {
  const out: Record<string, unknown> = { v: save.v };
  if (save.identity !== undefined) {
    out['identity'] = { handle: save.identity.handle, publicKey: save.identity.publicKey };
  }
  out['contracts'] = fromEntries(
    sorted(save.contracts).map(([id, progress]) => [id, canonicalContract(progress)] as const),
  );
  out['daily'] = {
    days: fromEntries(sorted(save.daily.days).map(([date, day]) => [date, canonicalDay(day)])),
    streak: save.daily.streak,
  };
  out['settings'] = fromEntries(sorted(save.settings));
  out['flags'] = {
    // Sorted for the same reason the maps are: two saves holding the same dismissed
    // marks in a different order are the same save.
    coachMarksSeen: [...save.flags.coachMarksSeen].sort(),
    codexRead: [...save.flags.codexRead].sort(),
  };
  return out;
};

/** Compact. What goes into `localStorage`, where every byte is quota. */
export const serialiseSave = (save: SaveV1): string => JSON.stringify(canonicalSave(save));

/** Indented. What the player downloads and may open (FR-703). */
export const exportSave = (save: SaveV1): string =>
  `${JSON.stringify(canonicalSave(save), null, 2)}\n`;

export type ReadResult =
  | { readonly ok: true; readonly save: SaveV1; readonly migrated: boolean }
  | { readonly ok: false; readonly problem: SaveProblem };

/**
 * Text in, a save out — the whole read path, in the order it has to happen.
 *
 * Parse, then migrate, then validate. Migrating before validating is the point: the
 * document arriving is not required to be a *current* save, and validating first would
 * reject every older one. Validating after is what makes the migration chain's output the
 * thing that must satisfy today's shape.
 */
export const readSaveText = (
  text: string,
  chain?: readonly Migration[],
  target?: number,
): ReadResult => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      problem: {
        code: 'unreadable',
        detail: error instanceof Error ? error.message : 'not JSON',
      },
    };
  }

  const migrated = migrate(parsed, chain, target);
  if (!migrated.ok) return { ok: false, problem: migrated.problem };

  const validated = parseSaveV1(migrated.document);
  if (!validated.ok) return { ok: false, problem: validated.problem };

  return { ok: true, save: validated.save, migrated: migrated.migrated };
};

/** Import a file the player carried here. Same path as a load, by construction. */
export const importSave = (text: string): ReadResult => readSaveText(text);
