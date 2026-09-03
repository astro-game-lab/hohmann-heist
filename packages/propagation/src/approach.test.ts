/**
 * The closest-approach finder (#61, FR-008).
 *
 * Two independent references do the work here, and neither is this module.
 *
 * **A closed form.** Two coplanar circular orbits aligned at an epoch are at their
 * minimum separation `r₂ − r₁` then, and again every synodic period
 * `2π / |n₁ − n₂|` afterwards, with a relative speed of `|√(μ/r₁) − √(μ/r₂)|`
 * because both velocities are purely transverse and parallel there. Every one of
 * those numbers comes from elementary two-body relations and none of them from a
 * search.
 *
 * **A different algorithm.** For a geometry with no closed form, the answer is
 * checked against a brute-force scan of four hundred thousand samples — the
 * time-stepping approach FR-103 forbids in the product, which is exactly why it is
 * a good oracle for the one that replaces it. If the bracketed search settled on a
 * local minimum rather than the global one, the dense scan would find the smaller
 * value and the test would fail.
 */
import {
  MU_EARTH,
  circularSpeed,
  epoch,
  period,
  semiMajorAxis,
  stateFromElements,
} from '@hh/astro';
import type { Epoch, State } from '@hh/astro';
import { V, metres, radians } from '@hh/math';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_APPROACH_SAMPLES_PER_REVOLUTION,
  findCloseApproaches,
  findClosestApproach,
} from './approach.js';
import { createArc, stateAt } from './arc.js';

const START = epoch(0);

const conic = (p: number, e: number, nu: number, inclination = 0, raan = 0, argp = 0): State =>
  stateFromElements(
    {
      semiLatusRectum: metres(p),
      eccentricity: e,
      inclination: radians(inclination),
      raan: radians(raan),
      argp: radians(argp),
      trueAnomaly: radians(nu),
    },
    MU_EARTH,
  );

const circular = (r: number, nu: number, inclination = 0, raan = 0): State =>
  conic(r, 0, nu, inclination, raan);

const arcOf = (state: State) =>
  createArc({ startEpoch: START, endEpoch: epoch(START + 1), state, mu: MU_EARTH });

/** The separation at `t`, propagated independently of anything the finder returned. */
const separationAt = (
  a: ReturnType<typeof arcOf>,
  b: ReturnType<typeof arcOf>,
  t: Epoch,
): number => {
  const first = stateAt(a, t);
  const second = stateAt(b, t);
  if (!first.converged || !second.converged) throw new Error('propagation failed');
  return V.distance(first.state.position, second.state.position);
};

describe('two coplanar circular orbits', () => {
  const R1 = 7.0e6;
  const R2 = 7.5e6;
  const a = arcOf(circular(R1, 0));
  const b = arcOf(circular(R2, 0));
  const synodic =
    (2 * Math.PI) / Math.abs(Math.sqrt(MU_EARTH / R1 ** 3) - Math.sqrt(MU_EARTH / R2 ** 3));

  it('reaches the closed-form minimum separation at each conjunction', () => {
    const approaches = findCloseApproaches(a, b, START, epoch(START + 2.5 * synodic));

    // Aligned at t = 0, then once per synodic period.
    expect(approaches.length).toBeGreaterThanOrEqual(3);
    for (const approach of approaches) {
      expect(approach.separation / (R2 - R1)).toBeCloseTo(1, 9);
    }
  });

  it('spaces the conjunctions by the synodic period', () => {
    const approaches = findCloseApproaches(a, b, START, epoch(START + 2.5 * synodic));
    for (let i = 1; i < approaches.length; i++) {
      const gap = (approaches[i]?.epoch ?? 0) - (approaches[i - 1]?.epoch ?? 0);
      expect(gap / synodic).toBeCloseTo(1, 9);
    }
  });

  it('reports the closed-form relative speed there', () => {
    const approach = findClosestApproach(a, b, START, epoch(START + 2.5 * synodic));
    expect(approach).toBeDefined();
    if (approach === undefined) return;

    // Both velocities are purely transverse and parallel at conjunction, so the
    // relative speed is the difference of two circular speeds.
    const expected = Math.abs(
      circularSpeed(metres(R1), MU_EARTH) - circularSpeed(metres(R2), MU_EARTH),
    );
    expect(approach.relativeSpeed / expected).toBeCloseTo(1, 9);
    expect(V.norm(approach.relativeVelocity)).toBeCloseTo(approach.relativeSpeed, 9);
  });
});

