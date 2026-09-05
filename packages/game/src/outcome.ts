/**
 * What a run came to — §6.7, §8.3.9, FR-301, FR-304, FR-307, #121.
 *
 * The debrief's whole numeric content, computed **once** from the committed evaluation
 * and never again. That is not an optimisation: FR-601 makes execution a playback of an
 * already-solved timeline, so a result recomputed at the end of the run could differ
 * from the one the planner promised, and the promise is the product (§6.3, D5). This
 * function is called before the first frame of playback is drawn, and the debrief
 * renders what it returned.
 *
 * ## Scoring runs on quantised values, and that is a determinism requirement
 *
 * §11.4: *"Medal thresholds are evaluated against quantised, rounded values (Δv to
 * 0.1 m/s, time to 1 s), so a 1e-9 cross-platform difference can never flip a medal."*
 *
 * This is a **different** quantisation from DEP-09's. DEP-09 quantises the *input* — a
 * node's epoch to 1/1024 s and its Δv to 1e-4 m/s — so that the same plan is the same
 * bytes everywhere. That says nothing about the *output*: `Math.sin` is not required to
 * be correctly rounded and does differ between engines, so a Δv of 109.117 699 999 on
 * one browser and 109.117 700 001 on another is expected and permitted. Comparing
 * either against a Silver threshold directly would make the medal a property of the
 * engine.
 *
 * So both sides of every threshold go through {@link toScoreDeltaV} and
 * {@link toScoreTime} first, and the comparison happens in integers. The same two
 * quantities in the same two units are what §11.6's replay claim carries (`c: {dv, t}`),
 * which is not a coincidence — the claim exists so a server can check a result, and a
 * result that could not be checked exactly would be worth nothing to check.
 *
 * ## Bronze needs the deadline, which nothing else was checking
 *
 * §6.7's Bronze is *"objective met, within budget and deadline"*, and neither half of
 * that was previously computed anywhere. `L1` caps the budget and `L3` caps the **last
 * burn**, both at commit — but a plan whose last burn is comfortably early can still
 * reach the target after the deadline has passed, and §6.4 names exactly that as one of
 * execution's three endings: *"deadline reached without success"*. `L6` does not catch
 * it either, because `L6` asks whether the objective was met anywhere in the
 * **horizon**, and the horizon is deliberately later than the deadline (§6.3).
 *
 * That gap is why {@link evaluateOutcome} re-applies both caps rather than trusting the
 * commit gate, and why `pastDeadline` is a distinct failure from `objectiveMissed`. A
 * player who flew a perfect intercept twenty minutes late deserves to be told that,
 * not "you missed".
 *
 * ## FR-307's diagnosis lives in `diagnosis.ts`
 *
 * This module owns §6.7's arithmetic — the medal ladder, the par comparison, the failure
 * classification. *Why* a run failed is a separate rule set over those facts (#83), and it
 * is a separate file because its failure mode is different: getting a threshold wrong
 * costs a medal, and getting an explanation wrong teaches the player something false at
 * the moment they are most willing to believe it.
 */
import { metAt } from '@hh/astro';
import type { Timeline } from '@hh/sim';

import type { LegalityConstraints, LegalityRules } from './legality.js';
import type { CodexSlug, OutcomeFailure } from './diagnosis.js';
import { diagnose } from './diagnosis.js';
import type { GameMessage } from './messages.js';
import type { AssistId, AssistState, MedalCap } from './assists.js';
import {
  cappingAssists,
  cleanEligible as cleanEligibleFor,
  medalCap as medalCapFor,
} from './assists.js';
import type { ObjectiveEvaluation } from './objectives/index.js';

/**
 * §11.4's scoring quantum for Δv: a tenth of a metre per second.
 *
 * Not DEP-09's 1e-4 m/s. See the docstring on why the input and the score are
 * quantised differently, and to different grids.
 */
export const SCORE_DELTA_V_QUANTUM_MPS = 0.1;

/** §11.4's scoring quantum for elapsed time: one second. */
export const SCORE_TIME_QUANTUM_S = 1;

/**
 * Δv in whole scoring quanta — tenths of a metre per second, as an integer.
 *
 * The same unit §11.6's replay claim carries as `c.dv`, so a claimed result and a
 * scored one are the same number and a verifier compares integers.
 */
export const toScoreDeltaV = (mps: number): number => Math.round(mps / SCORE_DELTA_V_QUANTUM_MPS);

