/**
 * The event-search performance budget (#61, `docs/PRODUCT.md` §11.9).
 *
 * > Full timeline re-evaluation, 8 nodes — target 2 ms, hard limit 8 ms.
 *
 * #61 requires the closest-approach search to "meet a stated performance budget
 * compatible with §11.9's ≤ 2 ms full timeline re-evaluation, since this runs inside
 * plan evaluation". §11.9 has no row for an event search on its own, so the budget
 * has to be *derived* rather than looked up, and the derivation is the interesting
 * part of this file.
 *
 * **The stated budget: a closest-approach search over a full contract horizon costs
 * no more than the whole timeline re-evaluation it sits inside — 2 ms target,
 * 8 ms hard limit.** That is deliberately the *same* number rather than a fraction
 * of it, because the two are not both paid per frame. §11.9's 2 ms row is the
 * dragging-a-node case, which re-propagates arcs; the event search is a per-plan
 * operation, run when a plan changes rather than while it is being dragged. Holding
 * it to the timeline's own limit is therefore a real constraint and not an
 * arbitrarily tightened one, and it is the number a caller can reason about: an
 * evaluation that does both stays inside §11.9's 8 ms hard limit.
 *
 * ## Why this is not in `packages/propagation`
 *
 * Measuring elapsed time needs a clock, and `performance` is banned in
 * `packages/{math,astro,propagation,sim,game}` by the core guardrail block. `tools/`
 * is outside that block. The benchmark is not the simulation.
 *
 * ## What is asserted, and what is only reported
 *
 * The hard limit is asserted; the target is reported. Same reasoning as
 * `propagation.bench.test.ts`: a 2 ms gate on whichever shared runner CI allocates
 * would flake, a flaking gate gets silenced, and a silenced gate enforces nothing.
 * The measured medians are printed on every run and carried into `docs/PHYSICS.md`.
 */
import { performance } from 'node:perf_hooks';
import { stdout } from 'node:process';

import { MU_EARTH, R_EARTH_EQ, eci, ecef, epoch, stateFromElements } from '@hh/astro';
import type { State } from '@hh/astro';
import {
  createArc,
  findApsisCrossings,
  findClosestApproach,
  findShellIntervals,
  findUmbraIntervals,
  findVisibilityIntervals,
} from '@hh/propagation';
import { V, metres, radians } from '@hh/math';
import { describe, expect, it } from 'vitest';

import type { Statistic } from './record.js';
import { createRecorder } from './record.js';

/** Results for the gate in `compare.mjs`; see `record.ts` for what a ratio is. */
const record = createRecorder('events');

/** §11.9's full-timeline row, which #61 says this must be compatible with. */
const TARGET_MS = 2;
const HARD_LIMIT_MS = 8;

/** A 14 h contract horizon — §11.9's own "8-node plan, 14 h horizon" case. */
const HORIZON_SECONDS = 50_400;

const BATCHES = 5;

const orbit = (a: number, e: number, nu: number, inclination = 0.9006, raan = 1.1): State =>
  stateFromElements(
    {
      semiLatusRectum: metres(a * (1 - e * e)),
      eccentricity: e,
      inclination: radians(inclination),
      raan: radians(raan),
      argp: radians(0.4),
      trueAnomaly: radians(nu),
    },
    MU_EARTH,
  );

const arcOf = (state: State) =>
  createArc({ startEpoch: epoch(0), endEpoch: epoch(HORIZON_SECONDS), state, mu: MU_EARTH });

/**
 * Median milliseconds per call.
 *
 * The median rather than the mean, so one garbage collection does not decide the
 * number. The result is accumulated into a sink and read afterwards so the
 * optimiser cannot delete the work being measured.
 */
const measure = (
  call: () => number,
  iterations: number,
): { median: number; min: number; sink: number } => {
  let sink = 0;
  for (let i = 0; i < iterations; i++) sink += call();

  const timings: number[] = [];
  for (let batch = 0; batch < BATCHES; batch++) {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) sink += call();
    timings.push((performance.now() - start) / iterations);
  }
  timings.sort((a, b) => a - b);
  return {
    median: timings[(BATCHES - 1) / 2] ?? Number.POSITIVE_INFINITY,
    min: timings[0] ?? Number.POSITIVE_INFINITY,
    sink,
  };
};

/**
 * Print a measurement.
 *
 * Only the closest-approach search is `budgeted`: #61 is the one issue that ties an
 * event search to §11.9, because it is the one that runs inside plan evaluation.
 * The other four are measured and printed for the record, and comparing them to a
 * target they were never given would either flatter them or condemn them for no
 * reason. All five are still held to the hard limit.
 */
