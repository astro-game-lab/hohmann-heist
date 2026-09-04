/**
 * The outcome (§6.7, FR-301, FR-304, FR-305, FR-307, #121).
 *
 * The medal ladder is arithmetic on published numbers, so the interesting tests are at
 * the **boundaries** — a run exactly on a threshold, and a run a hair either side of
 * it. §11.4's promise is that a 1e-9 difference between engines cannot flip a medal, and
 * the only way to test that is to apply a 1e-9 difference and assert the medal did not
 * move. That is what `is unmoved by a difference far below the scoring quantum` does,
 * and it is the case this module exists for.
 *
 * The thresholds themselves are §6.7's, quoted in the tests rather than imported from
 * the implementation: a test that computed the threshold the same way the code does
 * would pass for any threshold.
 */
import { describe, expect, it } from 'vitest';

import { evaluateAltitudeFloor, evaluateBudget, evaluateDeadline } from './constraints/index.js';
import type { LegalityConstraints, LegalityRules } from './legality.js';
import type { ObjectiveEvaluation } from './objectives/index.js';
import {
  evaluateOutcome,
  toScoreDeltaV,
  toScoreTime,
  type OutcomeInput,
  type ParValues,
} from './outcome.js';
import { HORIZON, START, messageOf, planOf, timelineFor } from './test-support.js';
import { epoch } from '@hh/astro';
import { metres, metresPerSec } from '@hh/math';

const RULES: LegalityRules = { budgetMps: 300, deadlineSeconds: 10_800 };

const PAR: ParValues = { dvMps: 100, timeSeconds: 4000, burns: 1 };

/** A proximity evaluation stating a result directly, so a test can name the outcome it wants. */
const proximity = (met: boolean, atSeconds: number | null): ObjectiveEvaluation => ({
  kind: 'intercept',
  met,
  atEpoch: atSeconds === null ? null : epoch(START + atSeconds),
  achieved: {
    epoch: epoch(START + (atSeconds ?? 5000)),
    rangeM: metres(met ? 310 : 12_400),
    relativeSpeedMps: metresPerSec(42.7),
  },
  candidates: [],
  tolerance: { maxRangeM: metres(1000), maxRelativeSpeedMps: null },
});

/**
 * An outcome input for a plan, with the constraints actually evaluated against it.
 *
 * `dvMps` overrides the budget evaluation's spend so a test can place a run exactly on
 * a threshold without having to find a plan that costs that much — the medal ladder is
 * a function of the number, and searching for a plan that produces it would be testing
 * the propagator instead.
 */
const inputFor = (options: {
  readonly dvMps: number;
  readonly metSeconds: number | null;
  readonly burns?: number;
  readonly par?: ParValues;
  readonly cleanEligible?: boolean;
  readonly rules?: LegalityRules;
}): OutcomeInput => {
  const burns = options.burns ?? 1;
  const timeline = timelineFor(
    planOf(
      ...Array.from({ length: burns }, (_v, i): readonly [number, number] => [600 + i * 2000, 20]),
    ),
  );
  const rules = options.rules ?? RULES;
  const budget = evaluateBudget(timeline, rules.budgetMps);
  const constraints: LegalityConstraints = {
    budget: { ...budget, usedMps: options.dvMps },
    deadline: evaluateDeadline(timeline, rules.deadlineSeconds),
    altitudeFloor: evaluateAltitudeFloor(timeline),
  };
  return {
    timeline,
    objective: proximity(options.metSeconds !== null, options.metSeconds),
    constraints,
    rules,
    par: options.par ?? PAR,
    cleanEligible: options.cleanEligible ?? false,
  };
};

describe('the scoring grid (§11.4)', () => {
  it('quantises delta-v to a tenth of a metre per second', () => {
    expect(toScoreDeltaV(109.1177)).toBe(1091);
    expect(toScoreDeltaV(109.14)).toBe(1091);
    expect(toScoreDeltaV(109.16)).toBe(1092);
  });

  it('quantises elapsed time to the second', () => {
    expect(toScoreTime(4122.965)).toBe(4123);
    expect(toScoreTime(4123.4)).toBe(4123);
  });

  it('reproduces the units §11.6’s replay claim carries', () => {
    // `c03-cold-open`'s published par, and the `c` block of its committed reference
    // replay: `{"dv":1091,"t":4123}`. The two agreeing is not decoration — the claim
    // exists so a server can check a result, and it checks integers.
    expect(toScoreDeltaV(109.1177)).toBe(1091);
    expect(toScoreTime(4122.965)).toBe(4123);
  });
});

