/**
 * Nelder–Mead simplex minimisation — the "refined by local optimisation" half of DEP-12.
 *
 * A grid finds the neighbourhood of a minimum; it does not find the minimum. For a par
 * that is published and beatable (D12), the difference matters: a grid step of thirty
 * seconds in departure epoch leaves the reported Δv a few tenths of a m/s above the real
 * one, and a player who finds those tenths has "beaten par" against a number that was
 * never the answer — a bug report about our arithmetic rather than about our physics.
 *
 * ## Why a simplex rather than a coordinate sweep
 *
 * The par surface's valley runs diagonally. For a Lambert transfer the cost depends
 * on departure epoch and time of flight mainly through where the ship *arrives*, so the
 * two parameters trade against each other and the valley floor is not aligned with either
 * axis. Golden-section sweeps along each axis in turn stall on exactly that shape, and
 * the amount they leave on the table is not bounded by anything you can state. A simplex
 * reorients itself, so it walks the valley instead of ricocheting across it.
 *
 * Derivative-free is not a compromise here either. The objective is a Lambert solve
 * followed by a full timeline evaluation; it has no analytic gradient, and a finite
 * difference of it would cost the same as the simplex step it was meant to inform.
 *
 * ## Determinism
 *
 * Everything about the search is fixed in advance: the initial simplex comes from the
 * caller's start point and step vector, the reflection, expansion, contraction and shrink
 * coefficients are the standard 1, 2, ½, ½, and the iteration cap is absolute. There is
 * no randomness and no restart heuristic, so the same inputs give the same output on
 * every run (NFR-008, NFR-009). Ties are broken by the sort's stability rather than by a
 * comparison on the coordinates, which keeps the ordering a function of the search's own
 * history rather than of the numbers' representation.
 *
 * An infeasible point is `Infinity` rather than an error, and `NaN` is folded into
 * `Infinity` on the way in — a grid point whose Lambert solve has no answer is an
 * ordinary thing to walk away from, and a simplex handles it by moving. The one thing
 * that cannot be handled is a *wholly* infeasible initial simplex, and that is reported
 * rather than returned as a shrug: see `converged`.
 */

/** Tuning. Both have defaults chosen for the par search; both are stated, not implied. */
export interface SimplexOptions {
  /**
   * Absolute cap on iterations. Default 200.
   *
   * A cap rather than a target: convergence is decided by {@link SimplexOptions.tolerance}
   * and this only bounds the work. Two hundred is roughly four times what the two-
   * parameter transfer searches take to converge, so hitting it means something is wrong
   * with the objective rather than with the budget — which is why `converged` reports it.
   */
  readonly maxIterations?: number;
  /**
   * Relative spread of the objective across the simplex at which to stop. Default 1e-10.
   *
   * Relative, because the objective is a Δv in m/s and its scale is set by the contract
   * rather than by anything here. 1e-10 of ~100 m/s is 1e-8 m/s: four orders below the
   * 1e-4 m/s quantum a node is stored in (DEP-09), so the search stops well after the
   * point where a finer answer could still change the plan that comes out of it.
   */
  readonly tolerance?: number;
  /**
   * Simplex width at which to stop, as a fraction of the initial `steps`. Default 1e-9.
   *
   * **Both this and {@link SimplexOptions.tolerance} must hold**, and the second one
   * alone is not enough. A simplex straddling a minimum can have equal objective values
   * at every vertex while still being as wide as it started — two points either side of
   * a parabola's vertex are the simplest case, and near-flat valley floors are the
   * common one. Stopping there reports a point that is not the minimum and calls it
   * converged, which for a published, beatable par (D12) is the exact failure this
   * refinement exists to prevent: the answer is a little high, nothing says so, and a
   * player finds the difference.
   *
   * Relative to the caller's step vector because the parameters have their own scales
   * and no shared unit. 1e-9 of a 45 s departure-epoch grid cell is 45 ns — six orders
   * below DEP-09's 1/1024 s tick, so the plan that comes out cannot tell the difference.
   */
  readonly stepTolerance?: number;
}

/** Where the search stopped, and whether it stopped because it was finished. */
export interface SimplexResult {
  readonly x: readonly number[];
  readonly fx: number;
  readonly iterations: number;
  /**
   * `true` when the simplex collapsed inside `tolerance`. `false` when the iteration cap
   * was reached, or when no vertex of the initial simplex was feasible — in which case
   * `fx` is `Infinity` and `x` is the start point, unchanged.
   */
  readonly converged: boolean;
}

/** Standard coefficients: reflection, expansion, contraction, shrink. */
const ALPHA = 1;
const GAMMA = 2;
const RHO = 0.5;
const SIGMA = 0.5;

interface Vertex {
  readonly x: readonly number[];
  readonly fx: number;
}

const at = <T>(items: readonly T[], i: number): T => {
  const item = items[i];
  if (item === undefined) {
    throw new RangeError(`index ${String(i)} is out of range for ${String(items.length)} items`);
  }
  return item;
};

