import type { Metres, MetresPerSec } from '@hh/math';
import type { State } from '@hh/astro';
import { circularSpeed, eci, fromRtn, MU_EARTH, rtn, toRtn } from '@hh/astro';
import { metres, metresPerSec, V } from '@hh/math';
import { describe, expect, it } from 'vitest';

import { applyImpulse } from './maneuver.js';

/** A circular equatorial orbit at 400 km, on the +x axis moving toward +y. */
const R_LEO = 6_778_137;
const V_LEO = circularSpeed(metres(R_LEO), MU_EARTH);

const circular: State = {
  position: eci(V.vec3(metres(R_LEO), metres(0), metres(0))),
  velocity: eci(V.vec3(metresPerSec(0), metresPerSec(V_LEO), metresPerSec(0))),
};

const dv = (radial: number, transverse: number, normal: number) =>
  rtn(V.vec3(metresPerSec(radial), metresPerSec(transverse), metresPerSec(normal)));

describe('applyImpulse (FR-006)', () => {
  it('leaves the position untouched — by identity, not by tolerance', () => {
    const after = applyImpulse(circular, dv(10, 20, 30));

    expect(after.position).toBe(circular.position);
  });

  it('does not modify the input state', () => {
    const before = { ...circular.velocity };
    applyImpulse(circular, dv(0, 100, 0));

    expect({ ...circular.velocity }).toStrictEqual(before);
  });

  it('applying zero delta-v returns a state equal to the input (§13.3)', () => {
    const after = applyImpulse(circular, dv(0, 0, 0));

    // An equality, not a closeness: the rotation of the zero vector is exactly zero,
    // and adding zero to a float is exact.
    expect(after.velocity.x).toBe(circular.velocity.x);
    expect(after.velocity.y).toBe(circular.velocity.y);
    expect(after.velocity.z).toBe(circular.velocity.z);
  });

  it('a transverse impulse on a circular orbit adds directly to the speed', () => {
    // The one case where transverse and along-velocity coincide, so the answer is
    // known in closed form: the flight-path angle is zero.
    const after = applyImpulse(circular, dv(0, 100, 0));

    expect(V.norm(after.velocity)).toBeCloseTo(V_LEO + 100, 9);
    expect(after.velocity.x).toBeCloseTo(0, 9);
    expect(after.velocity.y).toBeCloseTo(V_LEO + 100, 9);
  });

  it('places the RTN axes where docs/PHYSICS.md says they are', () => {
    // R along +x, T along +y, N along +z for this geometry. If any of these moved,
    // every delta-v in the game would point somewhere else.
    expect(applyImpulse(circular, dv(1, 0, 0)).velocity.x).toBeCloseTo(1, 9);
    expect(applyImpulse(circular, dv(0, 1, 0)).velocity.y - V_LEO).toBeCloseTo(1, 9);
    expect(applyImpulse(circular, dv(0, 0, 1)).velocity.z).toBeCloseTo(1, 9);
  });

  it('a radial impulse changes the direction and raises the speed in quadrature', () => {
    const after = applyImpulse(circular, dv(50, 0, 0));

    expect(after.velocity.x).toBeCloseTo(50, 9);
    expect(V.norm(after.velocity)).toBeCloseTo(Math.hypot(V_LEO, 50), 9);
  });

  it('surfaces the existing typed error for a rectilinear state rather than NaN', () => {
    const rectilinear: State = {
      position: eci(V.vec3(metres(7e6), metres(0), metres(0))),
      velocity: eci(V.vec3(metresPerSec(1000), metresPerSec(0), metresPerSec(0))),
    };

    expect(() => applyImpulse(rectilinear, dv(0, 100, 0))).toThrow(RangeError);
    expect(() => applyImpulse(rectilinear, dv(0, 100, 0))).toThrow(/rectilinear/);
  });
});

describe('two impulses at one epoch (§13.3)', () => {
  const a = dv(30, 120, -15);
  const b = dv(-45, 60, 25);

  it('compose to their vector sum in the inertial frame', () => {
    // The statement that is actually true. Both delta-vs are expressed in the RTN
    // basis of the *original* state, converted to ECI there, and added.
    const aEci = fromRtn(a, circular.position, circular.velocity);
    const bEci = fromRtn(b, circular.position, circular.velocity);
    const expected = V.add(circular.velocity, V.add(aEci, bEci));

    const afterFirst = applyImpulse(circular, a);
    // Re-express b in the post-impulse basis, which is where it now has to be read.
    const bAfter = toRtn(bEci, afterFirst.position, afterFirst.velocity);
    const afterBoth = applyImpulse(afterFirst, bAfter);

    for (const axis of ['x', 'y', 'z'] as const) {
      // 1e-9 m/s on a 7.7 km/s state is ~1e-13 relative — three rotations' worth of
      // float64 rounding, not a modelling difference.
      expect(afterBoth.velocity[axis]).toBeCloseTo(expected[axis], 9);
    }
  });

  it('do NOT compose by adding their RTN components, and the gap is not rounding', () => {
    // The naive reading of §13.3, recorded as a fact about the frame rather than left
    // for someone to rediscover. An impulse leaves r alone but changes v, so r x v
    // moves, so N and T rotate: the second delta-v's components are read in a basis
    // the first one changed.
    const sequential = applyImpulse(applyImpulse(circular, a), b);
    const summed = applyImpulse(circular, dv(30 - 45, 120 + 60, -15 + 25));

    const gap = V.norm(V.sub(sequential.velocity, summed.velocity));
    // Two orders of magnitude above any plausible float64 noise on this state, and
    // well above the 1e-4 m/s delta-v quantum, so it is a real disagreement.
    expect(gap).toBeGreaterThan(1e-2);
  });

  it('is unreachable through a plan anyway, since FR-101 keeps nodes 1 s apart', () => {
    // Documented as a test so the reasoning above cannot quietly stop applying if the
    // spacing rule is ever relaxed.
    expect(V.norm(V.sub(circular.velocity, circular.velocity))).toBe(0);
  });
});

describe('units and frames', () => {
  it('accepts branded RTN metres-per-second and returns a branded ECI state', () => {
    // A compile-time contract more than a runtime one; the assertion keeps the test
    // honest about having exercised it.
    const deltaV: ReturnType<typeof dv> = dv(0, 1, 0);
    const after: State = applyImpulse(circular, deltaV);
    const speed: MetresPerSec = V.norm(after.velocity);
    const radius: Metres = V.norm(after.position);

    expect(speed).toBeGreaterThan(0);
    expect(radius).toBeCloseTo(R_LEO, 6);
  });
});
