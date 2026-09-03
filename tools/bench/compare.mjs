// The benchmark regression gate (#74, NFR-011, NFR-021).
//
// `pnpm bench` asserts §11.9's hard limits inside each benchmark. That catches a
// catastrophe and nothing else: a change that makes plan evaluation forty percent
// slower passes every one of those assertions, and so does the next one. This is the
// other half -- a comparison against a **committed baseline**, so that a slow creep
// across many pull requests is caught while it is still a creep.
//
// Usage:
//   node tools/bench/compare.mjs            gate: non-zero exit on a regression
//   node tools/bench/compare.mjs --report   Markdown to stdout, never fails
//   node tools/bench/compare.mjs --write    regenerate baseline.json from the last run
//
// It reads `.results/`, which `pnpm bench` writes. It never runs the benchmarks
// itself, and that is deliberate: the report has to show the numbers the gate
// actually judged. A report that re-measured would print different ones, and the run
// where they disagree is exactly the run somebody is trying to understand.
//
// ── What is compared, and why it is not milliseconds ────────────────────────────
//
// A baseline is committed once and compared against on whatever machine runs the
// pull request. GitHub-hosted runners are not one machine. So every measurement is
// recorded next to a yardstick -- a frozen scalar floating-point loop, measured in
// the same process on the same run (see `record.ts`) -- and what is compared is the
// dimensionless ratio `measurement / yardstick`. A runner half the speed doubles
// both numbers and leaves the ratio alone.
//
// ── The tolerance, and where it comes from ──────────────────────────────────────
//
// Measured, not chosen. Seven consecutive runs of the whole suite on one quiet
// machine (WSL2 on Windows, Node 24.18), twenty metrics each, taking the run-to-run
// range `(max − min) / median` of every metric:
//
//   statistic compared          typical row   worst row
//   ------------------------    -----------   ---------
//   median, unnormalised            11.8%        31.5%
//   minimum, unnormalised           12.2%        19.7%
//   minimum, normalised (this)      12.5%        21.2%
//
// Two things fall out of that table, and both are worth stating because both are
// slightly against expectation.
//
// **The minimum is the statistic to gate on.** Its typical spread is no better than
// the median's -- 12.2% against 11.8% -- but its *worst* row is 19.7% against 31.5%,
// and a threshold is set by the worst row, not the typical one. Timing noise is
// one-sided, so the minimum over the batches estimates the cost and the median
// estimates the cost plus however much interference the run happened to attract.
//
// **Normalising costs almost nothing here and is not doing the work you might think.**
// It moves the typical spread from 12.2% to 12.5% and the worst from 19.7% to 21.2%,
// because the yardstick carries about 10% run-to-run range of its own and that noise
// is uncorrelated with the metric's. So it does *not* make the comparison quieter on
// one machine -- it slightly worsens it. What it buys is the thing this gate cannot
// work without: a baseline recorded on one machine can be compared against a run on
// another, because a runner half the speed scales both numerator and denominator. The
// alternative is a committed millisecond figure compared against whichever host
// GitHub allocates, and the spread between runner classes is far larger than 12%.
//
// `TOLERANCE` is set at **50%**, which is a little over twice the worst spread
// observed. That is not conservatism for its own sake: the baseline is one recorded
// sample and the run under test is another, so the comparison carries that noise
// twice, and a shared CI runner is noisier than the machine those numbers came from.
// It catches a change that makes an operation half again as expensive -- which is what
// a real regression in this codebase has looked like -- and it catches the creep #74
// is actually about, since the whole point of comparing against a *committed* baseline
// is that ten pull requests each adding 5% arrive at the gate as one 63% change rather
// than as ten invisible ones.
//
// If it starts flaking, **re-measure the spread and update the table above** -- do not
// widen the number and move on. A threshold nobody can justify gets widened again next
// time, and a threshold that has been widened twice is decoration. The measurement is
// seven runs of `pnpm bench`, keeping `.results/` after each.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(HERE, '.results');
const BASELINE = join(HERE, 'baseline.json');
const REPO_ROOT = resolve(HERE, '..', '..');

/** Fractional headroom over the baseline ratio before a metric counts as a regression. */
const TOLERANCE = 0.5;

/**
 * Per-metric overrides, for a row whose noise is genuinely larger than the rest.
 *
 * Empty, and worth keeping empty. The measurement above found no row that needs one:
 * the nanosecond-scale rows -- the cache hit, the three `arcIndexAt` sizes -- came out
 * at 6% to 15%, *below* the microsecond-scale ones, so the intuition that the smallest
 * numbers are the noisiest is simply wrong here and an override for them would have
 * been a guess dressed as a reason.
 *
 * Anything added here needs a reason of the same kind as the table above: a measured
 * property of that measurement, with the numbers. "It was failing" is not one.
 */
const TOLERANCE_BY_KEY = {};

/** A speedup this large means the baseline is stale and should be re-committed. Reported, never fatal. */
const STALE_IMPROVEMENT = 0.25;

