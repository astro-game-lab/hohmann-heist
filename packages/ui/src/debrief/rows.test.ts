/**
 * The debrief's result table (§8.3.9, FR-304, #121).
 *
 * Everything here is about *which rows exist and what is in them*. The wording is the
 * catalogue's and the layout is the component's, so there is nothing to assert about
 * either — which is the point of the module being separate from both.
 *
 * The one assertion worth stating twice: **no row carries a formatted string**. A test
 * that read "72.4 m/s" out of this module would be recording a bug, because the unit,
 * the separator and the decimal are all locale decisions that happen later.
 */
import { epoch } from '@hh/astro';
import type { Outcome, ProximityEvaluation } from '@hh/game';
import { metres, metresPerSec } from '@hh/math';
import { describe, expect, it } from 'vitest';

import { approachSummary, missRows, resultRows } from './rows.js';

const START_SECONDS = 1_000_000;

const proximity = (met: boolean, rangeM: number): ProximityEvaluation => ({
  kind: 'intercept',
  met,
  atEpoch: met ? epoch(START_SECONDS + 4123) : null,
  achieved: {
    epoch: epoch(START_SECONDS + 4123),
    rangeM: metres(rangeM),
    relativeSpeedMps: metresPerSec(42.7),
  },
  candidates: [],
  tolerance: { maxRangeM: metres(1000), maxRelativeSpeedMps: null },
});

const outcomeOf = (over: Partial<Outcome> = {}): Outcome => ({
  success: true,
  failure: null,
  medalCap: 'clean',
  cappedBy: [],
  dvUsedMps: 109.1177,
  dvBudgetMps: 300,
  metSeconds: 4123,
  deadlineSeconds: 10_800,
  burns: 1,
  medal: 'gold',
  par: { dvMps: 109.1177, timeSeconds: 4122.965, burns: 1 },
  parDelta: { dvFraction: 0, timeFraction: 0.0000085 },
  beatParDv: false,
  diagnosis: null,
  objective: proximity(true, 310),
  ...over,
});

describe('resultRows', () => {
  it('produces §8.3.9’s three rows, in the order the mock draws them', () => {
    expect(resultRows(outcomeOf()).map((row) => row.quantity)).toEqual(['deltaV', 'time', 'burns']);
  });

  it('carries SI values, not formatted text', () => {
    const [deltaV] = resultRows(outcomeOf());
    expect(deltaV?.you).toBe(109.1177);
    expect(deltaV?.par).toBe(109.1177);
  });

  it('carries the signed fraction against par', () => {
    const rows = resultRows(outcomeOf({ parDelta: { dvFraction: 0.006, timeFraction: -0.001 } }));
    expect(rows[0]?.deltaFraction).toBe(0.006);
    expect(rows[1]?.deltaFraction).toBe(-0.001);
  });

  it('shows no percentage on the burn count', () => {
    // §8.3.9 shows none, and "+50%" for three burns against two is a number pretending
    // to be a measurement.
    const burns = resultRows(outcomeOf()).find((row) => row.quantity === 'burns');
    expect(burns?.deltaFraction).toBeNull();
  });

  it('has no personal best on a first completion', () => {
    for (const row of resultRows(outcomeOf())) expect(row.best).toBeNull();
  });

  it('carries the personal best when the save has one', () => {
    const rows = resultRows(outcomeOf(), { dvMps: 108.4, timeSeconds: 4100, burns: 1 });
    expect(rows[0]?.best).toBe(108.4);
    expect(rows[1]?.best).toBe(4100);
    expect(rows[2]?.best).toBe(1);
  });

  it('carries a partially-recorded best without inventing the rest', () => {
    const rows = resultRows(outcomeOf(), { dvMps: 108.4 });
    expect(rows[0]?.best).toBe(108.4);
    expect(rows[1]?.best).toBeNull();
  });

  it('omits the time row when there is no time to compare', () => {
    const rows = resultRows(outcomeOf({ metSeconds: null, parDelta: null }));
    expect(rows.map((row) => row.quantity)).toEqual(['deltaV', 'burns']);
  });
});

describe('approachSummary', () => {
  it('reports the encounter in mission elapsed seconds', () => {
    const summary = approachSummary(outcomeOf(), START_SECONDS);
    expect(summary?.achievedM).toBe(310);
    expect(summary?.neededM).toBe(1000);
    expect(summary?.epochSeconds).toBe(4123);
    expect(summary?.met).toBe(true);
  });

  it('reports the encounter that missed, with the same shape', () => {
    const summary = approachSummary(
      outcomeOf({ objective: proximity(false, 12_400) }),
      START_SECONDS,
    );
    expect(summary?.achievedM).toBe(12_400);
    expect(summary?.met).toBe(false);
  });

  it('has nothing to report for an objective that is not about proximity', () => {
    // A `reach_orbit` contract has no encounter, and a row reading "closest — n/a"
    // would be worse than no row.
    expect(approachSummary(outcomeOf({ objective: null }), START_SECONDS)).toBeNull();
  });
});

describe('missRows', () => {
  it('produces #121’s three facts: achieved, needed, spent', () => {
    const rows = missRows(
      outcomeOf({
        success: false,
        failure: 'objectiveMissed',
        objective: proximity(false, 12_400),
      }),
      START_SECONDS,
    );
    expect(rows.map((row) => row.quantity)).toEqual(['closest', 'needed', 'deltaV']);
  });

  it('quotes the closest approach with the epoch it happened at', () => {
    const rows = missRows(
      outcomeOf({
        success: false,
        failure: 'objectiveMissed',
        objective: proximity(false, 12_400),
      }),
      START_SECONDS,
    );
    const closest = rows.find((row) => row.quantity === 'closest');
    expect(closest?.value).toBe(12_400);
    expect(closest?.epochSeconds).toBe(4123);
  });

  it('quotes the spend against the budget', () => {
    const rows = missRows(outcomeOf({ success: false, failure: 'objectiveMissed' }), START_SECONDS);
    const spent = rows.find((row) => row.quantity === 'deltaV');
    expect(spent?.value).toBe(109.1177);
    expect(spent?.limit).toBe(300);
  });

  it('still reports the spend for a contract with no encounter to quote', () => {
    const rows = missRows(
      outcomeOf({ success: false, failure: 'notEvaluated', objective: null }),
      START_SECONDS,
    );
    expect(rows.map((row) => row.quantity)).toEqual(['deltaV']);
  });
});