/** Elapsed time in whole scoring quanta — seconds, as an integer. §11.6's `c.t`. */
export const toScoreTime = (seconds: number): number => Math.round(seconds / SCORE_TIME_QUANTUM_S);

/** §6.7's medals, best first where they are compared. */
export type Medal = 'bronze' | 'silver' | 'gold' | 'clean';

/**
 * Why a run failed.
 *
 * Defined by `./diagnosis.ts` and re-exported here, because that is the module which
 * dispatches on it — and because the reverse arrangement was a cycle: the rule set needs
 * the vocabulary, and the outcome needs the rule set. Callers import it from either.
 */
export type { OutcomeFailure } from './diagnosis.js';

/** A contract's published par (§6.7), in SI. */
export interface ParValues {
  readonly dvMps: number;
  readonly timeSeconds: number;
  readonly burns: number;
}

/** How the run compares to par, as signed fractions. `0.006` is "0.6% over". */
export interface ParDelta {
  /** `(used - par) / par`. Positive is worse. `null` for a par of zero. */
  readonly dvFraction: number | null;
  /** `(elapsed - par) / par`. Positive is slower. `null` for a par of zero, or on failure. */
  readonly timeFraction: number | null;
}

/** What {@link evaluateOutcome} is given. */
export interface OutcomeInput {
  readonly timeline: Timeline;
  /** The objective evaluation. `null` produces `notEvaluated` rather than a guess. */
  readonly objective: ObjectiveEvaluation | null;
  /** The constraint evaluations legality already ran; none are repeated here. */
  readonly constraints: LegalityConstraints;
  readonly rules: LegalityRules;
  readonly par: ParValues;
  /**
   * Which assists were on for this run.
   *
   * §6.6's model decides two things from it — whether the run is Clean Job eligible, and
   * what medal it is capped at — and both are derived here rather than passed in. FR-301:
   * *"MUST NOT award a medal the player did not earn under the assists actually
   * enabled."* An eligibility flag supplied by a caller is exactly the shape that lets a
   * call site hard-code `true`, which is what `apps/web` did until #81.
   */
  readonly assists: AssistState;
  /**
   * Assists this contract is designed around, which therefore do not cap it (§6.6, Act V).
   *
   * Empty for every contract in M3. `assists.ts` says why this is separate from the
   * scenario's `assistsAllowed`.
   */
  readonly designedAround?: readonly AssistId[];
}

/** The debrief's numeric content. */
export interface Outcome {
  readonly success: boolean;
  /** `null` on success. */
  readonly failure: OutcomeFailure | null;
  /** `Σ∣Δv∣` over the plan, in metres per second, full precision. */
  readonly dvUsedMps: number;
  readonly dvBudgetMps: number;
  /** MET at which the objective was met, in seconds. `null` when it never was. */
  readonly metSeconds: number | null;
  readonly deadlineSeconds: number;
  readonly burns: number;
  /** `null` when no medal was earned — which includes every failed run. */
  readonly medal: Medal | null;
  /**
   * The medal this run could have reached given its assists, before its own performance
   * was considered. `clean` when nothing capped it.
   *
   * Reported whether or not it bit, because FR-411 asks the planner to show the cap
   * *while planning* — a player needs to know what they are giving up before they commit,
   * not after.
   */
  readonly medalCap: MedalCap;
  /** Which assists capped the run. Empty when nothing did. */
  readonly cappedBy: readonly AssistId[];
  readonly par: ParValues;
  /** `null` on a failed run: there is no time to compare, so there is no comparison. */
  readonly parDelta: ParDelta | null;
  /**
   * The player spent less than `par_dv` — D12, §6.7, FR-305.
   *
   * A bug report about our optimum rather than an achievement, and the debrief says so
   * and offers to file it. Compared on the scoring grid: beating par by less than
   * 0.05 m/s is float noise, not a better solution.
   */
  readonly beatParDv: boolean;
  /** FR-307's diagnosis, or `null` when no rule matched. See the docstring. */
  readonly diagnosis: GameMessage | null;
  /** The Codex entry that diagnosis points at (§8.3.9), or `null` when there is none. */
  readonly codex: CodexSlug | null;
  /** Carried through so the debrief quotes the encounter without re-deriving it. */
  readonly objective: ObjectiveEvaluation | null;
}

/** A signed fraction against par, or `null` for a par of zero. */
const fractionOf = (value: number, par: number): number | null =>
  par === 0 ? null : (value - par) / par;

