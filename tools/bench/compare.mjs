// The benchmark regression gate (#74, NFR-011, NFR-021).
//
// `pnpm bench` asserts §11.9's hard limits inside each benchmark. That catches a
// catastrophe and nothing else: a change that makes plan evaluation forty percent
// slower passes every one of those assertions, and so does the next one. This is the
// other half -- a comparison against a **committed baseline**, so that a slow creep
// across many pull requests is caught while it is still a creep.
//
// Usage:
//   node tools/bench/compare.mjs                    gate: non-zero exit on a regression
//   node tools/bench/compare.mjs --report           Markdown to stdout, never fails
//   node tools/bench/compare.mjs --write            regenerate baseline.json from the last run
//   node tools/bench/compare.mjs --write dirA dirB  ... from several runs, taking the median
//
// The last form is how the committed baseline is actually recorded. A baseline built
// from one run carries that run's noise forever, so every later comparison is two
// noisy samples against each other and the tolerance has to be wide enough for both.
// Taking the per-metric median of several runs leaves the noise on one side only,
// which is worth roughly a factor of the square root of two on the threshold -- and
// the baseline is written once and read on every pull request, so it is the one place
// where spending several runs is obviously worth it.
//
// It reads `.results/`, which `pnpm bench` writes. It never runs the benchmarks
// itself, and that is deliberate: the report has to show the numbers the gate
// actually judged. A report that re-measured would print different ones, and the run
// where they disagree is exactly the run somebody is trying to understand.
//
// ── What is compared ───────────────────────────────────────────────────────────
//
// For each metric, the **minimum** over its batches, divided by the baseline's, then
// divided again by the **median of that same quantity across all twenty metrics**.
// In words: *did this operation get slower than its neighbours did*.
//
// Three choices there. All three were measured, and two of them were measured twice
// because the first measurement was taken on the wrong machines and said the wrong
// thing.
//
// **The minimum, not the median, of each metric's batches.** Timing noise is
// one-sided: preemption, a collection and a frequency step can only add time. So the
// minimum estimates the cost and the median estimates the cost plus whatever
// interference the run attracted. Over seven consecutive runs on one machine the
// typical spread is the same either way, 12.2% against 11.8%, but the worst row is
// 19.7% against 31.5% -- and a threshold is set by the worst row. The benchmarks keep
// asserting their medians against §11.9, because a budget is about what happens under
// realistic conditions; the two questions want different statistics and both are
// recorded.
//
// **The baseline comes from CI, from several runs.** A GitHub runner is nothing like
// a developer's laptop, and one run carries its own noise forever. The committed
// baseline is the per-metric median of five CI runs. See "Recording a baseline".
//
// **Divided by the run's own median across metrics** -- the host offset. This is the
// one that took three attempts, so the evidence is worth setting down.
//
//   Six CI runs of one identical commit produced host offsets of 0.52x, 0.79x, 0.96x,
//   1.00x, 1.02x and 1.02x. The fleet is not one machine: it spans a factor of two in
//   how fast it executes this suite, and which host a pull request lands on is not
//   something the pull request controls.
//
//   Comparing absolute figures across that is hopeless -- the 0.52x host reads 48%
//   under a baseline recorded on the mid-range ones, and a host as far the other way
//   would read +90% and fail every row at once. Dividing by the run's own median
//   removes the host exactly, and what is left is per-metric scatter:
//
//     worst upward deviation, per run   9.7%  12.9%  13.0%  13.2%  12.2%  14.4%
//
//   Flat across a two-fold range of host speed, which is the property this needs.
//
// **The blind spot, stated rather than discovered later.** A change that slows
// *everything* by the same factor divides out and this gate will not see it. Three
// things sit behind that. §11.9's absolute hard limits are still asserted inside each
// benchmark and are not relative to anything. The host offset is printed on every run
// and put in the report, so a uniform shift is visible even though it does not fail.
// And a regression that hits all twenty metrics equally is an unusual shape for one
// pull request -- the median moves only when half the suite moves together, and at
// that point the offset line is the thing to read.
//
// ── The yardstick, which is recorded and not used ──────────────────────────────
//
// `record.ts` also times a frozen scalar arithmetic loop alongside every benchmark
// and records `measurement / yardstick`. That was the first attempt at the problem
// the host offset now solves, and it is kept in the results -- not in the gate -- so
// the next person to have the idea can check it rather than take this comment's word.
//
// It fails in both directions. Across machine families it **over-corrects**: a GitHub
// runner is 1.16x slower than this repository's development machine on the real
// workloads but 1.45x slower on the yardstick, 418 ns against 289 ns, so normalised
// figures came out a systematic 22% under their baseline on every row. Within the
// fleet it **under-corrects**: on the 0.52x host it left 22% of the difference
// standing, where the host offset leaves none. And it adds noise of its own -- across
// the six runs the worst upward deviation is 31.2% normalised against 14.4% with the
// host offset.
//
// The cause is what it is: a serial dependency chain of `sqrt`, multiply and add,
// measuring scalar floating-point latency and almost nothing else, while the code it
// was meant to normalise is branch-bound, memory-bound and full of transcendentals.
// Two runs with near-identical yardsticks -- 364 ns and 365 ns -- produced host
// offsets of 0.96x and 0.79x, which is the whole problem in one line. The suite is a
// better yardstick for the suite than any synthetic loop, because it is the work.
//
// ── The tolerance ──────────────────────────────────────────────────────────────
//
// `TOLERANCE` is **30%**, a little over twice the 14.4% worst upward deviation
// measured across those six runs and three host speeds. Two things make that honest
// rather than arbitrary: the baseline is a median of several runs, so only the run
// under test carries noise, and the sample spans the fleet's range rather than one
// corner of it.
//
// If it starts flaking, **re-measure and update the numbers above** -- do not widen
// it and move on. A threshold nobody can justify gets widened again next time, and
// one that has been widened twice is decoration.
//
// ── Recording a baseline ───────────────────────────────────────────────────────
//
//   1. `gh workflow run ci.yml --ref <branch>`, five times, letting each finish.
//   2. `gh run download <id> --dir <dir>` for each.
//   3. `node tools/bench/compare.mjs --write <dir>/bench-results-*/`
//   4. Review the diff. Every number in it is a cost this repository now accepts.
//
// `pnpm bench:baseline` records from the local `.results/` instead. That is for
// experimenting, not for the committed file: a laptop's numbers are about 16% off a
// runner's and carry one run's noise forever.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(HERE, '.results');
const BASELINE = join(HERE, 'baseline.json');
const REPO_ROOT = resolve(HERE, '..', '..');

