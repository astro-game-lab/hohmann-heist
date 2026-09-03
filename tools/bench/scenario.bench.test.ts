/**
 * Scenario load and validate — `docs/PRODUCT.md` §11.9.
 *
 * > Scenario load and validate — target 20 ms, hard limit 100 ms.
 *
 * The last §11.9 row that had no measurement, and #86's own acceptance criterion.
 *
 * ## Why this budget is not close, and why it is still worth a benchmark
 *
 * The validator is compiled ahead of time by `tools/schema/generate.mjs` and committed,
 * so loading a scenario is a `JSON.parse`, a walk of a few dozen fields by generated
 * straight-line code, and one conversion to SI. Nothing here is iterative and nothing
 * is a solver. The measured cost is microseconds, three to four orders of magnitude
 * under the target.
 *
 * That headroom is the *point*, not a reason to skip the row. The design decision this
 * measures is the one made in `generate.mjs`: compiling the schema at runtime with Ajv
 * would put a few milliseconds of code generation on the same budget, which is still
 * inside it and is most of it. Recording the number is what makes that trade visible if
 * anyone reconsiders it, and the regression gate is what catches the day somebody moves
 * validation back to load time.
 *
 * ## Two cases, because a rejection is a different amount of work
 *
 * `allErrors` means an invalid document is walked to the end rather than abandoned at
 * the first fault, so the error path costs more than the success path. It is also the
 * path a contributor hits repeatedly while writing a contract (G6), which makes it the
 * one worth watching.
 */
import { performance } from 'node:perf_hooks';
import { stdout } from 'node:process';

import { loadScenario } from '@hh/game';
import { describe, expect, it } from 'vitest';

import { createRecorder } from './record.js';

const record = createRecorder('scenario');

/** §11.9's row. */
const TARGET_MS = 20;
const HARD_LIMIT_MS = 100;

const BATCHES = 7;
const ITERATIONS = 2_000;

/** §11.5's example, with the `par` fields that section's rules require. */
const VALID = JSON.stringify({
  $schema: 'https://astro-game-lab.github.io/hohmann-heist/schema/scenario-1.json',
  id: 'c05-tailgate',
  version: 1,
  act: 2,
  index: 5,
  title: 'Tailgate',
  briefKey: 'brief.c05',
  epoch: { scale: 'TAI', j2000Seconds: 0 },
  horizonSeconds: 50_400,
  ship: {
    state: {
      kind: 'elements',
      a_m: 6_778_137,
      e: 0,
      i_rad: 0,
      raan_rad: 0,
      argp_rad: 0,
      nu_rad: 0,
    },
    dvBudget_mps: 250,
  },
  targets: [
    {
      id: 'CTX-4',
      label: 'CTX-4',
      state: {
        kind: 'elements',
        a_m: 6_778_137,
        e: 0,
        i_rad: 0,
        raan_rad: 0,
        argp_rad: 0,
        nu_rad: 0.698_131_7,
      },
    },
  ],
  objective: { kind: 'intercept', targetId: 'CTX-4', maxRange_m: 1000 },
  constraints: [
    { kind: 'altitude_floor', min_m: 100_000 },
    { kind: 'deadline', seconds: 50_400 },
  ],
  par: {
    dv_mps: 72,
    time_s: 43_800,
    burns: 2,
    derivation: 'Two-impulse coplanar phasing, 8 revolutions. Grid search over N=1..20 revs.',
    referenceReplay: 'eyJ2IjoxLCJuIjpbXX0',
  },
  unlocks: [],
  assistsAllowed: ['closest_approach', 'elements', 'snapping', 'constraints'],
  coachMarks: ['mark.c05.retrograde'],
});

/** The same document with four independent faults, so `allErrors` has work to do. */
const INVALID = VALID.replace('"horizonSeconds": 50400', '"horizonSeconds": "50400"')
  .replace('"act": 2', '"act": 99')
  .replace('"id": "c05-tailgate"', '"id": "Not A Slug"')
  .replace('"title": "Tailgate"', '"title": "Tailgate", "extra": 1');

/** Median and minimum milliseconds per call. Same shape as the other benchmarks here. */
const measure = (call: () => number): { median: number; min: number; sink: number } => {
  let sink = 0;
  for (let i = 0; i < ITERATIONS; i++) sink += call();

  const timings: number[] = [];
  for (let batch = 0; batch < BATCHES; batch++) {
    const start = performance.now();
    for (let i = 0; i < ITERATIONS; i++) sink += call();
    timings.push((performance.now() - start) / ITERATIONS);
  }

  timings.sort((a, b) => a - b);
  return {
    median: timings[(BATCHES - 1) / 2] ?? Number.POSITIVE_INFINITY,
    min: timings[0] ?? Number.POSITIVE_INFINITY,
    sink,
  };
};

describe('scenario load and validate (§11.9)', () => {
  const cases: readonly (readonly [key: string, label: string, text: string])[] = [
    ['valid', 'scenario load, valid document', VALID],
    ['invalid', 'scenario load, four faults (allErrors)', INVALID],
  ];

  it.each(cases)('%s', (key, label, text) => {
    // The sink reads a property of the result so the optimiser cannot elide the call.
    const { median, min, sink } = measure(() => {
      const result = loadScenario(text);
      return result.ok ? 1 : result.errors.length;
    });

    expect(sink).toBeGreaterThan(0);

    record({
      key: `game/scenario/${key}`,
      label,
      unit: 'ms',
      stat: { median, min },
      target: TARGET_MS,
      hardLimit: HARD_LIMIT_MS,
      note: null,
    });

    stdout.write(`  ${label}: ${median.toFixed(4)} ms (target ${String(TARGET_MS)} ms)\n`);
    expect(median).toBeLessThan(HARD_LIMIT_MS);
  });
});
