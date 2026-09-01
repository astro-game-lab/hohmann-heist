/**
 * Physical constants, with the source for every value.
 *
 * Constants are defined here exactly once and never redefined elsewhere. A second
 * definition that drifts from this one is the kind of bug no unit test catches,
 * because the test and the code would share the mistake.
 *
 * Units are SI throughout and appear in every doc comment. See `docs/PHYSICS.md`
 * for the conventions these follow, and `ATTRIBUTIONS.md` for the same table.
 *
 * Game constants do not belong here. The 100 km altitude floor, for instance, is a
 * gameplay departure (DEP-08) standing in for atmospheric drag, which this model
 * does not have — it lives in `@hh/game`.
 */

/**
 * Earth's geocentric gravitational constant, GM, in m³ s⁻².
 *
 * Source: EGM-96 / WGS-84.
 */
export const MU_EARTH = 3.986004418e14;

/**
 * Earth's equatorial radius (semi-major axis of the reference ellipsoid), in m.
 *
 * Source: WGS-84.
 */
export const R_EARTH_EQ = 6378137.0;

/**
 * Earth's second dynamic form factor, dimensionless.
 *
 * Source: EGM-96.
 *
 * Stored but **unused in v1.0** — the model is strictly two-body. It lives here so
 * that when the J2 option arrives there is one source of truth for the value rather
 * than a literal copied into whichever module needs it first.
 */
export const J2_EARTH = 1.08262668e-3;

/**
 * Earth's mean sidereal rotation rate, in rad s⁻¹.
 *
 * Source: IERS nominal value. Note this is the rounded published figure; it implies
 * a sidereal day of 86164.10 s against the measured 86164.0905 s, a difference of
 * about 0.01 s. That is far below anything this game resolves, but it is a real
 * discrepancy rather than a rounding artefact of our own making, so it is stated
 * rather than hidden.
 */
export const OMEGA_EARTH = 7.292115e-5;

/**
 * Geostationary orbital radius, in m.
 *
 * **Derived, not measured.** A circular orbit is geostationary when its mean motion
 * equals Earth's rotation rate, so ω²r³ = μ and r = (μ/ω²)^(1/3).
 *
 * This is computed rather than written down on purpose. An independently stated
 * literal can drift from the μ and ω it is supposed to follow from — which is
 * exactly what happened in an earlier draft of the product definition, where a
 * hard-coded 42164140.0 sat 33 m away from what these constants actually imply.
 * Deriving it makes that class of mistake impossible.
 *
 * Evaluates to 42164172.9 m, against the commonly published 42164.17 km.
 */
export const R_GEO = Math.cbrt(MU_EARTH / (OMEGA_EARTH * OMEGA_EARTH));

/**
 * Astronomical unit, in m.
 *
 * Source: IAU 2012 definition (exact).
 *
 * Reserved. Nothing in v1.0 is heliocentric; this is here for the interplanetary
 * games that share this package later.
 */
export const AU = 1.495978707e11;
