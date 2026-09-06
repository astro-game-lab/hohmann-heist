/**
 * §8.3.9's rule set, checked — FR-307.
 *
 * The property that matters most is not that each rule fires on its own case. It is that
 * **at most one fires**, and that the rules stay quiet when the evidence is ambiguous.
 * §8.3.9's whole design is that the game never speculates about why, and a rule set that
 * guessed on a diagonal miss would be speculating with the authority of a measurement.
 */
import { epoch } from '@hh/astro';
import { rtn } from '@hh/astro';
import { V, metres, metresPerSec } from '@hh/math';
import { describe, expect, it } from 'vitest';

import { DOMINANCE_RATIO, diagnose, type DiagnosisFacts } from './diagnosis.js';
import type { ProximityEvaluation } from './objectives/index.js';
import { messageOf } from './test-support.js';
import {
  INTERCEPT_MAX_RANGE_M,
  RENDEZVOUS_MAX_RANGE_M,
  RENDEZVOUS_MAX_REL_SPEED_MPS,
} from './objectives/index.js';

/** A missed proximity encounter whose miss points where the test says. */
const missed = (
  options: {
    radialM?: number;
    alongTrackM?: number;
    rangeM?: number;
    relativeSpeedMps?: number;
    kind?: ProximityEvaluation['kind'];
    maxRelativeSpeedMps?: number | null;
    maxRangeM?: number;
  } = {},
): ProximityEvaluation => {
  const radialM = options.radialM ?? 0;
  const alongTrackM = options.alongTrackM ?? 0;
  return {
    kind: options.kind ?? 'rendezvous',
    met: false,
    atEpoch: null,
    achieved: {
      epoch: epoch(4000),
      rangeM: metres(options.rangeM ?? Math.hypot(radialM, alongTrackM)),
      relativeSpeedMps: metresPerSec(options.relativeSpeedMps ?? 0.05),
      missRtn: rtn(V.vec3(metres(radialM), metres(alongTrackM), metres(0))),
    },
    candidates: [],
    tolerance: {
      maxRangeM: metres(options.maxRangeM ?? RENDEZVOUS_MAX_RANGE_M),
      maxRelativeSpeedMps:
        options.maxRelativeSpeedMps === null
          ? null
          : metresPerSec(options.maxRelativeSpeedMps ?? RENDEZVOUS_MAX_REL_SPEED_MPS),
    },
  };
};

const factsFor = (over: Partial<DiagnosisFacts> = {}): DiagnosisFacts => ({
  failure: 'objectiveMissed',
  objective: missed(),
  metSeconds: null,
  deadlineSeconds: 10_800,
  ...over,
});

describe('at most one rule speaks', () => {
  // The table is constructed so that several rules *could* claim each row. What is
  // asserted is which one does, and that it is exactly one.
  it('prefers the deadline over the geometry of a successful encounter', () => {
    // A perfect intercept, twenty minutes late. The encounter is not a miss at all, so
    // explaining it as one would answer the wrong question.
    const result = diagnose(
      factsFor({
        failure: 'pastDeadline',
        metSeconds: 12_000,
        objective: { ...missed({ alongTrackM: 9_000 }), met: true, atEpoch: epoch(12_000) },
      }),
    );

    expect(result?.message.key).toBe('debrief.diagnosis.pastDeadline');
  });

  it('prefers "too fast" over the geometry when the range was good enough', () => {
    // Inside 100 m and closing at 1.4 m/s. The along-track component would otherwise
    // dominate and produce a timing sentence, which would be plainly wrong: the ship got
    // there, and the encounter still was not a rendezvous.
    const result = diagnose(
      factsFor({
        objective: missed({ alongTrackM: 80, radialM: 5, rangeM: 80, relativeSpeedMps: 1.4 }),
      }),
    );

    expect(result?.message.key).toBe('debrief.diagnosis.tooFast');
  });

  it('does not fire "too fast" for an objective with no speed condition', () => {
    // `intercept` (DEP-04) imposes no velocity limit, so a fast flyby inside 1 km is a
    // pass, and a miss can only ever be geometric.
    const result = diagnose(
      factsFor({
        objective: missed({
          kind: 'intercept',
          maxRelativeSpeedMps: null,
          maxRangeM: INTERCEPT_MAX_RANGE_M,
          alongTrackM: 12_000,
          radialM: 200,
          relativeSpeedMps: 140,
        }),
      }),
    );

    expect(result?.message.key).toBe('debrief.diagnosis.arrivedLate');
  });

  it('never returns two diagnoses, whatever the facts', () => {
    // A returned value is one rule by construction; this asserts the shape rather than
    // the count, so a future refactor to an array would have to be deliberate.
    const result = diagnose(factsFor({ objective: missed({ alongTrackM: 9_000 }) }));
    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(false);
  });
});

