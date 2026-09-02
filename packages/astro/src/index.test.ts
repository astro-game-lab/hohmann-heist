import { describe, expect, it } from 'vitest';

import * as astro from './index.js';

/**
 * The package's public surface.
 *
 * This list exists because it was once wrong and nothing noticed: `time`, `frames`,
 * `kepler` and `anomaly` all shipped without being re-exported from the index, and
 * every test imported the modules directly, so `@hh/astro` looked healthy while
 * exporting only its constants. The first real consumer found it.
 *
 * Update this list deliberately when the surface changes. A barrel that drifts from
 * its modules is invisible to every test that does not go through it.
 */
const EXPECTED = [
  'PACKAGE',
  // constants
  'AU',
  'J2_EARTH',
  'MU_EARTH',
  'OMEGA_EARTH',
  'R_EARTH_EQ',
  'R_GEO',
  // time
  'J2000',
  'J2000_JD_TT',
  'SECONDS_PER_DAY',
  'TT_MINUS_TAI',
  'addSeconds',
  'differenceSeconds',
  'epoch',
  'epochAtMet',
  'formatMet',
  'fromCalendarTAI',
  'fromJulianDateTT',
  'met',
  'metAt',
  'toCalendarTAI',
  'toJulianDateTAI',
  'toJulianDateTT',
  // frames
  'eci',
  'eciToPqw',
  'eciToRtnMatrix',
  'fromRtn',
  'inertialToPerifocalMatrix',
  'perifocalToInertialMatrix',
  'pqw',
  'pqwToEci',
  'rtn',
  'rtnToEciMatrix',
  'toRtn',
  // elements
  'CIRCULAR_TOLERANCE',
  'EQUATORIAL_TOLERANCE',
  'apoapsisRadius',
  'elementsFromState',
  'periapsisRadius',
  'semiMajorAxis',
  'specificAngularMomentum',
  'stateFromElements',
  // equinoctial
  'classicalFromEquinoctial',
  'eccentricity',
  'equinoctialFromClassical',
  'equinoctialFromState',
  'inclination',
  'stateFromEquinoctial',
  // twobody
  'biEllipticTransfer',
  'circularSpeed',
  'escapeSpeed',
  'hohmannTransfer',
  'meanMotion',
  'period',
  'specificEnergy',
  'visVivaSpeed',
  // kepler
  'solveBarker',
  'solveKeplerElliptic',
  'solveKeplerHyperbolic',
  // lambert
  'solveLambert',
  'stumpffC',
  'stumpffS',
  // anomaly
  'eccentricFromTrue',
  'hyperbolicFromTrue',
  'meanFromEccentric',
  'meanFromHyperbolic',
  'trueFromEccentric',
  'trueFromHyperbolic',
].sort();

describe('@hh/astro public surface', () => {
  it('exports exactly what it claims', () => {
    expect(Object.keys(astro).sort()).toEqual(EXPECTED);
  });

  it('is wired into the workspace', () => {
    expect(astro.PACKAGE).toBe('@hh/astro');
  });

  it('re-exports values that actually work, not just names', () => {
    // A barrel can export a name that resolves to undefined. Call through it.
    expect(astro.formatMet(astro.met(3661))).toBe('T+01:01:01');
    expect(astro.solveKeplerElliptic(1, 0).converged).toBe(true);
    expect(astro.R_GEO).toBeGreaterThan(4.2e7);
  });
});
