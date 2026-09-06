/**
 * The Codex, minus the DOM — FR-903, FR-904, §8.3.10 (#161, #163).
 *
 * What an entry is, what it says, and what its numbers are. The screen that draws one
 * lives in `apps/web/src/codex/`, for the reason `planner/index.ts` gives: this package is
 * in the root TypeScript project, which has no DOM library, so everything reachable from
 * here is checked to run under Node — which is also what lets `figures.test.ts` check the
 * arithmetic without a browser.
 */
export type { CodexEntry, CodexEntryOf, CodexLayer } from './entry.js';
export { CODEX_LAYERS, OPEN_BY_DEFAULT, isCodexLayer, keysOf, resolveNumbers } from './entry.js';

export type {
  BurnsAndApsidesFigures,
  CostOfAltitudeFigures,
  DepartureTimingFigures,
  HohmannFigures,
  PhasingFigures,
  RendezvousFigures,
  TradeFigures,
} from './figures.js';
export {
  BURNS_AND_APSIDES_FIGURES,
  COST_OF_ALTITUDE_FIGURES,
  DEPARTURE_TIMING_FIGURES,
  GEO_RADIUS_M,
  HIGH_RADIUS_M,
  HOHMANN_FIGURES,
  LEO_RADIUS_M,
  PHASING_FIGURES,
  PHASING_GAIN_DEG,
  PHASING_REVOLUTIONS,
  PHASING_REVOLUTIONS_FAST,
  RENDEZVOUS_FIGURES,
  TRADE_FIGURES,
} from './figures.js';

export { CODEX_ENTRIES, entriesByAct, entryBySlug } from './entries.js';
