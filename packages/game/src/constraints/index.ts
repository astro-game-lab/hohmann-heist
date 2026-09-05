/**
 * Constraint evaluation — §6.5 and FR-107.
 *
 * The three constraints that are on from contract 01 — the Δv budget, the deadline, and
 * the altitude floor — plus the burn-count cap, which arrived with C04 as §6.5 says it
 * would. §6.5's remaining four — blackout, eclipse window, approach-speed cap, no-fly
 * shell — arrive with the contracts that first use them.
 *
 * Everything here runs **during planning**, on every plan change, not at commit. §6.5:
 * *"A player never discovers a constraint by failing it."* That is a statement about
 * when these functions are called, and it is why each is cheap and each is pure.
 */
export type { ConstraintEvaluation, ConstraintKind, ConstraintViolation } from './violation.js';
export { firstViolationEpoch, isViolated, mergeAbutting } from './violation.js';

export type { BudgetEvaluation, BudgetLevel } from './budget.js';
export { BUDGET_WARNING_FRACTION, evaluateBudget, totalDeltaV } from './budget.js';

export type { DeadlineEvaluation } from './deadline.js';
export { evaluateDeadline } from './deadline.js';

export type { AltitudeFloorEvaluation } from './altitude-floor.js';
export { evaluateAltitudeFloor } from './altitude-floor.js';

export type { BurnCountEvaluation } from './burn-count.js';
export { evaluateBurnCount } from './burn-count.js';
