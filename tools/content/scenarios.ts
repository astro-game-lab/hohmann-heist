/**
 * The scenario directory — where shipped contracts live, and how the tooling finds them.
 *
 * §13.4's content suite is "one parameterised test file over the scenario directory", so
 * that **adding a contract adds seven tests for free**. That property is only real if the
 * suite discovers contracts rather than listing them: a hand-maintained list of ids is a
 * list someone forgets to add to, and the contract they forgot is the one that ships
 * unchecked. Everything here walks the directory.
 *
 * ## Why `content/` rather than a package
 *
 * Contracts are data, not code. They are the contributor on-ramp (G6) and the v1.3
 * editor's file format, so they sit at the top of the repository where someone looking
 * for "the contracts" will find them, next to the `content/` subdirectories the Codex and
 * the daily archetypes will want later.
 *
 * Keeping them out of `packages/` also settles a layering question before it is asked.
 * `@hh/game` owns the *format* — the schema, the generated types, the loader — and owns
 * no particular contract; `packages/game/src/scenario/load.ts` says why at length. A
 * directory of contracts inside that package would be the first place a per-contract
 * special case could hide.
 *
 * ## Why this module is under `tools/`
 *
 * It reads files. `node:fs` and `process` are banned in `packages/**` by the core
 * guardrail block, correctly — the simulation must run unchanged in a browser and a
 * Worker, neither of which has a filesystem. `tools/goldens` and `tools/reference` are
 * here for the same reason. The application does not use this module at all: it bundles
 * the JSON through Vite, so nothing that ships ever reads a directory.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Repository root, resolved from this file rather than from the working directory. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The scenario directory §13.4 speaks of. */
export const CONTRACT_DIR = join(REPO_ROOT, 'content', 'contracts');

/** One contract as it sits on disk, before any validation. */
export interface ContractFile {
  /** File stem. Checked against the document's own `id` by the content suite. */
  readonly stem: string;
  readonly path: string;
  /** Repository-relative, forward slashes, for use in an assertion message. */
  readonly relativePath: string;
  readonly text: string;
  /** Parsed, but not validated. `unknown` because that is what the loader takes. */
  readonly document: unknown;
}

/**
 * Every contract in the directory, in filename order.
 *
 * Sorted, and sorted here rather than left to the platform: `readdirSync` makes no
 * ordering promise, and a suite whose `describe` blocks arrive in a different order on
 * a different machine is a suite whose failures are harder to compare (NFR-009).
 *
 * @throws SyntaxError, from `JSON.parse`, when a file is not JSON at all. Deliberately
 * not caught: the content suite's schema check reports a *document's* problems, and it
 * cannot run on a file that never parsed. A truncated contract should stop the run with
 * the parser's own message rather than become a mysterious failure of seven checks.
 */
export const contractFiles = (): readonly ContractFile[] =>
  readdirSync(CONTRACT_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && extname(entry.name) === '.json')
    .map((entry) => entry.name)
    .sort()
    .map((name) => {
      const path = join(CONTRACT_DIR, name);
      const text = readFileSync(path, 'utf8');
      return {
        stem: basename(name, '.json'),
        path,
        relativePath: relative(REPO_ROOT, path).replaceAll('\\', '/'),
        text,
        document: JSON.parse(text) as unknown,
      };
    });