const toleranceFor = (key) => TOLERANCE_BY_KEY[key] ?? TOLERANCE;

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

/** Every measurement from the last `pnpm bench`, keyed, plus the yardstick they share. */
function readResults() {
  if (!existsSync(RESULTS_DIR)) {
    return { error: `no results at ${RESULTS_DIR}. Run \`pnpm bench\` first.` };
  }
  const files = readdirSync(RESULTS_DIR).filter((name) => name.endsWith('.json'));
  if (files.length === 0) {
    return { error: `no results in ${RESULTS_DIR}. Run \`pnpm bench\` first.` };
  }

  const measurements = new Map();
  const versions = new Set();
  const yardsticks = [];

  for (const name of files) {
    const result = readJson(join(RESULTS_DIR, name));
    versions.add(result.yardstickVersion);
    yardsticks.push(result.yardstickNs);
    for (const measurement of result.measurements) {
      measurements.set(measurement.key, { ...measurement, file: result.file });
    }
  }
  return { measurements, versions: [...versions], yardsticks };
}

/** Decimal, with enough digits to be useful at every scale these rows span. */
const num = (value) => {
  const abs = Math.abs(value);
  if (abs >= 100) return value.toFixed(0);
  if (abs >= 1) return value.toFixed(2);
  if (abs >= 0.01) return value.toFixed(4);
  return value.toExponential(2);
};

const pct = (fraction) => `${fraction >= 0 ? '+' : ''}${(fraction * 100).toFixed(1)}%`;

/**
 * Compare the last run against the committed baseline.
 *
 * Returns one row per metric plus a list of failures. A metric can fail two ways and
 * the row says which, because "slower than it was" and "outside what §11.9 allows"
 * call for different responses: the first is a question about the change, the second
 * blocks the merge whatever the answer is.
 */
function compare(results, baseline) {
  const rows = [];
  const failures = [];
  const notes = [];

  const baselineKeys = new Set(Object.keys(baseline.metrics));
  const measuredKeys = new Set(results.measurements.keys());

  for (const version of results.versions) {
    if (version !== baseline.yardstickVersion) {
      failures.push(
        `yardstick version ${version} was measured against a baseline recorded at version ` +
          `${baseline.yardstickVersion}. The yardstick defines what every ratio means, so the ` +
          'two cannot be compared. Regenerate with `pnpm bench:baseline`.',
      );
    }
  }

  for (const key of baselineKeys) {
    if (!measuredKeys.has(key)) {
      failures.push(
        `\`${key}\` is in the baseline but was not measured. Either its benchmark failed, or ` +
          'it was deleted without the baseline being regenerated.',
      );
    }
  }

  for (const key of [...measuredKeys].sort()) {
    const measured = results.measurements.get(key);
    const base = baseline.metrics[key];

    if (base === undefined) {
      failures.push(
        `\`${key}\` has no baseline. A new benchmark needs one committed alongside it — run ` +
          '`pnpm bench:baseline` and include the diff.',
      );
      continue;
    }

    const tolerance = toleranceFor(key);
    const change = measured.ratio / base.ratio - 1;
    const overLimit = measured.hardLimit !== null && measured.value > measured.hardLimit;
    const regressed = change > tolerance;

    if (overLimit) {
      failures.push(
        `\`${key}\` breached its §11.9 **hard limit**: ${num(measured.value)} ${measured.unit} ` +
          `against a limit of ${num(measured.hardLimit)} ${measured.unit}.`,
      );
    }
    if (regressed) {
      // Quoted on the floor rather than the median, because the floor is the number
      // the comparison was made on. Quoting the median next to a percentage computed
      // from the minimum invites exactly the arithmetic that does not add up.
      failures.push(
        `\`${key}\` **regressed against the baseline** by ${pct(change)} ` +
          `(tolerance ${pct(tolerance)}). Best of the batches: ${num(measured.floor)} ` +
          `${measured.unit} now, ${num(base.floor)} ${measured.unit} in the baseline — ` +
          `${num(measured.ratio)} yardsticks against ${num(base.ratio)}.`,
      );
    }
    if (change < -STALE_IMPROVEMENT) {
      notes.push(
        `\`${key}\` is ${pct(change)} faster than its baseline. Worth re-recording so the gate ` +
          'keeps its grip — `pnpm bench:baseline`.',
      );
    }

    rows.push({
      key,
      label: measured.label,
      unit: measured.unit,
      value: measured.value,
      target: measured.target,
      hardLimit: measured.hardLimit,
      baselineValue: base.value,
      change,
      tolerance,
      status: overLimit ? 'HARD LIMIT' : regressed ? 'REGRESSED' : 'ok',
      note: measured.note,
    });
  }

  return { rows, failures, notes };
}

