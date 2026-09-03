/**
 * Ground-station conical visibility intervals (#63, FR-008).
 *
 * When a spacecraft is above a station's elevation mask, given a station that
 * rotates with the central body.
 *
 * ## The station's frame is part of the station
 *
 * A ground station is the one thing in this simulation that is *not* constant in
 * the inertial frame and *is* constant in the rotating one, so it is stated in the
 * rotating one: `position` is an `EcefVector<Metres>`, which the compiler will not
 * let anybody pass where an inertial vector belongs. It is converted to inertial at
 * the point of use, by one rotation about z, and nothing is ever propagated in the
 * rotating frame.
 *
 * **Earth's rotation affects nothing dynamical**, as `docs/PHYSICS.md` states. This
 * module moves a station; it does not move a spacecraft, and it introduces no
 * Coriolis or centrifugal term because no equation of motion is written here.
 *
 * ## Latitude, longitude and altitude are not in this module, on purpose
 *
 * #63 requires that conversion to happen at the boundary. Turning a geodetic
 * latitude into a position needs an ellipsoid, and turning it into a *local
 * vertical* needs the same ellipsoid's surface normal — which is not the direction
 * of the position vector except on a sphere or at a pole. Picking one here would
 * bake a choice of Earth model into a package whose central body is a parameter.
 *
 * So the station carries **both** its position and its local up direction, in the
 * body-fixed frame, and the caller supplies them together. A spherical-Earth
 * boundary sets `up` to the normalised position; a WGS-84 one sets it to the
 * ellipsoid normal; a station on another body sets whatever that body means by up.
 * This module measures elevation against whichever was given and does not ask which
 * it was.
 *
 * ## Elevation is a signed angle, and that is a stated exception
 *
 * `docs/PHYSICS.md` says angles normalise to `[0, 2π)` "everywhere, without
 * exception". Elevation is the second exception, alongside hyperbolic anomaly, and
 * the document now says so.
 *
 * The convention exists for *circular* coordinates — anomalies, node angles, phases
 * — where `−10°` and `350°` name the same direction and wrapping is harmless.
 * Elevation is not circular. It is a latitude-like coordinate on `[−π/2, π/2]`,
 * where the sign is the entire content: below the horizon versus above it. Wrapping
 * `−10°` to `350°` would make `elevation ≥ mask` true for every spacecraft on the
 * far side of the planet, which is not a convention violation so much as a bug with
 * a convention for cover.
 *
 * ```
 * elevation = atan2(ρ · û, |ρ − (ρ · û) û|)
 * ```
 *
 * where `ρ` is the station-to-spacecraft vector. `atan2` against the horizontal
 * magnitude — which is non-negative — puts the result on `[−π/2, π/2]` directly and
 * needs no quadrant repair. `Math.acos` is banned (NFR-006) and would be wrong here
 * anyway: it cannot distinguish a spacecraft 5° above the horizon from one 5° below
 * it.
 *
 * ## What the search can miss
 *
 * Unlike the apsis and shell finders, this one has no closed form: the station's
 * rotation means elevation is not a function of the spacecraft's anomaly alone. So
 * it samples and refines, and a pass shorter than one sample step can be missed.
 * The default resolves a pass longer than `period / 256` — about 22 seconds at
 * 400 km — which in practice means a pass that peaks within a small fraction of a
 * degree of the mask. That is a real limit and is stated rather than hidden; a
 * caller who needs those raises `samplesPerRevolution`.
 */
import type { EcefVector, Epoch, State } from '@hh/astro';
import { bodyFixedToInertialMatrix, ecefToEci, epoch } from '@hh/astro';
import type { Metres, Radians, Vec3 } from '@hh/math';
import { M, radians, V } from '@hh/math';

import type { Arc } from './arc.js';
import type { EpochInterval, EventOptions } from './events.js';
import {
  conicClock,
  refineRoot,
  requireSearchInterval,
  requireStateAt,
  sampleAt,
  sampleCount,
  timeGridStep,
} from './events.js';

/**
 * A ground station, stated in the frame it is constant in.
 *
 * The rotation is given as an angle at an epoch plus a rate, rather than as an
 * epoch alone, because turning an epoch into a body rotation angle needs a
 * sidereal-time model — data with a source and an expiry. A scenario states its own
 * station rotation angle, which makes it a scenario fact rather than a physical
 * constant this package would have to hold.
 */
export interface GroundStation {
  /** Station position in the body-fixed frame, in metres from the body's centre. */
  readonly position: EcefVector<Metres>;
  /**
   * Local up at the station, in the body-fixed frame. Normalised internally, so any
   * non-zero length will do.
   *
   * Separate from `position` because they differ on an ellipsoid, and which of them
   * "up" means is the caller's model choice, not this module's.
   */
  readonly up: Vec3;
  /** The body's rotation angle about z, in radians, at `rotationEpoch`. */
  readonly rotationAngle: Radians;
  /** The epoch at which `rotationAngle` holds. */
  readonly rotationEpoch: Epoch;
  /**
   * Body rotation rate in rad s⁻¹ — `OMEGA_EARTH` for an Earth station.
   *
   * Zero is legal and useful: it freezes the station in the inertial frame, which is
   * what makes a closed-form pass-geometry check possible. See `station.test.ts`.
   */
  readonly rotationRate: number;
}

