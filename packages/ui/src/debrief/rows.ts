/**
 * The debrief's result table, as data — §8.3.9, FR-304, #121.
 *
 * §8.3.9's success block is a small table:
 *
 * ```
 *             YOU          PAR        BEST KNOWN
 *  Δv        72.4 m/s     72.0        72.0            +0.6%
 *  time      12h 09m      12h 10m     12h 10m         −0.1%
 *  burns     2            2
 *  closest   0.31 km      (needed ≤ 1.00 km)
 * ```
 *
 * This module decides *which rows exist and what is in them*; the component draws them
 * and the catalogue words them. That split is `readouts.ts`'s, for the same reason: the
 * interesting decisions here are which comparisons are meaningful for this run, and
 * they are answerable without a DOM.
 *
 * ## Everything is SI, and stays SI
 *
 * Metres, seconds, metres per second, out. Not kilometres and not `"12h 09m"` — the
 * separator, the grouping and the unit's position all change with the locale, and
 * `catalogue/types.ts` spends a page on why that cannot live in a component. A `toFixed`
 * in this file would be a bug; there is none, and there is nothing for one to act on.
 *
 * ## What "BEST KNOWN" is
 *
 * §8.3.9's mock shows PAR and BEST KNOWN carrying the same numbers, which reads two
 * ways. It is taken here as **the player's own best recorded run** (FR-302 stores
 * exactly `bestDv_mps` and `bestTime_s` per contract), for one reason: under the other
 * reading it is par — DEP-12 already calls par *"the best known, not the proven
 * optimum"* — and a column that is always identical to the one beside it carries no
 * information. The mock's two columns agree because the player in it had previously
 * matched par, which is what the mock is depicting.
 *
 * It is therefore `null` on a first completion, and the row renders an em dash rather
 * than repeating par. That absence is itself informative: it says this is the first
 * time.
 *
 * ## A failed run has no table
 *
 * §8.3.9: *"the same layout, with the result block replaced by the diagnosis"*. So
 * {@link resultRows} produces the comparison table and {@link missRows} produces the
 * failure block, and they are separate functions rather than one function with a mode —
 * the two have different rows, not the same rows with different values. Asking for the
 * wrong one is then a call that does not exist rather than a table full of nulls.
 */
import type { Outcome, ProximityEvaluation } from '@hh/game';
import { isProximityEvaluation } from '@hh/game';

/**
 * Which quantity a row is about. Drives the row's label key and its unit.
 *
 * Named for the debrief rather than generically, because `@hh/ui` already has a
 * `ResultRow` — the node editor's before/after comparison (#137) — and one barrel
 * cannot export two. The collision is a useful signal rather than an annoyance: these
 * are different tables and sharing a name would invite sharing a component.
 */
export type DebriefQuantity = 'deltaV' | 'time' | 'burns';

/**
 * One row of §8.3.9's comparison table.
 *
 * `par` is never `null` — every contract publishes one (§6.7) — while `best` is, and
 * `deltaFraction` is `null` wherever a comparison would be a division by zero or a
 * statement about a quantity that has no percentage worth showing.
 */
export interface DebriefRow {
  readonly quantity: DebriefQuantity;
  /** This run, in SI: metres per second, seconds, or a count. */
  readonly you: number;
  readonly par: number;
  /** The player's best previous run, or `null` on a first completion. */
  readonly best: number | null;
  /** Signed fraction against par. Positive is worse. `null` where there is none to show. */
  readonly deltaFraction: number | null;
}

/** The player's best previous run, as the save records it (FR-302, §11.7). */
export interface PersonalBest {
  readonly dvMps?: number;
  readonly timeSeconds?: number;
  readonly burns?: number;
}

/**
 * §8.3.9's comparison table for a successful run.
 *
 * Three rows, always, in the order the mock draws them. The burns row deliberately has
 * no percentage: §8.3.9 shows none, and a percentage on a count of two is a number
 * pretending to be a measurement — "+50%" for three burns against a par of two says
 * less than "3" next to "2".
 */
