/**
 * The burn-count cap — #92, §6.5, FR-107.
 *
 * Two claims are being defended here, and only one of them is arithmetic. Counting nodes
 * is trivial; what is worth testing is that the count **never blocks a commit**, because
 * that is the property a well-meaning future edit would break by adding an `L7`, and
 * nothing else in the codebase would notice.
 */
import { describe, expect, it } from 'vitest';

import { evaluateLegality } from '../legality.js';
import {
  HORIZON,
  START,
  definitely,
  planOf,
  timelineFor,
  timelineResultFor,
} from '../test-support.js';
import { evaluateBurnCount } from './burn-count.js';
import { isViolated } from './violation.js';

/** A plan with `n` evenly spaced 5 m/s burns — cheap, legal, and the right length. */
const burns = (n: number) =>
  planOf(...Array.from({ length: n }, (_v, i): readonly [number, number] => [600 + i * 1200, 5]));

/** Rules that nothing but the burn count could ever violate. */
const permissive = (maxBurns?: number) => ({
  budgetMps: 10_000,
  deadlineSeconds: HORIZON - START,
  ...(maxBurns === undefined ? {} : { maxBurns }),
});

describe('the burn-count cap (§6.5)', () => {
  it('reports a null cap, not an infinite one, for a contract that declares none', () => {
    const evaluation = evaluateBurnCount(timelineFor(burns(5)), undefined);
    expect(evaluation.maxBurns).toBeNull();
    expect(evaluation.remaining).toBeNull();
    expect(evaluation.exceeded).toBe(false);
    expect(evaluation.violations).toStrictEqual([]);
    // The count is still reported: the HUD has nothing to compare against, but "5 burns"
    // is true and useful either way.
    expect(evaluation.burns).toBe(5);
  });

  it('is satisfied at the cap exactly, and reports no headroom left', () => {
    const evaluation = evaluateBurnCount(timelineFor(burns(2)), 2);
    expect(evaluation.exceeded).toBe(false);
    expect(evaluation.remaining).toBe(0);
    expect(isViolated(evaluation)).toBe(false);
  });

  it('returns an interval starting at the burn that crossed the cap', () => {
    const timeline = timelineFor(burns(4));
    const evaluation = evaluateBurnCount(timeline, 2);
    expect(evaluation.exceeded).toBe(true);
    expect(evaluation.remaining).toBe(-2);
    // Index 2 is the third burn — the first one past a cap of two.
    expect(evaluation.exceededAtNode).toBe(2);
    const interval = definitely(evaluation.violations[0]);
    expect(interval.start).toBe(definitely(timeline.plan.nodes[2]).epoch);
    expect(interval.end).toBe(timeline.horizon);
    expect(interval.clippedEnd).toBe(true);
  });

  it('is satisfied by an empty plan', () => {
    const evaluation = evaluateBurnCount(timelineFor(planOf()), 2);
    expect(evaluation.burns).toBe(0);
    expect(evaluation.remaining).toBe(2);
    expect(evaluation.exceeded).toBe(false);
  });
});

describe('soft means soft (§6.4, §6.5)', () => {
  /**
   * The claim §6.5 makes — *"soft cap; exceeding it forfeits Gold"* — and the one §6.4
   * makes by omission: its legality codes stop at `L6`, so there is no code for this and
   * a plan over the cap is a plan the game lets a player run.
   */
  it('never disables Commit, however far over the cap a plan goes', () => {
    // A cap of two, nine burns flown, and still committable.
    const legality = evaluateLegality(timelineResultFor(burns(9)), permissive(2));
    expect(legality.evaluable).toBe(true);
    expect(legality.commitAllowed).toBe(true);
  });

  it('produces no legality reason and no code', () => {
    const legality = evaluateLegality(timelineResultFor(burns(9)), permissive(2));
    if (!legality.evaluable) throw new Error('fixture should evaluate');
    expect(legality.reasons).toStrictEqual([]);
    expect(legality.constraints.burnCount.exceeded).toBe(true);
  });

  it('is still evaluated and reported on every call, so it can be drawn before it is failed', () => {
    const legality = evaluateLegality(timelineResultFor(burns(1)), permissive(3));
    if (!legality.evaluable) throw new Error('fixture should evaluate');
    // §6.5's closing line: a player never discovers a constraint by failing it, which is
    // a statement about a contract at rest as much as one in violation.
    expect(legality.constraints.burnCount.maxBurns).toBe(3);
    expect(legality.constraints.burnCount.remaining).toBe(2);
  });
});