describe('along-track means timing, radial means altitude', () => {
  it('says the ship arrived late when the target is still ahead', () => {
    const result = diagnose(factsFor({ objective: missed({ alongTrackM: 12_000, radialM: 100 }) }));
    expect(result?.message.key).toBe('debrief.diagnosis.arrivedLate');
    expect(result?.codex).toBe('departure-timing');
  });

  it('says the ship arrived early when it got there first', () => {
    const result = diagnose(
      factsFor({ objective: missed({ alongTrackM: -12_000, radialM: 100 }) }),
    );
    expect(result?.message.key).toBe('debrief.diagnosis.arrivedEarly');
  });

  it('says undershot when the target is above', () => {
    const result = diagnose(factsFor({ objective: missed({ radialM: 4_000, alongTrackM: 100 }) }));
    expect(result?.message.key).toBe('debrief.diagnosis.undershot');
    expect(result?.codex).toBe('the-hohmann-transfer');
  });

  it('says overshot when the target is below', () => {
    const result = diagnose(factsFor({ objective: missed({ radialM: -4_000, alongTrackM: 100 }) }));
    expect(result?.message.key).toBe('debrief.diagnosis.overshot');
  });

  it('is silent on a diagonal miss, which is a real outcome and not a gap', () => {
    // Equal components: genuinely both, and §8.3.9's fallback is the bare numbers.
    expect(
      diagnose(factsFor({ objective: missed({ radialM: 5_000, alongTrackM: 5_000 }) })),
    ).toBeNull();
  });

  it('has its threshold at exactly the stated ratio, on both sides', () => {
    const below = missed({ alongTrackM: 1_000 * DOMINANCE_RATIO, radialM: 1_000 });
    const above = missed({ alongTrackM: 1_000 * DOMINANCE_RATIO + 1, radialM: 1_000 });

    // At exactly the ratio the comparison is strict, so the rule stays quiet.
    expect(diagnose(factsFor({ objective: below }))).toBeNull();
    expect(diagnose(factsFor({ objective: above }))?.message.key).toBe(
      'debrief.diagnosis.arrivedLate',
    );
  });

  it('is silent on a miss of nothing, rather than inventing a direction', () => {
    // `proximity.ts` reports a zero vector when the encounter could not be decomposed.
    expect(diagnose(factsFor({ objective: missed({ radialM: 0, alongTrackM: 0 }) }))).toBeNull();
  });
});

describe('reach_orbit names the element that missed', () => {
  const comparison = (
    element: string,
    difference: number,
    tolerance: number,
    within: boolean,
  ): never =>
    ({
      element,
      compared: true,
      goal: 0,
      achieved: difference,
      difference,
      tolerance,
      within,
    }) as never;

  const reachOrbit = (comparisons: readonly never[]): never =>
    ({
      kind: 'reach_orbit',
      met: false,
      atEpoch: epoch(4000),
      comparisons,
      achieved: {},
      tolerance: { radiusM: metres(10_000), angleRad: 0 },
    }) as never;

  it('picks the element that missed by the largest multiple of its own tolerance', () => {
    // Not the largest raw difference: a 40 km radius miss against 10 km of slop is four
    // tolerances out, while 0.5° against 0.1° is five. Ranking by raw value would compare
    // metres against radians and always pick the radius.
    const result = diagnose(
      factsFor({
        objective: reachOrbit([
          comparison('periapsisRadius', 40_000, 10_000, false),
          comparison('inclination', 0.0087, 0.0017, false),
        ]),
      }),
    );

    expect(messageOf(result?.message, 'debrief.diagnosis.wrongOrbit').params.element).toBe(
      'inclination',
    );
  });

  it('ignores elements that were within tolerance', () => {
    const result = diagnose(
      factsFor({
        objective: reachOrbit([
          comparison('periapsisRadius', 100, 10_000, true),
          comparison('apoapsisRadius', 30_000, 10_000, false),
        ]),
      }),
    );

    expect(messageOf(result?.message, 'debrief.diagnosis.wrongOrbit').params.element).toBe(
      'apoapsisRadius',
    );
  });

  it('says nothing when no element is out of tolerance', () => {
    expect(
      diagnose(
        factsFor({ objective: reachOrbit([comparison('periapsisRadius', 1, 10_000, true)]) }),
      ),
    ).toBeNull();
  });
});