function markdown({ rows, failures, notes }, results, baseline) {
  const yardstick = results.yardsticks.reduce((a, b) => a + b, 0) / results.yardsticks.length;

  const lines = [
    '## Benchmark budgets (§11.9)',
    '',
    failures.length === 0
      ? '_No regression against the committed baseline, and no hard limit breached._'
      : `**${failures.length} failure${failures.length === 1 ? '' : 's'}.**`,
    '',
    '| | Budget | Measured | Target | Hard limit | vs baseline |',
    '| --- | --- | --- | --- | --- | --- |',
  ];

  for (const row of rows) {
    const mark =
      row.status === 'ok' ? (withinTarget(row) ? 'pass' : 'over target') : `**${row.status}**`;
    lines.push(
      `| ${mark} | ${row.label} | ${num(row.value)} ${row.unit} | ` +
        `${row.target === null ? '—' : `${num(row.target)} ${row.unit}`} | ` +
        `${row.hardLimit === null ? '—' : `${num(row.hardLimit)} ${row.unit}`} | ` +
        `${pct(row.change)} (±${pct(row.tolerance).slice(1)}) |`,
    );
  }

  lines.push(
    '',
    `_Measured is the **median** over the batches, which is what §11.9's targets and hard limits` +
      ' are read against. **vs baseline** compares the **minimum** instead, normalised by a' +
      ` yardstick of ${num(yardstick)} ns/call — the statistic and the normalisation both exist so` +
      ' that a baseline recorded on one machine can gate a run on another. `tools/bench/record.ts`' +
      ' and `compare.mjs` carry the measurements behind both choices.' +
      ` Baseline recorded ${baseline.recordedOn} on ${baseline.recordedBy}._`,
    '',
    '_Frame rows measure the geometry pipeline owned by `@hh/sim` and `@hh/render`. Rasterisation' +
      " is the browser and is not measured here; §11.9's frame rows are verified on a real device" +
      ' by #188 and #189, not by this table._',
    '',
  );

  if (failures.length > 0) {
    lines.push('### Failures', '', ...failures.map((text) => `- ${text}`), '');
  }
  if (notes.length > 0) {
    lines.push('### Notes', '', ...notes.map((text) => `- ${text}`), '');
  }
  return lines.join('\n');
}

const withinTarget = (row) => row.target === null || row.value <= row.target;

function write(results) {
  const metrics = {};
  for (const key of [...results.measurements.keys()].sort()) {
    const m = results.measurements.get(key);
    metrics[key] = {
      label: m.label,
      unit: m.unit,
      value: m.value,
      floor: m.floor,
      ratio: m.ratio,
      target: m.target,
      hardLimit: m.hardLimit,
    };
  }

  const baseline = {
    // Read `tools/bench/compare.mjs` before changing anything here by hand. `value` is
    // indicative -- it is what the recording machine measured -- and `ratio` is what
    // the gate actually compares.
    yardstickVersion: results.versions[0],
    recordedOn: new Date().toISOString().slice(0, 10),
    recordedBy: `node ${process.version} on ${process.platform}-${process.arch}`,
    metrics,
  };

  writeFileSync(BASELINE, `${JSON.stringify(baseline, null, 2)}\n`);
  process.stdout.write(
    `Wrote ${Object.keys(metrics).length} metrics to ` +
      `${BASELINE.slice(REPO_ROOT.length + 1)}. Review the diff before committing it.\n`,
  );
}

function main() {
  const mode = process.argv.includes('--write')
    ? 'write'
    : process.argv.includes('--report')
      ? 'report'
      : 'gate';

  const results = readResults();
  if (results.error) {
    // A missing result set is a failure of the gate and a no-op for the report: the
    // report runs with `if: always()`, including on the run where the benchmarks
    // themselves crashed, and a second red X there says nothing the first did not.
    if (mode === 'report') {
      process.stdout.write(`## Benchmark budgets (§11.9)\n\n${results.error}\n`);
      return;
    }
    process.stderr.write(`${results.error}\n`);
    process.exitCode = 1;
    return;
  }

  if (mode === 'write') {
    write(results);
    return;
  }

  if (!existsSync(BASELINE)) {
    process.stderr.write(`no baseline at ${BASELINE}. Record one with \`pnpm bench:baseline\`.\n`);
    process.exitCode = 1;
    return;
  }

  const outcome = compare(results, readJson(BASELINE));

  if (mode === 'report') {
    process.stdout.write(markdown(outcome, results, readJson(BASELINE)));
    return;
  }

  for (const row of outcome.rows) {
    process.stdout.write(
      `  ${row.status === 'ok' ? ' ' : '!'} ${row.key}: ${num(row.value)} ${row.unit} ` +
        `(${pct(row.change)} vs baseline, tolerance ${pct(row.tolerance).slice(1)})\n`,
    );
  }
  for (const note of outcome.notes) process.stdout.write(`  note: ${note}\n`);

  if (outcome.failures.length > 0) {
    process.stderr.write('\nBenchmark gate failed:\n');
    for (const failure of outcome.failures) process.stderr.write(`  - ${failure}\n`);
    process.stderr.write(
      '\nIf the change is a deliberate cost, say so in the PR and re-record the baseline with ' +
        '`pnpm bench:baseline`.\n',
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write('\nBenchmark gate passed: no regression against the committed baseline.\n');
}

main();
