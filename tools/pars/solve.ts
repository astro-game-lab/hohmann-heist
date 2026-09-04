/**
 * The par solver — #89, §6.7, DEP-12.
 *
 * Computes `par_dv` and `par_time` for a contract and emits the reference solution in the
 * form the scenario file stores. It is a **development tool**: nothing under `packages/`
 * or `apps/` may import it, which `dependency-cruiser`'s `no-tools-in-shipped-code` rule
 * enforces rather than leaving to review, so it cannot reach the bundle and does not count
 * against NFR-020.
 *
 * ## What par is, and what it is not
 *
 * DEP-12 states it plainly and this module may not overstate it: **par is the best
 * solution this search found, not a proven optimum.** What runs below is a fine grid over
 * the transfer parameters, refined by a simplex, over an explicitly enumerated family of
 * trajectories. Three limits follow, and they are limits of the *method*, not of this
 * implementation:
 *
 * 1. **The family is Lambert transfers between two epochs.** A cheaper solution outside it —
 *    three burns, a bi-elliptic detour, a drift-and-catch — would not be found, because
 *    it is not searched for.
 * 2. **The grid can step over a narrow minimum.** The refinement finds the bottom of a
 *    valley it started in; it cannot find one the grid never entered. The grid is fine
 *    enough that this is unlikely at v1.0's coplanar geometries and it is not impossible.
 * 3. **The revolution count is capped.** {@link DEFAULT_GRID}'s `maxRevolutions` bounds
 *    the search, not the physics, and a phasing contract that wants more revolutions than
 *    that must raise it and say so in its derivation.
 *
 * This is why D12 publishes par and invites a player to beat it. If one does, the
 * derivation in `docs/PARS.md` is what their bug report gets checked against — so it
 * records the method, these limits, and the numbers, rather than only the answer.
 *
 * ## Why the search minimises a Lambert cost and then evaluates the game's own plan
 *
 * The two stages measure different things on purpose. The **search** minimises a
 * continuous quantity — the departure impulse a Lambert arc needs — because a simplex
 * needs a surface it can walk down, and the quantity a plan actually costs is a staircase:
 * DEP-09 rounds every Δv component to 1e-4 m/s, so the evaluated cost is flat across whole
 * neighbourhoods and a simplex would stall on the first plateau it met.
 *
 * The **answer** is then built as a real `Plan`, quantised at entry the way a player's
 * would be (FR-105), and run through the same evaluator the game runs — so the published
 * par is a number the game itself produced from a plan it would let a player commit, not
 * a number this file computed about a trajectory. Everything reported comes from
 * `tools/content/evaluate.ts`, which the content suite also imports, so the figure written
 * into the scenario and the figure asserted against it cannot drift apart.
 */
import type { Epoch, LambertBranchChoice, State } from '@hh/astro';
import { addSeconds, eci, solveLambert, solveLambertBranches, toRtn } from '@hh/astro';
import type { LoadedScenario } from '@hh/game';
import { V, seconds } from '@hh/math';
import type { Arc } from '@hh/propagation';
import { createArc, stateAt } from '@hh/propagation';
import type { Plan } from '@hh/sim';
import { createManeuverNode, createPlan } from '@hh/sim';

import type { ContractOutcome } from '../content/evaluate.js';
import { isReferenceSolution, outcomeFor } from '../content/evaluate.js';
import { minimise } from './nelder-mead.js';

/** How finely the coarse stage samples, and how far it looks. */
export interface GridSpec {
  /** Departure samples across `[0, deadline]`, inclusive of both ends. */
  readonly departureSamples: number;
  /** Arrival samples across `(departure + minTimeOfFlight, horizon]`. */
  readonly arrivalSamples: number;
  /** Ceiling on complete revolutions before arrival. A bound on work, not on physics. */
  readonly maxRevolutions: number;
  /** Shortest transfer considered, seconds. */
  readonly minTimeOfFlightSeconds: number;
}

/**
 * The default grid, and why each number is what it is.
 *
 * `241 × 161` is 38 801 grid points. On C03's three-hour departure window that is a
 * departure step of 45 s and an arrival step of about two minutes — fine against a
 * transfer whose cost changes by roughly 1 m/s per 30 s of departure error, so every
 * minimum is bracketed several times over before the simplex starts.
 *
 * `maxRevolutions: 4` covers everything v1.0 Act I–III content asks for. §6.8's phasing
 * contracts go to eight revolutions and will have to raise it; the cost is linear in the
 * ceiling, and a contract that raises it says so in its derivation.
 *
 * `minTimeOfFlightSeconds: 60` keeps the grid off transfers so short that the two
 * positions are effectively the same point. Nothing physical happens there — the cost
 * simply runs away — and excluding it costs no solutions.
 */
