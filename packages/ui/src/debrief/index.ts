/**
 * The debrief's DOM-free logic — §8.3.9, #121.
 *
 * Which rows the result table has and what is in them, in SI. The screen that draws
 * them is `apps/web/src/debrief/`, and the words are the catalogue's.
 */
export type {
  ApproachSummary,
  DebriefQuantity,
  DebriefRow,
  MissQuantity,
  MissRow,
  PersonalBest,
} from './rows.js';
export { approachSummary, missRows, resultRows } from './rows.js';
