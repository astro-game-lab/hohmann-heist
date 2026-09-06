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
import type { ClosedFormReference } from './crosscheck.js';
import { closedFormFor } from './crosscheck.js';
import type { DriftPoint, ParSolution } from './solve.js';

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
  const { search } = record.solution;
  const method =
    search.kind === 'lambert'
      ? `Lambert transfer search over departure epoch and time of flight: ` +
        `${String(search.gridPoints)} grid points across ${String(search.familiesFound)} ` +
        `transfer families, revolutions capped at ${String(search.grid.maxRevolutions)} ` +
        `(derived from this contract's horizon), each refined by a Nelder-Mead simplex`
      : search.kind === 'transfer'
        ? `Closed-form ${search.shape} transfer in ${String(search.impulses)} impulse` +
          `${search.impulses === 1 ? '' : 's'}, with the departure epoch swept across one ` +
          `revolution (${String(search.departureSamples)} samples) and refined to the centre ` +
          `of the goal's tolerance band`
        : search.kind === 'phasing'
          ? `Closed-form phasing sweep over two revolution counts: ` +
            `${String(search.membersEnumerated)} members enumerated, ` +
            `${String(search.membersFeasible)} admissible, the cheapest of them flown in ` +
            `${String(search.shipRevolutions)} ship revolutions against the target's ` +
            `${String(search.targetRevolutions)}; the Lambert family is degenerate here and ` +
            `was searched too`
          : `Drift-orbit family indexed by revolution count: ${String(search.family.length)} ` +
            `members enumerated in closed form up to a ceiling of ` +
            `${String(search.revolutionCeiling)}, the cheapest whose second burn lands inside ` +
            `the deadline`;
  return (
    `${method}, then evaluated as a quantised plan through the game's own timeline. ` +
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

There is no general trajectory optimiser here. Each objective kind names a **family** of
solutions that is the right shape for it, and the solver searches that family and nothing
else.

### \`intercept\` — Lambert transfers between two epochs

Parameterised by **departure epoch** and **time of flight**, and searched in two stages.

1. **A grid.** Departure epoch is sampled across the interval from mission start to the
   deadline; arrival epoch across the interval from the earliest admissible transfer to
   the planning horizon. At each point every Lambert branch the time of flight admits is
   solved — the zero-revolution transfer and both branches of each multi-revolution count
   up to the search ceiling — and the cheapest point of each branch family is kept.
2. **A simplex.** Each family's best grid point seeds a Nelder–Mead refinement over the
   same two parameters, with the initial simplex one grid cell wide. The refinement runs
   per family because the cheapest family changes across the search space and a simplex
   on a discontinuous objective converges to the discontinuity.

The **revolution ceiling is derived from the contract's own horizon** rather than fixed or
overridden per contract: a transfer cannot complete more revolutions than fit in the
planning horizon, so the horizon divided by the ship's orbital period is an upper bound
that is a property of the scenario rather than of a lookup table. Each entry below reports
the ceiling its contract reached.

### \`reach_orbit\` — tangential two-body transfers

The Δv is **not searched for**. Between two coplanar circular orbits the minimum-Δv
two-impulse transfer is the Hohmann transfer; searching a grid for it would be pretending
not to know a textbook result, and would publish a number slightly worse than the one that
can be written down. Where the radius ratio exceeds 11.94 the bi-elliptic branch is
searched over its one free parameter as well, because above that ratio the answer depends
on the intermediate radius; below it, Hohmann wins for every intermediate radius and the
branch is skipped rather than searched and discarded.

What *is* searched is **when to depart**. A goal that is circular and equatorial pins
nothing and the answer is to leave immediately. A goal with an apse line pins the burn to
the point that becomes its periapsis — half an orbit from the apsis being raised, which is
the lesson C01 exists to teach. The departure epoch is swept across one revolution, scored
by how far the resulting orbit sits from the goal in units of its own tolerance, and
refined to the **centre** of the tolerance band rather than an edge of it.

### \`station\` — drift orbits

Not a transfer between two positions, so the Lambert family would not find it at all.
Leave the geostationary radius so the period no longer matches Earth's rotation, let the
longitude slide, and burn again to stop. The free parameter is an **integer**: how many
complete drift revolutions to fly. That is what makes the construction exact — a drift
orbit is eccentric, so the burn that stops the drift is the first one reversed only at the
apsis the ship departed from, which comes round once per revolution. Everything else
follows from

\`\`\`
T' = T_geo − slot / (k · omega_earth)
\`\`\`

and vis-viva at the departure radius. Δv falls as \`k\` rises, so the cheapest admissible
member is the largest \`k\` whose second burn still lands inside the deadline: **the
deadline, not the budget, is what sets par for a station contract.** The whole family is
tabulated in the entry rather than only its winner, because the trade is the contract.

The winner is then built as a real \`Plan\` — quantised at entry to DEP-09's 1e-4 m/s and
1/1024 s, exactly as a player's plan would be (FR-105) — and run through the game's own
timeline, objective evaluator and legality check. **The published numbers are what that
evaluation reported**, not what the search estimated: a par the game itself did not
produce is a par nobody can reproduce.

How many impulses the resulting plan carries follows from the objective. An \`intercept\`
needs only the departure impulse — DEP-04 asks for 1 000 m of range and says nothing about
relative velocity — so its plan has one burn, whether the transfer is a climb or a phasing
loop. A \`reach_orbit\` takes one impulse when the goal's near apsis is already where the
ship is and two when it must circularise elsewhere. A \`station\` takes two: start the
drift, stop the drift. An objective that must match **velocity** takes an arrival impulse
none of these families buys, and gets its own strategy with the contract that first needs
one; the solver refuses an objective it has no strategy for rather than answering a
different question.

Δv is the sum of the burn magnitudes, which is the quantity the budget caps (DEP-02).
Time is the epoch at which the objective evaluator says the objective was met — for a
proximity objective the closest approach inside tolerance, not the last burn and not the
horizon.

## What the method does not do

DEP-12 is explicit that par is a fine grid refined by local optimisation and **not a
proven optimum**, and there are three specific reasons it is not:

- **The family is chosen per objective kind, and nothing outside it is looked for.** An
  \`intercept\` solved by a drift-and-catch, a \`reach_orbit\` reached by a three-burn detour
  outside the bi-elliptic branch, a \`station\` slot acquired on a transfer rather than a
  drift — none of these is searched.
- **A grid can step over a narrow minimum.** The simplex finds the bottom of a valley it
  started in; it cannot find one the grid never entered.
- **The revolution count is capped.** The ceiling is derived from each contract's horizon
  and is a bound on the work, not on the physics. Every entry reports the ceiling it got.

Where the geometry admits a closed form, each entry reports it beside the search's answer.
That comparison is evidence about the **search**: the two paths share only the values of μ
and ω⊕, so agreement means the grid, the simplex, the Lambert solver, the quantiser and the
timeline did not conspire. It is *not* evidence about the physics, which is checked
independently in \`docs/PHYSICS.md\` — Tier 1 against closed forms, Tier 3 against Vallado,
Curtis and a poliastro-lineage fixture.

Four geometries, four forms: the apoapsis raise for an \`intercept\` between circular orbits
of different radii; the **phasing orbit** for one between orbits of the *same* radius,
where a Hohmann check would compare against zero and call it agreement; the Hohmann pair
or its first burn alone for a \`reach_orbit\`; and the first-order drift relation
\`λ̇ = −3Δv/a\` for a \`station\`. The first three are exact and are held to DEP-09's
quantisation noise. The fourth is a linearisation and is held to its own second-order term
instead, because asserting a first-order expansion to a quantum would be asserting
something false.

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

Acts I's four contracts reproduce §6.8 to the digit — 109.1177, 216.6823 and 3 853.9598 m/s
against a table quoting 109, 217 and 3 854 — so the divergences below are all in Act II, and
all of them are the same divergence: **§6.8's Δv columns price a manoeuvre that meets the
objective and then tidies up afterwards, and the objective does not ask for the tidying.**

- **C03 "Cold Open" — §6.8 quotes 217 m/s and 48 min; the solver finds about half the Δv.**
  The table's figure is the full two-burn Hohmann transfer, which is what C02 costs. C03 is
  an **\`intercept\`**, and DEP-04 asks only for 1 000 m of range — it says nothing about
  relative velocity, so the circularisation burn buys nothing the objective wants. One
  prograde impulse that raises apoapsis to the target's radius is the whole solution. The
  time is larger than 48 min for the matching reason: 48 min is the transfer alone, and the
  contract's departure phase requires waiting for the window before the transfer starts.
  Which is the lesson §6.8 itself assigns to C03 — *the transfer must arrive when the target
  is there, and departure timing is a free variable.*

- **C05 "Tailgate" and C06 "Overtake" — §6.8 quotes 72 and 44.0 m/s; the solver finds
  exactly half of each.** Same cause as C03, and the *times* agree to the minute: 12 h 10 m
  and 12 h 27 m, both on eight revolutions, exactly as the table says. §6.8 prices the
  two-burn phasing manoeuvre — drop into the phasing orbit, then re-circularise — and the
  re-circularisation is what an \`intercept\` does not buy. This was raised as a design
  question rather than settled by the arithmetic, because promoting C05 to a
  \`rendezvous\` *would* make the second burn necessary and would restore §6.8's figure.
  The decision was to keep \`intercept\`: C08 *Handshake*'s entire lesson is
  *"intercept is not rendezvous; you must match velocity too"*, and spending it three
  contracts early would cost more than the number is worth. C05's teaching claim is about
  **direction** — burn retrograde to catch something ahead — and one burn teaches it.

- **C07 "Slot Machine" — §6.8 quotes 1.7 m/s over 10 d 4 h; the solver ships 1.4244 m/s
  over 11.96 d.** Not a disagreement about the physics: §6.8's pair of points, *"1.7 m/s and
  ten days, or 3.7 m/s and five"*, are members of the family the solver enumerates, and the
  table below has the first of them at **1.7096 m/s over 9.96 days** — three figures, from
  the constants. The second is close rather than exact: the family is indexed by whole
  revolutions, and 3.7 m/s falls between the four-revolution member (4.2793 m/s, 3.98 d)
  and the five (3.4220 m/s, 4.98 d). The contract's deadline is twelve days, par is the
  cheapest member that fits inside it, and that is the twelve-revolution member rather than
  the ten. §6.8 quotes a point on the trade; the contract asks for its end.

## A correction to §6.8's C05/C06 asymmetry

§6.8 says of the phasing pair: *"there the **altitude floor** caps how cheap you can go,
here the **deadline** does."* The second half is right. The first is backwards, and the
arithmetic is not close.

Δv falls **monotonically with revolution count** — a longer phasing loop is a smaller
period change — so a cheaper solution flies a *higher* periapsis, not a lower one. C05's
winning eight-revolution member has its periapsis at 274.2 km; nine revolutions would put
it at 288.2 km. The floor is nowhere near either. Where it does bite is the **fast** end:
three revolutions puts periapsis at 63.2 km, through DEP-08's 100 km floor, and four
brings it back to 147.8 km.

So the floor bounds how *quickly* C05 can be flown, and the deadline bounds how *cheaply* —
in both contracts. The asymmetry §6.8 is reaching for is still real and is still worth
preserving: C05's family runs **downward** into the floor and C06's runs **upward** away
from it, so only one of the two has a fast end the floor can reach at all. That is what
\`tools/content/contracts.test.ts\` asserts, in those terms.

## The phasing family, and why Lambert cannot find it

Worth recording because it looks like a tuning problem and is not. C05 and C06 put the ship
and the target on the **same** circular orbit, so the manoeuvre is not a transfer between
two places — it is a change of period, flown for a whole number of revolutions, returning
to the point it started from. Departure and arrival are the same position, and that is
precisely the geometry Lambert's problem is degenerate at: the transfer angle is zero and
\`solveLambert\` refuses it.

The transfer search can therefore only creep towards the answer and gets worse as it does.
On C05 it returned 48.26 m/s from seventeen families with two of them feasible, against a
closed form of 36.00 — a number that is admissible, reproducible, and 34% too expensive.
Phasing orbits are a family of their own for that reason, indexed by two integers, and both
families are searched on every \`intercept\`; each entry below reports what the one that
lost was worth.

## Contracts
`;

/** A row of the drift family, as `docs/PARS.md` tabulates the trade (#94). */
const driftRow = (point: DriftPoint, winner: DriftPoint): string => {
  const mark = point.revolutions === winner.revolutions ? ' **← par**' : '';
  return (
    `| ${String(point.revolutions)} | ${fixed(point.totalDvMps, 4)} | ` +
    `${fixed(point.elapsedSeconds / 86_400, 2)} | ${fixed(point.semiMajorAxisOffsetM / 1000, 2)} | ` +
    `${point.feasible ? 'yes' : 'no — past the deadline'}${mark} |`
  );
};

/**
 * The Δv/time trade across the drift family, which for C07 *is* the contract.
 *
 * §6.8 calls C07 *"the delta-v/time trade at its most extreme"* and quotes two points of
 * it; #94 asks this document to show the trade rather than only the winning point, so the
 * whole enumerated family is tabulated — including the members the deadline refused,
 * because "why not cheaper" is the question a reader arrives with.
 */
const driftTable = (search: Extract<ParSolution['search'], { kind: 'drift' }>): string =>
  [
    '',
    '**The trade.** Δv falls as the drift gets slower, so what sets par is the deadline',
    'rather than the budget. Every member the solver enumerated:',
    '',
    '| Revolutions | Δv (m/s) | Elapsed (days) | Δa (km) | Admissible |',
    '| --- | --- | --- | --- | --- |',
    ...search.family.map((point) => driftRow(point, search.winner)),
  ].join('\n');

/** The "Search" paragraph, in whatever terms the winning family is stated in. */
const searchParagraph = (solution: ParSolution): string => {
  const { search } = solution;

  if (search.kind === 'lambert') {
    const family = search.candidate.family;
    const familyLine =
      family.revolutions === 0
        ? 'the direct, zero-revolution transfer'
        : `${String(family.revolutions)} complete revolution` +
          `${family.revolutions === 1 ? '' : 's'} on the ${family.branch} branch`;
    return (
      `**Search.** ${group(search.gridPoints)} grid points ` +
      `(${group(search.gridSkipped)} with no admissible transfer), ` +
      `${String(search.familiesFound)} transfer families found and ` +
      `${String(search.familiesFeasible)} of them feasible, ` +
      `${group(search.refinementIterations)} simplex iterations in total; every refinement ` +
      `${search.refinementConverged ? 'stopped on its tolerance' : '**did not converge** — it ran out of iterations, or had no feasible simplex to start from'}. ` +
      `Grid: ${group(search.grid.departureSamples)} departure samples × ` +
      `${group(search.grid.arrivalSamples)} arrival samples, revolutions capped at ` +
      `${String(search.grid.maxRevolutions)} — derived from this contract's horizon, not ` +
      `set for it — shortest transfer considered ` +
      `${group(search.grid.minTimeOfFlightSeconds)} s. The winning family is ${familyLine}.`
    );
  }

  if (search.kind === 'transfer') {
    const shape =
      search.shape === 'hohmann'
        ? `a Hohmann transfer in ${String(search.impulses)} impulse${search.impulses === 1 ? '' : 's'}`
        : `a bi-elliptic transfer via ${group(search.intermediateRadiusM ?? 0)} m`;
    const biElliptic = search.biEllipticConsidered
      ? 'The bi-elliptic branch was searched: the radius ratio is above 11.94, where the ' +
        'answer depends on the intermediate radius.'
      : `The bi-elliptic branch was **not** searched. The radius ratio is ` +
        `${fixed(search.radiusRatio, 2)}, below the 11.94 threshold \`docs/PHYSICS.md\` ` +
        `measures, and below it Hohmann wins for *every* intermediate radius — so there is ` +
        `provably nothing there to find rather than nothing found.`;
    return (
      `**Search.** No Δv search: the minimum-Δv two-impulse transfer between coplanar ` +
      `circular orbits is a closed form, and the winner is ${shape} from ` +
      `${group(search.departureRadiusM)} m to ${group(search.arrivalRadiusM)} m. What was ` +
      `searched is the departure epoch — ${group(search.departureSamples)} samples across one ` +
      `revolution, then ${group(search.refinementIterations)} simplex iterations to the ` +
      `centre of the goal's tolerance band; the refinement ` +
      `${search.refinementConverged ? 'stopped on its tolerance' : '**did not converge**'}. ` +
      biElliptic
    );
  }

  if (search.kind === 'phasing') {
    const degrees = (radians: number): string => fixed((radians * 180) / Math.PI, 1);
    const direction =
      search.shipRevolutions < search.targetRevolutions
        ? 'a lower, faster orbit — the ship catches up by dropping'
        : 'a higher, slower orbit — the ship falls back by climbing';
    const lambert =
      search.lambertBestMps === null
        ? 'The Lambert family found nothing admissible at all, which is what a degenerate ' +
          'geometry looks like from inside a transfer search.'
        : `The Lambert family was searched too and its best was ` +
          `${fixed(search.lambertBestMps, DV_DIGITS)} m/s — worse, and necessarily so: a ` +
          `phasing solution departs and arrives at the **same position**, which is the one ` +
          `geometry Lambert's problem is degenerate at, so the transfer search can only ` +
          `creep towards this answer and gets worse as it does.`;
    return (
      `**Search.** No Δv search: a phasing orbit is a closed form in two integers, how many ` +
      `revolutions the ship flies and how many the target does. The target starts ` +
      `${degrees(search.phaseRad)}° ahead, and the winner flies ` +
      `${String(search.shipRevolutions)} revolutions against the target's ` +
      `${String(search.targetRevolutions)} — ${direction} — on a period of ` +
      `${fixed(search.phasingPeriodSeconds, 3)} s, whose other apsis is at ` +
      `${group(search.otherApsisRadiusM)} m. ${String(search.membersEnumerated)} members ` +
      `were enumerated and ${String(search.membersFeasible)} were admissible. ${lambert}`
    );
  }

  const admissible = search.family.filter((point) => point.feasible).length;
  return (
    `**Search.** No Δv search: each member of the drift family is a closed form in one ` +
    `integer, the number of complete drift revolutions. ` +
    `${String(search.family.length)} members were enumerated up to a ceiling of ` +
    `${String(search.revolutionCeiling)}, ${String(admissible)} of them admissible, and the ` +
    `cheapest admissible one won — ${String(search.winner.revolutions)} revolutions on a ` +
    `drift orbit of period ${fixed(search.winner.driftPeriodSeconds, 3)} s, ` +
    `${fixed(Math.abs(search.winner.semiMajorAxisOffsetM), 1)} m ` +
    `${search.winner.semiMajorAxisOffsetM < 0 ? 'below' : 'above'} the ship's own radius.`
  );
};

/** The "Independent check" paragraph, or an honest statement that there is none. */
const crossCheckParagraph = (
  solution: ParSolution,
  reference: ClosedFormReference | null,
): string => {
  if (reference === null) {
    return (
      '**Independent check.** None: this contract’s geometry has no closed form to ' +
      'compare against, so the search is checked only by the content suite replaying its ' +
      'own answer.'
    );
  }

  const difference = Math.abs(solution.outcome.dvMps - reference.expectedMps);
  const relative = reference.expectedMps === 0 ? 0 : (100 * difference) / reference.expectedMps;
  const aside = reference.aside === null ? '' : ` ${reference.aside}`;

  return (
    `**Independent check.** Against ${reference.method}: ` +
    `**${fixed(reference.expectedMps, DV_DIGITS)} m/s**. The search found ` +
    `${fixed(solution.outcome.dvMps, DV_DIGITS)} m/s, a difference of ` +
    `${fixed(difference, 6)} m/s (${fixed(relative, 5)}%), against a tolerance of ` +
    `${fixed(reference.toleranceMps, 6)} m/s — ${reference.rationale}. The two share only ` +
    `the values of μ and ω⊕.${aside}`
  );
};

/** The objective, in one line, whatever kind it is. */
const objectiveLine = (record: ParRecord): string => {
  const loaded = record.scenario.objective;
  const document = record.scenario.document.objective;

  if (isProximityObjective(loaded) && 'targetId' in document) {
    return `${document.kind} ${document.targetId} within ${group(loaded.tolerance.maxRangeM)} m`;
  }
  if (loaded.kind === 'station') {
    const degrees = (radians: number): string => fixed((radians * 180) / Math.PI, 3);
    return (
      `station — a slot ${degrees(loaded.goal.slotOffsetRad)}° east, held within ` +
      `±${degrees(loaded.goal.maxOffsetRad)}° at a drift no greater than ` +
      `${degrees(loaded.goal.maxDriftRadPerSec * 86_400)}°/day`
    );
  }
  if (loaded.kind === 'reach_orbit') {
    const goal = loaded.goal;
    const periapsis = goal.semiLatusRectum / (1 + goal.eccentricity);
    const apoapsis = goal.semiLatusRectum / (1 - goal.eccentricity);
    return goal.eccentricity === 0
      ? `reach_orbit — circular at ${group(apoapsis)} m`
      : `reach_orbit — ${group(periapsis)} × ${group(apoapsis)} m`;
  }
  return document.kind;
};

/** The "Solution" paragraph: every impulse, in order. */
const solutionParagraph = (record: ParRecord): string => {
  const { scenario, solution } = record;
  const nodes = solution.plan.nodes;
  if (nodes.length === 0) return '**Solution.** No impulses.';

  const describe = (index: number): string => {
    const node = nodes[index];
    if (node === undefined) return '';
    const burnMet = metAt(scenario.startEpoch, node.epoch);
    // The transverse component's sign is the direction a player would read off the handle
    // (DEP-10), so it is named rather than left as a signed number in a bracket.
    const sense = node.deltaVRtn.y >= 0 ? 'prograde' : 'retrograde';
    return (
      `${index === 0 ? '' : '; '}at MET ${metOf(burnMet)} (${fixed(burnMet, TIME_DIGITS)} s), ` +
      `RTN [${fixed(node.deltaVRtn.x, DV_DIGITS)}, ${fixed(node.deltaVRtn.y, DV_DIGITS)}, ` +
      `${fixed(node.deltaVRtn.z, DV_DIGITS)}] m/s ${sense}`
    );
  };

  const impulses = nodes.map((_node, index) => describe(index)).join('');
  const count = nodes.length === 1 ? 'A single impulse' : `${String(nodes.length)} impulses`;
  return `**Solution.** ${count} — ${impulses}.`;
};

const contractSection = (record: ParRecord): string => {
  const { scenario, solution } = record;
  const document = scenario.document;
  const par = parBlockFor(record);
  const reference = closedFormFor(scenario, solution.outcome.metSeconds ?? 0);

  // Only a proximity objective has a closest approach. `reach_orbit` compares element sets
  // and `station` measures a longitude against a slot (#77), and neither has a range.
  const loaded = scenario.objective;
  const toleranceRangeM = isProximityObjective(loaded) ? loaded.tolerance.maxRangeM : null;
  const closest =
    solution.outcome.closestRangeM === null || toleranceRangeM === null
      ? ''
      : `\n| Closest approach | ${fixed(solution.outcome.closestRangeM, 1)} m, against a ` +
        `${group(toleranceRangeM)} m tolerance |`;

  const trade = solution.search.kind === 'drift' ? `${driftTable(solution.search)}\n` : '';

  // The heading is the contract id alone, so that the anchor `par.derivation` points at
  // is the id: a heading carrying the title too would make the anchor
  // `#c03-cold-open--cold-open`, and the link in every scenario file would be dead.
  return `
### ${document.id}

**“${document.title}”** — act ${String(document.act)}, contract ${String(document.index)}.

| | |
| --- | --- |
| Objective | ${objectiveLine(record)} |
| Δv budget | ${fixed(document.ship.dvBudget_mps, 1)} m/s |
| Deadline | ${metOf(scenario.rules.deadlineSeconds)} |
| Horizon | ${metOf(scenario.horizonSeconds)} |
| **par_dv** | **${fixed(par.dv_mps, DV_DIGITS)} m/s** |
| **par_time** | **${fixed(par.time_s, TIME_DIGITS)} s** (${metOf(par.time_s)}) |
| **par_burns** | **${String(par.burns)}** |${closest}
| Budget headroom | ${fixed(document.ship.dvBudget_mps / par.dv_mps, 2)}× (§13.4 asks for ≥ 1.15×) |
| Horizon headroom | ${fixed(scenario.horizonSeconds / par.time_s, 2)}× (§13.4 asks for ≥ 1.10×) |

${solutionParagraph(record)}
${trade}
${searchParagraph(solution)}

${crossCheckParagraph(solution, reference)}
`;
};

/** The whole of `docs/PARS.md`. */
export const parsDocument = (records: readonly ParRecord[]): string =>
  `${PREAMBLE}${records.map(contractSection).join('')}`;