export const DEFAULT_GRID: GridSpec = Object.freeze({
  departureSamples: 241,
  arrivalSamples: 161,
  maxRevolutions: 4,
  minTimeOfFlightSeconds: 60,
});

/**
 * One transfer geometry: a revolution count and a branch.
 *
 * The refinement runs **per family**. Minimising across all of them at once would give
 * the simplex a discontinuous objective — the cheapest family changes from one point to
 * the next, and the cost jumps where it does — and a simplex on a discontinuous surface
 * converges to the discontinuity rather than to a minimum.
 */
interface Family {
  readonly revolutions: number;
  /** Meaningless at zero revolutions, where there is one transfer rather than two. */
  readonly branch: LambertBranchChoice;
}

const familyKey = (family: Family): string =>
  `${String(family.revolutions)}:${family.revolutions === 0 ? 'single' : family.branch}`;

/** A point in the search space, with the cost the Lambert stage assigned it. */
interface Candidate {
  readonly departureMet: number;
  readonly timeOfFlightSeconds: number;
  readonly family: Family;
  /** Departure impulse magnitude, m/s. Continuous; the *plan's* cost is quantised. */
  readonly dvMps: number;
}

/** What the solver found, and enough about how it looked to write a derivation. */
export interface ParSolution {
  readonly plan: Plan;
  readonly outcome: ContractOutcome;
  readonly candidate: Candidate;
  readonly grid: GridSpec;
  /** Grid points evaluated, including those with no transfer. */
  readonly gridPoints: number;
  /** Grid points where every Lambert branch failed or the geometry was degenerate. */
  readonly gridSkipped: number;
  /** Families the grid found at all, and so the number of simplex runs. */
  readonly familiesFound: number;
  /** Families whose refined candidate produced a plan the game would accept. */
  readonly familiesFeasible: number;
  /** Simplex iterations, summed across families. */
  readonly refinementIterations: number;
  /** `true` when every simplex run stopped on its tolerance rather than on its cap. */
  readonly refinementConverged: boolean;
}

/** The ship's coasting arc, and the target's, over the whole planning horizon. */
interface Geometry {
  readonly ship: Arc;
  readonly target: Arc;
  readonly start: Epoch;
  readonly mu: number;
  readonly deadlineSeconds: number;
  readonly horizonSeconds: number;
}

const stateAtMet = (arc: Arc, start: Epoch, met: number): State | null => {
  const result = stateAt(arc, addSeconds(start, seconds(met)));
  return result.converged ? result.state : null;
};

/**
 * Every branch available for one (departure, time of flight), cheapest first.
 *
 * A degenerate geometry — the two positions collinear through the centre, which is what
 * `solveLambert` refuses — is reported as *no transfer* rather than propagated as an
 * error. It is an ordinary thing for a grid to walk over, and the count of how often it
 * happened is carried out to the derivation instead. Anything that is not a `RangeError`
 * is a bug rather than a geometry, and is rethrown.
 */
const branchesAt = (
  geometry: Geometry,
  departureMet: number,
  timeOfFlightSeconds: number,
  maxRevolutions: number,
): readonly Candidate[] => {
  const arrivalMet = departureMet + timeOfFlightSeconds;
  const from = stateAtMet(geometry.ship, geometry.start, departureMet);
  const to = stateAtMet(geometry.target, geometry.start, arrivalMet);
  if (from === null || to === null) return [];

  try {
    const solved = solveLambertBranches(
      from.position,
      to.position,
      seconds(timeOfFlightSeconds),
      'prograde',
      geometry.mu,
      { maxRevolutions },
    );
    return solved.branches.map((branch) => ({
      departureMet,
      timeOfFlightSeconds,
      family: {
        revolutions: branch.revolutions,
        branch: branch.branch === 'single' ? 'low' : branch.branch,
      },
      dvMps: V.norm(V.sub(branch.departureVelocity, from.velocity)),
    }));
  } catch (error) {
    if (error instanceof RangeError) return [];
    throw error;
  }
};

