import {
  MU_EARTH,
  R_EARTH_EQ,
  apoapsisRadius,
  epoch,
  periapsisRadius,
  type OrbitShape,
} from '@hh/astro';
import type { ProximityEvaluation } from '@hh/game';
import { metres, metresPerSec, radians } from '@hh/math';
import { APSIS_ECCENTRICITY_FLOOR } from '@hh/propagation';
import { describe, expect, it } from 'vitest';

import { approachReadout, orbitReadout } from './readouts.js';

/** An equatorial orbit of the given eccentricity; `p` is a 400 km circular radius. */
const orbit = (eccentricity: number, semiLatusRectum = 6_778_137): OrbitShape => ({
  semiLatusRectum: metres(semiLatusRectum),
  eccentricity,
  inclination: radians(0),
  raan: radians(0),
  argp: radians(0),
  trueAnomaly: radians(0),
});

const read = (eccentricity: number) => orbitReadout(orbit(eccentricity), MU_EARTH, R_EARTH_EQ);

describe('the suppression threshold is §9.3’s, not a copy of it', () => {
  it('comes from @hh/propagation rather than a local constant', () => {
    // The same assertion `apsis.test.ts` makes, for the same reason: the panel and the
    // orbit view must suppress together, or a player sees ticks with no numbers beside
    // them and reasonably concludes one of the two is broken.
    expect(read(APSIS_ECCENTRICITY_FLOOR * 0.99).circular).toBe(true);
    expect(read(APSIS_ECCENTRICITY_FLOOR).circular).toBe(false);
  });
});

describe('a near-circular orbit shows one altitude, not two noisy ones (#131)', () => {
  const readout = read(1e-6);

  it('suppresses apoapsis and periapsis', () => {
    expect(readout.circular).toBe(true);
    expect(readout.apoapsisAltitudeM).toBeNull();
    expect(readout.periapsisAltitudeM).toBeNull();
  });

  it('replaces them with the mean altitude', () => {
    const elements = orbit(1e-6);
    const expected = (apoapsisRadius(elements) + periapsisRadius(elements)) / 2 - R_EARTH_EQ;
    expect(readout.meanAltitudeM).toBeCloseTo(expected, 6);
  });

  it('still reports the period and the eccentricity', () => {
    // The eccentricity is the number that *explains* the suppression, so hiding it would
    // leave the player unable to tell a round orbit from a broken panel.
    expect(readout.periodSeconds).toBeGreaterThan(0);
    expect(readout.eccentricity).toBe(1e-6);
  });
});

describe('an eccentric orbit shows both apsides (#131)', () => {
  const readout = read(0.05);

  it('reports apoapsis above periapsis, as altitudes above the reference radius', () => {
    expect(readout.circular).toBe(false);
    expect(readout.meanAltitudeM).toBeNull();
    const elements = orbit(0.05);
    expect(readout.periapsisAltitudeM).toBeCloseTo(periapsisRadius(elements) - R_EARTH_EQ, 6);
    expect(readout.apoapsisAltitudeM).toBeCloseTo(apoapsisRadius(elements) - R_EARTH_EQ, 6);
    expect(readout.apoapsisAltitudeM ?? 0).toBeGreaterThan(readout.periapsisAltitudeM ?? 0);
  });

  it('returns SI, leaving the unit conversion to the catalogue (FR-406, FR-910)', () => {
    // Metres, not kilometres. This orbit's periapsis sits ~77 km up, so a panel-ready
    // kilometre reading would be ~77 and the SI one ~77 000. Asserting the magnitude
    // rather than the value keeps the test about the *unit*, which is the claim: if this
    // boundary ever moves into this module, the decimal separator has been decided for
    // every locale at once (see the module docstring).
    expect(readout.periapsisAltitudeM ?? 0).toBeGreaterThan(10_000);
  });
});

describe('an open orbit has no period and no apoapsis (§6.4’s L4)', () => {
  it('reports both as absent rather than as a negative number', () => {
    const hyperbolic = read(1.4);
    expect(hyperbolic.open).toBe(true);
    expect(hyperbolic.circular).toBe(false);
    expect(hyperbolic.periodSeconds).toBeNull();
    expect(hyperbolic.apoapsisAltitudeM).toBeNull();
    // Periapsis survives: it is the one apsis a hyperbola has, and it is the number the
    // player needs to see when they are being told their plan escapes.
    expect(hyperbolic.periapsisAltitudeM).not.toBeNull();
  });

  it('treats the parabolic case as open rather than as round', () => {
    // `e = 1` sits at the boundary and `a` is infinite there. The ordering inside
    // `orbitReadout` is what keeps it out of the circular branch; this is that ordering.
    const parabolic = read(1);
    expect(parabolic.open).toBe(true);
    expect(parabolic.circular).toBe(false);
    expect(parabolic.periodSeconds).toBeNull();
  });
});

// ── #132 ─────────────────────────────────────────────────────────────────────

const evaluation = (
  rangeM: number,
  met: boolean,
  relativeSpeedMps = 0.02,
): ProximityEvaluation => ({
  kind: 'rendezvous',
  met,
  atEpoch: met ? epoch(43_000) : null,
  achieved: {
    epoch: epoch(43_000),
    rangeM: metres(rangeM),
    relativeSpeedMps: metresPerSec(relativeSpeedMps),
  },
  candidates: [],
  tolerance: { maxRangeM: metres(1000), maxRelativeSpeedMps: metresPerSec(0.5) },
});

describe('the closest-approach block (#132, FR-407)', () => {
  it('quotes distance, relative speed and epoch from the finder', () => {
    const readout = approachReadout(evaluation(311.4, true));
    expect(readout).toMatchObject({
      present: true,
      rangeM: 311.4,
      relativeSpeedMps: 0.02,
      epoch: 43_000,
      met: true,
    });
  });

  it('carries the tolerances, so the panel can say what "met" meant', () => {
    const readout = approachReadout(evaluation(311.4, true));
    expect(readout).toMatchObject({ maxRangeM: 1000, maxRelativeSpeedMps: 0.5 });
  });

  it('reports an unmet objective while still quoting the approach', () => {
    // A miss is the interesting case: the block's job is "how close does this get?", and
    // on a plan that misses there is no satisfying candidate to read instead.
    const readout = approachReadout(evaluation(4200, false));
    expect(readout).toMatchObject({ present: true, rangeM: 4200, met: false });
  });

  it('says there is no approach rather than showing an infinite or zero range', () => {
    // `evaluateProximity` reports `Infinity` when the search found no stationary point at
    // all. Rendered naively that becomes "0.0 km" after a unit conversion, which tells the
    // player they have arrived. #132's fifth criterion, and this is the whole of it.
    expect(approachReadout(evaluation(Number.POSITIVE_INFINITY, false))).toEqual({
      present: false,
    });
  });
});
