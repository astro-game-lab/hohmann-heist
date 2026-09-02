/**
 * The `Arc` value object (#57, FR-102).
 *
 * The interesting assertions here are about *identity*, not about numbers: that a
 * derived arc leaves its origin alone, that the element cache is a cache and not a
 * recomputation, and that an arc evaluated at its own start epoch gives back the
 * state it was built from rather than one that merely agrees with it. Those are the
 * properties FR-104's incremental recompute depends on, and none of them is visible
 * in a tolerance.
 */
import { MU_EARTH, eci, epoch, stateFromElements } from '@hh/astro';
import type { State } from '@hh/astro';
import { V, metres, radians } from '@hh/math';
import { describe, expect, it } from 'vitest';

import {
  containsEpoch,
  createArc,
  duration,
  stateAt,
  withEndEpoch,
  withStartEpoch,
  withState,
} from './arc.js';

const orbit = (a: number, e: number, nu: number, inclination = 0.4): State =>
  stateFromElements(
    {
      semiLatusRectum: metres(Math.abs(a * (1 - e * e))),
      eccentricity: e,
      inclination: radians(inclination),
      raan: radians(1.1),
      argp: radians(2.2),
      trueAnomaly: radians(nu),
    },
    MU_EARTH,
  );

const START = epoch(1_000_000);
const END = epoch(1_050_000);

const arcOf = (state: State = orbit(1.2e7, 0.3, 0.6)) =>
  createArc({ startEpoch: START, endEpoch: END, state, mu: MU_EARTH });

describe('construction', () => {
  it('carries its span, its state and its central body', () => {
    const arc = arcOf();
    expect(arc.startEpoch).toBe(START);
    expect(arc.endEpoch).toBe(END);
    expect(arc.mu).toBe(MU_EARTH);
    expect(duration(arc)).toBe(50_000);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(arcOf())).toBe(true);
  });

  it('accepts a zero-length span, which a plan with two impulses at one epoch produces', () => {
    const arc = createArc({
      startEpoch: START,
      endEpoch: START,
      state: orbit(1.2e7, 0.3, 0.6),
      mu: MU_EARTH,
    });
    expect(duration(arc)).toBe(0);
    expect(containsEpoch(arc, START)).toBe(true);
  });

  it.each([
    ['a span that ends before it starts', { endEpoch: epoch(START - 1) }],
    ['a non-finite start epoch', { startEpoch: epoch(Number.NaN) }],
    ['a non-finite end epoch', { endEpoch: epoch(Number.POSITIVE_INFINITY) }],
  ])('rejects %s', (_label, override) => {
    expect(() =>
      createArc({
        startEpoch: START,
        endEpoch: END,
        state: orbit(1.2e7, 0.3, 0.6),
        mu: MU_EARTH,
        ...override,
      }),
    ).toThrow(RangeError);
  });

  it.each([
    ['zero', 0],
    ['negative', -MU_EARTH],
    ['non-finite', Number.POSITIVE_INFINITY],
  ])('rejects a %s gravitational parameter', (_label, mu) => {
    expect(() =>
      createArc({ startEpoch: START, endEpoch: END, state: orbit(1.2e7, 0.3, 0.6), mu }),
    ).toThrow(RangeError);
  });

  it('rejects a rectilinear state at construction, not at first element access', () => {
    const radial = orbit(1.2e7, 0.3, 0.6);
    const rectilinear: State = {
      position: radial.position,
      // Velocity parallel to position: the angular momentum vanishes and the orbital
      // plane is undefined. `docs/PHYSICS.md` says this is rejected at construction.
      velocity: eci(V.scale(radial.velocity, 0)),
    };
    expect(() =>
      createArc({ startEpoch: START, endEpoch: END, state: rectilinear, mu: MU_EARTH }),
    ).toThrow(RangeError);
  });
});

describe('the element cache', () => {
  it('computes elements once and returns the same object thereafter', () => {
    const arc = arcOf();
    const first = arc.elements;
    const second = arc.elements;
    // Reference equality, not deep equality: a recomputation would produce an equal
    // object, so only identity distinguishes a cache from a repeated calculation.
    expect(second).toBe(first);
    expect(arc.elements).toBe(first);
  });

  it('describes the orbit the arc was built from', () => {
    const arc = createArc({
      startEpoch: START,
      endEpoch: END,
      state: orbit(1.2e7, 0.3, 0.6),
      mu: MU_EARTH,
    });
    expect(arc.elements.eccentricity).toBeCloseTo(0.3, 12);
    expect(arc.elements.semiLatusRectum).toBeCloseTo(1.2e7 * (1 - 0.09), 4);
    expect(arc.elements.degeneracy).toBe('none');
  });

  it.each([
    ['circular', 0, 0.4, 'circular'],
    ['equatorial', 0.3, 0, 'equatorial'],
    ['circular equatorial', 0, 0, 'circular-equatorial'],
    ['retrograde equatorial', 0.3, Math.PI, 'equatorial'],
  ])('reports a %s orbit rather than erroring on it', (_label, e, inclination, degeneracy) => {
    const arc = createArc({
      startEpoch: START,
      endEpoch: END,
      state: orbit(1.2e7, e, 0.6, inclination),
      mu: MU_EARTH,
    });
    expect(arc.elements.degeneracy).toBe(degeneracy);
    expect(Number.isFinite(arc.elements.semiLatusRectum)).toBe(true);
    expect(Number.isNaN(arc.elements.raan)).toBe(false);
    expect(Number.isNaN(arc.elements.argp)).toBe(false);
    expect(Number.isNaN(arc.elements.trueAnomaly)).toBe(false);
  });
});

