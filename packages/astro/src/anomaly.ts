/**
 * Anomaly conversions.
 *
 * Three ways to say where a body is on its orbit:
 *
 * - **True anomaly (ν)** — the real geometric angle from periapsis. What you would
 *   measure.
 * - **Eccentric anomaly (E)** — an auxiliary angle on the circumscribing circle,
 *   which is what makes Kepler's equation tractable.
 * - **Mean anomaly (M)** — advances uniformly in time. What propagation works in.
 *
 * Every conversion here uses `atan2`. The half-angle tangent forms found in
 * textbooks are equivalent but lose the quadrant, and recovering it with a sign
 * test is the kind of thing that works until it does not. `Math.acos` is banned
 * outright (NFR-006).
 */
import type { Radians } from '@hh/math';
import { normalize, radians } from '@hh/math';

/** True anomaly from eccentric anomaly, elliptic case. */
export const trueFromEccentric = (eccentric: number, eccentricity: number): Radians =>
  radians(
    normalize(
      Math.atan2(
        Math.sqrt(1 - eccentricity * eccentricity) * Math.sin(eccentric),
        Math.cos(eccentric) - eccentricity,
      ),
    ),
  );

/** Eccentric anomaly from true anomaly, elliptic case. */
export const eccentricFromTrue = (trueAnomaly: number, eccentricity: number): Radians =>
  radians(
    normalize(
      Math.atan2(
        Math.sqrt(1 - eccentricity * eccentricity) * Math.sin(trueAnomaly),
        eccentricity + Math.cos(trueAnomaly),
      ),
    ),
  );

/** Mean anomaly from eccentric anomaly. Kepler's equation, in the easy direction. */
export const meanFromEccentric = (eccentric: number, eccentricity: number): Radians =>
  radians(normalize(eccentric - eccentricity * Math.sin(eccentric)));

/**
 * True anomaly from hyperbolic anomaly.
 *
 * `tan(ν/2) = √((e+1)/(e−1)) · tanh(H/2)`, expressed through `atan2` so the
 * quadrant survives. Unlike the elliptic case the result is **not** normalised to
 * `[0, 2π)`: a hyperbolic true anomaly is confined to the open interval bounded by
 * the asymptotes, and wrapping it would destroy that meaning.
 */
export const trueFromHyperbolic = (hyperbolic: number, eccentricity: number): Radians =>
  (2 *
    Math.atan2(
      Math.sqrt(eccentricity + 1) * Math.tanh(hyperbolic / 2),
      Math.sqrt(eccentricity - 1),
    )) as Radians;

/** Hyperbolic anomaly from true anomaly. */
export const hyperbolicFromTrue = (trueAnomaly: number, eccentricity: number): Radians =>
  (2 *
    Math.atanh(
      Math.sqrt((eccentricity - 1) / (eccentricity + 1)) * Math.tan(trueAnomaly / 2),
    )) as Radians;

/** Mean anomaly from hyperbolic anomaly. Not periodic, so not normalised. */
export const meanFromHyperbolic = (hyperbolic: number, eccentricity: number): Radians =>
  (eccentricity * Math.sinh(hyperbolic) - hyperbolic) as Radians;
