/**
 * Reference frames.
 *
 * `CLAUDE.md` is explicit: *"Never pass a bare position or velocity vector around.
 * The frame is part of the value: encode it in the type."* So frames are branded
 * the same way units are, with a `unique symbol` that cannot be forged outside this
 * module. `EciVector<Metres>` and `RtnVector<MetresPerSec>` are then fully distinct
 * to the compiler, and handing a perifocal vector to something expecting an
 * inertial one stops compiling rather than producing a plausible wrong trajectory.
 *
 * Four frames, per `docs/PHYSICS.md`:
 *
 * - **ECI** — J2000-aligned inertial. The default; everything dynamical lives here.
 * - **PQW** — perifocal, x toward periapsis, z along angular momentum. Used only
 *   for element to Cartesian conversion.
 * - **RTN** — radial, transverse, normal; attached to the spacecraft's state. The
 *   only frame a player ever sees a vector in.
 * - **ECEF** — body-fixed, rotating with the central body. Nothing dynamical uses
 *   it: it exists so that a ground station's position can be stated in the frame it
 *   is actually constant in, and converted at the point of use. See the note on
 *   `bodyFixedToInertialMatrix` for why the rotation is a parameter.
 */
import type { Mat3, Metres, MetresPerSec, Radians, Vec3 } from '@hh/math';
import { M, V } from '@hh/math';

declare const frameBrand: unique symbol;

/** A vector tagged with the frame it is expressed in. */
export type Framed<F extends string, T extends number> = Vec3<T> & {
  readonly [frameBrand]: F;
};

/** A vector in the J2000-aligned Earth-centred inertial frame. */
export type EciVector<T extends number = number> = Framed<'ECI', T>;
/** A vector in the perifocal frame. */
export type PqwVector<T extends number = number> = Framed<'PQW', T>;
/** A vector in the spacecraft's radial-transverse-normal frame. */
export type RtnVector<T extends number = number> = Framed<'RTN', T>;
/**
 * A vector in the central body's rotating body-fixed frame.
 *
 * Named ECEF because Earth is the only central body in v1.0, but nothing here is
 * Earth-specific — the rotation angle is supplied by the caller.
 */
export type EcefVector<T extends number = number> = Framed<'ECEF', T>;

/** Tag a vector as inertial. Use only where the frame is genuinely known. */
export const eci = <T extends number>(v: Vec3<T>): EciVector<T> => v as EciVector<T>;
/** Tag a vector as perifocal. */
export const pqw = <T extends number>(v: Vec3<T>): PqwVector<T> => v as PqwVector<T>;
/** Tag a vector as RTN. */
export const rtn = <T extends number>(v: Vec3<T>): RtnVector<T> => v as RtnVector<T>;
/** Tag a vector as body-fixed. */
export const ecef = <T extends number>(v: Vec3<T>): EcefVector<T> => v as EcefVector<T>;

/**
 * Rotation taking perifocal components to inertial ones.
 *
 * The classical 3-1-3 sequence `Rz(Ω)·Rx(i)·Rz(ω)`: rotate by the argument of
 * periapsis about the angular-momentum axis, tilt by the inclination, then swing
 * by the right ascension of the ascending node.
 *
 * At `i = 0` the node line is undefined and Ω and ω are not separately meaningful;
 * only their sum is. This function is still correct there — the composed rotation
 * depends only on `Ω + ω` — which is why the degenerate case is handled by the
 * element set rather than here. See `docs/PHYSICS.md`.
 */
export const perifocalToInertialMatrix = (
  raan: Radians,
  inclination: Radians,
  argp: Radians,
): Mat3 => M.multiply(M.multiply(M.rotationZ(raan), M.rotationX(inclination)), M.rotationZ(argp));

/** Rotation taking inertial components to perifocal ones. The transpose. */
export const inertialToPerifocalMatrix = (
  raan: Radians,
  inclination: Radians,
  argp: Radians,
): Mat3 => M.transpose(perifocalToInertialMatrix(raan, inclination, argp));

/** Apply a perifocal-to-inertial rotation, carrying the frame tag with it. */
export const pqwToEci = <T extends number>(m: Mat3, v: PqwVector<T>): EciVector<T> =>
  eci(M.apply(m, v));

/** Apply an inertial-to-perifocal rotation. */
export const eciToPqw = <T extends number>(m: Mat3, v: EciVector<T>): PqwVector<T> =>
  pqw(M.apply(m, v));