describe('evaluateOutcome', () => {
  describe('success and failure', () => {
    it('succeeds when the objective was met inside the deadline', () => {
      const outcome = evaluateOutcome(inputFor({ dvMps: 100, metSeconds: 4000 }));
      expect(outcome.success).toBe(true);
      expect(outcome.failure).toBeNull();
      expect(outcome.metSeconds).toBe(4000);
    });

    it('fails with objectiveMissed when the objective was never met', () => {
      const outcome = evaluateOutcome(inputFor({ dvMps: 100, metSeconds: null }));
      expect(outcome.success).toBe(false);
      expect(outcome.failure).toBe('objectiveMissed');
      expect(outcome.metSeconds).toBeNull();
      expect(outcome.medal).toBeNull();
    });

    it('fails with pastDeadline when the objective was met after the deadline', () => {
      // The gap nothing else catches: `L3` caps the last burn and `L6` asks about the
      // whole horizon, which is deliberately later than the deadline (§6.3).
      const outcome = evaluateOutcome(inputFor({ dvMps: 100, metSeconds: 12_000 }));
      expect(outcome.success).toBe(false);
      expect(outcome.failure).toBe('pastDeadline');
      // The achievement is still reported: they did reach the target.
      expect(outcome.metSeconds).toBe(12_000);
    });

    it('treats the deadline itself as inside it', () => {
      const outcome = evaluateOutcome(inputFor({ dvMps: 100, metSeconds: 10_800 }));
      expect(outcome.success).toBe(true);
    });

    it('reports notEvaluated rather than guessing when there is no objective', () => {
      const input = { ...inputFor({ dvMps: 100, metSeconds: 4000 }), objective: null };
      const outcome = evaluateOutcome(input);
      expect(outcome.failure).toBe('notEvaluated');
      expect(outcome.medal).toBeNull();
    });

    it('fails on an over-budget plan even though commit would have blocked it', () => {
      const input = inputFor({ dvMps: 400, metSeconds: 4000 });
      const withViolation: OutcomeInput = {
        ...input,
        constraints: {
          ...input.constraints,
          budget: {
            ...input.constraints.budget,
            usedMps: 400,
            violations: [
              {
                kind: 'dv_budget',
                start: START,
                end: HORIZON,
                clippedStart: true,
                clippedEnd: true,
              },
            ],
          },
        },
      };
      expect(evaluateOutcome(withViolation).failure).toBe('overBudget');
    });
  });

  describe('§6.7’s medal ladder', () => {
    // Par: 100 m/s, 4000 s, 1 burn. Silver is ×1.10 and ×1.25; Gold ×1.02, ×1.10 and
    // the burn count. The numbers below are those thresholds, not the code's.
    it('awards Bronze for a bare success', () => {
      expect(evaluateOutcome(inputFor({ dvMps: 200, metSeconds: 4900 })).medal).toBe('bronze');
    });

    it('awards Silver at exactly par × 1.10 delta-v and par × 1.25 time', () => {
      expect(evaluateOutcome(inputFor({ dvMps: 110, metSeconds: 5000 })).medal).toBe('silver');
    });

    it('drops to Bronze a tenth of a metre per second past the Silver cap', () => {
      expect(evaluateOutcome(inputFor({ dvMps: 110.1, metSeconds: 5000 })).medal).toBe('bronze');
    });

    it('drops to Bronze one second past the Silver time cap', () => {
      expect(evaluateOutcome(inputFor({ dvMps: 110, metSeconds: 5001 })).medal).toBe('bronze');
    });

    it('awards Gold at exactly par × 1.02 delta-v, par × 1.10 time and par burns', () => {
      expect(evaluateOutcome(inputFor({ dvMps: 102, metSeconds: 4400 })).medal).toBe('gold');
    });

    it('drops to Silver when the burn count exceeds par', () => {
      // Everything else is Gold; only the extra burn is different.
      expect(evaluateOutcome(inputFor({ dvMps: 102, metSeconds: 4400, burns: 2 })).medal).toBe(
        'silver',
      );
    });

    it('awards Clean Job for Gold with no medal-affecting assists', () => {
      expect(
        evaluateOutcome(inputFor({ dvMps: 102, metSeconds: 4400, cleanEligible: true })).medal,
      ).toBe('clean');
    });

    it('does not award Clean Job below Gold, however clean the run', () => {
      expect(
        evaluateOutcome(inputFor({ dvMps: 200, metSeconds: 4900, cleanEligible: true })).medal,
      ).toBe('bronze');
    });

    it('awards nothing at all for a failed run', () => {
      expect(evaluateOutcome(inputFor({ dvMps: 50, metSeconds: null })).medal).toBeNull();
    });
  });

  describe('§11.4’s cross-runtime guarantee', () => {
    it('is unmoved by a difference far below the scoring quantum', () => {
      // The failure this rules out: `Math.sin` is not required to be correctly rounded,
      // so the same plan can produce 109.999 999 999 on one engine and 110.000 000 001
      // on another. Without the scoring grid one of those is Silver and one is Bronze.
      const on = evaluateOutcome(inputFor({ dvMps: 110 - 1e-9, metSeconds: 5000 }));
      const over = evaluateOutcome(inputFor({ dvMps: 110 + 1e-9, metSeconds: 5000 }));
      expect(on.medal).toBe(over.medal);
      expect(on.medal).toBe('silver');
    });

    it('is unmoved by a sub-second difference in elapsed time', () => {
      const early = evaluateOutcome(inputFor({ dvMps: 110, metSeconds: 5000 - 1e-6 }));
      const late = evaluateOutcome(inputFor({ dvMps: 110, metSeconds: 5000 + 1e-6 }));
      expect(early.medal).toBe(late.medal);
    });

    it('gives the same outcome for the same inputs, every time', () => {
      const input = inputFor({ dvMps: 102, metSeconds: 4400 });
      expect(evaluateOutcome(input)).toEqual(evaluateOutcome(input));
    });
  });

  describe('par (FR-304, FR-305, D12)', () => {
    it('reports signed fractions against par', () => {
      const outcome = evaluateOutcome(inputFor({ dvMps: 100.6, metSeconds: 3996 }));
      expect(outcome.parDelta?.dvFraction).toBeCloseTo(0.006, 6);
      expect(outcome.parDelta?.timeFraction).toBeCloseTo(-0.001, 6);
    });

    it('has no comparison to make on a failed run', () => {
      expect(evaluateOutcome(inputFor({ dvMps: 100, metSeconds: null })).parDelta).toBeNull();
    });

    it('survives a par of zero without dividing by it', () => {
      const outcome = evaluateOutcome(
        inputFor({ dvMps: 10, metSeconds: 100, par: { dvMps: 0, timeSeconds: 0, burns: 0 } }),
      );
      expect(outcome.parDelta?.dvFraction).toBeNull();
      expect(outcome.parDelta?.timeFraction).toBeNull();
    });

    it('flags a run that beat par — a bug report about our optimum, not an achievement', () => {
      const outcome = evaluateOutcome(inputFor({ dvMps: 98, metSeconds: 3900 }));
      expect(outcome.beatParDv).toBe(true);
    });

    it('does not flag a run that merely equalled par', () => {
      expect(evaluateOutcome(inputFor({ dvMps: 100, metSeconds: 3900 })).beatParDv).toBe(false);
    });

    it('does not flag a beat below the scoring quantum', () => {
      // 0.04 m/s under par rounds to the same tenth, which is float noise rather than a
      // better solution — and filing it as a physics discrepancy would waste a person's
      // time on a rounding.
      expect(evaluateOutcome(inputFor({ dvMps: 99.96, metSeconds: 3900 })).beatParDv).toBe(false);
    });

    it('does not flag a failed run, however little it spent', () => {
      expect(evaluateOutcome(inputFor({ dvMps: 1, metSeconds: null })).beatParDv).toBe(false);
    });
  });

  describe('FR-307’s diagnosis', () => {
    it('explains a run that arrived after the deadline', () => {
      const outcome = evaluateOutcome(inputFor({ dvMps: 100, metSeconds: 12_000 }));
      expect(
        messageOf(outcome.diagnosis ?? undefined, 'debrief.diagnosis.pastDeadline').params
          .lateSeconds,
      ).toBe(1200);
    });

    it('says nothing rather than speculating about a missed objective', () => {
      // FR-307's stated fallback. Every rule that could explain *why* the intercept
      // missed needs a comparison against the target's arrival, which is #83 (M3).
      expect(evaluateOutcome(inputFor({ dvMps: 100, metSeconds: null })).diagnosis).toBeNull();
    });

    it('says nothing about a successful run', () => {
      expect(evaluateOutcome(inputFor({ dvMps: 100, metSeconds: 4000 })).diagnosis).toBeNull();
    });
  });

  describe('what it carries through', () => {
    it('reports the burn count from the plan', () => {
      expect(evaluateOutcome(inputFor({ dvMps: 100, metSeconds: 4000, burns: 3 })).burns).toBe(3);
    });

    it('reports the budget alongside the spend', () => {
      const outcome = evaluateOutcome(inputFor({ dvMps: 100, metSeconds: 4000 }));
      expect(outcome.dvUsedMps).toBe(100);
      expect(outcome.dvBudgetMps).toBe(300);
      expect(outcome.deadlineSeconds).toBe(10_800);
    });

    it('carries the objective evaluation so the debrief need not re-derive it', () => {
      const input = inputFor({ dvMps: 100, metSeconds: 4000 });
      expect(evaluateOutcome(input).objective).toBe(input.objective);
    });
  });
});
