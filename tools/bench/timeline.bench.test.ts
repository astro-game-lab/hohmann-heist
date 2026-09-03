/**
 * The timeline performance budgets from `docs/PRODUCT.md` §11.9 and NFR-011.
 *
 * > Full timeline re-evaluation, 8 nodes — target 2 ms, hard limit 8 ms.
 * > Single `stateAt()` call — target 5 microseconds, hard limit 20.
 * > NFR-011: re-evaluation and re-render on a node drag complete within one 60 Hz frame
 * > for an 8-node plan.
 *
 * #68 and #69 both ask for a *measurement* rather than a claim in a comment, which is
 * why these are here and not in a docstring. `propagation.bench.test.ts` explains why
 * benchmarks live under `tools/` — `performance` is banned in the core packages, and
 * correctly so — and why the **hard limit is asserted while the target is only
 * reported**: this runs on whatever shared runner CI allocates, and a flaky gate on a
 * 5 microsecond target would eventually be silenced, at which point nothing would be
 * enforced at all. §11.9's reference device is a 2019 mid-range laptop, which is not
 * this, so the absolute numbers are indicative and the trend is what to watch.
 *
 * ## Why the arc-lookup scaling test measures `arcIndexAt` and not `stateAt`
 *
 * #68 asks for the binary search to be "demonstrated by a test that measures scaling
 * across plan sizes rather than asserting the claim in a comment". Timing `stateAt` for
 * that would demonstrate nothing: it is one lookup plus one Kepler solve, the solve
 * costs microseconds and the lookup nanoseconds, so a *linear* scan over 2 048 arcs
 * would still be swamped by the solve and the curve would look flat either way. The
 * search is therefore measured on its own, where 9 arcs against 2 049 is a factor of
 * 228 if the lookup is linear and about 3.5 if it is logarithmic — a difference no
 * amount of runner noise can hide. Measured: 4.3.
 */
import { performance } from 'node:perf_hooks';
import { stdout } from 'node:process';

import type { State } from '@hh/astro';
import { MU_EARTH, epoch, stateFromElements } from '@hh/astro';
import { metres, radians } from '@hh/math';
import type { Plan, Timeline } from '@hh/sim';
import {
  arcIndexAt,
  buildTimeline,
  createPlan,
  maneuverNodeFromCounts,
  stateAt,
  withPlan,
} from '@hh/sim';
import { describe, expect, it } from 'vitest';

import type { Statistic } from './record.js';
import { createRecorder } from './record.js';

/** Results for the gate in `compare.mjs`; see `record.ts` for what a ratio is. */
const record = createRecorder('timeline');

/** §11.9: a single `stateAt()` is targeted at 5 us with a hard limit of 20. */
const STATE_AT_TARGET_US = 5;
const STATE_AT_HARD_LIMIT_US = 20;

/** §11.9: full re-evaluation of an 8-node plan, target 2 ms and hard limit 8. */
const REBUILD_TARGET_MS = 2;
const REBUILD_HARD_LIMIT_MS = 8;

/** NFR-011: one 60 Hz frame. Re-evaluation is only part of it; the renderer is #88. */
const FRAME_BUDGET_MS = 1000 / 60;

const BATCHES = 7;

/**
 * Median microseconds per call over `BATCHES` batches.
 *
 * The median rather than the mean, because a single garbage collection or a scheduler
 * preemption inside one batch should not decide the number. The value returned by the
 * call under test is accumulated into a sink and read afterwards, so the optimiser
 * cannot delete the work being measured.
 */
const measure = (
  call: () => number,
  iterations: number,
): { median: number; min: number; sink: number } => {
  let sink = 0;

  // Warm up: the first pass is interpreted, then optimised, and neither rate is the
  // steady-state one these budgets are about.
  for (let i = 0; i < iterations; i++) sink += call();

  const timings: number[] = [];
  for (let batch = 0; batch < BATCHES; batch++) {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) sink += call();
    timings.push(((performance.now() - start) * 1000) / iterations);
  }

  timings.sort((a, b) => a - b);
  return {
    median: timings[(BATCHES - 1) / 2] ?? Number.POSITIVE_INFINITY,
    min: timings[0] ?? Number.POSITIVE_INFINITY,
    sink,
  };
};

const report = (
  key: string,
  label: string,
  stat: Statistic,
  unit: 'us' | 'ms',
  target: number,
  limit: number,
): void => {
  const value = stat.median;
  stdout.write(
    `  §11.9 ${label}: ${value.toFixed(3)} ${unit}/call ` +
      `(target ${String(target)}, hard limit ${String(limit)}) ` +
      `— ${value <= target ? 'within target' : 'OVER TARGET'}\n`,
  );
  record({ key, label, unit, stat, target, hardLimit: limit, note: null });
};