describe('derivation leaves the original alone (FR-104)', () => {
  it('a new state gives a new arc with its own elements, and does not touch the old one', () => {
    const original = arcOf(orbit(1.2e7, 0.3, 0.6));
    const originalElements = original.elements;

    const edited = withState(original, orbit(2.4e7, 0.7, 1.9));

    expect(edited).not.toBe(original);
    expect(edited.elements).not.toBe(originalElements);
    expect(edited.elements.eccentricity).toBeCloseTo(0.7, 12);

    // The origin is bit-for-bit what it was, cache included. This is the property an
    // undo stack or a cached tessellation holding arc k-1 relies on.
    expect(original.elements).toBe(originalElements);
    expect(original.elements.eccentricity).toBeCloseTo(0.3, 12);
  });

  it('changing an epoch leaves the state alone and re-derives the elements', () => {
    const original = arcOf();
    const originalElements = original.elements;

    const moved = withStartEpoch(original, epoch(START + 500));
    const shortened = withEndEpoch(original, epoch(END - 500));

    expect(moved.state).toBe(original.state);
    expect(shortened.state).toBe(original.state);
    expect(moved.startEpoch).toBe(START + 500);
    expect(shortened.endEpoch).toBe(END - 500);

    // Equal in value, because the elements depend on the state and the state did not
    // change; a distinct object, because a cache never outlives the arc it was
    // derived for.
    expect(shortened.elements).not.toBe(originalElements);
    expect(shortened.elements.eccentricity).toBe(originalElements.eccentricity);
    expect(original.endEpoch).toBe(END);
  });

  it('derives without evaluating the cache it is deriving from', () => {
    // `withState` on an arc whose elements were never touched must not force them.
    const original = arcOf();
    const edited = withState(original, orbit(3e7, 0.1, 1.1));
    expect(edited.elements.eccentricity).toBeCloseTo(0.1, 12);
    expect(original.elements.eccentricity).toBeCloseTo(0.3, 12);
  });
});

describe('evaluation', () => {
  it('returns the initial state exactly at its own start epoch', () => {
    const state = orbit(1.2e7, 0.3, 0.6);
    const arc = arcOf(state);
    const result = stateAt(arc, START);
    expect(result.converged).toBe(true);
    if (!result.converged) return;
    // Reference equality. #57 asks for the initial state, not for a state that
    // agrees with it to round-off.
    expect(result.state).toBe(state);
  });

  it('propagates to an epoch inside the span', () => {
    const arc = arcOf();
    const mid = epoch((START + END) / 2);
    const result = stateAt(arc, mid);
    expect(result.converged).toBe(true);
    if (!result.converged) return;
    expect(V.norm(result.state.position)).toBeGreaterThan(0);
    // Coming back the other way reproduces the start.
    const back = stateAt(
      createArc({ startEpoch: mid, endEpoch: END, state: result.state, mu: arc.mu }),
      START,
    );
    expect(back.converged).toBe(true);
    if (!back.converged) return;
    expect(
      V.distance(back.state.position, arc.state.position) / V.norm(arc.state.position),
    ).toBeLessThan(1e-13);
  });

  it('evaluates outside the span, because the conic is defined there', () => {
    const arc = arcOf();
    const outside = epoch(END + 100_000);
    expect(containsEpoch(arc, outside)).toBe(false);
    const result = stateAt(arc, outside);
    // An event search brackets across an arc boundary, so refusing would break a
    // caller doing nothing wrong. `containsEpoch` is what a timeline asks instead.
    expect(result.converged).toBe(true);
  });

  it('reports span membership at both ends', () => {
    const arc = arcOf();
    expect(containsEpoch(arc, START)).toBe(true);
    expect(containsEpoch(arc, END)).toBe(true);
    expect(containsEpoch(arc, epoch(START - 1))).toBe(false);
    expect(containsEpoch(arc, epoch(END + 1))).toBe(false);
  });

  it('is a pure function of the arc and the epoch', () => {
    const arc = arcOf();
    const at = epoch(START + 12_345);
    expect(stateAt(arc, at)).toStrictEqual(stateAt(arc, at));
  });
});
