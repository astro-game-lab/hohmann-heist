/**
 * The par solver — #89, §6.7, DEP-12.
 *
 * Computes `par_dv` and `par_time` for a contract and emits the reference solution in the
 * form the scenario file stores. It is a **development tool**: nothing under `packages/`
 * or `apps/` may import it, which `dependency-cruiser`'s `no-tools-in-shipped-code` rule
 * enforces rather than leaving to review, so it cannot reach the bundle and does not count
 * against NFR-020.
 *
 * ## Three families, one per objective kind
 *
 * There is no general trajectory optimiser here and there is not going to be one. Each
 * objective kind names a *family* of solutions that is the right shape for it, and the
 * solver searches that family and nothing else:
 *
 * | Objective | Family | Free parameters |
 * | --- | --- | --- |
 * | `intercept` | Lambert transfers between two epochs | departure epoch, time of flight |
 * | `reach_orbit` | tangential two-body transfers — Hohmann, or bi-elliptic where the ratio admits it | departure epoch (and the intermediate radius, when bi-elliptic) |
 * | `station` | drift orbits — leave GEO radius, let the longitude slide, stop | one integer: how many drift revolutions |
 *
 * The families differ in more than their parameters. The Lambert one is genuinely a
 * *search* — a grid of tens of thousands of solves refined by a simplex — because the
 * cheapest transfer between two moving bodies has no closed form. The other two are
 * closed-form constructions with a one-dimensional sweep on top, because they do: the
 * minimum-Δv coplanar transfer between two circular orbits is a textbook result, and a
 * drift orbit is one algebraic relation between how far off GEO radius you go and how
 * fast the longitude slides. Where a closed form exists, searching for it would be
 * pretending not to know something.
 *
 * ## What par is, and what it is not
 *
 * DEP-12 states it plainly and this module may not overstate it: **par is the best
 * solution these searches found, not a proven optimum.** Three limits follow, and they
 * are limits of the *method*, not of this implementation:
 *
 * 1. **The family is chosen per objective kind, and a cheaper solution outside it is not
 *    found because it is not looked for.** An `intercept` solved by a drift-and-catch, a
 *    `reach_orbit` reached by a three-burn detour the bi-elliptic branch does not cover,
 *    a `station` acquisition flown on a transfer rather than a drift — none of these is
 *    searched.
 * 2. **A grid can step over a narrow minimum.** The refinement finds the bottom of a
 *    valley it started in; it cannot find one the grid never entered. The grids are fine
 *    enough that this is unlikely at v1.0's coplanar geometries and it is not impossible.
 * 3. **The revolution count is capped.** {@link revolutionCeilingFor} bounds the search,
 *    not the physics, and the ceiling each contract got is reported in its derivation.
 *
 * This is why D12 publishes par and invites a player to beat it. If one does, the
 * derivation in `docs/PARS.md` is what their bug report gets checked against — so it
 * records the method, these limits, and the numbers, rather than only the answer.
 *
 * ## Why a search minimises a continuous cost and then evaluates the game's own plan
 *
 * The two stages measure different things on purpose. The **search** minimises a
 * continuous quantity — the departure impulse a Lambert arc needs, or how far a resulting
 * orbit sits from the goal — because a simplex needs a surface it can walk down, and the
 * quantity a plan actually costs is a staircase: DEP-09 rounds every Δv component to
 * 1e-4 m/s, so the evaluated cost is flat across whole neighbourhoods and a simplex would
 * stall on the first plateau it met.
 *
 * The **answer** is then built as a real `Plan`, quantised at entry the way a player's
 * would be (FR-105), and run through the same evaluator the game runs — so the published
 * par is a number the game itself produced from a plan it would let a player commit, not
 * a number this file computed about a trajectory. Everything reported comes from
 * `tools/content/evaluate.ts`, which the content suite also imports, so the figure written
 * into the scenario and the figure asserted against it cannot drift apart.
 */
import type { Epoch, LambertBranchChoice, OrbitShape, State } from '@hh/astro';
import {
  OMEGA_EARTH,
  addSeconds,
  apoapsisRadius,
  biEllipticTransfer,
  eci,
  elementsFromState,
  hohmannTransfer,
  period,
  periapsisRadius,
  solveLambert,
  solveLambertBranches,
  toRtn,
} from '@hh/astro';
import type { LoadedScenario } from '@hh/game';
import { evaluateReachOrbit } from '@hh/game';
import { V, metres, seconds } from '@hh/math';
import type { Arc } from '@hh/propagation';
import { createArc, stateAt } from '@hh/propagation';
import type { Plan, Timeline } from '@hh/sim';
import { createManeuverNode, createPlan, stateAt as timelineStateAt } from '@hh/sim';