export const resultRows = (outcome: Outcome, best: PersonalBest = {}): readonly DebriefRow[] => {
  const rows: DebriefRow[] = [
    {
      quantity: 'deltaV',
      you: outcome.dvUsedMps,
      par: outcome.par.dvMps,
      best: best.dvMps ?? null,
      deltaFraction: outcome.parDelta?.dvFraction ?? null,
    },
  ];

  // The time row exists only when there is a time: a run that never met the objective
  // has no elapsed time to compare, and this function is not called for one anyway.
  if (outcome.metSeconds !== null) {
    rows.push({
      quantity: 'time',
      you: outcome.metSeconds,
      par: outcome.par.timeSeconds,
      best: best.timeSeconds ?? null,
      deltaFraction: outcome.parDelta?.timeFraction ?? null,
    });
  }

  rows.push({
    quantity: 'burns',
    you: outcome.burns,
    par: outcome.par.burns,
    best: best.burns ?? null,
    deltaFraction: null,
  });

  return Object.freeze(rows);
};

/**
 * §8.3.9's closest-approach line, which sits under the table on a success and inside
 * the diagnosis block on a failure.
 *
 * `null` for an objective that is not about proximity: a `reach_orbit` contract has no
 * encounter, and a row reading "closest — n/a" would be worse than no row.
 */
export interface ApproachSummary {
  readonly achievedM: number;
  readonly neededM: number;
  readonly epochSeconds: number;
  readonly relativeSpeedMps: number;
  readonly met: boolean;
}

/** The encounter, when the contract has one. */
export const approachSummary = (
  outcome: Outcome,
  startEpochSeconds: number,
): ApproachSummary | null => {
  const { objective } = outcome;
  // Only an encounter with a second body has a range and a relative speed. `reach_orbit`
  // compares element sets and `station` measures a longitude, and neither has a closest
  // approach to summarise — so this is a predicate rather than a test against one kind,
  // which is what stopped being correct when §6.4's fifth type landed (#77).
  if (objective === null || !isProximityEvaluation(objective)) return null;

  const proximity: ProximityEvaluation = objective;
  return Object.freeze({
    achievedM: proximity.achieved.rangeM,
    neededM: proximity.tolerance.maxRangeM,
    epochSeconds: proximity.achieved.epoch - startEpochSeconds,
    relativeSpeedMps: proximity.achieved.relativeSpeedMps,
    met: proximity.met,
  });
};

/** One line of §8.3.9's failure block. */
export type MissQuantity = 'closest' | 'needed' | 'deltaV';

/** A labelled quantity in the failure block, in SI. */
export interface MissRow {
  readonly quantity: MissQuantity;
  readonly value: number;
  /** Mission elapsed seconds the value was achieved at, where that means something. */
  readonly epochSeconds: number | null;
  /** The cap the value is measured against, where there is one. */
  readonly limit: number | null;
}

/**
 * §8.3.9's failure block: *"closest approach achieved, what was needed, Δv used"*.
 *
 * These are #121's second criterion verbatim, and they are the whole block when no
 * diagnosis rule matched — which FR-307 makes the correct behaviour rather than a
 * shortfall. **A confident wrong explanation is worse than none.**
 */
export const missRows = (outcome: Outcome, startEpochSeconds: number): readonly MissRow[] => {
  const rows: MissRow[] = [];
  const approach = approachSummary(outcome, startEpochSeconds);

  if (approach !== null) {
    rows.push({
      quantity: 'closest',
      value: approach.achievedM,
      epochSeconds: approach.epochSeconds,
      limit: null,
    });
    rows.push({
      quantity: 'needed',
      value: approach.neededM,
      epochSeconds: null,
      limit: null,
    });
  }

  rows.push({
    quantity: 'deltaV',
    value: outcome.dvUsedMps,
    epochSeconds: null,
    limit: outcome.dvBudgetMps,
  });

  return Object.freeze(rows);
};