/** A 400 km circular orbit at ISS inclination — the shape a contract actually starts on. */
const INITIAL: State = stateFromElements(
  {
    semiLatusRectum: metres(6_778_137),
    eccentricity: 0,
    inclination: radians(0.9006),
    raan: radians(1.1),
    argp: radians(0),
    trueAnomaly: radians(0.6),
  },
  MU_EARTH,
);

const START = epoch(0);
/** Fourteen hours: §11.9's own drag scenario is an 8-node plan over a 14 h horizon. */
const HORIZON_S = 14 * 3600;
const HORIZON = epoch(HORIZON_S);

/** A plan of `count` nodes evenly spread across the horizon, each a small prograde burn. */
const planOf = (count: number, spacingSeconds: number, transverseCounts = 250_000): Plan =>
  createPlan(
    Array.from({ length: count }, (_, i) =>
      maneuverNodeFromCounts(Math.round((i + 1) * spacingSeconds * 1024), [0, transverseCounts, 0]),
    ),
  );

const timelineOf = (plan: Plan, horizon = HORIZON): Timeline => {
  const result = buildTimeline({
    startEpoch: START,
    initialState: INITIAL,
    plan,
    horizon,
    mu: MU_EARTH,
  });
  if (!result.ok) throw new Error(`benchmark fixture failed to build: ${result.reason}`);
  return result.timeline;
};

const EIGHT_NODE_PLAN = planOf(8, 1800);

describe('§11.9 — full timeline re-evaluation, 8 nodes', () => {
  it('meets the hard limit', () => {
    const { median, min, sink } = measure(() => {
      const result = buildTimeline({
        startEpoch: START,
        initialState: INITIAL,
        plan: EIGHT_NODE_PLAN,
        horizon: HORIZON,
        mu: MU_EARTH,
      });
      return result.ok ? result.timeline.arcs.length : 0;
    }, 2_000);

    const milliseconds = median / 1000;
    expect(Number.isFinite(sink)).toBe(true);
    report(
      'sim/timeline/rebuild-8-nodes',
      'full re-evaluation (8 nodes)',
      { median: milliseconds, min: min / 1000 },
      'ms',
      REBUILD_TARGET_MS,
      REBUILD_HARD_LIMIT_MS,
    );

    expect(milliseconds).toBeLessThan(REBUILD_HARD_LIMIT_MS);
  });
});

describe('§11.9 — single timeline stateAt() call', () => {
  const timeline = timelineOf(EIGHT_NODE_PLAN);

  it.each([
    ['early in the plan', 600, 'early'],
    ['after the last node', 12 * 3600, 'after-last-node'],
  ])('meets the hard limit %s', (label, offset, key) => {
    let index = 0;
    const { median, min, sink } = measure(() => {
      // Vary the epoch so the solver is not measured on one cached trajectory, and so
      // the iteration count varies the way it will in play.
      index = (index + 1) % 512;
      const result = stateAt(timeline, epoch(offset + index * 0.37));
      return result.converged ? result.state.position.x : 0;
    }, 20_000);

    expect(Number.isFinite(sink)).toBe(true);
    report(
      `sim/timeline/state-at-${key}`,
      `timeline stateAt (${label})`,
      { median, min },
      'us',
      STATE_AT_TARGET_US,
      STATE_AT_HARD_LIMIT_US,
    );

    expect(median).toBeLessThan(STATE_AT_HARD_LIMIT_US);
  });
});

