/**
 * Recording benchmark results, and the yardstick that makes them comparable.
 *
 * The benchmarks in this directory already assert §11.9's hard limits. An absolute
 * limit catches a catastrophe and nothing else: a change that makes plan evaluation
 * forty percent slower passes every one of them, and the next change does it again.
 * #74 asks for the missing half — a gate against a **committed baseline**, so that a
 * slow creep across many pull requests is caught while it is still a creep.
 *
 * ## Why a baseline in milliseconds is hard, and what came of the attempt
 *
 * A baseline is committed once and compared against on whatever machine runs the pull
 * request. GitHub-hosted runners are not one machine: six runs of one commit executed
 * this suite at anywhere from 0.52x to 1.02x of each other's pace. A committed
 * millisecond figure is not comparable to that.
 *
 * The answer tried first was a **yardstick**: {@link yardstick}, a frozen scalar
 * floating-point loop measured in the same process, on the same run, with the same
 * harness, so every measurement could also be recorded as the dimensionless ratio
 * `measurement / yardstick`. A host half the speed would make both numbers twice as
 * large and leave the ratio where it was.
 *
 * **It does not hold, and `tools/bench/compare.mjs` carries the measurements.** In
 * short: across machine families it over-corrects, within the fleet it under-corrects,
 * and it adds noise of its own. The clearest single line is that two runs with
 * yardsticks of 364 ns and 365 ns executed the suite at 0.96x and 0.79x — the loop is
 * a serial dependency chain measuring scalar floating-point latency, and the code it
 * was meant to normalise is branch-bound, memory-bound and full of transcendentals.
 *
 * The gate instead divides each metric by the median across all of them, which uses
 * the suite as its own yardstick and removes the host exactly. The ratio recorded here
 * is therefore **not used by the gate**. It stays for two reasons: it is the evidence
 * for a decision that would otherwise be one comment's assertion, so the next person
 * to have this idea can check it; and a run whose yardstick moves while its floors do
 * not is a run that landed on a different host, which is worth seeing.
 *
 * ## Two statistics, because there are two questions
 *
 * Each benchmark asserts its **median** against §11.9, and says why in its own file:
 * the median is what the budget is about, since one garbage collection inside one
 * batch should not decide whether a budget is met. The gate asks a different question
 * — *did this get slower* — and the median is the wrong statistic for it. Timing noise
 * is one-sided: preemption, a collection, and a frequency step can only ever add time,
 * never remove it. The **minimum** over the batches is therefore the closest estimate
 * of what the operation actually costs, and comparing two minima compares two costs
 * rather than two noise levels.
 *
 * Measured over seven consecutive runs of the whole suite on one quiet machine: the
 * typical spread is the same either way, 12.2% against 11.8%, but the worst row is
 * 19.7% against 31.5% — and a threshold is set by the worst row. Both numbers are
 * recorded: `value` is the median and is what the report shows against §11.9, `floor`
 * is the minimum and is what the gate compares.
 *
 * ## The yardstick is still frozen, even though nothing gates on it
 *
 * It is arithmetic and nothing else — multiply, add, and `Math.sqrt`, all of which
 * IEEE 754 requires to be correctly rounded and every current CPU implements in
 * hardware. Deliberately **no transcendentals**: `Math.sin` and friends are library
 * code whose cost varies between platforms and libm versions by more than the effects
 * being measured.
 *
 * Editing it would make every recorded ratio incomparable with every earlier one,
 * which would cost exactly the diagnostic value the column is kept for. So it carries
 * a version, and `compare.mjs` reports a mismatch rather than failing on one — a
 * column nothing gates on is not a reason to refuse a comparison.
 *
 * If a future change makes the column useless as well as unused, delete it. Keeping a
 * measurement nobody reads is worse than keeping none.
 *
 * ## One result file per benchmark file
 *
 * Vitest runs each test file in its own worker, so a shared accumulator would be a
 * different object in each of them and the last writer would win. Each file writes
 * its own JSON under `.results/` instead — no coordination, no clobbering, and a
 * file that crashes leaves the others intact for the gate to report on.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import { afterAll } from 'vitest';

/**
 * Identity of the workload in {@link yardstick}.
 *
 * Every ratio in `baseline.json` is divided by that function's cost, so editing it
 * silently changes what every stored number means. **Bump this when you edit it, and
 * regenerate the baseline in the same commit.** `compare.mjs` refuses to compare
 * across versions, which turns a bumped edit into a loud failure — it cannot catch an
 * *un*-bumped one, and that is a review obligation rather than something a gate can
 * see. It is written down here so the obligation has a name.
 */
export const YARDSTICK_VERSION = 1;

/** Where the gate and the report read their inputs from. Git-ignored; regenerated by `pnpm bench`. */
export const RESULTS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '.results');

/** Units a §11.9 budget is written in. */
export type Unit = 'ns' | 'us' | 'ms';

const NANOSECONDS: Readonly<Record<Unit, number>> = Object.freeze({ ns: 1, us: 1e3, ms: 1e6 });

/** The two statistics a benchmark reports, over the same batches. */
export interface Statistic {
  /** Median over the batches. What §11.9's budgets are asserted against. */
  readonly median: number;
  /** Minimum over the batches. What the regression gate compares; see the module docstring. */
  readonly min: number;
}

