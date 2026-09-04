/**
 * The save, as a shape — FR-701, §11.7.
 *
 * One `localStorage` key, one JSON document, one version number at its head. Everything
 * the player has done is in here, and nothing else is: no cache, no derived state, no
 * second key holding "just the settings". A single key is what makes export, import and
 * "clear all local data" (FR-703) each a one-line operation rather than a list of places
 * to remember.
 *
 * ## One deliberate deviation from §11.7's sketch
 *
 * §11.7 writes the daily record as a map with the streak inside it:
 *
 * ```jsonc
 * "daily": { "2026-09-01": { … }, "streak": 6 }
 * ```
 *
 * This uses `{ "days": { "2026-09-01": { … } }, "streak": 6 }` instead. The same
 * information, one level deeper, for two reasons that are hard to walk back later: a map
 * whose values are *either* a daily result or a number has no useful TypeScript type and
 * forces every reader to narrow, and `"streak"` is a legal key in the same namespace as
 * the dates, so a future date format — or a bug — could collide with it. §11.7 is a
 * jsonc illustration rather than a schema (its `settings` is a comment), and this is the
 * one place taking it literally would cost something permanent.
 *
 * ## What is deliberately absent
 *
 * `identity` — the handle and keypair §11.7 shows — is optional here and is never
 * written. Its only consumer is the leaderboard (FR-801), which is M7 and has not chosen
 * a signature scheme; generating a key now would make that choice on its behalf, from a
 * layer that cannot see the verification design. §11.12's promise that the private key
 * never leaves the device is meanwhile true in the strongest available sense: there is no
 * key. When M7 adds one, it is an optional field appearing on an existing version, which
 * needs no migration.
 */

/** The `localStorage` key. Namespaced, because Pages serves other games from the org. */
export const SAVE_KEY = 'hohmann-heist:save';

/** The version this build reads and writes. */
export const CURRENT_SAVE_VERSION = 1;

/** §6.7's medals. Cumulative in the player's head; the highest earned is what is stored. */
export type Medal = 'bronze' | 'silver' | 'gold' | 'clean';

/**
 * §6.7's medals, worst to best.
 *
 * Exported as an ordered list rather than a set, because the save keeps the *highest*
 * medal earned (§6.7: *"medals are cumulative — earning Gold does not remove Bronze"*)
 * and "highest" needs an order. `MEDAL_RANK` is what a comparison uses; the array is
 * what the validator checks membership against, so the two cannot name different sets.
 */
export const MEDALS: readonly Medal[] = Object.freeze(['bronze', 'silver', 'gold', 'clean']);

/** Where a medal sits in {@link MEDALS}. Higher is better. */
export const medalRank = (medal: Medal | undefined): number =>
  medal === undefined ? -1 : MEDALS.indexOf(medal);

/** What one contract's history holds. Everything but `attempts` needs a completion. */
export interface ContractProgress {
  readonly medal?: Medal;
  readonly bestDv_mps?: number;
  readonly bestTime_s?: number;
  readonly burns?: number;
  /** Counts every accepted briefing, so it is present from the first attempt. */
  readonly attempts: number;
  /** §11.6's share code for the best run. */
  readonly bestReplay?: string;
  /** ISO 8601, UTC. A timestamp for the player, never an input to the simulation. */
  readonly firstCompletedAt?: string;
}

/** One day of the daily challenge (§6.9). */
export interface DailyProgress {
  readonly bestDv_mps: number;
  readonly submitted: boolean;
}

/**
 * A settings value.
 *
 * §8.3.12's groups are #169's, and this is deliberately an open record until then rather
 * than an interface with every setting optional: an open record needs no migration when a
 * setting is added, and #169 is where the shape of each group gets decided by the screen
 * that renders it.
 */
export type SettingValue = string | number | boolean;

export interface SaveV1 {
  readonly v: 1;
  /** Absent until M7. See the note at the top of this file. */
  readonly identity?: { readonly handle: string; readonly publicKey: string };
  readonly contracts: Readonly<Record<string, ContractProgress>>;
  readonly daily: {
    readonly days: Readonly<Record<string, DailyProgress>>;
    readonly streak: number;
  };
  readonly settings: Readonly<Record<string, SettingValue>>;
  readonly flags: {
    /** FR-902's dismissed coach marks, by catalogue key. */
    readonly coachMarksSeen: readonly string[];
    readonly codexRead: readonly string[];
  };
}

/** A save with nothing in it. What a first-time player has. */
export const emptySave = (): SaveV1 => ({
  v: CURRENT_SAVE_VERSION,
  contracts: {},
  daily: { days: {}, streak: 0 },
  settings: {},
  flags: { coachMarksSeen: [], codexRead: [] },
});

/** Why a document could not be read as a save. A code, not a sentence — FR-910. */
export type SaveProblemCode =
  /** Not JSON at all, or JSON that is not a save. */
  | 'unreadable'
  /** Written by a newer build. Refused rather than partially read. */
  | 'futureVersion'
  /** A version this build has no migration path from. */
  | 'unknownVersion';

export interface SaveProblem {
  readonly code: SaveProblemCode;
  /** Present for a version problem. */
  readonly found?: number;
  readonly supported?: number;
  /** Diagnostic, for a bug report. Never rendered as prose — it is not translated. */
  readonly detail?: string;
}

