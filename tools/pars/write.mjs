// Recompute every contract's par and write it into the scenario files and docs/PARS.md (#89).
//
//   pnpm pars:write
//
// §6.7 puts the derivation for each contract in `docs/PARS.md`, and §11.5 rules that a par
// without a reproducible derivation is not mergeable. Recomputing one is therefore a
// deliberate act with a reviewable diff, not something a test run does on the way past --
// so the writing lives behind this script and the default path only ever *checks*.
//
// Like `tools/goldens/generate.mjs`, this does almost nothing itself: it sets a flag and
// starts Vitest on the `pars` project, because the writer and the checker have to agree
// exactly on what a par is and the cheapest way to guarantee that is for them to be the
// same code. The indirection exists because this toolchain has no TypeScript runner --
// the workspace packages export `./src/index.ts` and import each other with `.js`
// specifiers, which Node's type stripping does not resolve.
//
// A script rather than an inline `HH_WRITE_PARS=1 vitest ...` in package.json because
// that form is a shell builtin assignment and does not work on Windows.

import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const VITEST = join(REPO_ROOT, 'node_modules', '.bin', 'vitest');

const result = spawnSync(VITEST, ['run', '--project', 'pars'], {
  cwd: REPO_ROOT,
  env: { ...process.env, HH_WRITE_PARS: '1' },
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
    '\nRewrote every par block and docs/PARS.md. Review the diff: a par that moved is a ' +
      'number players are scored against, and D12 publishes it. Say what moved it in the ' +
      'pull request, and in CHANGELOG.md if a physics result is behind it.\n',
  );
}
