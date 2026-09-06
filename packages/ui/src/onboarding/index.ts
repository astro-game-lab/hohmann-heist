/**
 * Coach marks, minus the DOM — FR-902, §8.6 (#159, #160).
 *
 * What a mark says, where it points, and when it appears. The component that draws one
 * lives in `apps/web/src/onboarding/`, for the reason `planner/index.ts` gives: this
 * package sits in the root TypeScript project, which has no DOM library, so everything
 * reachable from here is checked to run under Node.
 */
export type { MarkAnchor, MarkKey, MarkSpec } from './marks.js';
export { MARKS, MARK_ANCHORS, MARK_KEYS, MAX_MARKS_PER_CONTRACT, markByKey } from './marks.js';

export type { MarkFacts, MarkTrigger } from './triggers.js';
export { MARK_TRIGGERS, NO_FACTS, fires, latch } from './triggers.js';