/**
 * §6.7's medal ladder, on the scoring grid.
 *
 * Written as a fall-through from the top rather than as three independent predicates,
 * because §6.7's rows are cumulative by definition — *"Silver: Bronze, and …"*, *"Gold:
 * Silver, and …"* — and three predicates would let them drift apart. Clean Job is Gold
 * plus a fact this module is told rather than one it derives.
 */
const medalFor = (
  bronze: boolean,
  score: { readonly dv: number; readonly time: number; readonly burns: number },
  par: { readonly dv: number; readonly time: number; readonly burns: number },
  cleanEligible: boolean,
  cap: MedalCap,
): Medal | null => {
  if (!bronze) return null;

  const silver =
    score.dv <= toScoreDeltaV(par.dv * 1.1) && score.time <= toScoreTime(par.time * 1.25);
  if (!silver) return 'bronze';

  // The cap is applied *here* rather than to the finished medal, so a capped run never
  // briefly computes a Gold that something downstream has to take away.
  if (cap === 'silver') return 'silver';

  const gold =
    score.dv <= toScoreDeltaV(par.dv * 1.02) &&
    score.time <= toScoreTime(par.time * 1.1) &&
    score.burns <= par.burns;
  if (!gold) return 'silver';

  return cleanEligible ? 'clean' : 'gold';
};

/**
 * Judge a completed run.
 *
 * Deterministic and pure — no clock, no randomness, no ambient state (§11.4). Given the
 * same timeline, objective, constraints and par it returns the same outcome on every
 * runtime, which is the guarantee §11.4 makes about `dvUsed`, `metElapsed`, the medal
 * and the objective-met flag specifically.
 */
export const evaluateOutcome = (input: OutcomeInput): Outcome => {
  const { timeline, objective, constraints, rules, par, assists } = input;
  const designedAround = input.designedAround ?? [];
  const cap = medalCapFor(assists, designedAround);

  const dvUsedMps = constraints.budget.usedMps;
  const burns = timeline.plan.nodes.length;
  const { deadlineSeconds } = rules;

  // MET at which the objective was satisfied. `atEpoch` is the *earliest* such epoch for
  // a proximity objective, which is what par measures against (docs/PARS.md) — not the
  // last burn, and not the closest approach if the objective was already met before it.
  const metSeconds =
    objective !== null && objective.met && objective.atEpoch !== null
      ? metAt(timeline.startEpoch, objective.atEpoch)
      : null;

  const overBudget = constraints.budget.violations.length > 0;
  const late = metSeconds !== null && toScoreTime(metSeconds) > toScoreTime(deadlineSeconds);

  const failure: OutcomeFailure | null =
    objective === null
      ? 'notEvaluated'
      : overBudget
        ? 'overBudget'
        : metSeconds === null
          ? 'objectiveMissed'
          : late
            ? 'pastDeadline'
            : null;

  const success = failure === null;

  // FR-307's rule set (#83). `null` is its stated fallback rather than a gap: the debrief
  // then shows the closest approach, what was needed and the Δv used, and says nothing
  // about why. A confident wrong explanation is worse than none.
  const diagnosed = diagnose({ failure, objective, metSeconds, deadlineSeconds });

  const score = {
    dv: toScoreDeltaV(dvUsedMps),
    time: metSeconds === null ? Number.POSITIVE_INFINITY : toScoreTime(metSeconds),
    burns,
  };

  return Object.freeze({
    success,
    failure,
    dvUsedMps,
    dvBudgetMps: constraints.budget.budgetMps,
    metSeconds,
    deadlineSeconds,
    burns,
    medal: medalFor(
      success,
      score,
      { dv: par.dvMps, time: par.timeSeconds, burns: par.burns },
      cleanEligibleFor(assists),
      cap,
    ),
    medalCap: cap,
    cappedBy: cappingAssists(assists, designedAround),
    par,
    parDelta:
      metSeconds === null
        ? null
        : Object.freeze({
            dvFraction: fractionOf(dvUsedMps, par.dvMps),
            timeFraction: fractionOf(metSeconds, par.timeSeconds),
          }),
    // Strictly below par on the scoring grid. Equalling par is matching our answer, not
    // beating it, and only beating it is a report about our optimum being wrong.
    beatParDv: success && score.dv < toScoreDeltaV(par.dvMps),
    diagnosis: diagnosed?.message ?? null,
    codex: diagnosed?.codex ?? null,
    objective,
  });
};
