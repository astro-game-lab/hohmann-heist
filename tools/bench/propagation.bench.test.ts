/**
 * The propagation performance budget from `docs/PRODUCT.md` §11.9.
 *
 * > Single `stateAt()` call — target 5 microseconds, hard limit 20.
 *
 * #56 asks for that to be "measured rather than assumed", which is why this exists
 * as a test rather than as a claim in a docstring.
 *
 * ## Why this is not in `packages/propagation`
 *
 * Measuring elapsed time needs a clock, and `performance` is banned in
 * `packages/{math,astro,propagation,sim,game}` by the core guardrail block in
 * `eslint.config.js` — correctly, and NFR-005 is not worth widening for a
 * benchmark. `tools/` is inside `tsconfig.json` and outside that block, so the
 * measurement can read a clock without the simulation gaining the ability to.
 *
 * ## What is asserted, and what is only reported
 *
 * The **hard limit** is asserted. The **target** is reported and not asserted, and
 * that is a deliberate choice rather than a dodge: this runs on whatever shared
 * runner CI allocates, and a green-most-of-the-time gate on a 5 microsecond target
 * would eventually be silenced, at which point the budget would be enforced by
 * nothing at all. The measured median is printed on every run and carried into
 * `docs/PHYSICS.md`, so a regression that stays under 20 microseconds is still
 * visible to anyone reading the output. §11.9's reference device is a 2019
 * mid-range laptop, which is not this, so the absolute number is indicative.
 */
import { performance } from 'node:perf_hooks';
import { stdout } from 'node:process';

import { MU_EARTH, epoch, stateFromElements } from '@hh/astro';
import { createArc, stateAt } from '@hh/propagation';
import { metres, radians } from '@hh/math';
import { describe, expect, it } from 'vitest';

import { createRecorder } from './record.js';

/** Results for the gate in `compare.mjs`; see `record.ts` for what a ratio is. */
const record = createRecorder('propagation');

/** §11.9: target 5 us, hard limit 20 us. */
const TARGET_MICROSECONDS = 5;
const HARD_LIMIT_MICROSECONDS = 20;

const BATCHES = 7;
const ITERATIONS = 20_000;

/**
 * Median microseconds per call over `BATCHES` batches.
 *
 * The median rather than the mean, because a single garbage collection or a
 * scheduler preemption inside one batch should not decide the number. The returned
 * value from the call under test is accumulated into a sink and read afterwards, so
 * the optimiser cannot delete the work being measured.
 */
const measure = (call: () => number): { median: number; min: number; sink: number } => {
  let sink = 0;

  // Warm up: the first thousand calls are interpreted, then optimised, and neither
  // rate is the steady-state one this budget is about.
  for (let i = 0; i < ITERATIONS; i++) sink += call();

  const timings: number[] = [];
  for (let batch = 0; batch < BATCHES; batch++) {
    const start = performance.now();
    for (let i = 0; i < ITERATIONS; i++) sink += call();
    timings.push(((performance.now() - start) * 1000) / ITERATIONS);
  }

  timings.sort((a, b) => a - b);
  return {
    median: timings[(BATCHES - 1) / 2] ?? Number.POSITIVE_INFINITY,
    min: timings[0] ?? Number.POSITIVE_INFINITY,
    sink,
  };
};

describe('§11.9 — single stateAt() call', () => {
  const arc = createArc({
    startEpoch: epoch(0),
    endEpoch: epoch(86_400),
    state: stateFromElements(
      {
        // A 400 km circular orbit at ISS inclination: the shape most of a contract's
        // propagation calls actually have, rather than a worst case chosen to
        // flatter or to punish the solver.
        semiLatusRectum: metres(6_778_137),
        eccentricity: 0,
        inclination: radians(0.9006),
        raan: radians(1.1),
        argp: radians(0),
        trueAnomaly: radians(0.6),
      },
      MU_EARTH,
    ),
    mu: MU_EARTH,
  });

  it.each([
    ['a fraction of an orbit', 1_200, 'partial-orbit'],
    ['a whole day, many revolutions', 86_400, 'full-day'],
  ])('meets the hard limit for %s', (label, offset, key) => {
    let index = 0;
    const { median, min, sink } = measure(() => {
      // Vary the epoch so the solver cannot be measured on one cached trajectory,
      // and so the iteration count varies the way it will in play.
      index = (index + 1) % 512;
      const result = stateAt(arc, epoch(offset + index * 0.37));
      return result.converged ? result.state.position.x : 0;
    });

    expect(Number.isFinite(sink)).toBe(true);
    stdout.write(
      `  §11.9 stateAt(${label}): ${median.toFixed(3)} us/call ` +
        `(target ${String(TARGET_MICROSECONDS)}, hard limit ${String(HARD_LIMIT_MICROSECONDS)}) ` +
        `— ${median <= TARGET_MICROSECONDS ? 'within target' : 'OVER TARGET'}\n`,
    );

    record({
      key: `propagation/state-at/${key}`,
      label: `arc stateAt, ${label}`,
      unit: 'us',
      stat: { median, min },
      target: TARGET_MICROSECONDS,
      hardLimit: HARD_LIMIT_MICROSECONDS,
      note: null,
    });

    expect(median).toBeLessThan(HARD_LIMIT_MICROSECONDS);
  });
});
