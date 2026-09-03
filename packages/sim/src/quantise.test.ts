import { epoch } from '@hh/astro';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  DELTA_V_COUNTS_PER_MPS,
  DELTA_V_QUANTUM_MPS,
  EPOCH_QUANTUM_S,
  EPOCH_TICKS_PER_SECOND,
  fromDeltaVCounts,
  fromEpochTicks,
  toDeltaVCounts,
  toEpochTicks,
} from './quantise.js';

describe('the quanta themselves (DEP-09)', () => {
  it('are the values DEP-09 names', () => {
    expect(EPOCH_QUANTUM_S).toBe(1 / 1024);
    expect(DELTA_V_QUANTUM_MPS).toBe(1e-4);
  });

  it('pair with exact reciprocals', () => {
    expect(EPOCH_QUANTUM_S * EPOCH_TICKS_PER_SECOND).toBe(1);
    expect(DELTA_V_QUANTUM_MPS * DELTA_V_COUNTS_PER_MPS).toBe(1);
  });

  it('makes the epoch quantum a power of two, which is why an epoch tick is exact', () => {
    // Not decoration: the exactness claims below hold for the epoch and not for the
    // delta-v precisely because of this, and if someone "rounds" 1/1024 to 0.001 the
    // rest of this file stops being true.
    expect(Math.log2(EPOCH_TICKS_PER_SECOND)).toBe(10);
    expect(Number.isInteger(Math.log2(EPOCH_QUANTUM_S))).toBe(true);
  });
});

describe('epoch quantisation', () => {
  it('rounds to the nearest tick', () => {
    // 12.3456789 s is 12641.97... ticks; the nearest tick is 12642, or 12.345703125 s.
    expect(toEpochTicks(epoch(12.3456789))).toBe(12642);
    expect(fromEpochTicks(12642)).toBe(12.345703125);
  });

  it('is exact in both directions — a tick is a binary fraction', () => {
    // Asserted, not assumed: §11.4 claims epochs are exactly representable, and this
    // is the claim. Note `toBe`, not `toBeCloseTo`.
    for (const ticks of [0, 1, 1023, 1024, 44032000, 880803840000]) {
      expect(toEpochTicks(fromEpochTicks(ticks))).toBe(ticks);
      expect(fromEpochTicks(ticks) * EPOCH_TICKS_PER_SECOND).toBe(ticks);
    }
  });

  it('is exact at a realistic 2026 epoch, where a float subtraction would not be', () => {
    // ~8.4e8 s past J2000. The tick count is 8.6e11, comfortably inside 2^53, so the
    // round-trip is still exact — which is the property the plan's spacing check
    // relies on rather than differencing two nearby epochs as floats.
    const t = epoch(841_536_000);
    expect(fromEpochTicks(toEpochTicks(t))).toBe(841_536_000);
  });

  it('round-trips exactly for any epoch in the game domain', () => {
    fc.assert(
      fc.property(
        // J2000 to ~2040, at sub-tick resolution.
        fc.double({ min: -1e9, max: 1.3e9, noNaN: true, noDefaultInfinity: true }),
        (seconds) => {
          const ticks = toEpochTicks(epoch(seconds));
          expect(Number.isSafeInteger(ticks)).toBe(true);
          // Idempotent: quantising the quantised value cannot move it.
          expect(toEpochTicks(fromEpochTicks(ticks))).toBe(ticks);
          // And it is within half a tick of where it started.
          expect(Math.abs(fromEpochTicks(ticks) - seconds)).toBeLessThanOrEqual(
            EPOCH_QUANTUM_S / 2,
          );
        },
      ),
    );
  });

  it('normalises -0 to 0 so a tick count has one representation', () => {
    expect(Object.is(toEpochTicks(epoch(-0)), 0)).toBe(true);
    expect(Object.is(toEpochTicks(epoch(-0.0001)), 0)).toBe(true);
  });

  it('rejects a non-finite epoch', () => {
    expect(() => toEpochTicks(epoch(Number.NaN))).toThrow(RangeError);
    expect(() => toEpochTicks(epoch(Number.POSITIVE_INFINITY))).toThrow(/finite/);
  });

  it('rejects an epoch beyond the safe-integer tick range', () => {
    expect(() => toEpochTicks(epoch(1e16))).toThrow(/representable tick range/);
  });

  it('rejects a tick count that is not a safe integer', () => {
    expect(() => fromEpochTicks(1.5)).toThrow(/safe integer/);
    expect(() => fromEpochTicks(Number.MAX_SAFE_INTEGER + 2)).toThrow(RangeError);
  });
});

describe('delta-v quantisation', () => {
  it('rounds to the nearest count', () => {
    expect(toDeltaVCounts(0.724)).toBe(7240);
    expect(toDeltaVCounts(-0.72404)).toBe(-7240);
    expect(toDeltaVCounts(2397.53)).toBe(23_975_300);
  });

  it('round-trips the integer count exactly, which is what §11.4 actually claims', () => {
    // The count is the identity. The *quantity* is not exactly representable — 1e-4
    // is not a binary fraction — and this test says so rather than pretending
    // otherwise, because a quantisation module that overstates its own exactness is
    // the worst possible place for a quiet lie.
    expect(fromDeltaVCounts(7240)).not.toBe(0.724);
    expect(fromDeltaVCounts(7240)).toBeCloseTo(0.724, 15);
    expect(toDeltaVCounts(fromDeltaVCounts(7240))).toBe(7240);
  });

  it('round-trips exactly for any delta-v in the game domain', () => {
    fc.assert(
      fc.property(
        // Nothing in this game asks for more than a few km/s.
        fc.double({ min: -1e4, max: 1e4, noNaN: true, noDefaultInfinity: true }),
        (component) => {
          const counts = toDeltaVCounts(component);
          expect(Number.isSafeInteger(counts)).toBe(true);
          // Idempotence is the FR-105 property: applied once at entry, and applying
          // it again downstream is a no-op rather than a slow drift.
          expect(toDeltaVCounts(fromDeltaVCounts(counts))).toBe(counts);
          expect(Math.abs(fromDeltaVCounts(counts) - component)).toBeLessThanOrEqual(
            DELTA_V_QUANTUM_MPS / 2,
          );
        },
      ),
    );
  });

  it('survives a JSON round-trip unchanged — asserted, not assumed', () => {
    // §11.4's claim, tested on the thing that actually round-trips: the count.
    fc.assert(
      fc.property(fc.integer({ min: -1e9, max: 1e9 }), (counts) => {
        expect(JSON.parse(JSON.stringify(counts))).toBe(counts);
        expect(fromDeltaVCounts(JSON.parse(JSON.stringify(counts)) as number)).toBe(
          fromDeltaVCounts(counts),
        );
      }),
    );
  });

  it('normalises -0 to 0', () => {
    expect(Object.is(toDeltaVCounts(-0), 0)).toBe(true);
    expect(Object.is(toDeltaVCounts(-1e-9), 0)).toBe(true);
  });

  it('rejects a non-finite component', () => {
    expect(() => toDeltaVCounts(Number.NaN)).toThrow(/finite/);
    expect(() => toDeltaVCounts(Number.NEGATIVE_INFINITY)).toThrow(RangeError);
  });

  it('rejects a component beyond the safe-integer count range', () => {
    expect(() => toDeltaVCounts(1e15)).toThrow(/representable count range/);
  });

  it('rejects a count that is not a safe integer', () => {
    expect(() => fromDeltaVCounts(0.5)).toThrow(/safe integer/);
  });
});
