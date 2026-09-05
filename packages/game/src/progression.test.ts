/**
 * §6.8's unlock rule, checked — FR-303, §8.3.2.
 *
 * Three claims carry the weight. The threshold is ⌈2/3⌉ of the act's **shipped**
 * contracts, so a partially shipped campaign cannot lock a later act behind contracts that
 * do not exist. Bronze is a **floor**, so a save full of Golds unlocks everything a save
 * full of Bronzes would. And `NEXT` points at something unstarted, which is a different
 * question from unfinished.
 */
import { describe, expect, it } from 'vitest';

import {
  bronzeThreshold,
  hasBronze,
  isUnlocked,
  progression,
  type ContractRecord,
  type ProgressionContract,
} from './progression.js';

/** §6.8's Acts I and II, which is what M3 ships. */
const ACTS_I_II: readonly ProgressionContract[] = [
  { id: 'c01', act: 1, index: 1 },
  { id: 'c02', act: 1, index: 2 },
  { id: 'c03', act: 1, index: 3 },
  { id: 'c04', act: 1, index: 4 },
  { id: 'c05', act: 2, index: 5 },
  { id: 'c06', act: 2, index: 6 },
  { id: 'c07', act: 2, index: 7 },
];

/** §6.8's full campaign, to check the rule against what it eventually ships. */
const ALL_EIGHTEEN: readonly ProgressionContract[] = [
  ...ACTS_I_II,
  ...[8, 9, 10].map((n) => ({ id: `c0${String(n)}`, act: 3, index: n })),
  ...[11, 12].map((n) => ({ id: `c${String(n)}`, act: 4, index: n })),
  ...[13, 14, 15].map((n) => ({ id: `c${String(n)}`, act: 5, index: n })),
  ...[16, 17, 18].map((n) => ({ id: `c${String(n)}`, act: 6, index: n })),
];

const bronzed = (...ids: string[]): Record<string, ContractRecord> =>
  Object.fromEntries(ids.map((id) => [id, { medal: 'bronze' as const, attempts: 1 }]));

describe('the threshold is ⌈2/3⌉ of an act’s shipped contracts', () => {
  it('needs three of Act I’s four and two of Act II’s three', () => {
    expect(bronzeThreshold(4)).toBe(3);
    expect(bronzeThreshold(3)).toBe(2);
    expect(bronzeThreshold(2)).toBe(2);
    expect(bronzeThreshold(1)).toBe(1);
  });

  it('opens Act II at exactly three of Act I, and not at two', () => {
    expect(progression(ACTS_I_II, bronzed('c01', 'c02')).unlocked['c05']).toBe(false);
    expect(progression(ACTS_I_II, bronzed('c01', 'c02', 'c03')).unlocked['c05']).toBe(true);
    expect(progression(ACTS_I_II, bronzed('c01', 'c02', 'c03', 'c04')).unlocked['c05']).toBe(true);
  });

  it('says what a locked contract is waiting for', () => {
    const locked = progression(ACTS_I_II, bronzed('c01')).locks['c06'];
    expect(locked).toEqual({ requiredAct: 1, required: 3, earned: 1 });
  });

  it('counts against the contracts registered, not against §6.8’s eventual eighteen', () => {
    // The property that lets content ship act by act (§14.1). Act II's threshold is two
    // when only three of its contracts exist, and stays two in the full campaign because
    // Act II has three contracts either way — but Act III's *does* change, and that is
    // what would break a rule written against a hard-coded eighteen.
    const partial = progression(ACTS_I_II, bronzed('c01', 'c02', 'c03', 'c05', 'c06'));
    // Act III is not shipped, so nothing in it is reported at all.
    expect(partial.acts.map((act) => act.act)).toEqual([1, 2]);
    expect(partial.unlocked['c08']).toBeUndefined();

    const full = progression(ALL_EIGHTEEN, bronzed('c01', 'c02', 'c03', 'c05', 'c06'));
    expect(full.unlocked['c08']).toBe(true);
  });

  it('always opens the first act', () => {
    const empty = progression(ACTS_I_II, {});
    expect(empty.unlocked['c01']).toBe(true);
    expect(empty.unlocked['c05']).toBe(false);
    expect(empty.acts[0]?.lock).toBeUndefined();
  });
});

