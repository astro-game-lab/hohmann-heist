/**
 * The coach-mark vocabulary and the mark table — #159, #160.
 *
 * Two things worth testing here, and the second is the one that would rot silently.
 *
 * **The triggers latch.** A mark that appeared when the first node was placed and vanished
 * when the player deleted it would flicker through ordinary editing, and — because the mark
 * lives in a `role="status"` region — would make a screen reader announce it again on the
 * way back in. `latch` is the rule, and monotonicity is what the tests below are about.
 *
 * **The table and the catalogue agree.** `MarkKey` is derived from the catalogue, so a
 * string with no row does not compile. What the compiler cannot see is a row pointing at an
 * anchor `apps/web` never renders, or a contract declaring more marks than FR-902 allows —
 * the first is checked here against the closed anchor list, the second in `tools/content`
 * against the scenarios themselves.
 */
import { describe, expect, it } from 'vitest';

import { createCatalogue } from '../catalogue/resolve.js';

import { MARKS, MARK_ANCHORS, MARK_KEYS, MAX_MARKS_PER_CONTRACT, markByKey } from './marks.js';
import { MARK_TRIGGERS, NO_FACTS, fires, latch } from './triggers.js';
import type { MarkFacts, MarkTrigger } from './triggers.js';

const catalogue = createCatalogue();

const facts = (over: Partial<MarkFacts> = {}): MarkFacts => ({ ...NO_FACTS, ...over });

describe('the trigger vocabulary', () => {
  it('is five moments, and every one has a predicate', () => {
    expect(MARK_TRIGGERS).toHaveLength(5);
    for (const trigger of MARK_TRIGGERS) {
      // A predicate that threw or returned undefined for the empty facts would be a
      // trigger with no implementation, which `PREDICATES` being a total record prevents —
      // this is the runtime half of that.
      expect(typeof fires(trigger, NO_FACTS), trigger).toBe('boolean');
    }
  });

  it('opens a contract with the plan empty and nothing else', () => {
    const fired = MARK_TRIGGERS.filter((trigger) => fires(trigger, NO_FACTS));
    expect(fired).toStrictEqual(['planEmpty']);
  });

  it('fires firstNode once a node exists, and planEmpty stops being true', () => {
    expect(fires('firstNode', facts({ nodeCount: 1 }))).toBe(true);
    expect(fires('planEmpty', facts({ nodeCount: 1 }))).toBe(false);
  });

  /**
   * `onePlanNotEnough` is C02's moment, and it is about the *objective* rather than about
   * legality. A single burn on C02 is a perfectly legal plan that does not finish the job,
   * and a trigger written against `committable` would never fire on the contract it exists
   * for.
   */
  it('separates “one burn is legal” from “one burn is enough”', () => {
    expect(fires('onePlanNotEnough', facts({ nodeCount: 1, committable: true }))).toBe(true);
    expect(
      fires('onePlanNotEnough', facts({ nodeCount: 1, committable: true, objectiveMet: true })),
    ).toBe(false);
    // Two burns is no longer the moment, whatever the objective says.
    expect(fires('onePlanNotEnough', facts({ nodeCount: 2 }))).toBe(false);
  });

  it('fires planLegal when the plan would commit', () => {
    expect(fires('planLegal', facts({ nodeCount: 2 }))).toBe(false);
    expect(fires('planLegal', facts({ nodeCount: 2, committable: true }))).toBe(true);
  });

  /**
   * The regression this trigger was written wrong for, and it only showed in the browser.
   *
   * §6.4 keeps *Commit* enabled for a plan that will not achieve the objective — the reason
   * goes under the button rather than in front of it — so C01's **empty** plan is
   * committable from the moment the planner opens. A `planLegal` that read only
   * `committable` therefore fired before the player had done anything, and the mark it
   * showed talked about a plan that did not exist.
   */
  it('does not call an empty plan legal, even when the empty plan would commit', () => {
    expect(fires('planLegal', facts({ nodeCount: 0, committable: true }))).toBe(false);
    expect(fires('planLegal', facts({ nodeCount: 1, committable: true }))).toBe(true);
  });
});