/** The continuous cost the simplex walks: one family, one Lambert solve. */
const familyCost = (
  geometry: Geometry,
  family: Family,
  departureMet: number,
  timeOfFlightSeconds: number,
): number => {
  // The box, enforced by cost rather than by projection. A simplex that steps outside is
  // told the outside is expensive and walks back in, which keeps the objective a plain
  // function of its arguments — projection would make it one that lies about where it
  // was evaluated.
  if (departureMet < 0 || departureMet > geometry.deadlineSeconds) return Number.POSITIVE_INFINITY;
  if (timeOfFlightSeconds <= 0) return Number.POSITIVE_INFINITY;
  if (departureMet + timeOfFlightSeconds > geometry.horizonSeconds) {
    return Number.POSITIVE_INFINITY;
  }

  const from = stateAtMet(geometry.ship, geometry.start, departureMet);
  const to = stateAtMet(geometry.target, geometry.start, departureMet + timeOfFlightSeconds);
  if (from === null || to === null) return Number.POSITIVE_INFINITY;

  try {
    const solution = solveLambert(
      from.position,
      to.position,
      seconds(timeOfFlightSeconds),
      'prograde',
      geometry.mu,
      { revolutions: family.revolutions, branch: family.branch },
    );
    if (!solution.converged) return Number.POSITIVE_INFINITY;
    return V.norm(V.sub(solution.departureVelocity, from.velocity));
  } catch (error) {
    if (error instanceof RangeError) return Number.POSITIVE_INFINITY;
    throw error;
  }
};

/**
 * The plan a candidate describes: one impulse, quantised at entry.
 *
 * One, because this is an **intercept**. DEP-04 asks for 1 000 m of range and says nothing
 * about relative velocity, so the arrival burn a rendezvous needs is not merely optional
 * here — buying it would double the cost for nothing the objective asks for.
 */
const planFor = (geometry: Geometry, candidate: Candidate): Plan | null => {
  const from = stateAtMet(geometry.ship, geometry.start, candidate.departureMet);
  const to = stateAtMet(
    geometry.target,
    geometry.start,
    candidate.departureMet + candidate.timeOfFlightSeconds,
  );
  if (from === null || to === null) return null;

  let departureVelocity;
  try {
    const solution = solveLambert(
      from.position,
      to.position,
      seconds(candidate.timeOfFlightSeconds),
      'prograde',
      geometry.mu,
      { revolutions: candidate.family.revolutions, branch: candidate.family.branch },
    );
    if (!solution.converged) return null;
    departureVelocity = solution.departureVelocity;
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }

  const deltaVEci = eci(V.sub(departureVelocity, from.velocity));
  return createPlan([
    createManeuverNode({
      epoch: addSeconds(geometry.start, seconds(candidate.departureMet)),
      deltaVRtn: toRtn(deltaVEci, from.position, from.velocity),
    }),
  ]);
};

/** `count` samples across `[lo, hi]`, inclusive of both ends. */
const linspace = (lo: number, hi: number, count: number): readonly number[] =>
  count <= 1 ? [lo] : Array.from({ length: count }, (_, i) => lo + ((hi - lo) * i) / (count - 1));

/**
 * Compute par for one contract.
 *
 * @throws Error when the objective is not one this solver has a strategy for. Deliberate:
 * a solver that quietly returned its best guess for a `rendezvous` by solving the
 * `intercept` inside it would publish a par that no rendezvous can achieve, and the
 * scenario would ship with a number nobody could reproduce. `reach_orbit` (C01, C02, C04)
 * and the proximity kinds that need an arrival burn (C08 onward) get their strategies with
 * the contracts that need them.
 */