describe('Bronze is a floor, never an equality (§6.7)', () => {
  it('counts Gold, Silver and Clean Job toward the threshold', () => {
    // The save stores only the highest medal earned, so a strong player's record contains
    // no literal 'bronze' at all. An equality test would lock them out of Act II.
    const strong: Record<string, ContractRecord> = {
      c01: { medal: 'gold', attempts: 3 },
      c02: { medal: 'clean', attempts: 2 },
      c03: { medal: 'silver', attempts: 1 },
    };
    expect(progression(ACTS_I_II, strong).unlocked['c05']).toBe(true);
  });

  it('does not count an attempt without a medal', () => {
    const tried: Record<string, ContractRecord> = {
      c01: { attempts: 9 },
      c02: { attempts: 4 },
      c03: { attempts: 7 },
    };
    expect(progression(ACTS_I_II, tried).unlocked['c05']).toBe(false);
    expect(hasBronze(tried['c01'])).toBe(false);
    expect(hasBronze(undefined)).toBe(false);
  });
});

describe('§8.3.2’s NEXT marker', () => {
  it('is the first contract on an empty save', () => {
    expect(progression(ACTS_I_II, {}).next).toBe('c01');
  });

  it('is the first *unstarted* unlocked contract, not the first unfinished one', () => {
    // c01 was attempted and not beaten. The board should point at c02, which the player
    // has not seen, rather than back at the one they are already stuck on.
    const records: Record<string, ContractRecord> = { c01: { attempts: 4 } };
    expect(progression(ACTS_I_II, records).next).toBe('c02');
  });

  it('falls back to the first unbeaten contract once everything open is started', () => {
    const records: Record<string, ContractRecord> = {
      c01: { medal: 'gold', attempts: 1 },
      c02: { attempts: 2 },
      c03: { attempts: 1 },
      c04: { attempts: 1 },
    };
    expect(progression(ACTS_I_II, records).next).toBe('c02');
  });

  it('never points into a locked act', () => {
    const records: Record<string, ContractRecord> = {
      c01: { medal: 'gold', attempts: 1 },
      c02: { medal: 'gold', attempts: 1 },
      c03: { medal: 'gold', attempts: 1 },
      c04: { medal: 'gold', attempts: 1 },
      c05: { attempts: 1 },
    };
    // Act I is complete, so Act II is open and c05 is started but unbeaten.
    expect(progression(ACTS_I_II, records).next).toBe('c06');

    // With Act I incomplete, NEXT stays inside Act I.
    const early = progression(ACTS_I_II, bronzed('c01'));
    expect(early.next).toBe('c02');
  });

  it('is null when every unlocked contract is beaten', () => {
    const all = bronzed('c01', 'c02', 'c03', 'c04', 'c05', 'c06', 'c07');
    expect(progression(ACTS_I_II, all).next).toBeNull();
  });
});

describe('act counts, for §8.3.2’s header', () => {
  it('reports how many of each act are bronzed, in board order', () => {
    const result = progression(ACTS_I_II, bronzed('c01', 'c03', 'c05'));
    expect(result.acts.map((act) => [act.act, act.bronzed, act.contracts.length])).toEqual([
      [1, 2, 4],
      [2, 1, 3],
    ]);
  });

  it('orders contracts by act then index whatever order they arrive in', () => {
    const shuffled = [...ACTS_I_II].reverse();
    expect(progression(shuffled, {}).acts[0]?.contracts).toEqual(['c01', 'c02', 'c03', 'c04']);
  });
});

describe('the direct-URL guard is the same rule', () => {
  it('refuses a locked contract and admits an open one', () => {
    // §8.3.3: a locked contract is unreachable by UI, and direct-URL access shows the
    // unlock rule. Both go through `progression`, so the board and the guard cannot drift.
    expect(isUnlocked(ACTS_I_II, {}, 'c01')).toBe(true);
    expect(isUnlocked(ACTS_I_II, {}, 'c05')).toBe(false);
    expect(isUnlocked(ACTS_I_II, {}, 'nonexistent')).toBe(false);
  });
});