import type { ContractOutcome } from '../content/evaluate.js';
import { isReferenceSolution, outcomeFor, timelineFor } from '../content/evaluate.js';
import { minimise } from './nelder-mead.js';

/** Semi-major axis of a Cartesian state, m. `a = p / (1 − e²)`, through `@hh/astro`. */
const semiMajorAxisOf = (state: State, mu: number) => {
  const elements = elementsFromState(state.position, state.velocity, mu);
  return metres(elements.semiLatusRectum / (1 - elements.eccentricity * elements.eccentricity));
};

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
 * `maxRevolutions: 4` is a **floor**, not the ceiling that gets used: it is what a short
 * contract like C03 searches, and {@link revolutionCeilingFor} raises it from the
 * scenario's own horizon for anything longer. §6.8's phasing contracts need eight, and
 * they get eight by being twelve hours long rather than by naming a number.
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
 * Hard ceiling on the revolution count, whatever the horizon says.
 *
 * The Lambert stage's cost is linear in this, so an unbounded derivation from the horizon
 * would let one long contract dominate the CI step. Sixteen is comfortably above §6.8's
 * deepest phasing contract at eight and comfortably below anything that would matter to
 * the job timeout. A contract that genuinely needs more than this should say so out loud
 * by changing the constant, not by growing until nobody notices.
 */
const MAX_REVOLUTION_CEILING = 16;

/**
 * The revolution ceiling for one contract, derived from its own horizon — #93.
 *
 * `DEFAULT_GRID.maxRevolutions` used to be the ceiling for every contract, and its
 * docstring said what was wrong with that: *"§6.8's phasing contracts go to eight
 * revolutions and will have to raise it … and a contract that raises it says so in its
 * derivation."* The obvious reading of that is a per-contract override, and the obvious
 * override is a table of contract ids — which is the one thing `scenario/load.ts` refuses
 * to have, for the reason it gives at length: the moment a contract needs a special case
 * in code, contracts stop being data.
 *
 * So the ceiling is **derived**. A transfer cannot complete more revolutions than fit in
 * the planning horizon, so the horizon divided by the ship's own orbital period is an
 * upper bound that costs nothing to compute and is a property of the scenario rather than
 * of a lookup table. C03's six-hour horizon gives 3 and is floored at the default 4;
 * C05's thirteen-and-a-half-hour horizon gives 8, which is exactly what §6.8's phasing
 * pair needs. Nothing had to be told about either contract.
 *
 * The ceiling reached is reported in {@link LambertSearch} and lands in `docs/PARS.md`,
 * which is the "says so in its derivation" half of the requirement.
 */
export const revolutionCeilingFor = (scenario: LoadedScenario): number => {
  const shipPeriod = period(semiMajorAxisOf(scenario.ship.state, scenario.mu), scenario.mu);
  const fitsInHorizon = Math.floor(scenario.horizonSeconds / shipPeriod);
  return Math.min(MAX_REVOLUTION_CEILING, Math.max(DEFAULT_GRID.maxRevolutions, fitsInHorizon));
};

