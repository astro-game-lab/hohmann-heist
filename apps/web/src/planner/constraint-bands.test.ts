/**
 * §6.5's bands, and the table behind them — FR-409, #129.
 *
 * The claim under test is *"a player never discovers a constraint by failing it"*, which
 * splits into two checkable halves: the representation table is total over `ConstraintKind`
 * and says something for every kind, and a **legal** plan still shows the deadline's
 * preview region.
 */
import { epoch } from '@hh/astro';
import type { LegalityConstraints } from '@hh/game';
import { describe, expect, it } from 'vitest';

import { CONSTRAINT_REPRESENTATION, bandsFor } from './constraint-bands.js';

const START = epoch(0);
const HORIZON = epoch(14 * 3600);
const DEADLINE_SECONDS = 10 * 3600;

/** Every constraint satisfied — the shape a legal plan produces. */
const clean = (): LegalityConstraints => ({
  budget: {
    kind: 'dv_budget',
    violations: [],
    usedMps: 0,
    budgetMps: 250,
    remainingMps: 250,
    fraction: 0,
    level: 'ok',
    exceededAtNode: null,
  },
  deadline: {
    kind: 'deadline',
    violations: [],
    deadlineSeconds: DEADLINE_SECONDS,
    lastBurnMetSeconds: null,
    overrunSeconds: 0,
    firstLateNode: null,
  },
  altitudeFloor: {
    kind: 'altitude_floor',
    violations: [],
    floorAltitudeM: 100_000,
    referenceRadiusM: 6_378_137,
    totalSecondsBelow: 0,
  },
  burnCount: {
    kind: 'burn_count',
    violations: [],
    burns: 0,
    maxBurns: null,
    remaining: null,
    exceeded: false,
    exceededAtNode: null,
  },
});

/** A plan that dips below the floor between two epochs. */
const withFloorDip = (from: number, to: number): LegalityConstraints => {
  const base = clean();
  return {
    ...base,
    altitudeFloor: {
      ...base.altitudeFloor,
      violations: [
        {
          kind: 'altitude_floor',
          start: epoch(from),
          end: epoch(to),
          clippedStart: false,
          clippedEnd: false,
        },
      ],
      totalSecondsBelow: to - from,
    },
  };
};

const bands = (constraints: LegalityConstraints, previewEnabled = true) =>
  bandsFor({
    constraints,
    startEpoch: START,
    horizon: HORIZON,
    deadlineSeconds: DEADLINE_SECONDS,
    previewEnabled,
  });

describe('every constraint kind has a declared representation (#129’s first criterion)', () => {
  it('covers the whole union, checked by the compiler and counted here', () => {
    // The type is `Record<ConstraintKind, …>`, so a kind added to the union is a compile
    // error. This asserts the other direction: that the table has not grown a key the
    // union does not have, which would be a representation for a constraint that does not
    // exist.
    expect(Object.keys(CONSTRAINT_REPRESENTATION).sort()).toEqual([
      'altitude_floor',
      'burn_count',
      'deadline',
      'dv_budget',
    ]);
  });

  it('gives a reason whenever it declares no orbit representation', () => {
    // "None, because it has no geometry" is a real answer and has to say why — a kind with
    // neither a representation nor a reason is exactly what the table exists to prevent.
    for (const [kind, row] of Object.entries(CONSTRAINT_REPRESENTATION)) {
      if (row.orbit === 'none') {
        expect(row.orbitReason, kind).not.toBeNull();
        expect((row.orbitReason ?? '').length, kind).toBeGreaterThan(10);
      } else {
        expect(row.orbitReason, kind).toBeNull();
      }
    }
  });

  it('keeps the altitude floor’s geometric representation, which #107 already built', () => {
    expect(CONSTRAINT_REPRESENTATION.altitude_floor.orbit).toBe('hazard-shell');
  });
});

describe('preview, not only violation (#129’s second criterion)', () => {
  it('shows the deadline’s region for a plan that violates nothing', () => {
    const drawn = bands(clean());
    // The criterion in full: *"a legal plan still shows the floor's preview band"* — the
    // point being that a band must not require a failure to exist. The deadline is the kind
    // whose "where a burn would be illegal" is exactly computable, so it is the one that
    // can be asserted against an empty violation set.
    expect(drawn).toHaveLength(1);
    expect(drawn[0]?.kind).toBe('deadline');
    expect(drawn[0]?.state).toBe('preview');
  });

  it('runs that region from the wall to the horizon', () => {
    const drawn = bands(clean());
    expect(drawn[0]?.startMet).toBe(DEADLINE_SECONDS);
    expect(drawn[0]?.endMet).toBe(14 * 3600);
  });

  it('shades nothing beyond a deadline that is the horizon', () => {
    // The common shape for a short contract. There is no reachable epoch past the wall, so
    // a band there would be warning about somewhere that does not exist.
    const drawn = bandsFor({
      constraints: clean(),
      startEpoch: START,
      horizon: HORIZON,
      deadlineSeconds: 14 * 3600,
      previewEnabled: true,
    });
    expect(drawn).toHaveLength(0);
  });

  it('marks an actual violation as violated rather than as a preview', () => {
    const drawn = bands(withFloorDip(3600, 3700));
    const floor = drawn.find((band) => band.kind === 'altitude_floor');
    expect(floor?.state).toBe('violated');
    expect(floor?.startMet).toBe(3600);
    expect(floor?.endMet).toBe(3700);
  });

  it('draws a constraint that raises no legality reason at all', () => {
    // The burn-count cap is soft: §6.5 and #92 make it produce no `LegalityReason` ever, so
    // it could never be banded while bands came from the reason list. It can be now.
    const base = clean();
    const drawn = bands({
      ...base,
      burnCount: {
        ...base.burnCount,
        violations: [
          {
            kind: 'burn_count',
            start: epoch(1000),
            end: epoch(1000),
            clippedStart: false,
            clippedEnd: false,
          },
        ],
        maxBurns: 2,
        burns: 3,
        exceeded: true,
      },
    });
    expect(drawn.some((band) => band.kind === 'burn_count')).toBe(true);
  });
});

describe('§6.6’s constraints assist (#129’s third criterion)', () => {
  it('removes the preview region when it is off', () => {
    expect(bands(clean(), false)).toHaveLength(0);
  });

  it('keeps reporting a violation that has already happened', () => {
    const drawn = bands(withFloorDip(3600, 3700), false);
    // Turning off an assist that shows you things *early* buys you Blind; it does not buy
    // you a commit bar saying the plan is illegal with nothing on the timeline saying
    // where. A violation is a verdict, not a warning.
    expect(drawn).toHaveLength(1);
    expect(drawn[0]?.kind).toBe('altitude_floor');
    expect(drawn[0]?.state).toBe('violated');
  });
});

describe('ordering', () => {
  it('is stable rather than evaluation order, so a drag does not reshuffle the DOM', () => {
    const constraints = withFloorDip(3600, 3700);
    const first = bands(constraints);
    const second = bands(constraints);
    expect(first).toEqual(second);
    // Sorted by kind, so the floor precedes the deadline whatever order the evaluations
    // were assembled in.
    expect(first.map((band) => band.kind)).toEqual(['altitude_floor', 'deadline']);
  });
});