const report = (key: string, label: string, stat: Statistic, budgeted: boolean): void => {
  const { median } = stat;
  const verdict = budgeted
    ? `(target ${String(TARGET_MS)}, hard limit ${String(HARD_LIMIT_MS)}) — ` +
      (median <= TARGET_MS ? 'within target' : 'OVER TARGET')
    : `(no §11.9 row; hard limit ${String(HARD_LIMIT_MS)})`;
  stdout.write(`  §11.9 ${label}: ${median.toFixed(3)} ms ${verdict}\n`);
  record({
    key: `propagation/events/${key}`,
    label,
    unit: 'ms',
    stat,
    target: budgeted ? TARGET_MS : null,
    hardLimit: HARD_LIMIT_MS,
    note: budgeted ? null : 'no §11.9 row of its own; held to the full-timeline hard limit',
  });
};

describe('closest approach over a contract horizon', () => {
  // A 400 km chaser at ISS inclination against a target 100 km higher in a slightly
  // eccentric orbit: the shape a rendezvous contract actually has, rather than a
  // worst case chosen to flatter or to punish the search.
  const chaser = arcOf(orbit(6_778_137, 0, 0.6));
  const target = arcOf(orbit(6_878_137, 0.01, 2.4));

  it('meets the hard limit for a 14 h horizon', () => {
    const { median, min, sink } = measure(() => {
      const best = findClosestApproach(chaser, target, epoch(0), epoch(HORIZON_SECONDS));
      return best?.separation ?? 0;
    }, 20);

    expect(Number.isFinite(sink)).toBe(true);
    report('closest-approach-14h', 'closest approach, 14 h horizon', { median, min }, true);
    expect(median).toBeLessThan(HARD_LIMIT_MS);
  });

  // Not recorded for the gate. This is a statement about the *shape* of the cost
  // curve, and the 14 h number it starts from is already recorded above; committing
  // a baseline for the doubled horizon too would gate the same code twice.
  it('scales linearly with the horizon rather than worse', () => {
    // The search is one pass over a grid whose density is set per revolution, so
    // doubling the horizon should roughly double the cost. A superlinear result
    // would mean the refinement, not the scan, dominates -- which would make the
    // budget depend on how many approaches a plan happens to contain.
    const one = measure(
      () => findClosestApproach(chaser, target, epoch(0), epoch(HORIZON_SECONDS))?.separation ?? 0,
      20,
    ).median;
    const two = measure(
      () =>
        findClosestApproach(chaser, target, epoch(0), epoch(2 * HORIZON_SECONDS))?.separation ?? 0,
      20,
    ).median;

    stdout.write(`  closest approach scaling: ${one.toFixed(3)} ms -> ${two.toFixed(3)} ms\n`);
    expect(two).toBeLessThan(one * 3);
  });
});

describe('the other four finders, for comparison', () => {
  const arc = arcOf(orbit(6_778_137, 0.02, 0.6));
  const station = {
    position: ecef(V.vec3(metres(R_EARTH_EQ), metres(0), metres(0))),
    up: V.vec3(1, 0, 0),
    rotationAngle: radians(0),
    rotationEpoch: epoch(0),
    rotationRate: 7.292115e-5,
  };

  it('stays inside the hard limit, and is reported', () => {
    const cases: readonly [string, string, () => number, number][] = [
      [
        'apsis-14h',
        'apsis crossings, 14 h',
        () => findApsisCrossings(arc, epoch(0), epoch(HORIZON_SECONDS)).length,
        200,
      ],
      [
        'shell-14h',
        'shell intervals, 14 h',
        () => findShellIntervals(arc, 6_800_000, epoch(0), epoch(HORIZON_SECONDS)).length,
        200,
      ],
      [
        'umbra-14h',
        'umbra intervals, 14 h',
        () =>
          findUmbraIntervals(
            arc,
            eci(V.vec3(1, 0, 0)),
            R_EARTH_EQ,
            epoch(0),
            epoch(HORIZON_SECONDS),
          ).length,
        20,
      ],
      // The most expensive of the five, and knowingly so: its 256 samples per
      // revolution are what resolve a 22 s pass, and buying that back by thinning the
      // grid would trade a real capability for a benchmark. It is a per-contract
      // call, not a per-frame one.
      [
        'station-14h',
        'station visibility, 14 h',
        () => findVisibilityIntervals(arc, station, 0.087, epoch(0), epoch(HORIZON_SECONDS)).length,
        20,
      ],
    ];

    for (const [key, label, call, iterations] of cases) {
      const { median, min, sink } = measure(call, iterations);
      expect(Number.isFinite(sink)).toBe(true);
      report(key, label, { median, min }, false);
      expect(median).toBeLessThan(HARD_LIMIT_MS);
    }
  });
});