describe('several close passes', () => {
  // A slightly eccentric, slightly inclined chaser against a higher circular
  // target: the separations at successive passes differ, so the global minimum is
  // genuinely not the first one found.
  const a = arcOf(conic(7.2e6 * (1 - 0.12 ** 2), 0.12, 0.2, 0.02, 0.3, 1.0));
  const b = arcOf(circular(7.9e6, 2.1, 0.05));
  const SPAN = 60_000;

  it('finds the global minimum, not the first local one', () => {
    const approaches = findCloseApproaches(a, b, START, epoch(START + SPAN));
    const best = findClosestApproach(a, b, START, epoch(START + SPAN));

    expect(approaches.length).toBeGreaterThan(2);
    expect(best).toBeDefined();
    if (best === undefined) return;

    // The point of the requirement: the first local minimum is not the answer.
    expect(approaches[0]?.separation).toBeGreaterThan(best.separation);
  });

  it('agrees with a dense time-stepped scan, which is a different algorithm', () => {
    const best = findClosestApproach(a, b, START, epoch(START + SPAN));
    expect(best).toBeDefined();
    if (best === undefined) return;

    const SAMPLES = 400_000;
    let bruteSeparation = Number.POSITIVE_INFINITY;
    let bruteEpoch = START;
    for (let i = 0; i <= SAMPLES; i++) {
      const t = epoch(START + (SPAN * i) / SAMPLES);
      const d = separationAt(a, b, t);
      if (d < bruteSeparation) {
        bruteSeparation = d;
        bruteEpoch = t;
      }
    }

    // The refined answer is at least as good as the best grid point, and lands in
    // the same place: the grid step here is 0.15 s.
    expect(best.separation).toBeLessThanOrEqual(bruteSeparation);
    expect(Math.abs(best.epoch - bruteEpoch)).toBeLessThan(0.2);
  });

  it('returns genuine minima: the separation is larger just either side of each', () => {
    for (const approach of findCloseApproaches(a, b, START, epoch(START + SPAN))) {
      if (approach.boundary !== 'interior') continue;
      expect(separationAt(a, b, epoch(approach.epoch - 30))).toBeGreaterThan(approach.separation);
      expect(separationAt(a, b, epoch(approach.epoch + 30))).toBeGreaterThan(approach.separation);
    }
  });

  it('orders results by epoch and is deterministic', () => {
    const call = () => findCloseApproaches(a, b, START, epoch(START + SPAN));
    const approaches = call();

    expect(approaches.map((x) => x.epoch)).toEqual(
      [...approaches].sort((x, y) => x.epoch - y.epoch).map((x) => x.epoch),
    );
    expect(call()).toEqual(approaches);
  });

  it('reports each epoch once', () => {
    const epochs = findCloseApproaches(a, b, START, epoch(START + SPAN)).map((x) => x.epoch);
    expect(new Set(epochs).size).toBe(epochs.length);
  });
});

describe('co-orbiting bodies at a fixed phase offset', () => {
  const R = 7.0e6;
  const OFFSET = 0.4;
  const a = arcOf(circular(R, 0));
  const b = arcOf(circular(R, OFFSET));
  const T = period(semiMajorAxis(a.elements), MU_EARTH);

  it('holds a constant separation — the chord of the phase offset', () => {
    const approaches = findCloseApproaches(a, b, START, epoch(START + 2 * T));
    // Elementary geometry: the chord subtending an angle on a circle of radius R.
    const chord = 2 * R * Math.sin(OFFSET / 2);

    expect(approaches.length).toBeGreaterThan(0);
    for (const approach of approaches) {
      expect(approach.separation / chord).toBeCloseTo(1, 11);
    }
  });

  it('breaks the tie by the earliest epoch, and it is a bound', () => {
    // Every instant is a minimum, so the tie-break is the whole answer here. §11.4
    // requires it to be stated rather than left to the sort.
    const best = findClosestApproach(a, b, START, epoch(START + 2 * T));
    expect(best?.epoch).toBe(START);
    expect(best?.boundary).toBe('start');
  });
});

