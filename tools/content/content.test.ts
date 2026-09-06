/**
 * §13.4's content tests — #87.
 *
 * > *Every shipped contract gets, automatically: solvability, par accuracy, budget
 * > headroom, deadline headroom, schema validity, reachability, brief keys exist. This is
 * > one parameterised test file over the scenario directory, so **adding a contract adds
 * > seven tests for free** — which is what makes G6 (contributors adding contracts) safe.*
 *
 * That last clause is the design constraint, and it is what the file is shaped around.
 * Nothing here names a contract, lists an id, or carries a per-contract exception:
 * {@link contractFiles} walks `content/contracts/`, and every file it finds gets the seven
 * `it`s below. A contributor adds one JSON file and gains seven assertions without editing
 * a test — and, more to the point, **without being able to avoid them.**
 *
 * ## Each check is its own `it`, deliberately
 *
 * #87 asks that "a failure names the contract and which of the seven checks failed, so
 * diagnosis needs no log reading". A single test per contract asserting seven things would
 * stop at the first, and its name would say only that the contract is broken. One `describe`
 * per contract and one `it` per check makes the reporter print exactly that sentence —
 * `c03-cold-open › par accuracy — …` — and lets every other check still run and report.
 *
 * ## Why this replays rather than re-solves
 *
 * The suite asserts a *stored* reference solution. Computing par is `tools/pars/`, which is
 * a search and costs seconds; this is an assertion and costs milliseconds, so it runs in
 * `pnpm test:all` on every change while the solver runs as its own CI step. The two share
 * `evaluate.ts`, so the number written into a scenario and the number checked against it
 * come from the same code.
 */
import { describe, expect, it } from 'vitest';

import { MAX_MARKS_PER_CONTRACT, createCatalogue, markByKey } from '@hh/ui';

import type { ContractOutcome } from './evaluate.js';
import {
  ENGINE_MAJOR,
  describeErrors,
  loadContract,
  outcomeFor,
  parseStoredReplay,
  planForReplay,
  requireContract,
} from './evaluate.js';
import type { ProgressionContract } from './reachability.js';
import { analyseProgression } from './reachability.js';
import type { ContractFile } from './scenarios.js';
import { CONTRACT_DIR, contractFiles } from './scenarios.js';

/** §13.4's seven rows, as the sentences a failure prints. */
const CHECKS = {
  schema: 'schema validity — conforms to the published JSON Schema (§11.5)',
  solvability: 'solvability — the stored reference solution achieves the objective',
  par: 'par accuracy — the reference solution costs par ±0.5% and takes par time ±0.5%',
  budget: 'budget headroom — dvBudget ≥ par.dv × 1.15, so par is not the only solution',
  deadline: 'deadline headroom — horizon ≥ par.time × 1.10',
  reachability: 'reachability — a player following the progression rules can get here',
  briefKeys:
    'brief keys — every briefKey, clientKey and coachMarks entry resolves in the catalogue',
  coachMarks:
    'coach marks — at most three per contract, C01–C04 only, each anchored and triggered (FR-902)',
} as const;

/** §13.4's ±0.5% on both par figures. */
const PAR_TOLERANCE = 0.005;
/** §13.4's headroom factors. */
const BUDGET_HEADROOM = 1.15;
const DEADLINE_HEADROOM = 1.1;
/** §8.3.3: "Brief text — 30–60 words, second person, terse." */
const BRIEF_MIN_WORDS = 30;
const BRIEF_MAX_WORDS = 60;