describe('latching', () => {
  it('adds everything that has fired, not just the newest thing', () => {
    // One node and no objective met is two moments at once — the first burn exists, and it
    // is not going to be enough. Both latch; `useCoachMarks` picks between them by the
    // scenario's declaration order rather than by which fired last.
    const fired = latch(new Set<MarkTrigger>(), facts({ nodeCount: 1 }));
    expect([...fired].sort()).toStrictEqual(['firstNode', 'onePlanNotEnough']);
  });

  /** The whole point: deleting the node does not take the mark away. */
  it('never removes a trigger once it has fired', () => {
    const after = latch(new Set<MarkTrigger>(), facts({ nodeCount: 1 }));
    const back = latch(after, NO_FACTS);
    expect(back.has('firstNode')).toBe(true);
    expect(back.has('planEmpty')).toBe(true);
  });

  /**
   * Identity, not just equality.
   *
   * The planner calls this on every scrub, and the hook holding the result in state relies
   * on an unchanged set being the *same* set — `setState` bails out on identity, and a new
   * `Set` with the same contents would re-render the planner on every frame of a drag.
   */
  it('returns the same set when nothing new fired', () => {
    const fired = latch(new Set<MarkTrigger>(), facts({ nodeCount: 1 }));
    expect(latch(fired, facts({ nodeCount: 2 }))).toBe(fired);
  });

  it('accumulates across a whole session', () => {
    let fired: ReadonlySet<MarkTrigger> = new Set<MarkTrigger>();
    fired = latch(fired, NO_FACTS);
    fired = latch(fired, facts({ nodeCount: 1, nodeSelected: true }));
    fired = latch(fired, facts({ nodeCount: 2, committable: true }));
    expect([...fired].sort()).toStrictEqual(
      ['firstNode', 'nodeSelected', 'onePlanNotEnough', 'planEmpty', 'planLegal'].sort(),
    );
  });
});

describe('the mark table', () => {
  it('is eight marks, within FR-902’s ceiling of three per contract', () => {
    expect(MARK_KEYS).toHaveLength(8);
    expect(MAX_MARKS_PER_CONTRACT).toBe(3);

    // Grouped by the contract in the key, which is how the scenarios declare them. The
    // per-contract cap is enforced against the scenario files in `tools/content`; this is
    // the table's own half of the same rule.
    const perContract = new Map<string, number>();
    for (const key of MARK_KEYS) {
      const contract = key.split('.')[1] ?? '';
      perContract.set(contract, (perContract.get(contract) ?? 0) + 1);
    }
    expect([...perContract.keys()].sort()).toStrictEqual(['c01', 'c02', 'c03', 'c04']);
    for (const [contract, count] of perContract) {
      expect(count, contract).toBeLessThanOrEqual(MAX_MARKS_PER_CONTRACT);
    }
  });

  it('files every mark under its own key', () => {
    for (const [key, spec] of Object.entries(MARKS)) {
      expect(spec.key, key).toBe(key);
    }
  });

  /**
   * An anchor outside the closed list is a mark that would dock instead of pointing —
   * silently, because `CoachMark` treats a missing anchor as "not on screen right now",
   * which is a legitimate state it must not confuse with a typo.
   */
  it('anchors every mark to one of the five named regions', () => {
    for (const spec of Object.values(MARKS)) {
      expect(MARK_ANCHORS, spec.key).toContain(spec.anchor);
    }
  });

  it('triggers every mark from the vocabulary', () => {
    for (const spec of Object.values(MARKS)) {
      expect(MARK_TRIGGERS, spec.key).toContain(spec.trigger);
    }
  });

  it('resolves every mark’s text, and says something with it', () => {
    for (const key of MARK_KEYS) {
      expect(catalogue.has(key), key).toBe(true);
      expect(catalogue.resolveDynamic(key).trim(), key).not.toBe('');
    }
  });

  /**
   * #160's writing rule, as far as a test can carry it: *"a mark that needs two sentences
   * is two marks or is a Codex entry"* — read as an upper bound rather than a count, since
   * two short sentences are how most of these read best. The rule a reviewer still has to
   * apply by hand is the one above it: **a mark names the concept and never the answer.**
   */
  it('keeps every mark short', () => {
    for (const key of MARK_KEYS) {
      const text = catalogue.resolveDynamic(key);
      expect(text.length, key).toBeLessThanOrEqual(160);
      expect(text.split('.').filter((part) => part.trim() !== '').length, key).toBeLessThanOrEqual(
        2,
      );
    }
  });

  it('looks a mark up by a key out of a scenario file, and nothing else', () => {
    expect(markByKey('mark.c01.oppositeSide')).toBe(MARKS['mark.c01.oppositeSide']);
    expect(markByKey('mark.c09.invented')).toBeUndefined();
    expect(markByKey('toString')).toBeUndefined();
  });
});
