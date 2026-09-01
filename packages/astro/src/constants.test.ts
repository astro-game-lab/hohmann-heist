import { describe, expect, it } from 'vitest';

import { AU, J2_EARTH, MU_EARTH, OMEGA_EARTH, R_EARTH_EQ, R_GEO } from './constants.js';

describe('constants', () => {
  it('are all finite and positive', () => {
    for (const [name, value] of Object.entries({
      MU_EARTH,
      R_EARTH_EQ,
      J2_EARTH,
      OMEGA_EARTH,
      R_GEO,
      AU,
    })) {
      expect(Number.isFinite(value), name).toBe(true);
      expect(value, name).toBeGreaterThan(0);
    }
  });

  describe('R_GEO', () => {
    // R_GEO is derived from MU_EARTH and OMEGA_EARTH, so asserting it equals its own
    // formula would be a tautology. This asserts the *defining relation* instead:
    // a circular orbit is geostationary when its mean motion equals Earth's rotation
    // rate, so w^2 r^3 = mu. A wrong formula (mu/w rather than mu/w^2, say) fails here.
    it('satisfies w^2 r^3 = mu', () => {
      const ratio = (OMEGA_EARTH ** 2 * R_GEO ** 3) / MU_EARTH;
      expect(ratio).toBeCloseTo(1, 12);
    });

    // An independent check against a value we did not compute. 42164.17 km is the
    // commonly published geostationary radius; quoted to five decimal places of a
    // kilometre it carries about +/-5 m of rounding, so the tolerance cannot be
    // tighter than that. 10 m leaves a little room without being meaningless.
    it('agrees with the published 42164.17 km to within 10 m', () => {
      const published = 42_164_170;
      expect(Math.abs(R_GEO - published)).toBeLessThan(10);
    });

    it('is above the Earth surface by roughly five and a half radii', () => {
      expect(R_GEO / R_EARTH_EQ).toBeCloseTo(6.61, 2);
    });
  });

  describe('OMEGA_EARTH', () => {
    // The measured mean sidereal day is 86164.0905 s. Our OMEGA_EARTH is the rounded
    // IERS nominal figure and implies 86164.1006 s -- about 10 ms longer. The
    // tolerance is set to admit that known difference and nothing more; it is not a
    // number chosen to make the test pass, and the gap is documented on the constant
    // itself and in docs/PHYSICS.md.
    it('reproduces the sidereal day to within 20 ms', () => {
      const siderealDay = (2 * Math.PI) / OMEGA_EARTH;
      expect(Math.abs(siderealDay - 86_164.0905)).toBeLessThan(0.02);
    });
  });

  describe('MU_EARTH', () => {
    // Vis-viva at the surface radius. Not a mission-relevant number, but it is an
    // order-of-magnitude sanity check on mu that does not depend on any other
    // constant in this file: circular velocity at the equator should be ~7.9 km/s.
    it('gives a surface circular velocity near 7.9 km/s', () => {
      const v = Math.sqrt(MU_EARTH / R_EARTH_EQ);
      expect(v).toBeGreaterThan(7900);
      expect(v).toBeLessThan(7920);
    });
  });

  describe('AU', () => {
    it('is the exact IAU 2012 definition', () => {
      expect(AU).toBe(149_597_870_700);
    });
  });
});
