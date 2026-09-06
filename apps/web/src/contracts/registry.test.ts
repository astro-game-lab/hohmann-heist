import { parseScenario } from '@hh/game';
import { describe, expect, it } from 'vitest';

import { brokenContractById, brokenContracts, contractById, contracts } from './registry.js';

describe('the contract registry', () => {
  // The glob is the point: `tools/content/` walks the same directory, so a contributor
  // who adds a contract gets it into the game and into §13.4's seven checks by the same
  // act. A hand-maintained list here would let a contract pass every test and still be
  // unreachable.
  it('holds every contract in content/contracts/', () => {
    expect(contracts().length).toBeGreaterThan(0);
    expect(contracts().map((scenario) => scenario.id)).toContain('c03-cold-open');
  });

  /**
   * Acts I and II, in the order §6.8 lists them.
   *
   * Spelled out rather than counted, because the failure this catches is a contract that
   * loads and is unreachable — the glob is what puts a file into the game, and a file that
   * was never added is indistinguishable from one that was, unless something names it.
   * The list grows as M4's contracts land; that edit is the reminder to check the board.
   */
  it('ships Acts I and II, reachable at #/contract/<id>', () => {
    expect(contracts().map((scenario) => scenario.id)).toStrictEqual([
      'c01-shakedown',
      'c02-round-trip',
      'c03-cold-open',
      'c04-long-haul',
      'c05-tailgate',
      'c06-overtake',
      'c07-slot-machine',
    ]);
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

/**
 * A contract whose data is refused — §8.7, FR-202, #125.
 *
 * The registry used to throw at module load. It now collects the failure instead, so §8.7's
 * *"show which field failed, and offer to report it"* has something to render: a `throw`
 * happens before anything is mounted, and stringifying `parseScenario`'s JSON pointers into
 * an `Error` message threw away the very thing that row asks for.
 *
 * The build-failure guarantee did not go away — it moved to `tools/content/`, which refuses
 * to let an invalid contract merge and fails in CI with the file named, which is a better
 * place for it than a browser with a blank page.
 */
describe('a contract that fails validation', () => {
  it('is absent from the shipped registry, so nothing renders a partial scenario', () => {
    // FR-202: *"never load a partially valid scenario"*. Every id the registry hands out
    // came back from `parseScenario` with `ok: true`.
    for (const scenario of contracts()) {
      expect(scenario.ship.state.position, scenario.id).toBeDefined();
      expect(scenario.rules, scenario.id).toBeDefined();
    }
  });

  it('reports none in a build the content suite has passed', () => {
    expect(brokenContracts()).toStrictEqual([]);
    expect(brokenContractById('c01-shakedown')).toBeUndefined();
  });

  /**
   * The state is reachable, with a deliberately malformed fixture.
   *
   * Driven through the same `parseScenario` call the registry makes, because the value the
   * registry stores *is* the loader's error list — a test that hand-wrote the errors would
   * be testing its own fixture. What this establishes is the shape #125's screen renders:
   * a JSON pointer at the offending value, and a catalogue key naming what is wrong with
   * it (never Ajv's English, which is neither translatable nor stable).
   */
  it('produces field-level errors a screen can render', () => {
    const valid = contractById('c01-shakedown');
    expect(valid).toBeDefined();

    const malformed = {
      ...(valid?.document as unknown as Record<string, unknown>),
      // A number where the schema wants one, made a string. Chosen because it is the
      // commonest real mistake in a hand-written contract and because the pointer to it is
      // nested, which is where a naive error message stops being useful.
      horizonSeconds: 'forty thousand',
    };

    const result = parseScenario(malformed);
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.errors.length).toBeGreaterThan(0);
    const first = result.errors[0];
    expect(first?.path).toMatch(/^\//);
    expect(first?.message.key).toMatch(/^scenario\.error\./);
  });
});
