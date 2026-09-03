/**
 * Ground-station visibility intervals (#63, FR-008).
 *
 * ## The independent reference
 *
 * A pass over a spherical Earth is a plane-geometry problem, and it has a closed
 * form that owes nothing to this module. In the triangle joining the Earth's centre
 * `O`, the station `S` and the spacecraft `P`, the interior angle at `S` is
 * `90° + ε` where `ε` is the elevation, so the sine rule gives the geocentric
 * half-angle of the visible arc:
 *
 * ```
 * cos(ε + λ) = (R / r) cos ε        λ = atan2(√(1 − c²), c) − ε,   c = (R/r) cos ε
 * ```
 *
 * and for a station the spacecraft passes directly over, the pass lasts `λ T / π`.
 * Written through `atan2` rather than `acos` because `acos` is banned (NFR-006);
 * the identity is the same one.
 *
 * The station's rotation rate is a parameter, so setting it to zero makes that
 * closed form exact rather than approximate — the geometry stops depending on how
 * far the station has turned during the pass. The rotating case is then checked
 * against the elevation definition directly.
 *
 * The 81.3° geostationary visibility limit is the second reference: a station
 * further than that from the sub-satellite longitude cannot see a geostationary
 * satellite at all. It is a widely published satcom figure and it falls out of the
 * same relation at `ε = 0`, `r = R_GEO`.
 */
import {
  MU_EARTH,
  OMEGA_EARTH,
  R_EARTH_EQ,
  R_GEO,
  ecef,
  epoch,
  period,
  semiMajorAxis,
  stateFromElements,
} from '@hh/astro';
import type { Epoch, State } from '@hh/astro';
import { V, metres, radians } from '@hh/math';
import { describe, expect, it } from 'vitest';

import { createArc, stateAt } from './arc.js';
import type { GroundStation } from './station.js';
import { elevationOf, findVisibilityIntervals, stationPositionAt } from './station.js';

const circular = (r: number, nu: number, inclination = 0): State =>
  stateFromElements(
    {
      semiLatusRectum: metres(r),
      eccentricity: 0,
      inclination: radians(inclination),
      raan: radians(0),
      argp: radians(0),
      trueAnomaly: radians(nu),
    },
    MU_EARTH,
  );

const arcOf = (state: State) =>
  createArc({ startEpoch: epoch(0), endEpoch: epoch(1), state, mu: MU_EARTH });

/** A station on a spherical Earth at the given longitude, on the equator. */
const stationAt = (longitude: number, rotationRate = 0): GroundStation => {
  const direction = V.vec3(Math.cos(longitude), Math.sin(longitude), 0);
  return {
    position: ecef(
      V.vec3(
        metres(R_EARTH_EQ * direction.x),
        metres(R_EARTH_EQ * direction.y),
        metres(R_EARTH_EQ * direction.z),
      ),
    ),
    // Spherical Earth: up is the position direction. On an ellipsoid the caller
    // would pass the surface normal instead, which is the reason this is a field.
    up: direction,
    rotationAngle: radians(0),
    rotationEpoch: epoch(0),
    rotationRate,
  };
};

/**
 * Geocentric half-angle of the arc visible above `mask` from a station, for a
 * circular orbit of radius `r`. Closed form; see the module docstring.
 */
const visibleHalfAngle = (r: number, mask: number): number => {
  const c = (R_EARTH_EQ / r) * Math.cos(mask);
  return Math.atan2(Math.sqrt(1 - c * c), c) - mask;
};

const positionAt = (arc: ReturnType<typeof arcOf>, t: Epoch): State['position'] => {
  const result = stateAt(arc, t);
  if (!result.converged) throw new Error('propagation failed');
  return result.state.position;
};

