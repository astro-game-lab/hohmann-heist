/**
 * The migration chain — FR-701, §11.7.
 *
 * > *versioned with an explicit migration chain (`migrate_1_2`, …). Migrations are pure
 * > functions with tests.*
 *
 * A save outlives the build that wrote it. Someone comes back after a year, their browser
 * still holds a document this build has never seen, and there are exactly three things
 * that can be true of it: it is older and can be brought forward, it is current, or it is
 * from a build that knows more than this one. The third case is the one that matters,
 * and it is why this is a chain with a refusal at the end rather than a defensive read.
 *
 * ## A newer save is refused, not repaired
 *
 * The tempting alternative — read the fields we recognise and ignore the rest — is how
 * progress gets destroyed. A v2 save whose medals moved into a new shape reads as a v1
 * save with no medals; the game then writes that back, and a year of play is gone with no
 * error at any point. So a version above {@link CURRENT_SAVE_VERSION} stops here, before
 * anything is read, and nothing is written over it.
 *
 * ## The shipped chain is empty, and that is not a placeholder
 *
 * Version 1 is the first version, so there is nothing older to migrate from and
 * {@link MIGRATIONS} is `[]`. Writing a fake `migrate_0_1` to have something to point at
 * would be worse than an empty array: it would be untested against any real document and
 * would still be there, believed, when the first genuine migration arrives.
 *
 * What is tested is the **machinery**, against a synthetic chain — that steps run in
 * order, that each is pure, that a gap is refused rather than skipped, that a future
 * version is refused before it is read. Those are the properties the first real migration
 * will depend on, and they are checkable today. `migrate.test.ts` also asserts that
 * {@link MIGRATIONS} is contiguous up to the current version, so the day a migration is
 * added out of order the suite says so.
 */
import { CURRENT_SAVE_VERSION, type SaveProblem } from './schema.js';

/** A document mid-migration: known to be an object, not yet known to be a save. */
export type UnknownSave = Readonly<Record<string, unknown>>;

/**
 * One step.
 *
 * `from` and `to` are declared rather than inferred from array position, so that the
 * chain's contiguity is a property that can be *checked* instead of assumed from the
 * order someone happened to push entries in.
 */
export interface Migration {
  readonly from: number;
  readonly to: number;
  /**
   * Pure: it returns a new document and does not touch the one it was given.
   *
   * Not merely a style preference. A migration that mutated its input would make the
   * chain's result depend on how many times it had been run, which is exactly the
   * property that makes a failed upgrade unrecoverable — the raw document is the only
   * copy of the player's progress until a good one has been written.
   */
  readonly apply: (save: UnknownSave) => UnknownSave;
}

/** Every migration this build knows, in order. Empty: version 1 is the first version. */
export const MIGRATIONS: readonly Migration[] = [];

export type MigrateResult =
  | { readonly ok: true; readonly document: UnknownSave; readonly migrated: boolean }
  | { readonly ok: false; readonly problem: SaveProblem };

/**
 * The declared version, or `undefined` if the document does not declare one.
 *
 * Non-negative integers are all *declared* versions, including `0` — which this game
 * never shipped. Whether a path exists from a given version is the chain's question, not
 * this one's, so `{ "v": 0 }` comes back as `unknownVersion` ("no step reaches it")
 * rather than `unreadable` ("this is not a save"). The second would be a guess about
 * why, and the two refusals are symmetric this way: too new is `futureVersion`, too old
 * is `unknownVersion`, and neither is written over.
 *
 * A negative, fractional or non-numeric `v` is a different matter — nothing wrote that
 * on purpose — and stays `unreadable`.
 */
const versionOf = (document: UnknownSave): number | undefined => {
  const v = document['v'];
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : undefined;
};

/**
 * Bring a document up to `target`, or say why that cannot be done.
 *
 * The chain and the target are parameters with the shipped values as defaults, which is
 * what lets the tests drive the machinery with a real multi-step chain while version 1 is
 * still the only version there is.
 */
export const migrate = (
  document: unknown,
  chain: readonly Migration[] = MIGRATIONS,
  target: number = CURRENT_SAVE_VERSION,
): MigrateResult => {
  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    return { ok: false, problem: { code: 'unreadable', detail: 'not an object' } };
  }

  let current = document as UnknownSave;
  const found = versionOf(current);
  if (found === undefined) {
    return { ok: false, problem: { code: 'unreadable', detail: 'no usable version field' } };
  }

  // Before anything is read. A newer save is not this build's to interpret.
  if (found > target) {
    return { ok: false, problem: { code: 'futureVersion', found, supported: target } };
  }

  let version = found;
  while (version < target) {
    const step = chain.find((candidate) => candidate.from === version);
    if (step === undefined) {
      return { ok: false, problem: { code: 'unknownVersion', found: version, supported: target } };
    }
    // Checked before the step runs rather than after. The step declares where it lands
    // rather than the loop assuming `version + 1`, so a migration that collapses two
    // versions at once is expressible — and one that claims to land where it started is a
    // stall, caught here instead of spinning forever.
    if (step.to <= version) {
      return { ok: false, problem: { code: 'unknownVersion', found: version, supported: target } };
    }
    current = step.apply(current);
    version = step.to;
  }

  if (version !== target) {
    return { ok: false, problem: { code: 'unknownVersion', found: version, supported: target } };
  }

  return { ok: true, document: current, migrated: found !== target };
};

/**
 * Whether a chain forms an unbroken path from `1` to `target`.
 *
 * Exported for the test rather than called at load: a broken chain is a mistake to catch
 * in CI, not a check to pay for on every start-up.
 */
export const isContiguous = (
  chain: readonly Migration[],
  target: number = CURRENT_SAVE_VERSION,
): boolean => {
  let version = 1;
  for (const step of chain) {
    if (step.from !== version || step.to <= step.from) return false;
    version = step.to;
  }
  return version === target;
};
