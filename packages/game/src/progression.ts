/**
 * Which contracts are open — FR-303, §6.8, §8.3.2.
 *
 * > *An act opens when ⌈2/3⌉ of the previous act's contracts have Bronze.* — §6.8
 *
 * And, in the same paragraph and more important than the rule itself: *"Progression gates
 * on **Bronze count**, never on Gold, so a player is never blocked by an optimisation they
 * cannot find."* Everything here follows from that sentence. A player who can complete a
 * contract can always continue; the medals above Bronze are for them, not for the gate.
 *
 * ## Bronze is a floor, not an equality
 *
 * §6.7's medals are cumulative — *"earning Gold does not remove Bronze"* — and the save
 * stores only the **highest** medal earned. So "has Bronze" is a rank comparison, not
 * `medal === 'bronze'`. A save full of Golds has every contract Bronzed, and an
 * implementation that tested for equality would lock a strong player out of Act II.
 *
 * ## The contract list is an argument, and it has to be
 *
 * `@hh/game` may never import from `apps/web` (§11.1), and the contract registry lives
 * there. That constraint turns out to be the right shape anyway: the threshold is computed
 * from the contracts **actually registered**, so shipping Acts I–II alone cannot lock Act
 * III behind contracts that do not exist yet. §14.1 ships content act by act, so a rule
 * written against §6.8's eventual eighteen would be wrong in every milestone before the
 * last one.
 *
 * ## What "next" means
 *
 * §8.3.2 puts the `NEXT` marker on *"the first unstarted unlocked contract"* and lands
 * keyboard focus there. Unstarted is stronger than unfinished: a contract the player has
 * attempted and not beaten is not where the board should be pointing them, because they
 * already know where it is. When everything unlocked has been attempted, this falls back
 * to the first without Bronze — still somewhere to go — and only when every unlocked
 * contract is Bronzed does it report nothing.
 */
import type { Medal } from './outcome.js';

/** A contract, as progression needs to see it. */
export interface ProgressionContract {
  readonly id: string;
  /** §6.8's act number, 1-based. */
  readonly act: number;
  /** Position within the act, 1-based. Orders the board within a row. */
  readonly index: number;
}

/** What the save knows about one contract (§11.7). */
export interface ContractRecord {
  /** The highest medal earned, or absent for a contract never completed. */
  readonly medal?: Medal;
  /** Counts every accepted briefing, so it is ≥ 1 for anything started. */
  readonly attempts?: number;
}

/** §6.7's ladder, worst to best. Shared with the save's own ordering. */
const MEDAL_RANK: Readonly<Record<Medal, number>> = Object.freeze({
  bronze: 0,
  silver: 1,
  gold: 2,
  clean: 3,
});

/**
 * Whether a record counts toward a Bronze threshold.
 *
 * Any medal does. See the docstring on why this is a floor rather than an equality.
 */
export const hasBronze = (record: ContractRecord | undefined): boolean =>
  record?.medal !== undefined && MEDAL_RANK[record.medal] >= MEDAL_RANK.bronze;

/** Whether the player has ever accepted this contract's briefing. */
const isStarted = (record: ContractRecord | undefined): boolean => (record?.attempts ?? 0) > 0;

/**
 * §6.8's threshold for an act: ⌈2/3⌉ of its contracts.
 *
 * Over the contracts **shipped** in that act, not over what §6.8 eventually plans. Act I
 * has four, so Act II needs three; Act II has three, so Act III needs two.
 */
export const bronzeThreshold = (contractsInAct: number): number =>
  Math.ceil((contractsInAct * 2) / 3);

/** Why a contract cannot be opened yet, as a fact the UI turns into a sentence. */
export interface LockReason {
  /** The act that must be advanced first. */
  readonly requiredAct: number;
  /** How many of it need Bronze. */
  readonly required: number;
  /** How many have it now. */
  readonly earned: number;
}

/** One act's state, in the order §8.3.2 draws them. */
export interface ActProgress {
  readonly act: number;
  readonly contracts: readonly string[];
  /** Contracts in this act with at least Bronze. §8.3.2's "4/4". */
  readonly bronzed: number;
  readonly unlocked: boolean;
  /** Absent when the act is open. */
  readonly lock?: LockReason;
}

export interface Progression {
  /** Per contract id: whether it is open, and why not when it is not. */
  readonly unlocked: Readonly<Record<string, boolean>>;
  readonly locks: Readonly<Record<string, LockReason>>;
  /** Acts in ascending order, each with its counts. */
  readonly acts: readonly ActProgress[];
  /** §8.3.2's `NEXT`. `null` when every unlocked contract is Bronzed. */
  readonly next: string | null;
}

/**
 * Work out what is open.
 *
 * Pure and total: no clock, no randomness, no ambient state. Given the same contracts and
 * the same records it returns the same answer, which is what lets the board and a
 * direct-URL guard share one call rather than two rules that can disagree.
 */
export const progression = (
  contracts: readonly ProgressionContract[],
  records: Readonly<Record<string, ContractRecord>>,
): Progression => {
  // Ordered by act then index, so everything below iterates in board order (NFR-009: no
  // iteration over unordered containers where the order affects the result).
  const ordered = [...contracts].sort((a, b) => a.act - b.act || a.index - b.index);

  const actNumbers = [...new Set(ordered.map((contract) => contract.act))].sort((a, b) => a - b);

  const bronzedIn = new Map<number, number>();
  for (const act of actNumbers) {
    const inAct = ordered.filter((contract) => contract.act === act);
    bronzedIn.set(act, inAct.filter((contract) => hasBronze(records[contract.id])).length);
  }

  const unlocked: Record<string, boolean> = {};
  const locks: Record<string, LockReason> = {};
  const acts: ActProgress[] = [];

  for (const [position, act] of actNumbers.entries()) {
    const inAct = ordered.filter((contract) => contract.act === act);

    // The *previous shipped act*, not `act - 1`. A milestone that ships Acts I and III
    // with II still to come would otherwise gate III on an act with no contracts, whose
    // threshold is zero, silently opening it.
    const previous = position === 0 ? undefined : actNumbers[position - 1];

    let lock: LockReason | undefined;
    if (previous !== undefined) {
      const required = bronzeThreshold(
        ordered.filter((contract) => contract.act === previous).length,
      );
      const earned = bronzedIn.get(previous) ?? 0;
      if (earned < required) lock = { requiredAct: previous, required, earned };
    }

    for (const contract of inAct) {
      unlocked[contract.id] = lock === undefined;
      if (lock !== undefined) locks[contract.id] = lock;
    }

    acts.push({
      act,
      contracts: inAct.map((contract) => contract.id),
      bronzed: bronzedIn.get(act) ?? 0,
      unlocked: lock === undefined,
      ...(lock === undefined ? {} : { lock }),
    });
  }

  const open = ordered.filter((contract) => unlocked[contract.id] === true);
  const next =
    open.find((contract) => !isStarted(records[contract.id]))?.id ??
    open.find((contract) => !hasBronze(records[contract.id]))?.id ??
    null;

  return Object.freeze({
    unlocked: Object.freeze(unlocked),
    locks: Object.freeze(locks),
    acts: Object.freeze(acts),
    next,
  });
};

/** Whether one contract may be opened. The guard a direct URL is checked against (§8.3.3). */
export const isUnlocked = (
  contracts: readonly ProgressionContract[],
  records: Readonly<Record<string, ContractRecord>>,
  id: string,
): boolean => progression(contracts, records).unlocked[id] === true;
