/**
 * Tests for the simplex itself.
 *
 * The par search's answer is only as good as its refinement, and a refinement that
 * quietly returned its start point would look exactly like one that worked: the grid
 * already lands close, so the published par would be a little high and nothing would
 * say so. D12 makes that a player-facing failure — they beat par, file a bug, and the
 * bug is our arithmetic. So the optimiser is exercised on functions whose minima are
 * known independently of anything in this repository.
 *
 * **Rosenbrock is the case that matters**, not the easy one. Its minimum sits at the end
 * of a curved, narrow valley, which is the shape the module docstring claims a simplex
 * handles and a coordinate sweep does not. If the implementation were wrong in the way
 * that is easy to be wrong — a contraction that never contracts, a shrink that loses the
 * best vertex — the sphere function would still pass and this would not.
 */
import { describe, expect, it } from 'vitest';

import { minimise } from './nelder-mead.js';

/** `f(x) = Σ xᵢ²`. Minimum 0 at the origin. */
const sphere = (x: readonly number[]): number => x.reduce((sum, v) => sum + v * v, 0);

/**
 * Rosenbrock's banana, `f(x, y) = (1 − x)² + 100(y − x²)²`.
 *
 * Minimum **0 at (1, 1)** — Rosenbrock, *An automatic method for finding the greatest or
 * least value of a function*, Computer Journal 3 (1960), 175–184. Stated here rather than
 * computed, because a test that derives its own expected value from the same arithmetic
 * it is testing asserts nothing.
 */
const rosenbrock = (x: readonly number[]): number => {
  const [a = 0, b = 0] = x;
  return (1 - a) ** 2 + 100 * (b - a * a) ** 2;
};

describe('finding a minimum', () => {
  it('finds the origin of a sphere function', () => {
    const result = minimise(sphere, [3, -4], [1, 1]);
    expect(result.converged).toBe(true);
    expect(result.fx).toBeLessThan(1e-12);
    expect(result.x[0]).toBeCloseTo(0, 6);
    expect(result.x[1]).toBeCloseTo(0, 6);
  });

  it('works in one dimension', () => {
    const result = minimise((x) => ((x[0] ?? 0) - 3) ** 2, [0], [1]);
    expect(result.converged).toBe(true);
    expect(result.x[0]).toBeCloseTo(3, 6);
  });

  it('walks Rosenbrock’s valley to (1, 1) from the standard start point', () => {
    // (−1.2, 1) is the start Rosenbrock's paper uses and every implementation is compared
    // from. The default 200-iteration cap is set for the two-parameter transfer search,
    // which is a far gentler surface than this one.
    const result = minimise(rosenbrock, [-1.2, 1], [0.5, 0.5], { maxIterations: 2000 });
    expect(result.converged).toBe(true);
    expect(result.x[0]).toBeCloseTo(1, 4);
    expect(result.x[1]).toBeCloseTo(1, 4);
    expect(result.fx).toBeLessThan(1e-8);
  });

  it('improves on its start point rather than returning it', () => {
    // The failure that would be invisible in the par search: a refinement that does
    // nothing still reports a plausible answer, because the grid already landed close.
    const start = [2, 2];
    const result = minimise(rosenbrock, start, [0.5, 0.5], { maxIterations: 2000 });
    expect(result.fx).toBeLessThan(rosenbrock(start));
    expect(result.fx).toBeLessThan(1e-8);
  });
});

describe('infeasible and degenerate input', () => {
  it('reports a wholly infeasible simplex rather than shrugging', () => {
    const start = [1, 2];
    const result = minimise(() => Number.POSITIVE_INFINITY, start, [1, 1]);
    expect(result.converged).toBe(false);
    expect(result.fx).toBe(Number.POSITIVE_INFINITY);
    expect(result.x).toEqual(start);
    expect(result.iterations).toBe(0);
  });

  it('treats NaN as infeasible rather than letting it order the vertices', () => {
    // A Lambert solve out of domain can produce `NaN`, and `NaN` compares false against
    // everything — a sort that let it through would put it anywhere and the search would
    // follow it. Here the region below x = 0 is `NaN`; the minimum of the rest is at 0.
    const result = minimise((x) => ((x[0] ?? 0) < 0 ? Number.NaN : (x[0] ?? 0)), [5], [1]);
    expect(Number.isNaN(result.fx)).toBe(false);
    expect(result.x[0]).toBeGreaterThanOrEqual(0);
    expect(result.fx).toBeLessThan(1e-6);
  });

  it('walks back into a feasible region it steps out of', () => {
    // How the par search's box is enforced: outside is `Infinity`, and the simplex is
    // expected to come back rather than stall on the boundary. The minimum of `(x − 2)²`
    // is at 2, which is inside the box `[0, 10]`, but the start is near the edge.
    const boxed = (x: readonly number[]): number => {
      const v = x[0] ?? 0;
      return v < 0 || v > 10 ? Number.POSITIVE_INFINITY : (v - 2) ** 2;
    };
    const result = minimise(boxed, [0.5], [2]);
    expect(result.converged).toBe(true);
    expect(result.x[0]).toBeCloseTo(2, 6);
  });

  it('respects its iteration cap', () => {
    const result = minimise(rosenbrock, [-1.2, 1], [0.5, 0.5], { maxIterations: 5 });
    expect(result.converged).toBe(false);
    expect(result.iterations).toBe(5);
  });

  it('refuses a step vector that does not match the start point', () => {
    expect(() => minimise(sphere, [1, 2], [1])).toThrow(RangeError);
  });

  it('refuses a zero-dimensional search', () => {
    expect(() => minimise(sphere, [], [])).toThrow(RangeError);
  });
});

describe('determinism (NFR-008, NFR-009)', () => {
  it('returns bit-identical results for identical inputs', () => {
    const run = (): ReturnType<typeof minimise> =>
      minimise(rosenbrock, [-1.2, 1], [0.5, 0.5], { maxIterations: 2000 });
    const first = run();
    const second = run();
    // `Object.is`, so `-0` and `+0` are distinguished: §11.4 requires same-runtime
    // determinism to be exact, and a tolerance here would hide the drift it exists to
    // catch. A par is written to a file and compared on the next run.
    expect(Object.is(first.fx, second.fx)).toBe(true);
    expect(first.x.every((value, i) => Object.is(value, second.x[i]))).toBe(true);
    expect(first.iterations).toBe(second.iterations);
  });

  it('does not depend on how the objective was reached', () => {
    // A counter in the objective would make the search order-dependent; nothing here is
    // allowed to. Two runs with an objective that counts its calls must agree on both
    // the answer and the count.
    let firstCalls = 0;
    let secondCalls = 0;
    const a = minimise(
      (x) => {
        firstCalls++;
        return sphere(x);
      },
      [3, -4],
      [1, 1],
    );
    const b = minimise(
      (x) => {
        secondCalls++;
        return sphere(x);
      },
      [3, -4],
      [1, 1],
    );
    expect(firstCalls).toBe(secondCalls);
    expect(a.x).toEqual(b.x);
  });
});
