/**
 * `docs/PARS.md`, and the `par.derivation` string that points at it.
 *
 * §6.7 requires that `docs/PARS.md` record the derivation for each contract, and §11.5
 * makes the point sharper: *"a par without a reproducible derivation is not mergeable."*
 * This module writes both, from the solver's own output, so that neither can describe a
 * search that did not happen.
 *
 * ## Why the document is generated rather than written
 *
 * D12 publishes par and invites a player to beat it, which makes the derivation a
 * *forensic* document: when a bug report arrives, this is what it gets checked against.
 * A hand-maintained one would be the first thing to fall out of date, and a stale
 * derivation is worse than none — it describes a search that no longer produced the
 * number beside it.
 *
 * So everything contract-specific here is computed. The only prose that is written by a
 * person is {@link PREAMBLE}, which is about the *method* rather than about any contract,
 * and which is reviewed as code because it ships as documentation.
 *
 * ## Rounding
 *
 * `par_dv` is written to 1e-4 m/s and `par_time` to 1e-3 s. Those are DEP-09's quanta —
 * a plan stores Δv components in counts of 1e-4 m/s and epochs in ticks of 1/1024 s — so
 * digits past them describe a distinction no plan can express. They are also far finer
 * than §13.4's ±0.5% assertion and than the 1.10 and 1.02 medal thresholds in §6.7, so
 * nothing downstream can see the rounding.
 */
import { formatMet, met, metAt } from '@hh/astro';
import type { LoadedScenario, Par } from '@hh/game';
import { isProximityObjective } from '@hh/game';

import type { ContractFile } from '../content/scenarios.js';
import type { HohmannReference } from './crosscheck.js';
import { hohmannReference } from './crosscheck.js';
import type { ParSolution } from './solve.js';

/** Digits `par_dv` is written to: DEP-09's 1e-4 m/s Δv quantum. */
const DV_DIGITS = 4;
/** Digits `par_time` is written to: about DEP-09's 1/1024 s epoch tick. */
const TIME_DIGITS = 3;

const round = (value: number, digits: number): number => Number(value.toFixed(digits));

/** One contract, solved. */
export interface ParRecord {
  readonly file: ContractFile;
  readonly scenario: LoadedScenario;
  readonly solution: ParSolution;
  /** The reference replay, in the form `par.referenceReplay` stores. */
  readonly replayText: string;
}

/**
 * The `par.derivation` prose stored in the scenario file.
 *
 * Short, because the file is content a contributor reads and the full derivation is one
 * link away. It carries the three things §11.5 and DEP-12 require of it: the method, the
 * statement that par is the best known rather than a proven optimum, and the name of the
 * solver — plus a pointer to the section of `docs/PARS.md` that has the numbers.
 */
export const derivationFor = (record: ParRecord): string => {
  const { solution } = record;
  return (
    `Lambert transfer search over departure epoch and time of flight: ` +
    `${String(solution.gridPoints)} grid points across ${String(solution.familiesFound)} ` +
    `transfer families, each refined by a Nelder-Mead simplex, then evaluated as a ` +
    `quantised plan through the game's own timeline. ` +
    `Best known, not a proven optimum (DEP-12). ` +
    `Solver: tools/pars/solve.ts. Derivation: docs/PARS.md#${record.file.stem}.`
  );
};

/** The `par` block a scenario file stores. */
export const parBlockFor = (record: ParRecord): Par => {
  const { outcome } = record.solution;
  if (outcome.metSeconds === null) {
    // `solvePar` only returns solutions that meet the objective, so this cannot happen
    // through the harness. Checked rather than asserted away: a par with no arrival time
    // is not a par, and it should stop here rather than reach a scenario file.
    throw new Error(`${record.scenario.id}: the winning solution has no objective epoch`);
  }
  return {
    dv_mps: round(outcome.dvMps, DV_DIGITS),
    time_s: round(outcome.metSeconds, TIME_DIGITS),
    burns: outcome.burns,
    derivation: derivationFor(record),
    referenceReplay: record.replayText,
  };
};