describe('a pass over a station fixed in the inertial frame', () => {
  const RADIUS = 6_778_137;
  const arc = arcOf(circular(RADIUS, 0));
  const T = period(semiMajorAxis(arc.elements), MU_EARTH);
  const station = stationAt(0);

  it.each([
    ['no mask', 0],
    ['a 5° mask', (5 * Math.PI) / 180],
    ['a 10° mask', (10 * Math.PI) / 180],
  ])('lasts exactly the closed-form duration with %s', (_label, mask) => {
    // The spacecraft is at true anomaly 0 — directly over the station — at t = 0,
    // so one period centred there contains the whole pass.
    const intervals = findVisibilityIntervals(arc, station, mask, epoch(-(T / 2)), epoch(T / 2));

    expect(intervals).toHaveLength(1);
    const duration = (intervals[0]?.end ?? 0) - (intervals[0]?.start ?? 0);
    const expected = (visibleHalfAngle(RADIUS, mask) * T) / Math.PI;
    // The refinement's own tolerance is 1e-6 s against a ~600 s pass, so relative
    // agreement to 1e-9 is the geometry, not the solver.
    expect(duration / expected).toBeCloseTo(1, 9);
  });

  it('reaches the zenith at the overhead epoch', () => {
    expect(elevationOf(station, positionAt(arc, epoch(0)), epoch(0))).toBeCloseTo(Math.PI / 2, 9);
  });

  it('sits exactly on the mask at rise and set', () => {
    const mask = (5 * Math.PI) / 180;
    const interval = findVisibilityIntervals(arc, station, mask, epoch(-(T / 2)), epoch(T / 2))[0];
    expect(interval).toBeDefined();
    if (interval === undefined) return;

    for (const t of [interval.start, interval.end]) {
      expect(elevationOf(station, positionAt(arc, t), t)).toBeCloseTo(mask, 9);
    }
  });

  it('is deterministic and ordered', () => {
    const call = () => findVisibilityIntervals(arc, station, 0, epoch(-(2 * T)), epoch(2 * T));
    const intervals = call();
    expect(intervals.length).toBeGreaterThan(1);
    for (let i = 1; i < intervals.length; i++) {
      expect(intervals[i]?.start).toBeGreaterThan(intervals[i - 1]?.end ?? 0);
    }
    expect(call()).toEqual(intervals);
  });
});

describe('elevation as a signed angle', () => {
  const arc = arcOf(circular(6_778_137, Math.PI));
  const station = stationAt(0);

  it('is negative on the far side of the planet, not wrapped into [0, 2π)', () => {
    // The spacecraft is at true anomaly π — diametrically opposite the station.
    const elevation = elevationOf(station, positionAt(arc, epoch(0)), epoch(0));
    expect(elevation).toBeLessThan(0);
    expect(elevation).toBeCloseTo(-Math.PI / 2, 9);
  });

  it('never leaves [-π/2, π/2]', () => {
    const T = period(semiMajorAxis(arc.elements), MU_EARTH);
    for (let i = 0; i <= 64; i++) {
      const t = epoch((T * i) / 64);
      const elevation = elevationOf(station, positionAt(arc, t), t);
      expect(elevation).toBeGreaterThanOrEqual(-Math.PI / 2);
      expect(elevation).toBeLessThanOrEqual(Math.PI / 2);
    }
  });

  it('measures against the supplied up direction, not the position direction', () => {
    // A station tilted 20° from geocentric up — the ellipsoid case in miniature.
    // Elevation must follow the tilt, so a spacecraft on the geocentric zenith is no
    // longer at 90°.
    const tilt = 0.35;
    const tilted: GroundStation = {
      ...stationAt(0),
      up: V.vec3(Math.cos(tilt), 0, Math.sin(tilt)),
    };
    const overhead = arcOf(circular(6_778_137, 0));
    const elevation = elevationOf(tilted, positionAt(overhead, epoch(0)), epoch(0));

    expect(elevation).toBeCloseTo(Math.PI / 2 - tilt, 9);
  });
});