/** `NaN` is not a value the comparisons can order, so it joins the infeasible points. */
const finite = (value: number): number => (Number.isNaN(value) ? Number.POSITIVE_INFINITY : value);

const combine = (a: readonly number[], b: readonly number[], t: number): number[] =>
  a.map((value, i) => value + t * (at(b, i) - value));

/**
 * Minimise `f` from `start`, with an initial simplex `steps` wide in each dimension.
 *
 * `steps` sets the search's scale and should be the size of the neighbourhood the grid
 * localised the minimum to — one grid cell is the natural choice. Too small and the
 * simplex converges into a corner of the cell it started in; too large and it spends its
 * first iterations walking back.
 */
export const minimise = (
  f: (x: readonly number[]) => number,
  start: readonly number[],
  steps: readonly number[],
  options: SimplexOptions = {},
): SimplexResult => {
  const maxIterations = options.maxIterations ?? 200;
  const tolerance = options.tolerance ?? 1e-10;
  const stepTolerance = options.stepTolerance ?? 1e-9;
  const n = start.length;

  if (n === 0) throw new RangeError('a simplex search needs at least one dimension');
  if (steps.length !== n) {
    throw new RangeError(
      `steps must have one entry per dimension: got ${String(steps.length)} for ` +
        `${String(n)} dimensions`,
    );
  }

  const vertex = (x: readonly number[]): Vertex => ({ x, fx: finite(f(x)) });

  // Per-dimension yardstick for "how wide is the simplex". A zero step has no scale of
  // its own, so it falls back to 1 rather than dividing by zero.
  const scale = steps.map((step) => (step === 0 ? 1 : Math.abs(step)));

  /** Widest vertex-to-best distance, in units of the initial step. */
  const width = (vertices: readonly Vertex[], best: Vertex): number => {
    let widest = 0;
    for (const candidate of vertices) {
      for (const [i, value] of candidate.x.entries()) {
        widest = Math.max(widest, Math.abs(value - at(best.x, i)) / at(scale, i));
      }
    }
    return widest;
  };

  let vertices: Vertex[] = [
    vertex([...start]),
    ...steps.map((step, i) => vertex(start.map((value, j) => (i === j ? value + step : value)))),
  ];

  // Stable sort on the objective alone. `Array.prototype.sort` has been required to be
  // stable since ES2019, so equal vertices keep the order they were built in and the
  // search's path is a function of its own history rather than of float representation.
  const sort = (): void => {
    vertices = [...vertices].sort((a, b) => a.fx - b.fx);
  };
  sort();

  if (at(vertices, 0).fx === Number.POSITIVE_INFINITY) {
    return { x: [...start], fx: Number.POSITIVE_INFINITY, iterations: 0, converged: false };
  }

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    const best = at(vertices, 0);
    const worst = at(vertices, n);
    const secondWorst = at(vertices, n - 1);

    // Two conditions, and both must hold. Relative spread is guarded so that a run whose
    // objective passes through zero cannot divide by it — the `+1` is a scale floor, not
    // a fudge: below it the absolute and the relative test coincide, which is the
    // behaviour wanted near zero. Width is what stops a simplex straddling a minimum
    // from reporting one of its ends; see `stepTolerance`.
    const spread = worst.fx - best.fx;
    const converged =
      spread <= tolerance * (Math.abs(best.fx) + Math.abs(worst.fx) + 1) &&
      width(vertices, best) <= stepTolerance;
    if (converged) {
      return { x: best.x, fx: best.fx, iterations: iteration - 1, converged: true };
    }

    // Centroid of everything but the worst vertex.
    const centroid = start.map(
      (_, i) => vertices.slice(0, n).reduce((sum, v) => sum + at(v.x, i), 0) / n,
    );

    const reflected = vertex(combine(centroid, worst.x, -ALPHA));

    if (reflected.fx < best.fx) {
      const expanded = vertex(combine(centroid, worst.x, -GAMMA));
      vertices[n] = expanded.fx < reflected.fx ? expanded : reflected;
    } else if (reflected.fx < secondWorst.fx) {
      vertices[n] = reflected;
    } else {
      // Contract towards whichever of the reflection and the worst vertex is better —
      // outside when the reflection improved on the worst, inside when it did not.
      const outside = reflected.fx < worst.fx;
      const contracted = vertex(combine(centroid, outside ? reflected.x : worst.x, RHO));
      const accepted = outside ? contracted.fx <= reflected.fx : contracted.fx < worst.fx;
      if (accepted) {
        vertices[n] = contracted;
      } else {
        // Nothing worked: pull every vertex halfway towards the best one and try again.
        vertices = [best, ...vertices.slice(1).map((v) => vertex(combine(best.x, v.x, SIGMA)))];
      }
    }
    sort();
  }

  return {
    x: at(vertices, 0).x,
    fx: at(vertices, 0).fx,
    iterations: maxIterations,
    converged: false,
  };
};