/** Words, ignoring punctuation — an em dash between two words is not a third word. */
const wordCount = (text: string): number =>
  (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;

const catalogue = createCatalogue();
const files = contractFiles();

/** The reference solution, evaluated. Memoised: three of the seven checks want it. */
const outcomes = new Map<string, ContractOutcome>();
const referenceOutcome = (file: ContractFile): ContractOutcome => {
  const cached = outcomes.get(file.stem);
  if (cached !== undefined) return cached;

  const scenario = requireContract(file);
  const plan = planForReplay(scenario, parseStoredReplay(scenario.document.par.referenceReplay));
  const outcome = outcomeFor(scenario, plan);
  if (outcome === null) {
    throw new Error(
      `${file.stem}: the stored reference replay does not produce a timeline at all. The plan ` +
        'is either non-convergent or leaves the ship on a rectilinear trajectory.',
    );
  }
  outcomes.set(file.stem, outcome);
  return outcome;
};

/**
 * Reachability is a question about the whole set, so it is answered once.
 *
 * Only documents that pass the schema contribute: an invalid file has no trustworthy `act`
 * or `unlocks`, and feeding one in would make the reachability check fail for a reason the
 * schema check has already reported better.
 */
const progression = analyseProgression(
  files.flatMap((file): ProgressionContract[] => {
    const result = loadContract(file);
    if (!result.ok) return [];
    const document = result.scenario.document;
    return [
      {
        id: document.id,
        act: document.act,
        index: document.index,
        unlocks: document.unlocks ?? [],
      },
    ];
  }),
);

describe('the suite itself', () => {
  // Every assertion below is per contract. An empty directory, or a walk pointed at the
  // wrong place, would make the whole suite pass by running nothing at all.
  it('found the scenario directory, and contracts in it', () => {
    expect(CONTRACT_DIR.replaceAll('\\', '/')).toMatch(/\/content\/contracts$/);
    expect(files.map((file) => file.stem)).not.toEqual([]);
  });

  // §13.4's seven rows, and FR-902's cap. The count is asserted rather than left implicit
  // because the table is what the per-contract block iterates: a check deleted while
  // refactoring would take its assertions with it and the suite would still be green.
  it('applies all seven of §13.4’s checks to each of them, plus FR-902’s cap', () => {
    expect(Object.keys(CHECKS)).toHaveLength(8);
  });

  it('has one file per contract id', () => {
    const ids = files.map((file) => file.stem);
    expect([...new Set(ids)]).toEqual(ids);
  });
});

describe.each(files.map((file): readonly [string, ContractFile] => [file.stem, file]))(
  '%s',
  (_stem, file) => {
    it(CHECKS.schema, () => {
      const result = loadContract(file);
      expect(
        result.ok,
        result.ok ? '' : `${file.relativePath} is not a valid scenario:\n${describeErrors(result)}`,
      ).toBe(true);
      if (!result.ok) return;

      // The file name is the contract id. It appears in URLs and in save data (§11.7), so
      // a file whose name and id disagree would be addressable under one and stored under
      // the other. The schema cannot see a file name; this can.
      expect(result.scenario.document.id).toBe(file.stem);
    });

    it(CHECKS.solvability, () => {
      const scenario = requireContract(file);
      const replay = parseStoredReplay(scenario.document.par.referenceReplay);

      // A replay for another contract, or from another engine, is not this contract's
      // reference solution however well it happens to evaluate.
      expect(replay.s, 'the reference replay names another contract').toBe(scenario.id);
      expect(replay.e, 'the reference replay was recorded on another engine major').toBe(
        ENGINE_MAJOR,
      );

      const outcome = referenceOutcome(file);
      expect(outcome.met, 'the reference solution does not achieve the objective').toBe(true);
      // And the game would let a player run it: an over-budget or floor-violating plan that
      // happens to reach the target is not a solution the contract admits.
      expect(
        outcome.legality.commitAllowed,
        'the game would refuse to commit the reference solution',
      ).toBe(true);
    });

    it(CHECKS.par, () => {
      const scenario = requireContract(file);
      const par = scenario.document.par;
      const outcome = referenceOutcome(file);

      expect(outcome.metSeconds).not.toBeNull();
      expect(Math.abs(outcome.dvMps - par.dv_mps) / par.dv_mps).toBeLessThanOrEqual(PAR_TOLERANCE);
      expect(Math.abs((outcome.metSeconds ?? 0) - par.time_s) / par.time_s).toBeLessThanOrEqual(
        PAR_TOLERANCE,
      );

      // Not one of §13.4's rows, and asserted here because §6.7 makes Gold depend on it:
      // "burn count ≤ par_burns". A `par.burns` that does not match the reference solution
      // makes Gold either unreachable or free, and nothing else would notice.
      expect(outcome.burns, 'par.burns does not match the reference solution').toBe(par.burns);

      // §11.6's claim travels inside the replay and is what a server re-evaluates against
      // (§11.11). A claim that disagrees with the plan beside it is a replay that would be
      // rejected as cheating the moment the leaderboard exists.
      const replay = parseStoredReplay(par.referenceReplay);
      expect(replay.c.dv).toBe(Math.round(outcome.dvMps * 10));
      expect(replay.c.t).toBe(Math.round(outcome.metSeconds ?? 0));
    });

    it(CHECKS.budget, () => {
      const scenario = requireContract(file);
      const { par, ship } = scenario.document;
      expect(ship.dvBudget_mps).toBeGreaterThanOrEqual(par.dv_mps * BUDGET_HEADROOM);
    });

    it(CHECKS.deadline, () => {
      const scenario = requireContract(file);
      expect(scenario.document.horizonSeconds).toBeGreaterThanOrEqual(
        scenario.document.par.time_s * DEADLINE_HEADROOM,
      );
    });

    it(CHECKS.reachability, () => {
      const scenario = requireContract(file);
      expect(
        progression.unreachable,
        'no sequence of unlocks reaches this contract from a cold start',
      ).not.toContain(scenario.id);
      expect(
        progression.danglingUnlocks.filter((edge) => edge.from === scenario.id),
        'this contract unlocks something that does not ship',
      ).toEqual([]);
    });

    it(CHECKS.briefKeys, () => {
      const scenario = requireContract(file);
      const { briefKey, clientKey, coachMarks } = scenario.document;

      // `clientKey` joins the list rather than getting a check of its own: it is a
      // catalogue key named by contract data, which is exactly what this check is for,
      // and #120 needs it to resolve for the same reason the brief does.
      const named = [
        briefKey,
        ...(clientKey === undefined ? [] : [clientKey]),
        ...(coachMarks ?? []),
      ];
      const missing = named.filter((key) => !catalogue.has(key));
      expect(missing, 'these keys are not in the message catalogue').toEqual([]);

      // Resolving is the real test — a key can exist and its message still throw on the
      // parameters a contract hands it — and the word count is §8.3.3's own rule for what
      // a brief is. Both are cheap here and unenforceable anywhere else.
      const brief = catalogue.resolveDynamic(briefKey);
      expect(wordCount(brief)).toBeGreaterThanOrEqual(BRIEF_MIN_WORDS);
      expect(wordCount(brief)).toBeLessThanOrEqual(BRIEF_MAX_WORDS);
      for (const key of named.slice(1)) {
        expect(catalogue.resolveDynamic(key).length, key).toBeGreaterThan(0);
      }
    });

    /**
     * FR-902's two limits, checked against the scenarios rather than trusted (#159).
     *
     * > *Coach marks MUST appear in C01–C04 only, at most three per contract.*
     *
     * Both halves are properties of the **content**, which is why they are here and not in
     * `@hh/ui` beside the mark table: that table is keyed by mark, and a mark does not know
     * which contract declared it or how many friends it has. A fourth mark on C02, or any
     * mark on C05, is a content failure and this is where a content failure is found.
     *
     * The third assertion is #160's *"no per-contract code"* stated as a check: a declared
     * key with no row in the mark table would resolve, render its words, and never appear,
     * because nothing would know where to put it or when. That is the failure mode a
     * catalogue-key check cannot see.
     */
    it(CHECKS.coachMarks, () => {
      const scenario = requireContract(file);
      const marks = scenario.document.coachMarks ?? [];
      const { act, index } = scenario.document;
      // C01–C04 are Act I's first four, which is the whole of Act I today and is stated as
      // both conditions anyway: an Act I that grew a fifth contract must not silently
      // acquire the right to mark it.
      const isEarly = act === 1 && index <= 4;

      expect(
        marks.length,
        'FR-902 allows at most three coach marks per contract',
      ).toBeLessThanOrEqual(MAX_MARKS_PER_CONTRACT);
      if (!isEarly) {
        expect(marks, 'FR-902 allows coach marks in C01–C04 only').toEqual([]);
      }

      const unknown = marks.filter((key) => markByKey(key) === undefined);
      expect(
        unknown,
        "these marks have no row in @hh/ui's mark table, so nothing knows where or when to show them",
      ).toEqual([]);
    });
  },
);
