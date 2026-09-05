/**
 * The burn-count cap — §6.5, FR-107, and the first of §6.5's five deferred constraints.
 *
 * > *Burn count | Operational complexity | **Soft cap; exceeding it forfeits Gold** |
 * > First seen C04*
 *
 * ## Soft means soft, and it is worth being precise about what that buys
 *
 * Every other constraint in this directory can stop a plan. This one cannot, and the
 * absence is structural rather than a policy someone has to remember: §6.4's legality
 * codes are `L1`–`L6` and **none of them is a burn count**, so `evaluateLegality` has
 * nowhere to put a blocking reason for it even if a future edit wanted one. Adding an
 * `L7` would be the change to argue about; until then a plan over the cap commits.
 *
 * What the cap does instead is cost the player Gold, and it does that through a rule
 * that already exists. §6.7's Gold requires `burn count ≤ par_burns`, so a contract
 * publishes the *same* number here that its par carries and the cap becomes the
 * **visible** form of a threshold the medal ladder was already applying silently. That
 * is the whole point of declaring it: §6.5's closing line is *"a player never discovers
 * a constraint by failing it"*, and a Gold threshold nobody was shown is exactly that
 * discovery. Nothing in `outcome.ts` changes, and nothing should — a second medal rule
 * reading this cap would be two thresholds that can disagree.
 *
 * ## Why it has intervals at all
 *
 * FR-107 asks every constraint for violating intervals rather than a boolean, and the
 * budget's docstring makes the argument this one reuses: the cap is exceeded **from the
 * burn that crosses it onward**, which is a real epoch and draws as a band covering the
 * part of the plan that costs the medal. It tells the player *which* burn was the one
 * too many, which "4 of 3 burns" does not.
 *
 * ## A contract with no cap is not a contract with an infinite one
 *
 * {@link evaluateBurnCount} takes `maxBurns` as `undefined` for a scenario that declares
 * no cap and reports no violations and a `null` cap. The distinction reaches the HUD:
 * there is nothing to draw for a contract that never had a cap, whereas a cap of three
 * with three burns used is a thing to show at rest.
 */
import type { Epoch } from '@hh/astro';
import type { Timeline } from '@hh/sim';

import type { ConstraintEvaluation, ConstraintViolation } from './violation.js';

export interface BurnCountEvaluation extends ConstraintEvaluation {
  readonly kind: 'burn_count';
  /** Burns in the plan. */
  readonly burns: number;
  /** The contract's published cap, or `null` when it declares none. */
  readonly maxBurns: number | null;
  /** `max - burns`. Negative when over. `null` when there is no cap. */
  readonly remaining: number | null;
  /** Whether the plan is over the cap. `false` when there is no cap. */
  readonly exceeded: boolean;
  /** Index of the burn that crossed the cap, or `null`. */
  readonly exceededAtNode: number | null;
}

/**
 * Evaluate the burn-count cap against a timeline.
 *
 * Pure, and cheap: it counts nodes. Called on every plan change like every other
 * constraint (§6.5), never only at commit.
 */
export const evaluateBurnCount = (
  timeline: Timeline,
  maxBurns: number | undefined,
): BurnCountEvaluation => {
  const nodes = timeline.plan.nodes;
  const burns = nodes.length;

  if (maxBurns === undefined) {
    return {
      kind: 'burn_count',
      burns,
      maxBurns: null,
      remaining: null,
      exceeded: false,
      exceededAtNode: null,
      violations: [],
    };
  }

  // The first burn past the cap is at index `maxBurns` — the (max + 1)th node.
  const offending = burns > maxBurns ? nodes[maxBurns] : undefined;
  const exceededAtEpoch: Epoch | null = offending?.epoch ?? null;

  const violations: readonly ConstraintViolation[] =
    exceededAtEpoch === null
      ? []
      : [
          {
            kind: 'burn_count',
            start: exceededAtEpoch,
            end: timeline.horizon,
            clippedStart: false,
            // Every burn after the cap is also over it, so the band runs to the horizon
            // and is clipped there rather than ending there — the budget's reasoning.
            clippedEnd: true,
          },
        ];

  return {
    kind: 'burn_count',
    burns,
    maxBurns,
    remaining: maxBurns - burns,
    exceeded: exceededAtEpoch !== null,
    exceededAtNode: exceededAtEpoch === null ? null : maxBurns,
    violations,
  };
};