// ── The document ────────────────────────────────────────────────────────────────

const fixed = (value: number, digits: number): string => value.toFixed(digits);

/**
 * An integer with its digits grouped in threes, the way the repository's documents write
 * a number: `38801` reads as `38 801`. A plain space rather than a locale separator —
 * `Intl` would put a comma in one locale and a full stop in another, and this document is
 * generated once and committed.
 */
const group = (value: number): string =>
  Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

const metOf = (secondsSinceStart: number): string => formatMet(met(secondsSinceStart));

/**
 * The hand-written part. Everything else in `docs/PARS.md` is computed.
 *
 * It is about the method, not about any contract, which is what keeps per-contract
 * editorial out of a generator — the same reason `packages/game/src/scenario/load.ts`
 * refuses to know any contract's id.
 */
const PREAMBLE = `# Par values — Hohmann Heist

> **Generated. Do not edit by hand.** \`pnpm pars:write\` writes this file from the
> solver's own output; \`pnpm pars:check\` regenerates it and fails when it differs from
> what is committed. An edit here is reverted by the next run rather than kept.

## What a par is

Every contract publishes two numbers (§6.7): **\`par_dv\`**, the Δv of the reference
solution, and **\`par_time\`**, the mission elapsed time at which that solution meets the
objective. Both are shown to the player in the briefing and the debrief — par is not a
hidden developer score — and both are stored in the scenario file beside a reference
replay that the content suite replays and asserts on every run (§13.4).

**Par is published and beatable.** D12: if a player beats \`par_dv\`, that is a bug report
about our optimum, and the debrief says so and offers to file it. This document is what
such a report gets checked against, which is why it records the search rather than only
the answer.

## The method

For each contract the solver enumerates a family of Lambert transfers, parameterised by
**departure epoch** and **time of flight**, and searches it in two stages.

1. **A grid.** Departure epoch is sampled across the interval from mission start to the
   deadline; arrival epoch across the interval from the earliest admissible transfer to
   the planning horizon. At each point every Lambert branch the time of flight admits is
   solved — the zero-revolution transfer and both branches of each multi-revolution count
   up to the search ceiling — and the cheapest point of each branch family is kept.
2. **A simplex.** Each family's best grid point seeds a Nelder–Mead refinement over the
   same two parameters, with the initial simplex one grid cell wide. The refinement runs
   per family because the cheapest family changes across the search space and a simplex
   on a discontinuous objective converges to the discontinuity.

The winner is then built as a real \`Plan\` — quantised at entry to DEP-09's 1e-4 m/s and
1/1024 s, exactly as a player's plan would be (FR-105) — and run through the game's own
timeline, objective evaluator and legality check. **The published numbers are what that
evaluation reported**, not what the search estimated: a par the game itself did not
produce is a par nobody can reproduce.

How many impulses the resulting plan carries follows from the objective. An \`intercept\`
needs only the departure impulse — DEP-04 asks for 1 000 m of range and says nothing about
relative velocity — so its plan has one burn. An objective that must match velocity takes
the arrival impulse too, and gets its own strategy with the contract that first needs one;
the solver refuses an objective it has no strategy for rather than answering a different
question.

Δv is the sum of the burn magnitudes, which is the quantity the budget caps (DEP-02).
Time is the epoch at which the objective evaluator says the objective was met — for a
proximity objective the closest approach inside tolerance, not the last burn and not the
horizon.

## What the method does not do

DEP-12 is explicit that par is a fine grid refined by local optimisation and **not a
proven optimum**, and there are three specific reasons it is not:

- **The search family is Lambert transfers between two epochs.** A cheaper solution outside
  that family — an extra mid-course burn, a bi-elliptic detour, a drift-and-catch — is not
  found, because it is not looked for.
- **A grid can step over a narrow minimum.** The simplex finds the bottom of a valley it
  started in; it cannot find one the grid never entered.
- **The revolution count is capped.** The ceiling below is a bound on the work, not on the
  physics. A contract needing more revolutions than the ceiling must raise it, and its
  entry says so.

Where the geometry admits a closed form, each entry reports it beside the search's answer.
That comparison is evidence about the **search**: the two paths share only the value of μ,
so agreement means the grid, the simplex, the Lambert solver, the quantiser and the
timeline did not conspire. It is *not* evidence about the physics, which is checked
independently in \`docs/PHYSICS.md\` — Tier 1 against closed forms, Tier 3 against Vallado,
Curtis and a poliastro-lineage fixture.

## Reproducing a par

\`\`\`bash
pnpm pars:check   # recompute every par and fail if it moved
pnpm pars:write   # recompute and write the result into the scenario files and this document
\`\`\`

The search is deterministic: no randomness, a fixed grid, fixed simplex coefficients and a
fixed iteration cap, so the same scenario gives the same par on every run. §11.4 does not
claim bit-identical results across JavaScript engines — \`Math.sin\` and friends are not
required to be correctly rounded — so a par recomputed on a different engine may move in
its last digits. That is why a change in par is a **visible diff** rather than a silent
one: whatever moves it, it has to be committed.

## Divergences from \`docs/PRODUCT.md\` §6.8

§6.8's Δv and time columns say of themselves that they are *"computed from the constants in
§7.3 and are indicative targets for content design ... not authoritative"*, and that the
scenario file's value is whatever the validation test confirms. Where the solver disagrees
with that table, the solver's figure is the one that ships and the divergence is recorded
here. \`docs/PRODUCT.md\` is maintained outside this repository and is not edited to match.

- **C03 "Cold Open" — §6.8 quotes 217 m/s and 48 min; the solver finds about half the Δv.**
  The table's figure is the full two-burn Hohmann transfer, which is what C02 costs. C03 is
  an **\`intercept\`**, and DEP-04 asks only for 1 000 m of range — it says nothing about
  relative velocity, so the circularisation burn buys nothing the objective wants. One
  prograde impulse that raises apoapsis to the target's radius is the whole solution. The
  time is larger than 48 min for the matching reason: 48 min is the transfer alone, and the
  contract's departure phase requires waiting for the window before the transfer starts.
  Which is the lesson §6.8 itself assigns to C03 — *the transfer must arrive when the target
  is there, and departure timing is a free variable.*

## Contracts
`;