/** The grid one contract searches: the default, with its own revolution ceiling. */
export const gridFor = (scenario: LoadedScenario): GridSpec => ({
  ...DEFAULT_GRID,
  maxRevolutions: revolutionCeilingFor(scenario),
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

/** What the Lambert search did, for an `intercept`. */
export interface LambertSearch {
  readonly kind: 'lambert';
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

/** What the tangential-transfer construction did, for a `reach_orbit`. */
export interface TransferSearch {
  readonly kind: 'transfer';
  /** Which closed form the winner came from. */
  readonly shape: 'hohmann' | 'bi-elliptic';
  /** Impulses the construction used: one for an apsis raise, two or three otherwise. */
  readonly impulses: number;
  /** Ship radius at departure, m. */
  readonly departureRadiusM: number;
  /** The radius the transfer targets, m — the goal's far apsis. */
  readonly arrivalRadiusM: number;
  /** `arrivalRadiusM / departureRadiusM`, the number the bi-elliptic threshold is about. */
  readonly radiusRatio: number;
  /** Bi-elliptic intermediate apoapsis, m — `null` when the winner is a Hohmann. */
  readonly intermediateRadiusM: number | null;
  /** Whether the bi-elliptic branch was searched at all, and why not when it was not. */
  readonly biEllipticConsidered: boolean;
  /** Departure epochs sampled while orienting the transfer against the goal's apse line. */
  readonly departureSamples: number;
  /** Simplex iterations spent refining the departure epoch. */
  readonly refinementIterations: number;
  readonly refinementConverged: boolean;
}

/** One member of the drift family: `revolutions` drift orbits, and what it costs. */
export interface DriftPoint {
  readonly revolutions: number;
  /** Period of the drift orbit, s. */
  readonly driftPeriodSeconds: number;
  /** Semi-major axis offset from the ship's starting radius, m. Negative drifts east. */
  readonly semiMajorAxisOffsetM: number;
  /** Both impulses summed, m/s — what the closed form says this member costs. */
  readonly totalDvMps: number;
  /** Mission elapsed time at the second burn, s. */
  readonly elapsedSeconds: number;
  /** Whether the game accepted it: objective met and commit allowed. */
  readonly feasible: boolean;
}

/** What the drift-orbit sweep did, for a `station`. */
export interface DriftSearch {
  readonly kind: 'drift';
  /** Every member enumerated, cheapest last. The Δv/time trade §6.8 names (#94). */
  readonly family: readonly DriftPoint[];
  /** The member that won. */
  readonly winner: DriftPoint;
  /** Largest revolution count the horizon admitted. */
  readonly revolutionCeiling: number;
}

/** How the winner was found, in terms particular to its family. */
export type SearchReport = LambertSearch | TransferSearch | DriftSearch;

/** What the solver found, and enough about how it looked to write a derivation. */
export interface ParSolution {
  readonly plan: Plan;
  readonly outcome: ContractOutcome;
  readonly search: SearchReport;
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
 * The `intercept` strategy: Lambert transfers between two epochs.
 *
 * One impulse, because DEP-04 asks for 1 000 m of range and says nothing about relative
 * velocity — see {@link planFor}. The two stages are the grid and the simplex described
 * in the module docstring.
 */
const solveIntercept = (
  scenario: LoadedScenario,
  // The proximity member of the loaded union, which is the one carrying a target. Its
  // `kind` is `ProximityKind` rather than the literal, so it is picked out by the field
  // that distinguishes it — the same discriminator `isProximityObjective` uses.
  objective: Extract<LoadedScenario['objective'], { readonly targetId: string }>,
  grid: GridSpec,
): ParSolution => {
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
    search: {
      kind: 'lambert',
      candidate: winner.candidate,
      grid,
      gridPoints,
      gridSkipped,
      familiesFound: families.length,
      familiesFeasible,
      refinementIterations,
      refinementConverged,
    },
  };
};

// ── The `reach_orbit` strategy ───────────────────────────────────────────────────────

/**
 * How finely the departure epoch is sampled while orienting a transfer, per revolution.
 *
 * 361 samples over one revolution is a step of one degree of the ship's position. The
 * quantity being resolved is DEP-13's 0.1° angle tolerance, so the grid is ten times
 * coarser than the tolerance band it is looking for — deliberately: the grid only has to
 * *bracket* the band, and the simplex below then walks to its centre. A grid fine enough
 * to land inside the band on its own would be doing the refinement's job at ten times the
 * cost, and would still not be centred.
 */
const ORIENTATION_SAMPLES_PER_REVOLUTION = 361;

/**
 * How far a resulting orbit sits from the goal, in units of its own tolerance.
 *
 * Zero when every compared element is exactly right, `1` when each is exactly at its
 * tolerance, and smoothly increasing beyond — so a simplex has a surface to walk down and
 * its minimum is the **centre** of the tolerance band rather than an edge of it. Centring
 * matters: a departure epoch chosen at the edge would meet the objective by a hair, and
 * §13.4 replays the stored answer on a different engine than the one that wrote it.
 *
 * The comparisons come from `evaluateReachOrbit` itself rather than being recomputed
 * here, so the elements this cost is built from are exactly the elements the game judges
 * — including which ones a degenerate goal skips.
 */
const goalMismatch = (evaluation: ReturnType<typeof evaluateReachOrbit>): number =>
  evaluation.comparisons.reduce((sum, comparison) => {
    if (!comparison.compared) return sum;
    const scaled = comparison.difference / comparison.tolerance;
    return sum + scaled * scaled;
  }, 0);

/** The apsis radii a `reach_orbit` goal asks for. */
interface GoalApsides {
  readonly periapsisM: number;
  readonly apoapsisM: number;
}

const apsidesOf = (goal: OrbitShape): GoalApsides => ({
  periapsisM: periapsisRadius(goal),
  apoapsisM: apoapsisRadius(goal),
});

/** A tangential impulse: when, and how much, along the velocity at that moment. */
interface Impulse {
  readonly met: number;
  readonly magnitudeMps: number;
}

/**
 * The plan a list of tangential impulses describes, built the way the game would.
 *
 * Each impulse is applied along the **velocity at the moment it happens**, which is what
 * "prograde" means and what a player dragging the prograde handle gets. The state at each
 * burn comes from the timeline built out of the burns before it, so this is the real
 * trajectory rather than a closed form's idea of one — a second burn placed at the
 * transfer's apoapsis is placed where the *plan* actually put the apoapsis.
 *
 * Returns `null` rather than throwing for a trajectory the engine cannot evaluate: a
 * sweep over departure epochs walks over those, and they are an ordinary thing to skip.
 */
const planForImpulses = (scenario: LoadedScenario, impulses: readonly Impulse[]): Plan | null => {
  const nodes = [];
  for (const impulse of impulses) {
    const epoch = addSeconds(scenario.startEpoch, seconds(impulse.met));
    // The trajectory as flown so far: no nodes for the first impulse, every earlier node
    // for the ones after it.
    const result = timelineFor(scenario, createPlan(nodes));
    if (!result.ok) return null;
    const at = stateAtTimeline(result.timeline, epoch);
    if (at === null) return null;
    const direction = V.scale(at.velocity, 1 / V.norm(at.velocity));
    const deltaVEci = eci(V.scale(direction, impulse.magnitudeMps));
    nodes.push(
      createManeuverNode({
        epoch,
        deltaVRtn: toRtn(deltaVEci, at.position, at.velocity),
      }),
    );
  }
  return createPlan(nodes);
};

/** A timeline's state at an epoch, or `null` where it did not converge. */
const stateAtTimeline = (timeline: Timeline, at: Epoch): State | null => {
  const result = timelineStateAt(timeline, at);
  return result.converged ? result.state : null;
};

/** One candidate transfer: its impulses, and what shape produced it. */
interface TransferShape {
  readonly shape: 'hohmann' | 'bi-elliptic';
  /** Impulse magnitudes in order, signed along velocity. */
  readonly magnitudes: readonly number[];
  /** Offsets from the departure epoch, seconds. */
  readonly offsets: readonly number[];
  readonly intermediateRadiusM: number | null;
}

/**
 * The tangential transfers from a circular radius to a goal, cheapest construction first.
 *
 * Three cases, and which one applies is read off the **goal's own apsides** rather than
 * decided by a flag:
 *
 * - **The goal's near apsis is already where the ship is.** One impulse: raise the far
 *   apsis to where the goal wants it and stop. This is C01, and the second burn a
 *   circularisation would add buys nothing the goal asks for — the same argument DEP-04
 *   makes for an `intercept`, applied to a shape rather than to a range.
 * - **The goal is circular at another radius.** Two impulses: the Hohmann pair.
 * - **…and the ratio is above 11.94.** The bi-elliptic branch is searched as well, over
 *   its one free parameter. Below that ratio `docs/PHYSICS.md`'s measured threshold says
 *   Hohmann wins for *every* intermediate radius, so there is provably nothing there and
 *   the branch is skipped rather than searched and discarded.
 */
const transferShapesFor = (
  departureRadiusM: number,
  goal: GoalApsides,
  mu: number,
): readonly TransferShape[] => {
  const oneImpulse =
    Math.abs(goal.periapsisM - departureRadiusM) <= Math.abs(goal.apoapsisM - departureRadiusM);
  const targetRadius = oneImpulse ? goal.apoapsisM : goal.periapsisM;
  const hohmann = hohmannTransfer(metres(departureRadiusM), metres(targetRadius), mu);

  // Sign: outward is prograde, inward retrograde. `hohmannTransfer` reports magnitudes.
  const outward = targetRadius > departureRadiusM ? 1 : -1;

  if (oneImpulse) {
    return [
      {
        shape: 'hohmann',
        magnitudes: [outward * hohmann.firstBurn],
        offsets: [0],
        intermediateRadiusM: null,
      },
    ];
  }

  const shapes: TransferShape[] = [
    {
      shape: 'hohmann',
      magnitudes: [outward * hohmann.firstBurn, outward * hohmann.secondBurn],
      offsets: [0, hohmann.timeOfFlight],
      intermediateRadiusM: null,
    },
  ];

  if (!biEllipticCouldWin(departureRadiusM, targetRadius)) return shapes;

  const best = bestBiElliptic(departureRadiusM, targetRadius, mu);
  if (best !== null) shapes.push(best);
  return shapes;
};

/**
 * `docs/PHYSICS.md`'s measured lower threshold: below this, Hohmann wins for every `r_b`.
 *
 * 11.94 rather than 15.58, and the two are not the ends of one comparison — that document
 * says so at length. 11.94 is where the bi-elliptic with `r_b → ∞`, the best it can ever
 * do, ties Hohmann; below it there is no intermediate radius that wins, so searching is
 * provably wasted. Above it the answer depends on `r_b`, which is what makes it a search.
 */
const BI_ELLIPTIC_LOWER_THRESHOLD = 11.94;

const biEllipticCouldWin = (r1: number, r2: number): boolean =>
  Math.max(r1, r2) / Math.min(r1, r2) > BI_ELLIPTIC_LOWER_THRESHOLD;

/**
 * The cheapest bi-elliptic transfer, searched over its one free parameter.
 *
 * `r_b` is a genuine free choice — `biEllipticTransfer` says so, and §6.8's C11 is built
 * on the trade it opens. The cost falls monotonically towards `r_b → ∞` above the upper
 * threshold, so an unbounded search would return "escape and come back"; the sweep is
 * bounded at the horizon-crossing radius a contract could actually fly, and the simplex
 * refines inside it. C11 is where this earns its keep; nothing in M3 reaches it.
 */
const bestBiElliptic = (r1: number, r2: number, mu: number): TransferShape | null => {
  const outer = Math.max(r1, r2);
  const cost = (rb: number): number => {
    if (rb <= outer) return Number.POSITIVE_INFINITY;
    try {
      return biEllipticTransfer(metres(r1), metres(r2), metres(rb), mu).totalDeltaV;
    } catch (error) {
      if (error instanceof RangeError) return Number.POSITIVE_INFINITY;
      throw error;
    }
  };

  let bestRb: number | null = null;
  let bestCost = Number.POSITIVE_INFINITY;
  // A decade above the outer radius, in twenty steps. Coarse on purpose: the cost is
  // smooth and monotone in `r_b`, so this only has to find the side the minimum is on.
  for (let i = 1; i <= 20; i++) {
    const rb = outer * (1 + (i * 9) / 20);
    const value = cost(rb);
    if (value < bestCost) {
      bestCost = value;
      bestRb = rb;
    }
  }
  if (bestRb === null || !Number.isFinite(bestCost)) return null;

  const refined = minimise(([rb]) => cost(rb ?? 0), [bestRb], [outer / 2]);
  const rb =
    Number.isFinite(refined.fx) && refined.fx < bestCost ? (refined.x[0] ?? bestRb) : bestRb;

  const transfer = biEllipticTransfer(metres(r1), metres(r2), metres(rb), mu);
  const outward = r2 > r1 ? 1 : -1;
  const firstLeg = Math.PI * Math.sqrt(((r1 + rb) / 2) ** 3 / mu);
  return {
    shape: 'bi-elliptic',
    // Out to `r_b`, raise periapsis there, circularise on the way back in.
    magnitudes: [
      outward * transfer.firstBurn,
      outward * transfer.secondBurn,
      -outward * transfer.thirdBurn,
    ],
    offsets: [0, firstLeg, transfer.timeOfFlight],
    intermediateRadiusM: rb,
  };
};

/**
 * The `reach_orbit` strategy: a closed-form transfer, oriented against the goal's apse
 * line — #90, #92.
 *
 * The Δv is not searched for. Between two coplanar circular orbits the minimum-Δv
 * two-impulse transfer is the Hohmann transfer, which is a textbook result and is already
 * validated against §7.3's constants in `docs/PHYSICS.md`'s Tier 1 table; searching a grid
 * for it would be pretending not to know it, and would publish a number slightly worse
 * than the one we can write down.
 *
 * **What is searched is *when*.** A goal that is circular and equatorial pins nothing, and
 * the answer is to depart immediately. A goal with an apse line — C01's 400 × 800 km
 * ellipse — pins the burn to the point that becomes its periapsis, which is half an orbit
 * from the apoapsis being raised. That is §6.8's whole lesson for C01, *"a prograde burn
 * raises the orbit on the opposite side"*, expressed as a constraint the solver has to
 * satisfy rather than as prose: the departure epoch is swept over one revolution, scored
 * by how far the resulting orbit sits from the goal, and refined to the centre of the
 * tolerance band.
 */
const solveReachOrbit = (
  scenario: LoadedScenario,
  objective: Extract<LoadedScenario['objective'], { readonly kind: 'reach_orbit' }>,
): ParSolution => {
  const goal = apsidesOf(objective.goal);
  const shipPeriod = period(semiMajorAxisOf(scenario.ship.state, scenario.mu), scenario.mu);

  const shipArc = createArc({
    startEpoch: scenario.startEpoch,
    endEpoch: scenario.horizon,
    state: scenario.ship.state,
    mu: scenario.mu,
  });

  /** The candidate transfers available from a departure epoch, and their plans. */
  const plansAt = (departureMet: number): readonly { shape: TransferShape; plan: Plan }[] => {
    if (departureMet < 0 || departureMet > scenario.rules.deadlineSeconds) return [];
    const from = stateAtMet(shipArc, scenario.startEpoch, departureMet);
    if (from === null) return [];
    const radius = V.norm(from.position);

    return transferShapesFor(radius, goal, scenario.mu).flatMap((shape) => {
      const impulses = shape.magnitudes.map((magnitudeMps, index) => ({
        met: departureMet + (shape.offsets[index] ?? 0),
        magnitudeMps,
      }));
      const last = impulses[impulses.length - 1];
      if (last === undefined || last.met > scenario.rules.deadlineSeconds) return [];
      const plan = planForImpulses(scenario, impulses);
      return plan === null ? [] : [{ shape, plan }];
    });
  };

  /** How far the best transfer from this departure epoch lands from the goal. */
  const mismatchAt = (departureMet: number): number => {
    let best = Number.POSITIVE_INFINITY;
    for (const { plan } of plansAt(departureMet)) {
      const result = timelineFor(scenario, plan);
      if (!result.ok) continue;
      best = Math.min(
        best,
        goalMismatch(evaluateReachOrbit(result.timeline, objective.goal, objective.tolerance)),
      );
    }
    return best;
  };

  // ── Sweep one revolution of the ship's own orbit ────────────────────────────
  // One revolution and no more: the geometry repeats after it, so a second lap could only
  // find the same departure a period later, which is the same solution at a worse time.
  const window = Math.min(shipPeriod, scenario.rules.deadlineSeconds);
  const samples = ORIENTATION_SAMPLES_PER_REVOLUTION;
  let bestMet = 0;
  let bestMismatch = Number.POSITIVE_INFINITY;
  for (const departureMet of linspace(0, window, samples)) {
    const mismatch = mismatchAt(departureMet);
    // Strict `<`, so a goal that pins nothing — every sample scoring the same — keeps the
    // earliest departure and so the earliest par time.
    if (mismatch < bestMismatch) {
      bestMismatch = mismatch;
      bestMet = departureMet;
    }
  }

  const step = window / Math.max(samples - 1, 1);
  const refined = minimise(([departureMet]) => mismatchAt(departureMet ?? 0), [bestMet], [step]);
  const candidates = [bestMet, ...(Number.isFinite(refined.fx) ? [refined.x[0] ?? bestMet] : [])];

  let winner: {
    readonly plan: Plan;
    readonly outcome: ContractOutcome;
    readonly shape: TransferShape;
    readonly radiusM: number;
  } | null = null;

  for (const departureMet of candidates) {
    const from = stateAtMet(shipArc, scenario.startEpoch, departureMet);
    if (from === null) continue;
    for (const { shape, plan } of plansAt(departureMet)) {
      const outcome = outcomeFor(scenario, plan);
      if (outcome === null || !isReferenceSolution(outcome)) continue;
      if (
        winner === null ||
        outcome.dvMps < winner.outcome.dvMps ||
        (outcome.dvMps === winner.outcome.dvMps &&
          (outcome.metSeconds ?? Number.POSITIVE_INFINITY) <
            (winner.outcome.metSeconds ?? Number.POSITIVE_INFINITY))
      ) {
        winner = { plan, outcome, shape, radiusM: V.norm(from.position) };
      }
    }
  }

  if (winner === null) {
    throw new Error(
      `${scenario.id}: no tangential transfer reaches the goal orbit inside the contract's ` +
        `budget, deadline and horizon. ${String(samples)} departure epochs were swept across ` +
        `one revolution (${window.toFixed(1)} s) and the closest any of them came was ` +
        `${bestMismatch.toFixed(3)} tolerance-widths from the goal. Either the goal is not ` +
        'reachable by a two-body tangential transfer, or the deadline is shorter than one.',
    );
  }

  const targetRadius = winner.shape.magnitudes.length === 1 ? goal.apoapsisM : goal.periapsisM;
  return {
    plan: winner.plan,
    outcome: winner.outcome,
    search: {
      kind: 'transfer',
      shape: winner.shape.shape,
      impulses: winner.shape.magnitudes.length,
      departureRadiusM: winner.radiusM,
      arrivalRadiusM: targetRadius,
      radiusRatio: Math.max(winner.radiusM, targetRadius) / Math.min(winner.radiusM, targetRadius),
      intermediateRadiusM: winner.shape.intermediateRadiusM,
      biEllipticConsidered: biEllipticCouldWin(winner.radiusM, targetRadius),
      departureSamples: samples,
      refinementIterations: refined.iterations,
      refinementConverged: refined.converged,
    },
  };
};

// ── The `station` strategy ───────────────────────────────────────────────────────────

/**
 * The `station` strategy: drift orbits — #94.
 *
 * Nothing here is a transfer between two positions, so the Lambert family is the wrong
 * one and would not find this at all. Acquiring a slot 3° east is a **drift**: leave the
 * geostationary radius so the orbit's period no longer matches Earth's rotation, let the
 * longitude slide at the rate that mismatch produces, and burn again to stop.
 *
 * ## The family is indexed by an integer, and that is what makes it exact
 *
 * The obvious parameterisation is "how far off GEO radius to go", with the coast time
 * following. It has a flaw that only shows up in the second burn: a drift orbit is
 * *eccentric*, so at an arbitrary coast time the ship is not back at the radius it left,
 * and the burn that stops the drift is not simply the first one reversed. It is reversed
 * exactly once per revolution, at the apsis the ship departed from.
 *
 * So the free parameter is the **number of complete drift revolutions**, `k`, and
 * everything else is algebra. Over one revolution the ship returns to the same inertial
 * direction, so the longitude it gains is what Earth failed to turn through in that time:
 *
 *     Δλ per revolution = 2π − ω⊕·T′ = ω⊕·(T_geo − T′)
 *
 * Setting `k` revolutions equal to the slot offset gives the drift period directly,
 *
 *     T′ = T_geo − slot / (k·ω⊕)
 *
 * and the two impulses are then vis-viva at the departure radius. No search, one closed
 * form per `k`, and the second burn is exactly the negative of the first because the ship
 * is back where it started.
 *
 * ## Cheaper is slower, so the deadline is what sets par
 *
 * Δv falls as `k` rises — a longer coast needs a smaller period offset — so the cheapest
 * admissible member is the largest `k` whose second burn still lands inside the deadline.
 * That makes the contract's deadline, not its budget, the thing that decides par, which
 * is §6.8's *"delta-v/time trade, at its most extreme"* stated as a search bound. The whole
 * family is reported rather than only the winner, because #94 asks `docs/PARS.md` to show
 * the trade and not just its endpoint.
 */
const solveStation = (
  scenario: LoadedScenario,
  objective: Extract<LoadedScenario['objective'], { readonly kind: 'station' }>,
): ParSolution => {
  const radius = V.norm(scenario.ship.state.position);
  const geoPeriod = (2 * Math.PI) / OMEGA_EARTH;
  const slot = objective.goal.slotOffsetRad;

  // A slot due east of a ship already on a geostationary orbit. A contract whose ship is
  // not at that radius has no drift orbit in this sense, and the caller is told so rather
  // than handed a number from a family that does not describe it.
  if (slot === 0) {
    throw new Error(
      `${scenario.id}: the slot is at the ship's own longitude, so there is nothing to ` +
        'drift. A station contract with a zero offset is met by the empty plan and needs ' +
        'no par strategy.',
    );
  }

  // How many drift revolutions the horizon could possibly hold. One more than the deadline
  // admits, so the sweep can see the first member that does *not* fit and the derivation
  // can say the deadline is what stopped it.
  const ceiling = Math.max(1, Math.floor(scenario.horizonSeconds / geoPeriod) + 1);

  const family: DriftPoint[] = [];
  let winner: {
    readonly plan: Plan;
    readonly outcome: ContractOutcome;
    readonly point: DriftPoint;
  } | null = null;

  for (let revolutions = 1; revolutions <= ceiling; revolutions++) {
    // T′ = T_geo − slot / (k·ω⊕). A slot east of the ship needs a shorter period, so a
    // smaller semi-major axis and a retrograde first burn — which is the same
    // counter-intuitive fact C05 teaches, one act later and two orders of magnitude
    // cheaper.
    const driftPeriod = geoPeriod - slot / (revolutions * OMEGA_EARTH);
    if (driftPeriod <= 0) continue;

    const driftSemiMajorAxis = Math.cbrt(scenario.mu * (driftPeriod / (2 * Math.PI)) ** 2);
    // Vis-viva at the departure radius on the drift orbit, against the circular speed
    // there. Signed: negative is retrograde.
    const speedOnDrift = Math.sqrt(scenario.mu * (2 / radius - 1 / driftSemiMajorAxis));
    const circularSpeedHere = Math.sqrt(scenario.mu / radius);
    const firstBurn = speedOnDrift - circularSpeedHere;
    const elapsed = revolutions * driftPeriod;

    const plan = planForImpulses(scenario, [
      { met: 0, magnitudeMps: firstBurn },
      // Exactly reversed, and exactly a whole number of revolutions later, which is the
      // one coast time at which "reversed" is the right burn.
      { met: elapsed, magnitudeMps: -firstBurn },
    ]);

    const outcome = plan === null ? null : outcomeFor(scenario, plan);
    const feasible = outcome !== null && isReferenceSolution(outcome);

    const point: DriftPoint = {
      revolutions,
      driftPeriodSeconds: driftPeriod,
      semiMajorAxisOffsetM: driftSemiMajorAxis - radius,
      totalDvMps: 2 * Math.abs(firstBurn),
      elapsedSeconds: elapsed,
      feasible,
    };
    family.push(point);

    // `feasible` already carries `outcome !== null`, and the compiler knows it: the
    // narrowing travels through the aliased condition, so repeating it here would be a
    // check with no case that reaches it.
    if (!feasible || plan === null) continue;
    if (
      winner === null ||
      outcome.dvMps < winner.outcome.dvMps ||
      (outcome.dvMps === winner.outcome.dvMps &&
        (outcome.metSeconds ?? Number.POSITIVE_INFINITY) <
          (winner.outcome.metSeconds ?? Number.POSITIVE_INFINITY))
    ) {
      winner = { plan, outcome, point };
    }
  }

  if (winner === null) {
    throw new Error(
      `${scenario.id}: no drift orbit reaches the slot inside the contract's budget, ` +
        `deadline and horizon. ${String(family.length)} members of the family were tried, ` +
        `from ${family[0]?.totalDvMps.toFixed(4) ?? '—'} m/s over ` +
        `${family[0]?.elapsedSeconds.toFixed(0) ?? '—'} s downward. Either the deadline is ` +
        'shorter than one drift revolution, or the ship does not start on a geostationary ' +
        'orbit and the drift family is the wrong one for this contract.',
    );
  }

  return {
    plan: winner.plan,
    outcome: winner.outcome,
    search: {
      kind: 'drift',
      family,
      winner: winner.point,
      revolutionCeiling: ceiling,
    },
  };
};

// ── Dispatch ─────────────────────────────────────────────────────────────────────────

/**
 * Compute par for one contract.
 *
 * @throws Error when the objective is not one this solver has a strategy for. Deliberate:
 * a solver that quietly returned its best guess for a `rendezvous` by solving the
 * `intercept` inside it would publish a par that no rendezvous can achieve, and the
 * scenario would ship with a number nobody could reproduce. The proximity kinds that need
 * an arrival burn — `rendezvous` and `soft_rendezvous`, C08 onward — get their strategy
 * with the contract that first needs one.
 */
export const solvePar = (scenario: LoadedScenario, grid?: GridSpec): ParSolution => {
  const objective = scenario.objective;

  if (objective.kind === 'intercept') {
    return solveIntercept(scenario, objective, grid ?? gridFor(scenario));
  }
  if (objective.kind === 'reach_orbit') return solveReachOrbit(scenario, objective);
  if (objective.kind === 'station') return solveStation(scenario, objective);

  throw new Error(
    `${scenario.id}: no par strategy for a "${objective.kind}" objective. ` +
      'This solver has three families — Lambert transfers for an `intercept`, tangential ' +
      'two-body transfers for a `reach_orbit`, and drift orbits for a `station`. An ' +
      'objective that must match velocity needs an arrival burn and so a family of its ' +
      'own; add it with the contract that needs it rather than reusing one of these — ' +
      'see tools/pars/solve.ts.',
  );
};