/** Fractional headroom over the baseline, after the host offset, before a metric counts as a regression. */
const TOLERANCE = 0.3;

/**
 * Per-metric overrides, for a row whose noise is genuinely larger than the rest.
 *
 * Empty, and worth keeping empty. Across the five CI runs the upward deviations run
 * from 1.4% to 15.2%, with no row far enough from the rest to earn its own number --
 * and in particular the nanosecond-scale rows, the cache hit and the three
 * `arcIndexAt` sizes, are not the noisy ones. The intuition that the smallest numbers
 * are the least stable is simply wrong here, and an override for them would have been
 * a guess dressed as a reason.
 *
 * Anything added here needs a reason of the same kind as the table above: a measured
 * property of that measurement, with the numbers. "It was failing" is not one.
 */
const TOLERANCE_BY_KEY = {};

/** A speedup this large means the baseline is stale and should be re-committed. Reported, never fatal. */
const STALE_IMPROVEMENT = 0.25;

const toleranceFor = (key) => TOLERANCE_BY_KEY[key] ?? TOLERANCE;

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

/** Every measurement from one results directory, keyed, plus the yardsticks they share. */
function readResultsFrom(dir) {
  if (!existsSync(dir)) {
    return { error: `no results at ${dir}. Run \`pnpm bench\` first.` };
  }
  const files = readdirSync(dir).filter((name) => name.endsWith('.json'));
  if (files.length === 0) {
    return { error: `no results in ${dir}. Run \`pnpm bench\` first.` };
  }

  const measurements = new Map();
  const versions = new Set();
  const yardsticks = [];

  for (const name of files) {
    const result = readJson(join(dir, name));
    versions.add(result.yardstickVersion);
    yardsticks.push(result.yardstickNs);
    for (const measurement of result.measurements) {
      measurements.set(measurement.key, { ...measurement, file: result.file });
    }
  }
  return { measurements, versions: [...versions], yardsticks };
}