/** One recorded number, with the §11.9 budget it is measured against. */
export interface Measurement {
  /**
   * Stable identifier, `<package>/<file>/<case>`. This is the key the baseline is
   * matched on, so renaming one is a baseline change and shows up as such.
   */
  readonly key: string;
  /** What a human reads in the report. */
  readonly label: string;
  /** Unit of `value`, `target` and `hardLimit`. */
  readonly unit: Unit;
  /** The measured statistics, per call, in `unit`. */
  readonly stat: Statistic;
  /** §11.9's target, or `null` where the budget has no row of its own. */
  readonly target: number | null;
  /** §11.9's hard limit, or `null`. Asserted by the benchmark and restated by the gate. */
  readonly hardLimit: number | null;
  /** Anything the report should say about this row. */
  readonly note: string | null;
}

/** Batches and iterations for the yardstick. Its own, so a benchmark cannot change it. */
const YARDSTICK_BATCHES = 11;
const YARDSTICK_ITERATIONS = 20_000;
const YARDSTICK_STEPS = 64;

/**
 * The frozen workload. **Do not edit** — see the module docstring.
 *
 * A fixed-point iteration on `a ← a/2 + √(a+1)`, which converges to `2 + 2√2` and so
 * stays bounded and finite from any start in `[1, 2]` without a branch to guard it.
 * Sixty-four steps per call puts real arithmetic between two function-call
 * boundaries, which is the shape of the code being measured.
 */
const yardstick = (seed: number): number => {
  let a = seed;
  for (let i = 0; i < YARDSTICK_STEPS; i++) {
    a = 0.5 * a + Math.sqrt(a + 1);
  }
  return a;
};

/**
 * Nanoseconds per {@link yardstick} call, as the **minimum** over the batches.
 *
 * The minimum for the reason the module docstring gives, and it matters more here than
 * anywhere else: this number is the denominator of every ratio, so noise in it is
 * noise in every metric at once. Eleven batches rather than seven for the same reason
 * — it costs about three milliseconds per benchmark file and buys a denominator that
 * is not the largest single source of spread in the comparison.
 */
const measureYardstick = (): number => {
  let sink = 0;
  const seed = (i: number): number => 1 + (i % YARDSTICK_STEPS) / YARDSTICK_STEPS;

  for (let i = 0; i < YARDSTICK_ITERATIONS; i++) sink += yardstick(seed(i));

  const timings: number[] = [];
  for (let batch = 0; batch < YARDSTICK_BATCHES; batch++) {
    const start = performance.now();
    for (let i = 0; i < YARDSTICK_ITERATIONS; i++) sink += yardstick(seed(i));
    timings.push(((performance.now() - start) * 1e6) / YARDSTICK_ITERATIONS);
  }

  if (!Number.isFinite(sink)) {
    throw new Error('the yardstick sink is not finite, so the loop was not run as written');
  }
  return Math.min(...timings);
};

/** A measurement with everything the gate needs derived. */
interface RecordedMeasurement extends Omit<Measurement, 'stat'> {
  /** The median, in `unit`. What the report shows and what §11.9's budgets are read against. */
  readonly value: number;
  /** The minimum, in `unit`. */
  readonly floor: number;
  /** `floor` in nanoseconds, so rows in different units are comparable. */
  readonly nanoseconds: number;
  /** `nanoseconds / yardstickNs` — the machine-independent figure the gate compares. */
  readonly ratio: number;
}

/** What one benchmark file writes. */
export interface ResultFile {
  readonly file: string;
  readonly yardstickVersion: number;
  readonly yardstickNs: number;
  readonly measurements: readonly RecordedMeasurement[];
}

/**
 * A `record` function bound to one benchmark file, flushed when the file finishes.
 *
 * `afterAll` rather than a process exit hook: it is deterministic, it runs inside the
 * worker that took the measurements, and a file whose tests failed still writes what
 * it managed to measure — which is exactly the run whose numbers matter.
 *
 * The yardstick is measured here, once per file, and only when there is something to
 * normalise. Measuring it at the same point in every file's lifetime is what keeps
 * it a fair denominator; `fileParallelism` is off for this project so it is not
 * competing with another benchmark for the same core while it does.
 */
export const createRecorder = (file: string): ((measurement: Measurement) => void) => {
  const measurements: Measurement[] = [];

  afterAll(() => {
    if (measurements.length === 0) return;

    const yardstickNs = measureYardstick();
    const result: ResultFile = {
      file,
      yardstickVersion: YARDSTICK_VERSION,
      yardstickNs,
      measurements: measurements.map(({ stat, ...rest }) => {
        const nanoseconds = stat.min * NANOSECONDS[rest.unit];
        return {
          ...rest,
          value: stat.median,
          floor: stat.min,
          nanoseconds,
          ratio: nanoseconds / yardstickNs,
        };
      }),
    };

    mkdirSync(RESULTS_DIR, { recursive: true });
    writeFileSync(join(RESULTS_DIR, `${file}.json`), `${JSON.stringify(result, null, 2)}\n`);
  });

  return (measurement: Measurement): void => {
    measurements.push(measurement);
  };
};
