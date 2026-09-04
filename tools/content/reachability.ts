/**
 * §6.8's unlock rule, as something a test can ask questions of — §13.4's reachability
 * check.
 *
 * > *Unlock rule: an act opens when ⌈2/3⌉ of the previous act's contracts have Bronze.*
 *
 * §13.4 asks that every shipped contract be "unlockable by a player following the
 * progression rules". That is a statement about a **graph**, not about a contract: whether
 * C09 can be reached depends on how many act II contracts exist, and a check that looked
 * at C09 alone could only ever say yes.
 *
 * ## Why this lives in `tools/` and not in `@hh/game`
 *
 * Progression — medals, Bronze counts, the unlock state machine, the save data behind it —
 * is **#82, in M3**. This module is not that: it is the acyclic question "given this set of
 * files, is each one reachable", with no medals, no save data and no player. When #82
 * lands, the rule moves into `@hh/game` beside the rest of progression and this becomes a
 * caller of it, so that the game and the content suite cannot disagree about what opens
 * an act. Until then the rule is written once, here, and tested on its own in
 * `reachability.test.ts` — because a check that is trivially satisfied by today's content
 * is a check that will still be trivially satisfied when it stops being true.
 *
 * ## What the model says, precisely
 *
 * A player is assumed to Bronze anything they can play, which is the right assumption for
 * a *reachability* question — whether they can beat it is §13.4's solvability check, one
 * row up. From there:
 *
 * - **Act 1 is open at game start.** Nothing gates it.
 * - **Act *k* opens** once ⌈2/3⌉ of act *k*−1's shipped contracts are Bronzed. The
 *   denominator is what *ships*, not §6.8's designed act sizes: the game gates on the
 *   content it has, and a rule written against a table would be a copy of `docs/PRODUCT.md`
 *   living in code — which §7.6's process rule and `CLAUDE.md` both rule out.
 * - **`unlocks` adds explicit edges** on top of the act gate. Completing a contract opens
 *   everything it names, whatever act that is in.
 *
 * The consequence worth stating: with sparse content the act gate is easy to satisfy — one
 * shipped act-I contract opens act II, because ⌈2/3 × 1⌉ is 1. That is not the check being
 * weak, it is the model being accurate: with one act-I contract, beating it really would
 * open act II. What the check catches is content that is *stranded* — an act with no
 * predecessor shipped at all, an `unlocks` edge pointing at a contract that does not exist,
 * a contract nothing can ever open — and it gets stricter on its own as acts fill in.
 */

/** The first act, open from a cold start. */
export const FIRST_ACT = 1;

/**
 * How many Bronze medals in act *k*−1 open act *k*.
 *
 * `⌈2n/3⌉`, not `⌈n × (2/3)⌉`. The two are the same in exact arithmetic and not in
 * float64: `2/3` is not representable, so `3 * (2/3)` is 1.9999999999999998 and `6 * (2/3)`
 * is 3.9999999999999996 — both happen to ceil correctly here, and both are one refactor
 * away from not doing. Dividing an integer product keeps the result exact for every act
 * size that will ever exist.
 */
export const bronzeGateFor = (contractsInPreviousAct: number): number =>
  Math.ceil((2 * contractsInPreviousAct) / 3);

/** The part of a contract progression cares about. */
export interface ProgressionContract {
  readonly id: string;
  readonly act: number;
  readonly index: number;
  /** Contracts this one opens directly, whatever act they are in. */
  readonly unlocks: readonly string[];
}

/** An `unlocks` entry naming a contract that does not ship. */
export interface DanglingUnlock {
  readonly from: string;
  readonly to: string;
}

export interface ReachabilityReport {
  /** Contracts a player can get to, in the order the walk reached them. */
  readonly reachable: readonly string[];
  /** Contracts nothing opens. Empty is what §13.4 asks for. */
  readonly unreachable: readonly string[];
  readonly danglingUnlocks: readonly DanglingUnlock[];
  /** Bronze medals each act beyond the first needs, given what ships. */
  readonly gates: ReadonlyMap<number, number>;
  /** Acts the walk managed to open. */
  readonly openActs: readonly number[];
}

/**
 * Walk the progression graph and report what a player can get to.
 *
 * A fixpoint rather than a single pass: opening an act makes its contracts playable, which
 * Bronzes them, which can open the next act *and* fire their `unlocks` edges, which can
 * open something in a much later act. Iterating until nothing changes is the only way to
 * get that right without assuming the graph is layered — and `unlocks` exists precisely so
 * that it need not be.
 *
 * Contracts are processed in `(act, index, id)` order at every step, so the reported order
 * is a property of the content rather than of the directory listing (NFR-009).
 */
export const analyseProgression = (
  contracts: readonly ProgressionContract[],
): ReachabilityReport => {
  const ordered = [...contracts].sort(
    (a, b) => a.act - b.act || a.index - b.index || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const known = new Set(ordered.map((contract) => contract.id));

  const danglingUnlocks: DanglingUnlock[] = ordered.flatMap((contract) =>
    contract.unlocks
      .filter((target) => !known.has(target))
      .map((target) => ({ from: contract.id, to: target })),
  );

  const byAct = new Map<number, ProgressionContract[]>();
  for (const contract of ordered) {
    const act = byAct.get(contract.act) ?? [];
    act.push(contract);
    byAct.set(contract.act, act);
  }
  const acts = [...byAct.keys()].sort((a, b) => a - b);

  const gates = new Map<number, number>();
  for (const act of acts) {
    if (act === FIRST_ACT) continue;
    gates.set(act, bronzeGateFor((byAct.get(act - 1) ?? []).length));
  }

  const openActs = new Set<number>([FIRST_ACT]);
  const unlocked = new Set<string>();
  const bronzed = new Set<string>();
  const order: string[] = [];

  for (;;) {
    let changed = false;

    for (const contract of ordered) {
      if (bronzed.has(contract.id)) continue;
      if (!openActs.has(contract.act) && !unlocked.has(contract.id)) continue;
      bronzed.add(contract.id);
      order.push(contract.id);
      for (const target of contract.unlocks) unlocked.add(target);
      changed = true;
    }

    for (const act of acts) {
      if (openActs.has(act)) continue;
      const previous = byAct.get(act - 1);
      // An act whose predecessor ships nothing has no gate that can ever be met. Skipped
      // rather than treated as open: that is exactly the stranded content this check is
      // for, and opening it by default would hide it.
      if (previous === undefined || previous.length === 0) continue;
      const earned = previous.filter((contract) => bronzed.has(contract.id)).length;
      if (earned >= bronzeGateFor(previous.length)) {
        openActs.add(act);
        changed = true;
      }
    }

    if (!changed) break;
  }

  return {
    reachable: order,
    unreachable: ordered.filter((c) => !bronzed.has(c.id)).map((c) => c.id),
    danglingUnlocks,
    gates,
    openActs: [...openActs].sort((a, b) => a - b),
  };
};
