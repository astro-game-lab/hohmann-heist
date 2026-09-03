// "A golden moved, so docs/PHYSICS.md has to move too" (#71, docs/PRODUCT.md §11.13).
//
//   node tools/goldens/physics-doc-gate.mjs                  compare against origin/main
//   node tools/goldens/physics-doc-gate.mjs --base <ref>     compare against another ref
//   node tools/goldens/physics-doc-gate.mjs --files a b c    check an explicit list
//
// §11.13: "any PR that changes a physics result must update `docs/PHYSICS.md` in the
// same PR (CI check on the golden fixtures enforces this by failing loudly)." That
// sentence has been in the product definition since M0 and nothing enforced it. This
// is the enforcement.
//
// ## Why the golden fixtures are the trigger, and not "any change under packages/"
//
// A rule that fired on every touched file in `@hh/astro` would fire on a renamed
// variable, and a rule that fires on things that do not matter is one people learn to
// satisfy with an empty line in the document. `tools/goldens/fixtures.json` is exactly
// the file that cannot change unless an evaluated trajectory changed -- that is what
// the golden suite is for -- so it is the precise signal, and it stays precise without
// anyone maintaining a list of which modules count as physics.
//
// The check is deliberately shallow: it asks whether `docs/PHYSICS.md` is in the same
// diff, not whether what was written there is any good. No script can check the
// second, and pretending to would be worse than not trying -- review is what checks
// that. What this buys is that the question gets asked at all, on the pull request
// where the numbers moved, rather than three months later when nobody remembers.
//
// ## Exit codes
//
//   0  nothing to enforce, or the document moved with the fixtures
//   1  the fixtures moved and the document did not
//   2  the check could not run (bad usage, or no base to compare against)
//
// Testable without git: `--files` takes the list directly, which is how
// `tools/guardrails/guardrails.test.ts` checks that this fires when it should. A
// blocking check that has quietly stopped working is worse than no check.

import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The file that cannot change unless an evaluated trajectory did. */
const FIXTURES = 'tools/goldens/fixtures.json';
/** The document that has to say what changed. */
const PHYSICS_DOC = 'docs/PHYSICS.md';

/**
 * The rule, as a pure function of the changed-file list.
 *
 * Paths are compared as git reports them: repository-relative, forward slashes.
 */
export function check(changedFiles) {
  const changed = new Set(changedFiles);

  if (!changed.has(FIXTURES)) {
    return { ok: true, message: `${FIXTURES} is unchanged; nothing to enforce.` };
  }
  if (changed.has(PHYSICS_DOC)) {
    return {
      ok: true,
      message: `${FIXTURES} changed and ${PHYSICS_DOC} changed with it. Good.`,
    };
  }
  return {
    ok: false,
    message:
      `${FIXTURES} changed but ${PHYSICS_DOC} did not.\n\n` +
      'A golden trajectory only moves when an evaluated result moved, which makes this a change\n' +
      'to the physics model rather than to a test fixture. docs/PRODUCT.md §11.13 requires the\n' +
      'physics document to be updated in the same pull request, and docs/PHYSICS.md exists so a\n' +
      'reader can tell how far to trust a number the game prints.\n\n' +
      'Say what changed and why: which validation rows are affected, whether a stated tolerance\n' +
      'or measured figure moved, and — if the change was not intended — stop and find out what\n' +
      'moved before regenerating the fixtures.',
  };
}

/** Files changed between `base` and `HEAD`, as git reports them. */
function changedSince(base) {
  const stdout = execFileSync('git', ['diff', '--name-only', `${base}...HEAD`], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  return stdout.split('\n').filter((line) => line.length > 0);
}

function resolveBase(requested) {
  if (requested !== undefined) return requested;
  // `GITHUB_BASE_REF` is set on a pull_request event and names the target branch.
  const fromCi = process.env.GITHUB_BASE_REF;
  return fromCi ? `origin/${fromCi}` : 'origin/main';
}

function main() {
  const argv = process.argv.slice(2);

  const filesFlag = argv.indexOf('--files');
  if (filesFlag !== -1) {
    const outcome = check(argv.slice(filesFlag + 1));
    process.stdout.write(`${outcome.message}\n`);
    process.exitCode = outcome.ok ? 0 : 1;
    return;
  }

  const baseFlag = argv.indexOf('--base');
  if (baseFlag !== -1 && argv[baseFlag + 1] === undefined) {
    process.stderr.write('--base needs a ref.\n');
    process.exitCode = 2;
    return;
  }
  const base = resolveBase(baseFlag === -1 ? undefined : argv[baseFlag + 1]);

  let files;
  try {
    files = changedSince(base);
  } catch (error) {
    // A missing base is a broken invocation, not a passing check. Saying so beats
    // exiting zero, which would turn a misconfigured CI step into a silent no-op --
    // the failure mode this whole file exists to prevent, one level up.
    process.stderr.write(
      `could not diff against \`${base}\`: ${error.message}\n` +
        'The gate needs the base branch fetched. In CI, check out with `fetch-depth: 0`.\n',
    );
    process.exitCode = 2;
    return;
  }

  const outcome = check(files);
  process.stdout.write(`${outcome.message}\n`);
  process.exitCode = outcome.ok ? 0 : 1;
}

// Only when run as a program. Importing this module must not exit the process.
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
