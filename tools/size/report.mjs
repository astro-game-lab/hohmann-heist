// Render the bundle-size budgets as a Markdown table.
//
// The gate on its own answers "did this PR bust a budget", which is only the
// question worth asking on the day it fails. The number and its headroom answer
// "is this PR moving us towards one", which is worth asking on every PR -- and it
// has to be visible without opening a log, or nobody will look. In CI this is
// appended to $GITHUB_STEP_SUMMARY, which renders on the run's summary page.
//
// This runs size-limit itself rather than reading a pipe, so that a failing gate
// still produces a report: piping would couple the two exit codes together, and
// the run where a budget is exceeded is exactly the run whose numbers matter most.
// It never fails the build -- the `pnpm size` step is the gate.

import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Decimal, matching NFR-020's notation and size-limit's own parsing.
const kB = (bytes) => `${(bytes / 1000).toFixed(bytes < 100_000 ? 2 : 1)} kB`;

function measure() {
  const stdout = execFileSync('node_modules/.bin/size-limit', ['--json'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    // A busted budget exits non-zero while still printing usable JSON.
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return JSON.parse(stdout);
}

function main() {
  let results;
  try {
    results = measure();
  } catch (error) {
    // Recover the JSON from a non-zero exit; give up quietly if there is none.
    const stdout = error.stdout?.toString() ?? '';
    const start = stdout.indexOf('[');
    if (start === -1) {
      process.stdout.write(`## Bundle size\n\nsize-limit produced no report.\n`);
      return;
    }
    results = JSON.parse(stdout.slice(start));
  }

  const rows = results.map((entry) => {
    const headroom = entry.sizeLimit - entry.size;
    const used = ((entry.size / entry.sizeLimit) * 100).toFixed(1);
    return [
      entry.passed ? 'pass' : '**FAIL**',
      entry.name,
      kB(entry.size),
      kB(entry.sizeLimit),
      headroom >= 0 ? `${kB(headroom)} (${used}% used)` : `**over by ${kB(-headroom)}**`,
    ];
  });

  const lines = [
    '## Bundle size',
    '',
    '| | Budget | Size (gzip) | Limit | Headroom |',
    '| --- | --- | --- | --- | --- |',
    ...rows.map((cells) => `| ${cells.join(' | ')} |`),
    '',
    '_NFR-020 targets gate the merge; the §11.9 hard limits are shown alongside so the',
    'distinction between what the game is designed to fit in and what it must never',
    'exceed stays visible._',
    '',
  ];

  process.stdout.write(lines.join('\n'));
}

main();