/** The last `pnpm bench`. What the gate and the report read. */
const readResults = () => readResultsFrom(RESULTS_DIR);

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * Several runs collapsed to one per-metric median.
 *
 * The median of each field independently rather than picking one representative run:
 * the fields are not a package, they are three views of the same measurement, and the
 * middle value of each is the one least likely to be an artefact of the run it came
 * from. A metric missing from any run is an error rather than something to average
 * over — it means a benchmark failed in that run, and a baseline built from a partial
 * sample is a baseline nobody can reason about.
 */
function mergeResults(runs) {
  const merged = new Map();
  const [first] = runs;

  for (const [key, sample] of first.measurements) {
    const samples = runs.map((run) => run.measurements.get(key));
    if (samples.some((entry) => entry === undefined)) {
      return { error: `\`${key}\` is missing from at least one run; cannot record a baseline.` };
    }
    merged.set(key, {
      ...sample,
      value: median(samples.map((entry) => entry.value)),
      floor: median(samples.map((entry) => entry.floor)),
      ratio: median(samples.map((entry) => entry.ratio)),
    });
  }

  return {
    measurements: merged,
    versions: [...new Set(runs.flatMap((run) => run.versions))],
    yardsticks: runs.flatMap((run) => run.yardsticks),
    runCount: runs.length,
  };
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
/**
 * How much slower this whole run is than the baseline, as the median across metrics.
 *
 * This is the host, not the code. Six CI runs of one commit produced offsets from
 * 0.52x to 1.02x -- a two-fold spread in machine speed -- and dividing it out is what
 * makes the per-metric comparison mean the same thing on every runner.
 *
 * The **median** rather than the mean, so it is not the thing being measured. One
 * metric regressing by half moves a median of twenty by nothing at all, which is
 * exactly the property required: the offset must describe the host even when a metric
 * has moved. It degrades gracefully rather than suddenly -- if half the suite
 * regressed together the median would follow them and the gate would understate the
 * damage, which is the blind spot named in the header and backstopped by §11.9's
 * absolute hard limits.
 */
function hostOffset(results, baseline) {
  const ratios = [];
  for (const [key, measured] of results.measurements) {
    const base = baseline.metrics[key];
    if (base !== undefined && base.floor > 0) ratios.push(measured.floor / base.floor);
  }
  return ratios.length === 0 ? 1 : median(ratios);
}

function compare(results, baseline) {
  const rows = [];
  const failures = [];
  const notes = [];
  const offset = hostOffset(results, baseline);

  const baselineKeys = new Set(Object.keys(baseline.metrics));
  const measuredKeys = new Set(results.measurements.keys());

  for (const version of results.versions) {
    if (version !== baseline.yardstickVersion) {
      // A note rather than a failure. The yardstick is recorded for diagnosis and
      // takes no part in the comparison below -- the header carries the measurement
      // that put it there -- so a version change makes one column of the report
      // incomparable and changes no verdict.
      notes.push(
        `the yardstick moved from version ${baseline.yardstickVersion} to ${version} since the ` +
          'baseline was recorded, so its column is not comparable across the two. The gate does ' +
          'not use it.',
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
    // Relative to how the whole suite moved on this host, not to the recorded
    // milliseconds. See `hostOffset` and the header.
    const change = measured.floor / base.floor / offset - 1;
    const overLimit = measured.hardLimit !== null && measured.value > measured.hardLimit;
    const regressed = change > tolerance;

    if (overLimit) {
      failures.push(
        `\`${key}\` breached its §11.9 **hard limit**: ${num(measured.value)} ${measured.unit} ` +
          `against a limit of ${num(measured.hardLimit)} ${measured.unit}.`,
      );
    }
    if (regressed) {
      // Both the raw figures and the host offset, because on a fast host the raw
      // numbers can be *smaller* than the recorded ones on a row that regressed --
      // and a failure message whose own arithmetic looks wrong is a failure message
      // nobody trusts.
      failures.push(
        `\`${key}\` **regressed against the baseline** by ${pct(change)} ` +
          `(tolerance ${pct(tolerance)}). Best of the batches: ${num(measured.floor)} ` +
          `${measured.unit} against ${num(base.floor)} ${measured.unit} recorded, on a host ` +
          `running the suite at ${num(offset)}x the baseline's pace — so this row moved ` +
          `${pct(change)} against its neighbours.`,
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

  if (offset < 0.8 || offset > 1.25) {
    notes.push(
      `this host ran the whole suite at ${num(offset)}x the baseline's pace. That is the machine, ` +
        'not the code — every row above is measured relative to it, which is the point. Absolute ' +
        'figures will not match the recorded ones.',
    );
  }

  return { rows, failures, notes, offset };
}

function markdown({ rows, failures, notes, offset }, results, baseline) {
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
      ' are read against. **vs baseline** compares the **minimum** — the statistic that estimates' +
      " the cost rather than the cost plus this run's interference — and does so *relative to how" +
      ` the whole suite moved on this host*, which ran at **${num(offset)}x** the baseline's pace.` +
      ' Runner speed varies about two-fold, so a row here says whether an operation moved against' +
      ` its neighbours, not whether the machine was busy. The yardstick reads ${num(yardstick)} ns/call,` +
      ' recorded for diagnosis only and not used by the gate; `tools/bench/compare.mjs` carries the' +
      ' measurements behind every one of those choices.' +
      ` Baseline recorded ${baseline.recordedOn} from ${baseline.recordedBy}._`,
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
    recordedBy:
      results.recordedBy ?? `node ${process.version} on ${process.platform}-${process.arch}`,
    recordedFromRuns: results.runCount ?? 1,
    metrics,
  };

  writeFileSync(BASELINE, `${JSON.stringify(baseline, null, 2)}\n`);
  process.stdout.write(
    `Wrote ${Object.keys(metrics).length} metrics to ` +
      `${BASELINE.slice(REPO_ROOT.length + 1)}, from ${String(baseline.recordedFromRuns)} ` +
      `${baseline.recordedFromRuns === 1 ? 'run' : 'runs'}. Review the diff before committing it.\n`,
  );

  // Said here rather than only in the header, because the header is not open at the
  // moment somebody makes this mistake -- and it is an easy one to make, since the
  // command that makes it is shorter than the command that does not.
  if ((baseline.recordedFromRuns ?? 1) === 1) {
    process.stdout.write(
      '\nNote: this baseline came from one run on this machine. That is fine for ' +
        'experimenting and wrong for the committed file — a laptop reads about 16% away from a ' +
        'CI runner, and one run carries its own noise forever. Record the committed baseline ' +
        'from several CI runs; `tools/bench/compare.mjs` has the four-step recipe.\n',
    );
  }
}

function main() {
  const mode = process.argv.includes('--write')
    ? 'write'
    : process.argv.includes('--report')
      ? 'report'
      : 'gate';

  const dirs = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  if (dirs.length > 0 && mode !== 'write') {
    process.stderr.write('result directories may only be given with --write.\n');
    process.exitCode = 2;
    return;
  }

  let results;
  if (dirs.length > 0) {
    const runs = dirs.map(readResultsFrom);
    const failed = runs.find((run) => run.error);
    results = failed ?? mergeResults(runs);
    if (!results.error) {
      results.recordedBy = `${String(dirs.length)} CI runs`;
    }
  } else {
    results = readResults();
  }

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

  process.stdout.write(
    `  host offset: this run executed the suite at ${num(outcome.offset)}x the baseline's pace; ` +
      'every row below is measured relative to that.\n',
  );
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
      '\nIf the cost is deliberate, say so in the pull request and re-record the baseline from ' +
        'CI — `tools/bench/compare.mjs` has the recipe. Do not re-record it from this machine.\n',
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write('\nBenchmark gate passed: no regression against the committed baseline.\n');
}

main();