describe('NFR-011 — a node drag re-evaluates within one frame', () => {
  const timeline = timelineOf(EIGHT_NODE_PLAN);

  /**
   * The plans a drag actually produces: the same eight nodes with the last one's
   * delta-v moving a count at a time. Precomputed so the measurement is the
   * re-evaluation and not `createPlan`'s validation.
   */
  const dragged = Array.from({ length: 256 }, (_, i) =>
    createPlan([
      ...EIGHT_NODE_PLAN.nodes.slice(0, -1),
      maneuverNodeFromCounts(Math.round(8 * 1800 * 1024), [0, 250_000 + i, 0]),
    ]),
  );

  it('re-evaluates an 8-node plan in well under a 60 Hz frame', () => {
    let index = 0;
    const { median, min, sink } = measure(() => {
      index = (index + 1) % dragged.length;
      const result = withPlan(timeline, dragged[index] ?? EIGHT_NODE_PLAN);
      return result.ok ? result.timeline.arcs.length : 0;
    }, 5_000);

    const milliseconds = median / 1000;
    expect(Number.isFinite(sink)).toBe(true);
    stdout.write(
      `  NFR-011 drag re-evaluation (8 nodes, last node): ${milliseconds.toFixed(4)} ms/edit ` +
        `(frame budget ${FRAME_BUDGET_MS.toFixed(2)} ms)\n`,
    );
    record({
      key: 'sim/timeline/drag-reevaluate-8-nodes',
      label: 'drag re-evaluation (8 nodes, last node)',
      unit: 'ms',
      stat: { median: milliseconds, min: min / 1000 },
      // NFR-011's budget is the whole frame, of which this is one part; §11.9 gives
      // re-evaluation its own 2 ms target, which is the one this row is measured against.
      target: REBUILD_TARGET_MS,
      hardLimit: FRAME_BUDGET_MS,
      note: 'NFR-011: re-evaluation alone, not the whole frame',
    });

    expect(milliseconds).toBeLessThan(FRAME_BUDGET_MS);
  });

  it('costs less than a rebuild, because it does less work', () => {
    // FR-104 is a claim about work avoided, and this is that claim as a number. The
    // margin asserted is deliberately loose — the point is a real difference, not a
    // particular ratio on a shared runner.
    const rebuild = measure(() => {
      const result = buildTimeline({
        startEpoch: START,
        initialState: INITIAL,
        plan: EIGHT_NODE_PLAN,
        horizon: HORIZON,
        mu: MU_EARTH,
      });
      return result.ok ? result.timeline.arcs.length : 0;
    }, 2_000);

    let index = 0;
    const incremental = measure(() => {
      index = (index + 1) % dragged.length;
      const result = withPlan(timeline, dragged[index] ?? EIGHT_NODE_PLAN);
      return result.ok ? result.timeline.arcs.length : 0;
    }, 5_000);

    expect(Number.isFinite(rebuild.sink + incremental.sink)).toBe(true);
    stdout.write(
      `  FR-104 last-node edit: ${incremental.median.toFixed(3)} us vs ` +
        `${rebuild.median.toFixed(3)} us for a full rebuild ` +
        `(${(rebuild.median / incremental.median).toFixed(2)}x)\n`,
    );

    expect(incremental.median).toBeLessThan(rebuild.median);
  });
});

describe('FR-103 — arc lookup scales logarithmically, not linearly', () => {
  /**
   * Node counts spanning eight arcs to two thousand and forty-nine.
   *
   * Two seconds apart, which is above FR-101's floor and keeps a 2 048-node plan inside
   * a horizon a contract could plausibly have. A plan this size is far beyond anything
   * the game will ship — it exists to make the difference between `log n` and `n`
   * unmistakable.
   */
  const SIZES = [8, 128, 2048];

  it('is flat enough across plan sizes to rule out a linear scan', () => {
    const results = SIZES.map((count) => {
      const horizonSeconds = (count + 1) * 2 + 600;
      const timeline = timelineOf(planOf(count, 2, 100), epoch(horizonSeconds));
      let index = 0;

      const { median, min, sink } = measure(() => {
        // Sweep the whole horizon so the search is not measured on one branch of the
        // tree, and use a stride coprime with the arc count so successive lookups do
        // not walk neighbouring arcs.
        index = (index + 997) % 4096;
        return arcIndexAt(timeline, epoch((index / 4096) * horizonSeconds));
      }, 200_000);

      expect(Number.isFinite(sink)).toBe(true);
      record({
        key: `sim/timeline/arc-index-at-${String(count)}-nodes`,
        label: `arcIndexAt over ${String(count + 1)} arcs`,
        unit: 'ns',
        stat: { median: median * 1000, min: min * 1000 },
        target: null,
        hardLimit: null,
        note: 'FR-103: no §11.9 row; the gate watches it for a change of algorithm',
      });
      return { count, nanoseconds: median * 1000 };
    });

    for (const { count, nanoseconds } of results) {
      stdout.write(
        `  FR-103 arcIndexAt over ${String(count + 1)} arcs: ${nanoseconds.toFixed(1)} ns\n`,
      );
    }

    const smallest = results[0];
    const largest = results.at(-1);
    if (smallest === undefined || largest === undefined) throw new Error('no measurements');

    const growth = largest.nanoseconds / smallest.nanoseconds;
    const sizeRatio = (largest.count + 1) / (smallest.count + 1);
    stdout.write(
      `  FR-103 growth over a ${sizeRatio.toFixed(0)}x larger plan: ${growth.toFixed(2)}x ` +
        `(binary search predicts about ${(Math.log2(largest.count + 1) / Math.log2(smallest.count + 1)).toFixed(2)}x, ` +
        `a linear scan ${sizeRatio.toFixed(0)}x)\n`,
    );

    // A binary search predicts about 3.5x and a linear scan 228x; 4.3x is what this
    // measures. The bound sits far from both so that runner noise cannot decide the
    // outcome: nothing short of an actual change of algorithm crosses it.
    expect(growth).toBeLessThan(20);
  });
});
