import { describe, expect, it } from 'vitest';

import { contractById, contracts } from './registry.js';

describe('the contract registry', () => {
  // The glob is the point: `tools/content/` walks the same directory, so a contributor
  // who adds a contract gets it into the game and into §13.4's seven checks by the same
  // act. A hand-maintained list here would let a contract pass every test and still be
  // unreachable.
  it('holds every contract in content/contracts/', () => {
    expect(contracts().length).toBeGreaterThan(0);
    expect(contracts().map((scenario) => scenario.id)).toContain('c03-cold-open');
  });

  it('loads each one through @hh/game’s own loader', () => {
    const c03 = contractById('c03-cold-open');
    expect(c03).toBeDefined();
    // A loaded scenario, not raw JSON: the loader has already turned elements into a
    // Cartesian state and assembled the legality rules.
    expect(c03?.ship.state.position).toBeDefined();
    expect(c03?.rules.budgetMps).toBe(300);
  });

  // By act then index, from the contract's own fields — not by filename, which is only
  // conventionally `cNN-slug`.
  it('orders contracts the way they are played', () => {
    const order = contracts().map((scenario) => [scenario.document.act, scenario.document.index]);
    const sorted = [...order].sort(
      (a, b) => (a[0] ?? 0) - (b[0] ?? 0) || (a[1] ?? 0) - (b[1] ?? 0),
    );
    expect(order).toStrictEqual(sorted);
  });

  it('answers undefined for an id that does not ship, rather than throwing', () => {
    expect(contractById('c99-nope')).toBeUndefined();
    expect(contractById('')).toBeUndefined();
  });
});