describe('a geostationary satellite', () => {
  const arc = arcOf(circular(R_GEO, 0));
  const DAY = 3 * 86_164;

  it('is permanently visible from a station beneath it, clipped at both bounds', () => {
    const intervals = findVisibilityIntervals(
      arc,
      stationAt(0, OMEGA_EARTH),
      0,
      epoch(0),
      epoch(DAY),
    );

    expect(intervals).toHaveLength(1);
    expect(intervals[0]?.clippedStart).toBe(true);
    expect(intervals[0]?.clippedEnd).toBe(true);
    expect(intervals[0]?.start).toBe(epoch(0));
    expect(intervals[0]?.end).toBe(epoch(DAY));
  });

  it('is visible just inside the 81.3° limit and invisible just outside it', () => {
    // The published geostationary visibility limit. Re-derived here from the same
    // closed form rather than copied: at ε = 0 and r = R_GEO it is 81.30°.
    const limit = visibleHalfAngle(R_GEO, 0);
    expect((limit * 180) / Math.PI).toBeCloseTo(81.3, 1);

    const inside = findVisibilityIntervals(
      arc,
      stationAt(limit - 0.005, OMEGA_EARTH),
      0,
      epoch(0),
      epoch(DAY),
    );
    const outside = findVisibilityIntervals(
      arc,
      stationAt(limit + 0.005, OMEGA_EARTH),
      0,
      epoch(0),
      epoch(DAY),
    );

    expect(inside).toHaveLength(1);
    expect(outside).toHaveLength(0);
  });
});

describe('a rotating station', () => {
  const RADIUS = 7_500_000;
  const arc = arcOf(circular(RADIUS, 0, 0.9));
  const T = period(semiMajorAxis(arc.elements), MU_EARTH);
  const station = stationAt(0.2, OMEGA_EARTH);

  it('carries the station around with the body', () => {
    // A quarter turn is `pi / (2 * OMEGA_EARTH)`, taken from the constant rather than
    // from a rounded sidereal day. `constants.ts` records that the published
    // `OMEGA_EARTH` implies 86164.10 s against the measured 86164.0905 s, and 0.01 s
    // of rotation is 7e-7 rad -- above the tolerance this assertion wants, so using
    // the day would be testing the discrepancy rather than the rotation.
    const quarterTurn = epoch(Math.PI / (2 * OMEGA_EARTH));
    const moved = stationPositionAt(station, quarterTurn);
    const initial = stationPositionAt(station, epoch(0));

    expect(V.norm(moved)).toBeCloseTo(V.norm(initial), 6);
    expect(V.angleBetween(moved, initial)).toBeCloseTo(Math.PI / 2, 9);
  });

  it('brackets every pass at the mask, with the spacecraft below it in between', () => {
    const mask = (5 * Math.PI) / 180;
    const intervals = findVisibilityIntervals(arc, station, mask, epoch(0), epoch(8 * T));

    expect(intervals.length).toBeGreaterThan(0);
    for (const interval of intervals) {
      if (!interval.clippedStart) {
        expect(elevationOf(station, positionAt(arc, interval.start), interval.start)).toBeCloseTo(
          mask,
          8,
        );
      }
      if (!interval.clippedEnd) {
        expect(elevationOf(station, positionAt(arc, interval.end), interval.end)).toBeCloseTo(
          mask,
          8,
        );
      }
      const middle = epoch((interval.start + interval.end) / 2);
      expect(elevationOf(station, positionAt(arc, middle), middle)).toBeGreaterThan(mask);
    }
  });

  it('leaves the spacecraft below the mask between passes', () => {
    const intervals = findVisibilityIntervals(arc, station, 0, epoch(0), epoch(8 * T));
    for (let i = 1; i < intervals.length; i++) {
      const gapMiddle = epoch(((intervals[i - 1]?.end ?? 0) + (intervals[i]?.start ?? 0)) / 2);
      expect(elevationOf(station, positionAt(arc, gapMiddle), gapMiddle)).toBeLessThan(0);
    }
  });

  it('rotates the station up direction with it, so a pass is symmetric about the zenith', () => {
    // With a station that did not carry its up vector around, elevation would be
    // measured against a fixed inertial direction and the pass would drift.
    const equatorial = arcOf(circular(RADIUS, 0));
    const intervals = findVisibilityIntervals(
      equatorial,
      stationAt(0, OMEGA_EARTH),
      0,
      epoch(-(T + 0)),
      epoch(T),
    );
    const containing = intervals.find((i) => i.start <= 0 && i.end >= 0);

    expect(containing).toBeDefined();
    if (containing === undefined) return;
    // t = 0 is the overhead instant; the pass is centred on it to within the
    // asymmetry the station's own motion introduces, which is small but real.
    const centre = (containing.start + containing.end) / 2;
    expect(Math.abs(centre)).toBeLessThan(1);
  });
});