describe('the interval bounds', () => {
  const a = arcOf(circular(7.0e6, 0));
  const b = arcOf(circular(7.5e6, 0));

  it('tags a minimum at the start as a bound rather than an interior stationary point', () => {
    // Aligned at t = 0: the separation is at its minimum and increasing from there.
    const approaches = findCloseApproaches(a, b, START, epoch(START + 3000));
    expect(approaches[0]?.boundary).toBe('start');
    expect(approaches[0]?.epoch).toBe(START);
  });

  it('reports the end when the bodies are still closing there', () => {
    // Start just after conjunction and run backwards in phase towards the next one:
    // a window that ends mid-approach must not claim the separation was larger.
    const synodic =
      (2 * Math.PI) / Math.abs(Math.sqrt(MU_EARTH / 7.0e6 ** 3) - Math.sqrt(MU_EARTH / 7.5e6 ** 3));
    const end = epoch(START + 0.9 * synodic);
    const approaches = findCloseApproaches(a, b, epoch(START + 0.6 * synodic), end);

    const last = approaches[approaches.length - 1];
    expect(last?.boundary).toBe('end');
    expect(last?.epoch).toBe(end);
    expect(last?.separation).toBeLessThan(separationAt(a, b, epoch(START + 0.6 * synodic)));
  });

  it('answers a zero-length interval with the single instant it names', () => {
    const approaches = findCloseApproaches(a, b, START, START);
    expect(approaches).toHaveLength(1);
    expect(approaches[0]?.epoch).toBe(START);
    expect(approaches[0]?.separation).toBeCloseTo(separationAt(a, b, START), 6);
  });

  it('rejects a reversed interval', () => {
    expect(() => findCloseApproaches(a, b, epoch(START + 10), START)).toThrow(RangeError);
  });
});

describe('the sampling floor', () => {
  it('is what `samplesPerRevolution` moves, and the default is not the only setting', () => {
    const a = arcOf(conic(7.2e6 * (1 - 0.12 ** 2), 0.12, 0.2, 0.02, 0.3, 1.0));
    const b = arcOf(circular(7.9e6, 2.1, 0.05));
    const span = epoch(START + 60_000);

    const coarse = findCloseApproaches(a, b, START, span, { samplesPerRevolution: 2 });
    const fine = findCloseApproaches(a, b, START, span, { samplesPerRevolution: 256 });
    const fallback = findCloseApproaches(a, b, START, span);

    // A grid two samples wide cannot bracket every extremum; the default and a much
    // finer grid agree, which is what makes the default defensible.
    expect(coarse.length).toBeLessThan(fine.length);
    expect(fallback.length).toBe(
      findCloseApproaches(a, b, START, span, {
        samplesPerRevolution: DEFAULT_APPROACH_SAMPLES_PER_REVOLUTION,
      }).length,
    );

    const bestFine = findClosestApproach(a, b, START, span, { samplesPerRevolution: 256 });
    const bestDefault = findClosestApproach(a, b, START, span);
    expect(bestDefault?.separation).toBeCloseTo(bestFine?.separation ?? 0, 6);
  });
});

describe('open orbits', () => {
  it('handles a hyperbolic flyby past a circular orbit', () => {
    const flyby = arcOf(conic(1.2e7, 1.6, -1.2));
    const target = arcOf(circular(8.0e6, 1.0));
    const best = findClosestApproach(flyby, target, epoch(-3000), epoch(3000));

    expect(best).toBeDefined();
    if (best === undefined) return;
    expect(best.separation).toBeCloseTo(separationAt(flyby, target, best.epoch), 6);
    expect(Number.isFinite(best.relativeSpeed)).toBe(true);
  });
});
