/**
 * Persistence — FR-701, FR-703, §11.7.
 *
 * `apps/web` owns storage (§11.2), which is why this is here and not in a package: the
 * simulation core must run under Node and in a Worker, and neither has a `localStorage`.
 * Nothing below this layer knows a save exists.
 */
export type {
  ContractProgress,
  DailyProgress,
  Medal,
  ParseResult,
  SaveProblem,
  SaveProblemCode,
  SaveV1,
  SettingValue,
} from './schema.js';
export {
  CURRENT_SAVE_VERSION,
  MEDALS,
  SAVE_KEY,
  emptySave,
  medalRank,
  parseSaveV1,
} from './schema.js';

export type { Migration, MigrateResult, UnknownSave } from './migrate.js';
export { MIGRATIONS, isContiguous, migrate } from './migrate.js';

export type { ReadResult } from './transfer.js';
export { canonicalSave, exportSave, importSave, readSaveText, serialiseSave } from './transfer.js';

export type { LoadOutcome, StorageLike, WriteOutcome } from './storage.js';
export { browserStorage, clearSave, loadSave, writeSave } from './storage.js';
