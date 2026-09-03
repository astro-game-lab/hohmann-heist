import type { MetresPerSec } from '@hh/math';
import { epoch, rtn } from '@hh/astro';
import { metresPerSec, V } from '@hh/math';
import { describe, expect, it } from 'vitest';

import {
  createManeuverNode,
  createPlan,
  EMPTY_PLAN,
  maneuverNodeFromCounts,
  MINIMUM_NODE_SPACING_S,
  MINIMUM_NODE_SPACING_TICKS,
} from './plan.js';
import { EPOCH_TICKS_PER_SECOND, toDeltaVCounts, toEpochTicks } from './quantise.js';

/**
 * Narrow away `undefined`, failing the test rather than asserting it away.
 *
 * `noUncheckedIndexedAccess` is on and the lint config forbids both `!` and the widening
 * cast, which is correct for source and merely noisy in a test that has just built the
 * array it is indexing.
 */
const definitely = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error('expected a value, got undefined');
  return value;
};

const dv = (radial: number, transverse: number, normal: number) =>
  rtn(V.vec3<MetresPerSec>(metresPerSec(radial), metresPerSec(transverse), metresPerSec(normal)));

const nodeAt = (seconds: number, radial = 0, transverse = 100, normal = 0) =>
  createManeuverNode({ epoch: epoch(seconds), deltaVRtn: dv(radial, transverse, normal) });

describe('createManeuverNode', () => {
  it('quantises at entry (FR-105)', () => {
    const node = nodeAt(12.3456789, 0.00012345, 723.99999, -0.5);

    expect(node.epochTicks).toBe(12642);
    expect(node.deltaVCounts).toStrictEqual([1, 7_240_000, -5000]);
  });

  it('derives the SI values from the counts, not from the arguments', () => {
    // The point of FR-105: the node reports what it *is*, not what was asked for.
    // If these came from the caller's numbers the plan would no longer be "exactly
    // what was played".
    const node = nodeAt(12.3456789, 0, 0.72404, 0);

    expect(node.epoch).toBe(12.345703125);
    expect(node.epoch).not.toBe(12.3456789);
    expect(node.deltaVRtn.y).toBe(7240 * 1e-4);
    expect(node.deltaVRtn.y).not.toBe(0.72404);
  });

  it('keeps the delta-v in RTN order', () => {
    const node = nodeAt(0, 1, 2, 3);

    expect(node.deltaVCounts).toStrictEqual([10000, 20000, 30000]);
    expect([node.deltaVRtn.x, node.deltaVRtn.y, node.deltaVRtn.z]).toStrictEqual([
      10000 * 1e-4,
      20000 * 1e-4,
      30000 * 1e-4,
    ]);
  });

  it('is idempotent — re-quantising a node cannot move it', () => {
    const once = nodeAt(12.3456789, 0.123456, -723.99994, 0.05);
    const twice = createManeuverNode({ epoch: once.epoch, deltaVRtn: once.deltaVRtn });

    expect(twice.epochTicks).toBe(once.epochTicks);
    expect(twice.deltaVCounts).toStrictEqual(once.deltaVCounts);
    expect(twice.epoch).toBe(once.epoch);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(nodeAt(0))).toBe(true);
  });

  it('rejects a non-finite epoch or component', () => {
    expect(() => nodeAt(Number.NaN)).toThrow(RangeError);
    expect(() => nodeAt(0, Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('maneuverNodeFromCounts', () => {
  it('takes counts as they stand, without re-quantising', () => {
    const node = maneuverNodeFromCounts(12642, [1, 7_240_000, -5000]);

    expect(node.epochTicks).toBe(12642);
    expect(node.deltaVCounts).toStrictEqual([1, 7_240_000, -5000]);
    expect(node.epoch).toBe(12.345703125);
  });

  it('rejects counts that are not safe integers', () => {
    expect(() => maneuverNodeFromCounts(12.5, [0, 0, 0])).toThrow(/safe integer/);
    expect(() => maneuverNodeFromCounts(0, [0, 0.25, 0])).toThrow(/safe integer/);
  });
});

describe('createPlan (FR-101)', () => {
  it('accepts an empty plan', () => {
    expect(createPlan([]).nodes).toStrictEqual([]);
    expect(EMPTY_PLAN.nodes).toStrictEqual([]);
  });

  it('accepts a single node', () => {
    expect(createPlan([nodeAt(0)]).nodes).toHaveLength(1);
  });

  it('accepts strictly increasing nodes at least a second apart', () => {
    const plan = createPlan([nodeAt(0), nodeAt(1), nodeAt(3600), nodeAt(43_784)]);

    expect(plan.nodes.map((n) => n.epochTicks)).toStrictEqual([0, 1024, 3_686_400, 44_834_816]);
  });

  it('accepts exactly one second, which is the boundary a tight sequence lands on', () => {
    const plan = createPlan([nodeAt(100), nodeAt(101)]);

    expect(definitely(plan.nodes[1]).epochTicks - definitely(plan.nodes[0]).epochTicks).toBe(
      MINIMUM_NODE_SPACING_TICKS,
    );
    expect(MINIMUM_NODE_SPACING_TICKS).toBe(MINIMUM_NODE_SPACING_S * EPOCH_TICKS_PER_SECOND);
  });

  it('rejects out-of-order nodes with a typed error naming both', () => {
    expect(() => createPlan([nodeAt(100), nodeAt(50)])).toThrow(RangeError);
    expect(() => createPlan([nodeAt(100), nodeAt(50)])).toThrow(/strictly increase/);
  });

  it('rejects two nodes at the same epoch', () => {
    expect(() => createPlan([nodeAt(100), nodeAt(100)])).toThrow(/strictly increase/);
  });

  it('rejects nodes closer than a second, distinguishing that from being out of order', () => {
    expect(() => createPlan([nodeAt(100), nodeAt(100.5)])).toThrow(/at least 1 s apart/);
    // One tick short of legal, which a float comparison on a 2026 epoch could miss.
    const first = nodeAt(841_536_000);
    const second = maneuverNodeFromCounts(
      first.epochTicks + MINIMUM_NODE_SPACING_TICKS - 1,
      [0, 0, 0],
    );
    expect(() => createPlan([first, second])).toThrow(/at least 1 s apart/);
  });

  it('validates every consecutive pair, not just the first', () => {
    expect(() => createPlan([nodeAt(0), nodeAt(10), nodeAt(10.25)])).toThrow(/at least 1 s apart/);
  });

  it('is frozen, and copies its input so a later mutation cannot reach it', () => {
    const nodes = [nodeAt(0), nodeAt(10)];
    const plan = createPlan(nodes);
    nodes.push(nodeAt(20));

    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.nodes)).toBe(true);
    expect(plan.nodes).toHaveLength(2);
  });
});

describe('quantisation constants match the node contract', () => {
  it('agrees with the quantise module on both quanta', () => {
    const node = nodeAt(1.5, 0, 0.05, 0);

    expect(node.epochTicks).toBe(toEpochTicks(epoch(1.5)));
    expect(node.deltaVCounts[1]).toBe(toDeltaVCounts(0.05));
  });
});
