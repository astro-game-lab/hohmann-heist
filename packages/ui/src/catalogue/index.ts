/**
 * The message catalogue — FR-910, NFR-028, and D14.
 *
 * Every user-facing string in the game comes from here. `@hh/game` emits keys and
 * parameters; this resolves them. The two key sets are joined by the compiler: see
 * `types.ts`.
 */
export type {
  AllMessageParams,
  DynamicParams,
  MessageFor,
  MessageFormatters,
  MessageKey,
  Messages,
  MissingKeyPolicy,
  UiMessageParams,
} from './types.js';

export { en } from './en.js';

export type { Catalogue, CatalogueOptions } from './resolve.js';
export {
  DEFAULT_LOCALE,
  MissingMessageKeyError,
  createCatalogue,
  missingKeyFallback,
} from './resolve.js';