const contractSection = (record: ParRecord): string => {
  const { scenario, solution } = record;
  const document = scenario.document;
  const par = parBlockFor(record);
  const objective = document.objective;
  const reference: HohmannReference | null = hohmannReference(scenario);

  // The proximity tolerance, where there is one. Read from the *loaded* objective rather
  // than from the document, so it is the limit the evaluator actually applied — which is
  // the departure table's default when the file did not override it.
  //
  // Only a proximity objective has one. `reach_orbit` compares element sets and `station`
  // measures a longitude against a slot (#77), and neither has a range to quote.
  const loaded = scenario.objective;
  const toleranceRangeM = isProximityObjective(loaded) ? loaded.tolerance.maxRangeM : null;

  const objectiveLine =
    isProximityObjective(loaded) && toleranceRangeM !== null && 'targetId' in objective
      ? `${objective.kind} ${objective.targetId} within ${group(toleranceRangeM)} m`
      : objective.kind;

  const node = solution.plan.nodes[0];
  const burnMet = node === undefined ? 0 : metAt(scenario.startEpoch, node.epoch);
  const burnLine =
    node === undefined
      ? 'No impulses.'
      : `A single impulse at MET ${metOf(burnMet)} (${fixed(burnMet, TIME_DIGITS)} s), ` +
        `RTN [${fixed(node.deltaVRtn.x, DV_DIGITS)}, ${fixed(node.deltaVRtn.y, DV_DIGITS)}, ` +
        `${fixed(node.deltaVRtn.z, DV_DIGITS)}] m/s — ` +
        `${solution.plan.nodes.length === 1 ? 'prograde, and nothing else' : 'the first of several'}.`;

  const closest =
    solution.outcome.closestRangeM === null || toleranceRangeM === null
      ? ''
      : `\n| Closest approach | ${fixed(solution.outcome.closestRangeM, 1)} m, against a ` +
        `${group(toleranceRangeM)} m tolerance |`;

  const family = solution.candidate.family;
  const familyLine =
    family.revolutions === 0
      ? 'the direct, zero-revolution transfer'
      : `${String(family.revolutions)} complete revolution` +
        `${family.revolutions === 1 ? '' : 's'} on the ${family.branch} branch`;

  const search =
    `**Search.** ${group(solution.gridPoints)} grid points ` +
    `(${group(solution.gridSkipped)} with no admissible transfer), ` +
    `${String(solution.familiesFound)} transfer families found and ` +
    `${String(solution.familiesFeasible)} of them feasible, ` +
    `${group(solution.refinementIterations)} simplex iterations in total; every refinement ` +
    `${solution.refinementConverged ? 'stopped on its tolerance' : '**did not converge** — it ran out of iterations, or had no feasible simplex to start from'}. ` +
    `Grid: ${group(solution.grid.departureSamples)} departure samples × ` +
    `${group(solution.grid.arrivalSamples)} arrival samples, revolutions capped at ` +
    `${String(solution.grid.maxRevolutions)}, shortest transfer considered ` +
    `${group(solution.grid.minTimeOfFlightSeconds)} s. The winning family is ${familyLine}.`;

  const crossCheck =
    reference === null
      ? '**Independent check.** None: this contract’s geometry has no closed form to ' +
        'compare against, so the search is checked only by the content suite replaying its ' +
        'own answer.'
      : `**Independent check.** The closed-form tangential impulse that raises apoapsis from ` +
        `${group(reference.shipRadiusM)} m to ${group(reference.targetRadiusM)} m is ` +
        `**${fixed(reference.firstBurnMps, DV_DIGITS)} m/s** over ` +
        `${fixed(reference.timeOfFlightSeconds, TIME_DIGITS)} s. The search found ` +
        `${fixed(solution.outcome.dvMps, DV_DIGITS)} m/s, a difference of ` +
        `${fixed(Math.abs(solution.outcome.dvMps - reference.firstBurnMps), 6)} m/s ` +
        `(${fixed((100 * Math.abs(solution.outcome.dvMps - reference.firstBurnMps)) / reference.firstBurnMps, 5)}%). ` +
        `The two share only the value of μ. A full two-burn Hohmann — what a *rendezvous* ` +
        `would cost here — is ${fixed(reference.totalMps, DV_DIGITS)} m/s.`;

  // The heading is the contract id alone, so that the anchor `par.derivation` points at
  // is the id: a heading carrying the title too would make the anchor
  // `#c03-cold-open--cold-open`, and the link in every scenario file would be dead.
  return `
### ${document.id}

**“${document.title}”** — act ${String(document.act)}, contract ${String(document.index)}.

| | |
| --- | --- |
| Objective | ${objectiveLine} |
| Δv budget | ${fixed(document.ship.dvBudget_mps, 1)} m/s |
| Deadline | ${metOf(scenario.rules.deadlineSeconds)} |
| Horizon | ${metOf(scenario.horizonSeconds)} |
| **par_dv** | **${fixed(par.dv_mps, DV_DIGITS)} m/s** |
| **par_time** | **${fixed(par.time_s, TIME_DIGITS)} s** (${metOf(par.time_s)}) |
| **par_burns** | **${String(par.burns)}** |${closest}
| Budget headroom | ${fixed(document.ship.dvBudget_mps / par.dv_mps, 2)}× (§13.4 asks for ≥ 1.15×) |
| Horizon headroom | ${fixed(scenario.horizonSeconds / par.time_s, 2)}× (§13.4 asks for ≥ 1.10×) |

**Solution.** ${burnLine}

${search}

${crossCheck}
`;
};

/** The whole of `docs/PARS.md`. */
export const parsDocument = (records: readonly ParRecord[]): string =>
  `${PREAMBLE}${records.map(contractSection).join('')}`;
