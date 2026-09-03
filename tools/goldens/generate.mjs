// Regenerate tools/goldens/fixtures.json (#71).
//
//   pnpm goldens:write
//
// §7.6 Tier 4 asks for fixtures "produced by a committed script, so regeneration is
// deliberate and lands as a reviewable diff". This is that script. It does almost
// nothing itself: the evaluation lives in `goldens.test.ts`, because the writer and
// the comparison have to agree exactly on what a record is and the cheapest way to
// guarantee that is for them to be the same code.
//
// So this sets a flag and starts Vitest on the `goldens` project. The indirection
// exists because there is no TypeScript runner in this toolchain -- the workspace
// packages export `./src/index.ts` and import each other with `.js` specifiers, which
// Node's type stripping does not resolve -- and adding `tsx` or `vite-node` for one
// script would cost a dependency and an NFR-024 licence row for something Vitest
// already does.
//
// A script rather than an inline `HH_WRITE_GOLDENS=1 vitest ...` in package.json for a
// duller reason: that form is a shell builtin assignment, and it does not work on
// Windows. The repository is developed from WSL, but a package script that silently
// does nothing on half the platforms it might be run from is a trap worth spending
// twenty lines to avoid.

import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const VITEST = join(REPO_ROOT, 'node_modules', '.bin', 'vitest');

const result = spawnSync(VITEST, ['run', '--project', 'goldens'], {
  cwd: REPO_ROOT,
  env: { ...process.env, HH_WRITE_GOLDENS: '1' },
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

if (result.error) {
  process.stderr.write(`could not start vitest: ${result.error.message}\n`);
  process.exitCode = 1;
} else if (result.status !== 0) {
  process.exitCode = result.status ?? 1;
} else {
  process.stdout.write(
    '\nRegenerated tools/goldens/fixtures.json. Review the diff: every number that moved is a ' +
      'physics result that changed, and docs/PHYSICS.md must say so in the same pull request ' +
      '(§11.13).\n',
  );
}
