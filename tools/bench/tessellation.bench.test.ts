/**
 * The orbit-tessellation performance budget from `docs/PRODUCT.md` §11.9.
 *
 * > Orbit tessellation, one orbit — target 0.5 ms, hard limit 2 ms.
 *
 * #104 asks for that to be met rather than assumed, and it is the budget that decides
 * whether dragging a node feels direct: §11.9 allows 8 ms for a whole dragging frame on
 * an 8-node plan, and a plan that size holds nine or ten conics. Ten orbits at the
 * 0.5 ms target would be 5 ms of that 8 ms on tessellation alone — which is why the
 * cache exists, and why the second case below measures the cached path as well as the
 * cold one.
 *
 * ## Why this is not in `packages/render`
 *
 * Measuring elapsed time needs a clock. `performance` is banned in
 * `packages/{math,astro,propagation,sim,game}` by the core guardrail block in
 * `eslint.config.js`, and while `@hh/render` is exempt from that block — the DOM is its
 * job — the same argument that put `propagation.bench.test.ts` here applies: `tools/` is
 * where measurement lives, next to the other budget it already checks, rather than
 * scattered through the packages being measured.
 *
 * ## What is asserted, and what is only reported
 *
 * The **hard limit** is asserted; the **target** is reported and not asserted. That is
 * the same deliberate choice `propagation.bench.test.ts` documents: this runs on
 * whatever shared runner CI allocates, not on §11.9's 2019 mid-range laptop, so a gate
 * on the target would eventually be silenced and then the budget would be enforced by
 * nothing at all. The measured median is printed on every run, so a regression that
 * stays under the hard limit is still visible to anyone reading the output.
 */
import { performance } from 'node:perf_hooks';
import { stdout } from 'node:process';

import type { OrbitShape } from '@hh/astro';
import { metres, radians } from '@hh/math';
import { createTessellationCache, tessellate } from '@hh/render';
import { describe, expect, it } from 'vitest';

/** §11.9: target 0.5 ms, hard limit 2 ms, for one orbit. */
const TARGET_MILLISECONDS = 0.5;
const HARD_LIMIT_MILLISECONDS = 2;

const BATCHES = 7;
/**
 * Fewer iterations than the propagation bench, because one call here costs tens of
 * microseconds rather than one. 500 still puts tens of milliseconds of work in every
 * batch, which is far above the timer's resolution, and it keeps the whole file inside
 * a sane timeout when `pnpm coverage` runs it under V8 instrumentation.
 */
const ITERATIONS = 500;

/** A planner-sized viewport at a planner-sized zoom: 800 px across a GEO-scale frame. */
const SCALE = 800 / 8.4e7;
const MAX_RADIUS = 1e9;

const orbit = (semiLatusRectum: number, eccentricity: number): OrbitShape => ({
  semiLatusRectum: metres(semiLatusRectum),
  eccentricity,
  inclination: radians(0.9006),
  raan: radians(1.1),
  argp: radians(0.4),
  trueAnomaly: radians(0),
});

/**
 * Median milliseconds per call over `BATCHES` batches.
 *
 * The median rather than the mean, for the reason `propagation.bench.test.ts` gives: one
 * garbage collection inside one batch should not decide the number. The call's result is
 * accumulated into a sink and read afterwards so the optimiser cannot delete the work.
 */
const measure = (call: () => number): { median: number; sink: number } => {
  let sink = 0;

  for (let i = 0; i < ITERATIONS; i++) sink += call();

  const timings: number[] = [];
  for (let batch = 0; batch < BATCHES; batch++) {
    const start = performance.now();
    for (let i = 0; i < ITERATIONS; i++) sink += call();
    timings.push((performance.now() - start) / ITERATIONS);
  }

  timings.sort((a, b) => a - b);
  return { median: timings[(BATCHES - 1) / 2] ?? Number.POSITIVE_INFINITY, sink };
};

const report = (label: string, median: number): void => {
  stdout.write(
    `  §11.9 tessellate(${label}): ${median.toFixed(4)} ms/orbit ` +
      `(target ${String(TARGET_MILLISECONDS)}, hard limit ${String(HARD_LIMIT_MILLISECONDS)}) ` +
      `— ${median <= TARGET_MILLISECONDS ? 'within target' : 'OVER TARGET'}\n`,
  );
};

describe('§11.9 — orbit tessellation, one orbit', () => {
  it.each([
    // A parking orbit and a GEO orbit are what most of a contract's frames actually
    // draw; the high-eccentricity transfer is the one that refines hardest, because
    // periapsis curvature is where the subdivision spends its vertices.
    ['a near-circular LEO', orbit(6_778_137, 0.001)],
    ['a GTO-like transfer, e = 0.73', orbit(1.5e7, 0.73)],
    ['a hyperbolic escape arc', orbit(8.0e6, 1.4)],
  ])(
    'meets the hard limit for %s',
    (label, elements) => {
      let index = 0;
      const { median, sink } = measure(() => {
        // Vary the orbit slightly so the measurement cannot collapse onto one cached
        // branch prediction, and so the vertex count varies the way it does under a drag.
        index = (index + 1) % 128;
        const nudged: OrbitShape = {
          ...elements,
          semiLatusRectum: metres(elements.semiLatusRectum * (1 + index * 1e-6)),
        };
        return tessellate({ elements: nudged, scale: SCALE, maxRadius: MAX_RADIUS }).points.length;
      });

      expect(Number.isFinite(sink)).toBe(true);
      report(label, median);
      expect(median).toBeLessThan(HARD_LIMIT_MILLISECONDS);
      // Generous, because `pnpm coverage` runs this under V8 instrumentation, which costs
      // several times the uninstrumented rate. The budget is the assertion; this is only
      // there so a slow runner reports a number rather than a timeout.
    },
    60_000,
  );

  it('costs almost nothing on a cache hit, which is what a drag frame relies on', () => {
    const cache = createTessellationCache();
    const elements = orbit(1.5e7, 0.73);
    const request = { elements, scale: SCALE, maxRadius: MAX_RADIUS };

    const { median, sink } = measure(() => cache.get(request).points.length);

    expect(Number.isFinite(sink)).toBe(true);
    report('cached, unchanged orbit', median);

    // A drag frame re-tessellates one orbit and reads the rest from the cache, so the
    // nine unchanged conics have to be effectively free against §11.9's 8 ms frame.
    expect(median).toBeLessThan(TARGET_MILLISECONDS / 10);
  }, 60_000);
});