export const solvePar = (scenario: LoadedScenario, grid: GridSpec = DEFAULT_GRID): ParSolution => {
  const objective = scenario.objective;
  if (objective.kind !== 'intercept') {
    throw new Error(
      `${scenario.id}: no par strategy for a "${objective.kind}" objective. ` +
        'This solver searches Lambert transfers for an `intercept`, which is ' +
        'the only objective kind shipped so far. Add the strategy with the contract that ' +
        'needs it rather than reusing this one — see tools/pars/solve.ts.',
    );
  }

  const target = scenario.targets.find((candidate) => candidate.id === objective.targetId);
  if (target === undefined) {
    throw new Error(`${scenario.id}: the loader admitted an objective naming an absent target`);
  }

  const geometry: Geometry = {
    ship: createArc({
      startEpoch: scenario.startEpoch,
      endEpoch: scenario.horizon,
      state: scenario.ship.state,
      mu: scenario.mu,
    }),
    target: createArc({
      startEpoch: scenario.startEpoch,
      endEpoch: scenario.horizon,
      state: target.state,
      mu: scenario.mu,
    }),
    start: scenario.startEpoch,
    mu: scenario.mu,
    deadlineSeconds: scenario.rules.deadlineSeconds,
    horizonSeconds: scenario.horizonSeconds,
  };

  // ── Coarse stage: the cheapest point of every family the grid can see ──────────
  const best = new Map<string, Candidate>();
  let gridPoints = 0;
  let gridSkipped = 0;

  for (const departureMet of linspace(0, geometry.deadlineSeconds, grid.departureSamples)) {
    const earliest = departureMet + grid.minTimeOfFlightSeconds;
    if (earliest >= geometry.horizonSeconds) continue;
    for (const arrivalMet of linspace(earliest, geometry.horizonSeconds, grid.arrivalSamples)) {
      gridPoints++;
      const candidates = branchesAt(
        geometry,
        departureMet,
        arrivalMet - departureMet,
        grid.maxRevolutions,
      );
      if (candidates.length === 0) {
        gridSkipped++;
        continue;
      }
      for (const candidate of candidates) {
        const key = familyKey(candidate.family);
        const incumbent = best.get(key);
        if (incumbent === undefined || candidate.dvMps < incumbent.dvMps) {
          best.set(key, candidate);
        }
      }
    }
  }

  // ── Fine stage: a simplex per family, then the game's own evaluator ────────────
  // Sorted by key so the order of refinement — and so the tie-break below — is the same
  // on every run and every platform (NFR-009). `Map` iteration order is insertion order,
  // which depends on which grid point happened to see a family first.
  const families = [...best.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  const departureStep = geometry.deadlineSeconds / Math.max(grid.departureSamples - 1, 1);
  const arrivalStep = geometry.horizonSeconds / Math.max(grid.arrivalSamples - 1, 1);

  let refinementIterations = 0;
  let refinementConverged = true;
  let winner: {
    readonly candidate: Candidate;
    readonly plan: Plan;
    readonly outcome: ContractOutcome;
  } | null = null;
  let familiesFeasible = 0;

  for (const [, seed] of families) {
    const refined = minimise(
      ([departureMet, timeOfFlightSeconds]) =>
        familyCost(geometry, seed.family, departureMet ?? 0, timeOfFlightSeconds ?? 0),
      [seed.departureMet, seed.timeOfFlightSeconds],
      // One grid cell in each direction. Smaller and the simplex converges inside the
      // cell it started in; larger and it spends its first iterations walking back.
      [departureStep, arrivalStep],
    );
    refinementIterations += refined.iterations;
    refinementConverged &&= refined.converged;

    const [departureMet, timeOfFlightSeconds] = refined.x;
    if (departureMet === undefined || timeOfFlightSeconds === undefined) continue;
    // A refinement that found nothing feasible keeps the grid point it started from,
    // which is a real transfer even when the simplex could not improve on it.
    const candidate: Candidate =
      Number.isFinite(refined.fx) && refined.fx < seed.dvMps
        ? { departureMet, timeOfFlightSeconds, family: seed.family, dvMps: refined.fx }
        : seed;

    const plan = planFor(geometry, candidate);
    if (plan === null) continue;
    const outcome = outcomeFor(scenario, plan);
    if (outcome === null || !isReferenceSolution(outcome)) continue;
    familiesFeasible++;

    // Δv first, then time — §6.7's own ordering, and the leaderboard's. A tie on both is
    // broken by the family order above rather than left to whichever ran first.
    if (
      winner === null ||
      outcome.dvMps < winner.outcome.dvMps ||
      (outcome.dvMps === winner.outcome.dvMps &&
        (outcome.metSeconds ?? Number.POSITIVE_INFINITY) <
          (winner.outcome.metSeconds ?? Number.POSITIVE_INFINITY))
    ) {
      winner = { candidate, plan, outcome };
    }
  }

  if (winner === null) {
    throw new Error(
      `${scenario.id}: the search found no plan that meets the objective and that the game ` +
        `would let a player commit. ${String(families.length)} transfer families were ` +
        `refined from ${String(gridPoints - gridSkipped)} usable grid points. Either the ` +
        'contract is unsolvable inside its budget, deadline and horizon, or the search ' +
        'family is the wrong one for it.',
    );
  }

  return {
    plan: winner.plan,
    outcome: winner.outcome,
    candidate: winner.candidate,
    grid,
    gridPoints,
    gridSkipped,
    familiesFound: families.length,
    familiesFeasible,
    refinementIterations,
    refinementConverged,
  };
};
