/**
 * §6.10's career total — #119.
 *
 * > *Deliberately thin. Contracts pay a **fee** in credits; credits do nothing except
 * > appear on your record and rank your career total. There is no shop, no upgrades, no
 * > unlockable hardware.*
 *
 * So this is a sum, and the whole design intent is that it stays one. Nothing reads the
 * result, no rule branches on it, and there is no threshold anywhere in the game that a
 * player could be short of. It is flavour with a number attached, and it is in its own
 * module rather than inline in the board because a sum with a stated rule about *which*
 * contracts count is worth a test.
 *
 * ## Completed, not attempted
 *
 * A fee is paid for a job done. `firstCompletedAt` is the field that means "this contract
 * was once flown successfully" — `app.tsx`'s `withResult` writes it on any successful run
 * and never on a failed one — so it is the marker, rather than `medal`, which is absent for
 * a success that earned none, or `attempts`, which counts accepting a briefing and walking
 * away.
 *
 * ## A contract with no fee pays nothing
 *
 * `fee_kcr` is optional in the scenario schema (*"Omitted when the contract pays nothing"*),
 * and an absent fee is zero rather than a reason to skip the row. That distinction does not
 * matter for the sum and does for the reading: a contract that pays nothing is still
 * completed, and a future "3 of 7 paid" readout should not have to rediscover the rule.
 */
import type { LoadedScenario } from '@hh/game';

import type { ContractProgress } from '../save/index.js';

/** Whether a contract has been flown to a successful conclusion at least once. */
export const isCompleted = (progress: ContractProgress | undefined): boolean =>
  progress?.firstCompletedAt !== undefined;

/**
 * The career total, in kilocredits.
 *
 * Iterates the contracts in the order it is given them, which `contracts()` has already
 * sorted by act and index — NFR-009's rule holds trivially for a sum, and holding it
 * anyway means the eventual per-act breakdown does not have to re-establish it.
 */
export const careerCredits = (
  scenarios: readonly LoadedScenario[],
  records: Readonly<Record<string, ContractProgress>>,
): number =>
  scenarios.reduce(
    (total, scenario) =>
      isCompleted(records[scenario.id]) ? total + (scenario.document.fee_kcr ?? 0) : total,
    0,
  );