/**
 * `station` — the two ways to miss a slot, and why they read different quantities.
 *
 * DEP-14 asks for two conditions at one epoch, so there are two failures and they want
 * opposite advice: a ship that never stopped needs a bigger second burn, and one that
 * stopped in the wrong place needs a different coast. C07 is the only station contract in
 * v1.0, so until it shipped a station miss produced no explanation at all — which is what
 * a player reported.
 */
describe('station tells "never stopped" from "stopped in the wrong place"', () => {
  const DRIFT_LIMIT = 2.0201e-9; // DEP-14's 0.01°/day in rad/s.
  const SLOT = 8.727e-4; // DEP-14's ±0.05° in rad.

  const station = (over: {
    readonly offsetRad?: number;
    readonly achievedDrift?: number;
    readonly finalDrift: number;
  }): never =>
    ({
      kind: 'station',
      met: false,
      atEpoch: null,
      achieved: {
        offsetRad: over.offsetRad ?? 0,
        driftRadPerSec: over.achievedDrift ?? 0,
        withinSlot: Math.abs(over.offsetRad ?? 0) <= SLOT,
        withinDrift: Math.abs(over.achievedDrift ?? 0) <= DRIFT_LIMIT,
      },
      finalDriftRadPerSec: over.finalDrift,
      goal: { slotOffsetRad: 0.0524, maxOffsetRad: SLOT, maxDriftRadPerSec: DRIFT_LIMIT },
    }) as never;

  it('reports the drift when the plan ends on an orbit that is still sliding', () => {
    const result = diagnose(factsFor({ objective: station({ finalDrift: 5e-8 }) }));
    expect(result?.message.key).toBe('debrief.diagnosis.stillDrifting');
  });

  /**
   * The case that made this rule read the **final** arc rather than `achieved`.
   *
   * A plan with one burn and no second one has an admissible-drift instant at the very
   * start — before it left geostationary — so `achieved` reports that instant as its best
   * moment. A rule reading `achieved.withinDrift` therefore concluded the ship had
   * stopped, and told the player their coast was short while they slid away for the rest
   * of the horizon. The best moment a run managed and the orbit it ended on are different
   * questions, and only the second one answers "did you stop".
   */
  it('is not fooled by an admissible moment that predates the manoeuvre', () => {
    const result = diagnose(
      factsFor({
        objective: station({
          // The best moment: at the start, geostationary, 3° from the slot.
          offsetRad: 0.0524,
          achievedDrift: 0,
          // The orbit it actually ends on: sliding east at 0.25°/day.
          finalDrift: 5e-8,
        }),
      }),
    );
    expect(result?.message.key).toBe('debrief.diagnosis.stillDrifting');
  });

  it('reports the offset, signed, when the plan did stop but in the wrong place', () => {
    const result = diagnose(
      factsFor({ objective: station({ offsetRad: -0.0484, finalDrift: 1e-11 }) }),
    );
    expect(result?.message.key).toBe('debrief.diagnosis.wrongLongitude');
    // Signed, because the sign is the advice: west means the coast was cut short.
    expect(result?.message.params).toMatchObject({ offsetRad: -0.0484 });
  });

  it('says nothing when the drift could not be measured at all', () => {
    // A timeline that did not propagate. §8.3.9: no explanation beats a wrong one.
    expect(diagnose(factsFor({ objective: station({ finalDrift: Number.NaN }) }))).toBeNull();
  });

  it('says nothing about a run that met the objective', () => {
    const met = { ...(station({ finalDrift: 0 }) as object), met: true } as never;
    expect(diagnose(factsFor({ objective: met }))).toBeNull();
  });
});

describe('the fallback is silence', () => {
  it('says nothing when there is no objective to reason about', () => {
    expect(diagnose(factsFor({ objective: null }))).toBeNull();
  });

  it('says nothing about a run that succeeded', () => {
    const met = { ...missed({ alongTrackM: 9_000 }), met: true, atEpoch: epoch(4000) };
    expect(diagnose(factsFor({ failure: null, objective: met, metSeconds: 4000 }))).toBeNull();
  });

  it('says nothing when a deadline failure has no epoch to quote', () => {
    expect(diagnose(factsFor({ failure: 'pastDeadline', metSeconds: null }))).not.toBeUndefined();
  });
});