export type ParseResult =
  | { readonly ok: true; readonly save: SaveV1 }
  | { readonly ok: false; readonly problem: SaveProblem };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** An optional field is either absent or the right type. Never `null`, never `NaN`. */
const optional = (value: unknown, check: (v: unknown) => boolean): boolean =>
  value === undefined || check(value);

const unreadable = (detail: string): ParseResult => ({
  ok: false,
  problem: { code: 'unreadable', detail },
});

const parseContract = (value: unknown): ContractProgress | undefined => {
  if (!isRecord(value)) return undefined;
  if (!isFiniteNumber(value['attempts']) || value['attempts'] < 0) return undefined;
  if (!optional(value['medal'], (v) => MEDALS.some((medal): boolean => medal === v))) {
    return undefined;
  }
  if (!optional(value['bestDv_mps'], isFiniteNumber)) return undefined;
  if (!optional(value['bestTime_s'], isFiniteNumber)) return undefined;
  if (!optional(value['burns'], isFiniteNumber)) return undefined;
  if (!optional(value['bestReplay'], (v) => typeof v === 'string')) return undefined;
  if (!optional(value['firstCompletedAt'], (v) => typeof v === 'string')) return undefined;

  // Rebuilt field by field rather than spread, so that a document carrying extra
  // properties cannot smuggle them into the save and back out through export. What this
  // build does not understand, it does not keep.
  return {
    attempts: value['attempts'],
    ...(value['medal'] === undefined ? {} : { medal: value['medal'] as Medal }),
    ...(value['bestDv_mps'] === undefined ? {} : { bestDv_mps: value['bestDv_mps'] as number }),
    ...(value['bestTime_s'] === undefined ? {} : { bestTime_s: value['bestTime_s'] as number }),
    ...(value['burns'] === undefined ? {} : { burns: value['burns'] as number }),
    ...(value['bestReplay'] === undefined ? {} : { bestReplay: value['bestReplay'] as string }),
    ...(value['firstCompletedAt'] === undefined
      ? {}
      : { firstCompletedAt: value['firstCompletedAt'] as string }),
  };
};

const parseDay = (value: unknown): DailyProgress | undefined => {
  if (!isRecord(value)) return undefined;
  if (!isFiniteNumber(value['bestDv_mps'])) return undefined;
  if (typeof value['submitted'] !== 'boolean') return undefined;
  return { bestDv_mps: value['bestDv_mps'], submitted: value['submitted'] };
};

/**
 * Read a document that claims to be a current-version save.
 *
 * Structural rather than schema-driven on purpose. `@hh/game`'s scenario loader compiles
 * Ajv ahead of time because a scenario is written by a contributor and its errors are
 * addressed to them; a save is written by this build and read by this build, its only
 * corruption is external, and the useful answer is "yes" or "no" rather than a JSON
 * pointer. Shipping a validator to the browser for that would cost more bytes than the
 * whole save (NFR-020).
 */
export const parseSaveV1 = (value: unknown): ParseResult => {
  if (!isRecord(value)) return unreadable('not an object');
  if (value['v'] !== CURRENT_SAVE_VERSION) return unreadable('not version 1');

  const { contracts, daily, settings, flags, identity } = value;

  if (!isRecord(contracts)) return unreadable('contracts is not an object');
  const readContracts: Record<string, ContractProgress> = {};
  for (const [id, raw] of Object.entries(contracts)) {
    const parsed = parseContract(raw);
    if (parsed === undefined) return unreadable(`contracts.${id}`);
    readContracts[id] = parsed;
  }

  if (!isRecord(daily)) return unreadable('daily is not an object');
  if (!isRecord(daily['days'])) return unreadable('daily.days is not an object');
  if (!isFiniteNumber(daily['streak'])) return unreadable('daily.streak is not a number');
  const readDays: Record<string, DailyProgress> = {};
  for (const [date, raw] of Object.entries(daily['days'])) {
    const parsed = parseDay(raw);
    if (parsed === undefined) return unreadable(`daily.days.${date}`);
    readDays[date] = parsed;
  }

  if (!isRecord(settings)) return unreadable('settings is not an object');
  const readSettings: Record<string, SettingValue> = {};
  for (const [name, raw] of Object.entries(settings)) {
    if (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean') {
      return unreadable(`settings.${name}`);
    }
    readSettings[name] = raw;
  }

  if (!isRecord(flags)) return unreadable('flags is not an object');
  if (!isStringArray(flags['coachMarksSeen'])) return unreadable('flags.coachMarksSeen');
  if (!isStringArray(flags['codexRead'])) return unreadable('flags.codexRead');

  let readIdentity: SaveV1['identity'];
  if (identity !== undefined) {
    if (!isRecord(identity)) return unreadable('identity is not an object');
    if (typeof identity['handle'] !== 'string') return unreadable('identity.handle');
    if (typeof identity['publicKey'] !== 'string') return unreadable('identity.publicKey');
    readIdentity = { handle: identity['handle'], publicKey: identity['publicKey'] };
  }

  return {
    ok: true,
    save: {
      v: CURRENT_SAVE_VERSION,
      ...(readIdentity === undefined ? {} : { identity: readIdentity }),
      contracts: readContracts,
      daily: { days: readDays, streak: daily['streak'] },
      settings: readSettings,
      flags: {
        coachMarksSeen: [...flags['coachMarksSeen']],
        codexRead: [...flags['codexRead']],
      },
    },
  };
};