/**
 * The RTN basis for a state, as a rotation from inertial to RTN components.
 *
 * ```
 * R = r / |r|                 radial, outward
 * N = (r x v) / |r x v|       normal, along angular momentum
 * T = N x R                   transverse, completing the right-handed set
 * ```
 *
 * `T` is *transverse*, not along-velocity: the two coincide only for circular
 * orbits and differ by the flight-path angle otherwise. The UI calls this axis
 * "prograde" because that is the word players know, which is a naming departure
 * recorded as DEP-10 and living in the game layer, not here.
 *
 * @throws RangeError when position and velocity are parallel. Angular momentum is
 * then zero, the orbit is rectilinear, and RTN is undefined. Returning a basis full
 * of `NaN` would let that travel silently into a maneuver.
 */
export const eciToRtnMatrix = (
  position: EciVector<Metres>,
  velocity: EciVector<MetresPerSec>,
): Mat3 => {
  const h = V.cross(position, velocity);
  if (V.normSq(h) === 0) {
    throw new RangeError(
      'RTN is undefined for a rectilinear orbit: position and velocity are parallel',
    );
  }
  const r = V.normalize(position);
  const n = V.normalize(h);
  const t = V.cross(n, r);
  return [r.x, r.y, r.z, t.x, t.y, t.z, n.x, n.y, n.z];
};

/** The RTN basis as a rotation from RTN components to inertial ones. */
export const rtnToEciMatrix = (
  position: EciVector<Metres>,
  velocity: EciVector<MetresPerSec>,
): Mat3 => M.transpose(eciToRtnMatrix(position, velocity));

/** Express an inertial vector in the RTN frame of the given state. */
export const toRtn = <T extends number>(
  value: EciVector<T>,
  position: EciVector<Metres>,
  velocity: EciVector<MetresPerSec>,
): RtnVector<T> => rtn(M.apply(eciToRtnMatrix(position, velocity), value));

/**
 * Express an RTN vector in the inertial frame of the given state.
 *
 * This is the conversion every maneuver goes through: the player expresses a
 * delta-v as prograde and radial components, and it becomes an inertial vector.
 */
export const fromRtn = <T extends number>(
  value: RtnVector<T>,
  position: EciVector<Metres>,
  velocity: EciVector<MetresPerSec>,
): EciVector<T> => eci(M.apply(rtnToEciMatrix(position, velocity), value));

/**
 * Rotation taking body-fixed components to inertial ones, given the body's
 * rotation angle at the instant of interest.
 *
 * A single rotation about z. That is the whole of the model: no precession, no
 * nutation, no polar motion, and no pole offset — the body-fixed z axis and the
 * inertial z axis are the same axis, and the two frames differ by one angle.
 *
 * **The angle is a parameter, and it is not an epoch.** Turning an epoch into a
 * rotation angle needs a reference angle at a reference epoch — for Earth, a
 * sidereal-time model — which is data with a source and an attribution row.
 * Nothing in v1.0 needs one: the only consumer is ground-station visibility, and a
 * scenario states the station's rotation angle at the scenario epoch because that
 * is a *scenario* fact, not a physical constant. Taking the angle rather than the
 * epoch keeps the choice of sidereal-time model out of the core, in the same way
 * that `elementsFromState` takes `mu` rather than assuming Earth.
 *
 * **This rotation is kinematic only.** The body-fixed frame is not inertial and
 * nothing is propagated in it: `docs/PHYSICS.md` is explicit that Earth's rotation
 * affects nothing dynamical. It moves a station; it does not move a spacecraft.
 */
export const bodyFixedToInertialMatrix = (rotationAngle: Radians): Mat3 =>
  M.rotationZ(rotationAngle);

/** Rotation taking inertial components to body-fixed ones. The transpose. */
export const inertialToBodyFixedMatrix = (rotationAngle: Radians): Mat3 =>
  M.transpose(bodyFixedToInertialMatrix(rotationAngle));

/** Apply a body-fixed-to-inertial rotation, carrying the frame tag with it. */
export const ecefToEci = <T extends number>(m: Mat3, v: EcefVector<T>): EciVector<T> =>
  eci(M.apply(m, v));

/** Apply an inertial-to-body-fixed rotation. */
export const eciToEcef = <T extends number>(m: Mat3, v: EciVector<T>): EcefVector<T> =>
  ecef(M.apply(m, v));