describe('partial passes at the search bounds', () => {
  const RADIUS = 6_778_137;
  const arc = arcOf(circular(RADIUS, 0));
  const T = period(semiMajorAxis(arc.elements), MU_EARTH);
  const station = stationAt(0);
  const whole = findVisibilityIntervals(arc, station, 0, epoch(-(T / 2)), epoch(T / 2))[0];

  it('clips a pass already in progress at the start', () => {
    expect(whole).toBeDefined();
    if (whole === undefined) return;
    const inside = epoch((whole.start + whole.end) / 2);
    const intervals = findVisibilityIntervals(arc, station, 0, inside, epoch(T / 2));

    expect(intervals).toHaveLength(1);
    expect(intervals[0]?.clippedStart).toBe(true);
    expect(intervals[0]?.start).toBe(inside);
    expect(intervals[0]?.clippedEnd).toBe(false);
    expect(intervals[0]?.end).toBeCloseTo(whole.end, 6);
  });

  it('clips a pass still in progress at the end', () => {
    expect(whole).toBeDefined();
    if (whole === undefined) return;
    const inside = epoch((whole.start + whole.end) / 2);
    const intervals = findVisibilityIntervals(arc, station, 0, epoch(-(T / 2)), inside);

    expect(intervals).toHaveLength(1);
    expect(intervals[0]?.clippedEnd).toBe(true);
    expect(intervals[0]?.end).toBe(inside);
    expect(intervals[0]?.clippedStart).toBe(false);
    expect(intervals[0]?.start).toBeCloseTo(whole.start, 6);
  });

  it('reports a whole search interval spent above the mask as clipped at both ends', () => {
    expect(whole).toBeDefined();
    if (whole === undefined) return;
    const quarter = (whole.end - whole.start) / 4;
    const intervals = findVisibilityIntervals(
      arc,
      station,
      0,
      epoch(whole.start + quarter),
      epoch(whole.end - quarter),
    );

    expect(intervals).toHaveLength(1);
    expect(intervals[0]?.clippedStart).toBe(true);
    expect(intervals[0]?.clippedEnd).toBe(true);
  });
});

describe('rejected input', () => {
  const arc = arcOf(circular(6_778_137, 0));
  const station = stationAt(0);

  it.each([
    ['a mask beyond the zenith', Math.PI],
    ['a mask below the nadir', -Math.PI],
    ['a non-finite mask', Number.NaN],
  ])('rejects %s', (_label, mask) => {
    expect(() => findVisibilityIntervals(arc, station, mask, epoch(0), epoch(1000))).toThrow(
      RangeError,
    );
  });

  it('rejects a station at the centre of the body', () => {
    const degenerate: GroundStation = {
      ...station,
      position: ecef(V.vec3(metres(0), metres(0), metres(0))),
    };
    expect(() => findVisibilityIntervals(arc, degenerate, 0, epoch(0), epoch(1000))).toThrow(
      RangeError,
    );
  });

  it('rejects a station with no up direction', () => {
    const degenerate: GroundStation = { ...station, up: V.vec3(0, 0, 0) };
    expect(() => findVisibilityIntervals(arc, degenerate, 0, epoch(0), epoch(1000))).toThrow(
      RangeError,
    );
  });

  it('rejects a non-finite rotation rate', () => {
    const degenerate: GroundStation = { ...station, rotationRate: Number.POSITIVE_INFINITY };
    expect(() => findVisibilityIntervals(arc, degenerate, 0, epoch(0), epoch(1000))).toThrow(
      RangeError,
    );
  });

  it('rejects a reversed search interval', () => {
    expect(() => findVisibilityIntervals(arc, station, 0, epoch(10), epoch(0))).toThrow(RangeError);
  });

  it('finds nothing in a zero-length interval', () => {
    expect(findVisibilityIntervals(arc, station, 0, epoch(0), epoch(0))).toHaveLength(0);
  });
});
