/**
 * §6.10's career total — #119.
 *
 * Against the **shipped** contracts and their real fees rather than a fixture, for the
 * reason `Briefing.test.tsx` gives: a fixture would let a wrong rule look reasonable, and
 * the actual numbers (C01 pays 2 kcr, C04 pays 18) are ones a reader can check by eye.
 */
import { describe, expect, it } from 'vitest';

import { contracts } from '../contracts/registry.js';
import type { ContractProgress } from '../save/index.js';

import { careerCredits, isCompleted } from './credits.js';

const shipped = contracts();

/** A record for a contract that was completed. */
const completed = (): ContractProgress => ({
  attempts: 1,
  medal: 'bronze',
  firstCompletedAt: '2026-09-14T18:22:11Z',
});

/** A record for a contract that was accepted and abandoned. */
const attempted = (): ContractProgress => ({ attempts: 3 });

describe('isCompleted', () => {
  it('is false for a contract never touched', () => {
    expect(isCompleted(undefined)).toBe(false);
  });

  /**
   * The distinction the sum rests on. §11.7 counts an attempt per *accepted briefing*, so
   * a player who read C04, opened the planner and gave up has `attempts: 1` — and has not
   * been paid.
   */
  it('is false for a contract attempted but never finished', () => {
    expect(isCompleted(attempted())).toBe(false);
  });

  it('is true once a run has succeeded', () => {
    expect(isCompleted(completed())).toBe(true);
  });
});

describe('careerCredits', () => {
  it('is zero on an empty save', () => {
    expect(careerCredits(shipped, {})).toBe(0);
  });

  it('pays only for completed contracts', () => {
    const first = shipped[0];
    const second = shipped[1];
    if (first === undefined || second === undefined) throw new Error('need two contracts');

    const total = careerCredits(shipped, {
      [first.id]: completed(),
      [second.id]: attempted(),
    });

    expect(total).toBe(first.document.fee_kcr ?? 0);
  });

  it('sums every fee once the campaign is finished', () => {
    const records = Object.fromEntries(shipped.map((s) => [s.id, completed()]));
    const expected = shipped.reduce((sum, s) => sum + (s.document.fee_kcr ?? 0), 0);

    expect(careerCredits(shipped, records)).toBe(expected);
    // The shipped Acts I–II are worth 61 kcr. A number a reader can check against the
    // seven contract files, and one that will change with the content — deliberately, so
    // that retuning a fee is a decision someone sees rather than a silent drift.
    expect(expected).toBe(61);
  });

  /** A contract that pays nothing is still completed. See the module docstring. */
  it('treats an absent fee as zero rather than skipping the contract', () => {
    const scenario = shipped[0];
    if (scenario === undefined) throw new Error('need a contract');

    // The key *omitted*, which is what "omitted when the contract pays nothing" means in
    // the schema — not present-and-undefined, which the type does not allow and which no
    // scenario file can produce.
    const unpaidDocument = { ...scenario.document };
    delete (unpaidDocument as { fee_kcr?: number }).fee_kcr;
    const free: typeof scenario = { ...scenario, document: unpaidDocument };

    expect(careerCredits([free], { [scenario.id]: completed() })).toBe(0);
  });
});
