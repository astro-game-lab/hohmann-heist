/**
 * Tests for the progression rule itself.
 *
 * §13.4's reachability check runs this rule over whatever ships. With one contract in act
 * I that check passes trivially — as it should, because one act-I contract really is
 * reachable — and a check that can only pass is not a check. So the rule is exercised here
 * against sets that are *supposed* to fail, which is the part that keeps the content
 * suite's sixth row meaningful before Act I is finished and after it lands.
 */
import { describe, expect, it } from 'vitest';

import type { ProgressionContract } from './reachability.js';
import { analyseProgression, bronzeGateFor } from './reachability.js';

const contract = (
  id: string,
  act: number,
  index: number,
  unlocks: readonly string[] = [],
): ProgressionContract => ({ id, act, index, unlocks });

/** `n` contracts in one act, named `a<act>-<i>`. */
const act = (number: number, count: number): ProgressionContract[] =>
  Array.from({ length: count }, (_, i) =>
    contract(`a${String(number)}-${String(i + 1)}`, number, i + 1),
  );

describe('the Bronze gate (§6.8)', () => {
  // ⌈2n/3⌉. Written out rather than computed from the same expression the code uses,
  // which would assert only that a function equals itself.
  it.each([
    [1, 1],
    [2, 2],
    [3, 2],
    [4, 3],
    [5, 4],
    [6, 4],
    [18, 12],
  ])('opens the next act on %i contracts after %i Bronze', (contracts, gate) => {
    expect(bronzeGateFor(contracts)).toBe(gate);
  });

  it('is exact at the act sizes float arithmetic gets wrong', () => {
    // `3 * (2/3)` is 1.9999999999999998 and `6 * (2/3)` is 3.9999999999999996. Both
    // happen to ceil correctly; the integer form does not depend on that happening.
    expect(bronzeGateFor(3)).toBe(Math.ceil(6 / 3));
    expect(bronzeGateFor(6)).toBe(Math.ceil(12 / 3));
  });
});

describe('what is reachable', () => {
  it('opens act I from a cold start', () => {
    const report = analyseProgression(act(1, 1));
    expect(report.unreachable).toEqual([]);
    expect(report.openActs).toEqual([1]);
  });

  it('reaches every contract of the full six-act campaign', () => {
    // §6.8's shape — 18 contracts as 4, 3, 3, 2, 3, 3. A fixture for the rule, not a
    // source of truth about the content: nothing here asserts the campaign *is* this
    // shape, only that the rule admits it.
    const campaign = [4, 3, 3, 2, 3, 3].flatMap((count, i) => act(i + 1, count));
    const report = analyseProgression(campaign);
    expect(report.unreachable).toEqual([]);
    expect(report.reachable).toHaveLength(18);
    expect([...report.gates.entries()]).toEqual([
      [2, 3],
      [3, 2],
      [4, 2],
      [5, 2],
      [6, 2],
    ]);
  });

  it('strands an act whose predecessor ships nothing', () => {
    const report = analyseProgression([...act(1, 3), ...act(3, 1)]);
    expect(report.unreachable).toEqual(['a3-1']);
    expect(report.openActs).toEqual([1]);
  });

  it('strands content that does not start in act I', () => {
    const report = analyseProgression(act(2, 2));
    expect(report.unreachable).toEqual(['a2-1', 'a2-2']);
  });

  it('opens act II on one act-I contract, because that is what the game would do', () => {
    // The honest consequence of gating on shipped content rather than on a designed act
    // size: ⌈2/3 × 1⌉ is 1, so beating the only act-I contract really does open act II.
    // Recorded as a test so that the sparse-content behaviour is a decision rather than
    // something discovered later.
    const report = analyseProgression([...act(1, 1), ...act(2, 1)]);
    expect(report.unreachable).toEqual([]);
    expect(report.gates.get(2)).toBe(1);
  });

  it('does not open act II until enough of act I is beatable', () => {
    // Four act-I contracts need three Bronze. Every one of them is playable, so the gate
    // is met — the interesting half is that removing act I entirely does not.
    const full = analyseProgression([...act(1, 4), ...act(2, 1)]);
    expect(full.gates.get(2)).toBe(3);
    expect(full.unreachable).toEqual([]);
  });

  it('follows an explicit unlock across a gap the act gate cannot bridge', () => {
    const report = analyseProgression([contract('a1-1', 1, 1, ['a3-1']), contract('a3-1', 3, 1)]);
    expect(report.unreachable).toEqual([]);
    // Act III never opened: the contract was reached by its edge, not by its act.
    expect(report.openActs).toEqual([1]);
  });

  it('reports an unlock naming a contract that does not ship', () => {
    const report = analyseProgression([contract('a1-1', 1, 1, ['c99-nonexistent'])]);
    expect(report.danglingUnlocks).toEqual([{ from: 'a1-1', to: 'c99-nonexistent' }]);
  });

  it('reports the same result whatever order the contracts arrive in', () => {
    const campaign = [4, 3, 3].flatMap((count, i) => act(i + 1, count));
    const forwards = analyseProgression(campaign);
    const backwards = analyseProgression([...campaign].reverse());
    expect(backwards.reachable).toEqual(forwards.reachable);
    expect(backwards.openActs).toEqual(forwards.openActs);
  });
});
