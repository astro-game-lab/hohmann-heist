/**
 * `@hh/astro` — constants, time, frames, orbital elements, Kepler and Lambert solvers.
 *
 * **Layer: core.** Must not import from `@hh/game`, `@hh/render`, `@hh/ui`, or `apps/*`,
 * and must not reference `document`, `window`, `Date.now`, `performance.now`,
 * `Math.random`, `fetch`, or `process`. It runs unchanged under Node, a browser, and a
 * Cloudflare Worker.
 *
 * See `docs/PRODUCT.md` §11.1 (architecture and the layering rule) and §11.2
 * (package responsibilities).
 */

/** Package identity. */
export const PACKAGE = '@hh/astro' as const;

export { AU, J2_EARTH, MU_EARTH, OMEGA_EARTH, R_EARTH_EQ, R_GEO } from './constants.js';

export type { CalendarDate, Epoch, Met } from './time.js';
export {
  addSeconds,
  differenceSeconds,
  epoch,
  epochAtMet,
  formatMet,
  fromCalendarTAI,
  fromJulianDateTT,
  J2000,
  J2000_JD_TT,
  met,
  metAt,
  SECONDS_PER_DAY,
  toCalendarTAI,
  toJulianDateTAI,
  toJulianDateTT,
  TT_MINUS_TAI,
} from './time.js';

export type { EciVector, Framed, PqwVector, RtnVector } from './frames.js';
export {
  eci,
  eciToPqw,
  eciToRtnMatrix,
  fromRtn,
  inertialToPerifocalMatrix,
  perifocalToInertialMatrix,
  pqw,
  pqwToEci,
  rtn,
  rtnToEciMatrix,
  toRtn,
} from './frames.js';

export type { ClassicalElements, Degeneracy, OrbitShape, State } from './elements.js';
export {
  apoapsisRadius,
  CIRCULAR_TOLERANCE,
  elementsFromState,
  EQUATORIAL_TOLERANCE,
  periapsisRadius,
  semiMajorAxis,
  specificAngularMomentum,
  stateFromElements,
} from './elements.js';

export type { EquinoctialElements } from './equinoctial.js';
export {
  classicalFromEquinoctial,
  eccentricity,
  equinoctialFromClassical,
  equinoctialFromState,
  inclination,
  stateFromEquinoctial,
} from './equinoctial.js';

export type { BiEllipticTransfer, HohmannTransfer } from './twobody.js';
export {
  biEllipticTransfer,
  circularSpeed,
  escapeSpeed,
  hohmannTransfer,
  meanMotion,
  period,
  specificEnergy,
  visVivaSpeed,
} from './twobody.js';

export type { KeplerMethod, KeplerOptions, KeplerResult } from './kepler.js';
export { solveBarker, solveKeplerElliptic, solveKeplerHyperbolic } from './kepler.js';

export type { LambertMethod, LambertOptions, LambertResult, TransferDirection } from './lambert.js';
export { solveLambert, stumpffC, stumpffS } from './lambert.js';

export {
  eccentricFromTrue,
  hyperbolicFromTrue,
  meanFromEccentric,
  meanFromHyperbolic,
  trueFromEccentric,
  trueFromHyperbolic,
} from './anomaly.js';