/**
 * Samples per revolution when bracketing, by default.
 *
 * Higher than the other time-domain finder's because the feature is much smaller. A
 * ground-station pass occupies a few percent of a revolution where an eclipse
 * occupies tens of percent, and the shortest pass worth finding is shorter still.
 * At a 400 km orbit's 92.6-minute period this is a look every 21.7 s.
 */
export const DEFAULT_STATION_SAMPLES_PER_REVOLUTION = 256;

/** The station's inertial position at `t`. */
export const stationPositionAt = (station: GroundStation, t: Epoch): State['position'] => {
  const angle = radians(station.rotationAngle + station.rotationRate * (t - station.rotationEpoch));
  return ecefToEci(bodyFixedToInertialMatrix(angle), station.position);
};

/**
 * Elevation of an inertial position above the station's local horizon, in radians
 * on `[-π/2, π/2]`.
 *
 * Negative below the horizon. See the module docstring for why this one angle is
 * not normalised to `[0, 2π)`.
 */
export const elevationOf = (
  station: GroundStation,
  position: State['position'],
  t: Epoch,
): Radians => {
  const angle = radians(station.rotationAngle + station.rotationRate * (t - station.rotationEpoch));
  const rotation = bodyFixedToInertialMatrix(angle);
  const site = ecefToEci(rotation, station.position);
  const up = V.normalize(M.apply(rotation, station.up));

  const topocentric = V.sub(position, site);
  const vertical = V.dot(topocentric, up);
  const horizontal = Math.hypot(
    topocentric.x - vertical * up.x,
    topocentric.y - vertical * up.y,
    topocentric.z - vertical * up.z,
  );
  return radians(Math.atan2(vertical, horizontal));
};

/**
 * Spans of `[start, end)` during which the arc is at or above `elevationMask` as
 * seen from `station`.
 *
 * Ordered by start epoch and non-overlapping. A pass already in progress at `start`
 * — or still in progress at `end` — is returned clipped, with the corresponding
 * flag set, rather than dropped: #63 requires partial intervals at the bounds to
 * survive, and the flag is what tells a caller the rise or set epoch is outside the
 * window rather than at its edge.
 *
 * @param elevationMask Minimum elevation in radians, on `[-π/2, π/2]`. Zero is the
 * geometric horizon; a real station uses a few degrees to clear terrain and
 * atmosphere, and negative values are legal for a station on a height.
 *
 * @throws RangeError when the station is degenerate, the mask is out of range, or
 * the search interval is malformed.
 */
export const findVisibilityIntervals = (
  arc: Arc,
  station: GroundStation,
  elevationMask: number,
  start: Epoch,
  end: Epoch,
  options: EventOptions = {},
): readonly EpochInterval[] => {
  requireSearchInterval(start, end);
  if (!(Math.abs(elevationMask) <= Math.PI / 2)) {
    throw new RangeError(
      `elevation mask must lie in [-pi/2, pi/2] rad, got ${String(elevationMask)}`,
    );
  }
  if (V.normSq(station.position) === 0) {
    throw new RangeError('a ground station cannot sit at the centre of the body');
  }
  if (V.normSq(station.up) === 0) {
    throw new RangeError('a ground station needs a non-zero up direction');
  }
  if (!Number.isFinite(station.rotationRate)) {
    throw new RangeError(
      `station rotation rate must be finite, got ${String(station.rotationRate)}`,
    );
  }
  if (end === start) return [];

  const samplesPerRevolution =
    options.samplesPerRevolution ?? DEFAULT_STATION_SAMPLES_PER_REVOLUTION;
  const step = timeGridStep([conicClock(arc).period], end - start, samplesPerRevolution);
  const count = sampleCount(end - start, step);

  /** Positive when the spacecraft is above the mask. Its roots are rise and set. */
  const g = (t: number): number =>
    elevationOf(station, requireStateAt(arc, t).position, epoch(t)) - elevationMask;

  const intervals: EpochInterval[] = [];
  let previous = g(start);
  let openedAt: number | undefined = previous >= 0 ? start : undefined;
  let clippedStart = previous >= 0;

  for (let i = 1; i <= count; i++) {
    const hi = sampleAt(start, end, i, count);
    const current = g(hi);
    const lo = sampleAt(start, end, i - 1, count);

    if (previous < 0 && current >= 0) {
      const rise = refineRoot(g, lo, hi, options);
      if (rise !== undefined) {
        openedAt = rise;
        clippedStart = false;
      }
    } else if (previous >= 0 && current < 0 && openedAt !== undefined) {
      const set = refineRoot(g, lo, hi, options);
      if (set !== undefined) {
        intervals.push({
          start: epoch(openedAt),
          end: epoch(set),
          clippedStart,
          clippedEnd: false,
        });
        openedAt = undefined;
        clippedStart = false;
      }
    }
    previous = current;
  }

  if (openedAt !== undefined) {
    intervals.push({ start: epoch(openedAt), end, clippedStart, clippedEnd: true });
  }
  return intervals;
};
