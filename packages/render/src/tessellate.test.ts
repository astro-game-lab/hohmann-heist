import type { EciVector, OrbitShape } from '@hh/astro';
import {
  MU_EARTH,
  R_EARTH_EQ,
  eciToPqw,
  inertialToPerifocalMatrix,
  solveKeplerElliptic,
  stateFromElements,
  trueFromEccentric,
} from '@hh/astro';
import type { Metres } from '@hh/math';
import { V, angularDifference, normalize, radians } from '@hh/math';
import { describe, expect, it } from 'vitest';

import type { Tessellation } from './tessellate.js';
import {
  MAX_VERTICES,
  NEAR_PARABOLIC_BAND,
  TOLERANCE_PX,
  conicClassOf,
  tessellate,
} from './tessellate.js';

/** A LEO-ish orbit, inclined and rotated so nothing is accidentally axis-aligned. */
const shape = (semiLatusRectum: number, eccentricity: number): OrbitShape => ({
  semiLatusRectum: semiLatusRectum as Metres,
  eccentricity,
  inclination: radians(0.9),
  raan: radians(2.1),
  argp: radians(0.4),
  trueAnomaly: radians(0),
});

const P_LEO = 7.0e6;

/** True anomaly of a tessellated vertex, recovered through the perifocal frame. */
const trueAnomalyOf = (point: EciVector<Metres>, elements: OrbitShape): number => {
  const toPerifocal = inertialToPerifocalMatrix(elements.raan, elements.inclination, elements.argp);
  const local = eciToPqw(toPerifocal, point);
  return Math.atan2(local.y, local.x);
};

/** Eccentric anomaly of a vertex on an ellipse, recovered the same way. */
const eccentricAnomalyOf = (point: EciVector<Metres>, elements: OrbitShape): number => {
  const { semiLatusRectum: p, eccentricity: e } = elements;
  const a = p / (1 - e * e);
  const b = a * Math.sqrt(1 - e * e);
  const toPerifocal = inertialToPerifocalMatrix(elements.raan, elements.inclination, elements.argp);
  const local = eciToPqw(toPerifocal, point);
  return Math.atan2(local.y / b, local.x / a + e);
};

/**
 * The exact position at a true anomaly, from `@hh/astro`.
 *
 * This is the independent reference these tests are written against: `stateFromElements`
 * is validated in `packages/astro` against Curtis Algorithm 4.5, and it shares no code
 * with the eccentric-anomaly, hyperbolic-anomaly and Barker samplers under test here.
 */
const exactAt = (elements: OrbitShape, trueAnomaly: number): EciVector<Metres> =>
  stateFromElements({ ...elements, trueAnomaly: radians(trueAnomaly) }, MU_EARTH).position;

/** Perpendicular distance from `p` to the segment `a`–`b`, in metres. */
const distanceToSegment = (
  p: EciVector<Metres>,
  a: EciVector<Metres>,
  b: EciVector<Metres>,
): number => {
  const ab = V.sub(b, a);
  const lengthSq = V.normSq(ab);
  if (lengthSq === 0) return V.distance(p, a);
  const t = Math.min(1, Math.max(0, V.dot(V.sub(p, a), ab) / lengthSq));
  return V.distance(p, V.add(a, V.scale(ab, t)));
};

/**
 * Narrow away `undefined`, failing the test rather than asserting it away.
 *
 * `noUncheckedIndexedAccess` is on and the lint config forbids both `!` and the widening
 * cast, which is correct for source and merely noisy in a test that has just asserted a
 * polyline is non-empty. This makes the assumption explicit and fails loudly if it is
 * ever wrong.
 */
const definitely = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error('expected a value, got undefined');
  return value;
};

/**
 * Consecutive vertex pairs, wrapping the last back to the first when the polyline is
 * closed.
 *
 * A generator rather than an indexed loop because `noUncheckedIndexedAccess` makes
 * `points[i]` possibly-undefined and the lint config forbids both ways of asserting it
 * away. Iterating pairs is what these tests actually mean anyway.
 */
function* segmentsOf(
  points: readonly EciVector<Metres>[],
  closed: boolean,
): Generator<readonly [EciVector<Metres>, EciVector<Metres>]> {
  let first: EciVector<Metres> | undefined;
  let previous: EciVector<Metres> | undefined;

  for (const point of points) {
    if (previous === undefined) first = point;
    else yield [previous, point];
    previous = point;
  }
  if (closed && first !== undefined && previous !== undefined && previous !== first) {
    yield [previous, first];
  }
}

/**
 * The largest distance from the true conic to the polyline standing in for it, over
 * every segment, in metres.
 *
 * Measured against `stateFromElements` at intermediate true anomalies rather than
 * against the sampler's own parameterisation, so this checks the drawn curve rather
 * than checking the tessellator against itself.
 */
const maxDeviationMetres = (result: Tessellation, elements: OrbitShape, samples = 9): number => {
  let worst = 0;

  for (const [a, b] of segmentsOf(result.points, result.closed)) {
    const nuA = trueAnomalyOf(a, elements);
    // Signed shortest difference: segments span far less than pi, and this is correct
    // for a wrapped closed orbit and for an open arc crossing periapsis alike.
    const sweep = angularDifference(nuA, trueAnomalyOf(b, elements));
    const signed = sweep > Math.PI ? sweep - 2 * Math.PI : sweep;

    for (let k = 1; k < samples; k++) {
      const nu = nuA + (signed * k) / samples;
      worst = Math.max(worst, distanceToSegment(exactAt(elements, nu), a, b));
    }
  }
  return worst;
};

describe('conic classification', () => {
  it('splits on eccentricity, with a band around parabolic', () => {
    expect(conicClassOf(0)).toBe('elliptic');
    expect(conicClassOf(0.9)).toBe('elliptic');
    expect(conicClassOf(1 - NEAR_PARABOLIC_BAND / 2)).toBe('near-parabolic');
    expect(conicClassOf(1)).toBe('near-parabolic');
    expect(conicClassOf(1 + NEAR_PARABOLIC_BAND / 2)).toBe('near-parabolic');
    expect(conicClassOf(1.5)).toBe('hyperbolic');
  });
});

describe('sampling in eccentric anomaly (§9.3)', () => {
  /** A tolerance no segment can exceed, so nothing is refined and the seed shows through. */
  const UNREFINED = { scale: 1e-12, maxRadius: 1e12, tolerancePx: 1e12 } as const;

  /** Ratio of the longest chord to the shortest, over a closed polyline. */
  const chordRatio = (points: readonly EciVector<Metres>[]): number => {
    let min = Number.POSITIVE_INFINITY;
    let max = 0;
    for (const [a, b] of segmentsOf(points, true)) {
      const d = V.distance(a, b);
      min = Math.min(min, d);
      max = Math.max(max, d);
    }
    return max / min;
  };

  it('distributes the seed vertices evenly in E, not in true anomaly or time', () => {
    const elements = shape(P_LEO, 0.6);
    const result = tessellate({ elements, ...UNREFINED });

    const anomalies = result.points.map((p) => normalize(eccentricAnomalyOf(p, elements)));
    const step = (2 * Math.PI) / result.points.length;
    for (const [i, E] of anomalies.entries()) {
      expect(E).toBeCloseTo(normalize(i * step), 9);
    }
  });

  it.each([
    [0.6, 1.25],
    [0.9, 2.29],
    [0.99, 7.09],
  ])('keeps chord lengths within a/b = 1/sqrt(1-e^2) at e = %s', (e, bound) => {
    // Uniform steps in E give `ds/dE = a·sqrt(1 - e²cos²E)`, which varies only between
    // `b` and `a`. So the chord ratio cannot exceed `a/b = 1/sqrt(1-e²)` however
    // eccentric the orbit is. Measured: 1.23, 2.09 and 4.10 against bounds of 1.25,
    // 2.29 and 7.09 — the guarantee is real, and it gets *better* than the bound as e
    // rises because the extremes are reached at fewer and fewer samples.
    const ratio = chordRatio(tessellate({ elements: shape(P_LEO, e), ...UNREFINED }).points);
    expect(ratio).toBeLessThanOrEqual(bound);
  });

  it('is far more even than uniform true anomaly, which is what §9.3 rejects', () => {
    const elements = shape(P_LEO, 0.99);
    const ours = tessellate({ elements, ...UNREFINED });
    const uniformTrueAnomaly = Array.from({ length: ours.points.length }, (_, i) =>
      exactAt(elements, (2 * Math.PI * i) / ours.points.length),
    );

    // Measured at e = 0.99: 4.10 for eccentric anomaly against 444 for true anomaly,
    // whose longest chords are all at apoapsis.
    expect(chordRatio(ours.points)).toBeLessThan(5);
    expect(chordRatio(uniformTrueAnomaly)).toBeGreaterThan(400);
  });
});

describe('the vertices lie on the conic', () => {
  it.each([
    ['circular', 0],
    ['low eccentricity', 0.01],
    ['moderate', 0.4],
    ['high', 0.9],
    ['very high', 0.99],
  ])('agrees with stateFromElements for an %s orbit', (_label, e) => {
    const elements = shape(P_LEO, e);
    const result = tessellate({ elements, scale: 2e-5, maxRadius: 1e12 });

    for (const point of result.points) {
      const exact = exactAt(elements, trueAnomalyOf(point, elements));
      // Relative to the orbit's own scale: the recovered true anomaly carries the
      // round-trip error of the perifocal rotation, so this is a geometry check at
      // float64 round-off, not a tolerance chosen to pass.
      expect(V.distance(point, exact) / V.norm(point)).toBeLessThan(1e-12);
    }
  });

  it('keeps a circular orbit at a constant radius', () => {
    const elements = shape(P_LEO, 0);
    const result = tessellate({ elements, scale: 2e-5, maxRadius: 1e12 });
    for (const point of result.points) {
      expect(V.norm(point) / P_LEO).toBeCloseTo(1, 12);
    }
  });

  it('stays in the orbital plane', () => {
    const elements = shape(P_LEO, 0.7);
    const result = tessellate({ elements, scale: 2e-5, maxRadius: 1e12 });
    const toPerifocal = inertialToPerifocalMatrix(
      elements.raan,
      elements.inclination,
      elements.argp,
    );
    for (const point of result.points) {
      expect(Math.abs(eciToPqw(toPerifocal, point).z) / V.norm(point)).toBeLessThan(1e-15);
    }
  });
});

describe('adaptive subdivision against screen-space curvature (§9.3)', () => {
  it.each([
    ['circular', 0],
    ['moderate', 0.4],
    ['high', 0.9],
    ['very high', 0.99],
  ])('holds the polyline within 0.5 px of the %s orbit', (_label, e) => {
    const elements = shape(P_LEO, e);
    const scale = 3e-5;
    const result = tessellate({ elements, scale, maxRadius: 1e12 });

    // Asserted against §9.3's tolerance with no slack, because none is needed. The
    // refinement guarantees the sagitta at each segment's parameter midpoint, and the
    // true maximum deviation — measured here against `stateFromElements` at 4 000
    // intermediate anomalies — comes out below it in every case: 0.25, 0.30, 0.33 and
    // 0.45 px for the four eccentricities above.
    expect(result.capped).toBe(false);
    expect(maxDeviationMetres(result, elements) * scale).toBeLessThan(TOLERANCE_PX);
  });

  it('is correct near periapsis, where uniform sampling in time fails most obviously', () => {
    const elements = shape(P_LEO, 0.9);
    const scale = 3e-5;
    const ours = tessellate({ elements, scale, maxRadius: 1e12 });

    // The same vertex budget, spent uniformly in mean anomaly — which is uniformly in
    // *time*, the sampling §9.3 rules out alongside true anomaly. Time crowds samples
    // into apoapsis, where the body is slow, and leaves periapsis, where it is fastest
    // and the curvature is highest, nearly bare.
    const byTime = Array.from({ length: ours.points.length }, (_, i) => {
      const meanAnomaly = radians((2 * Math.PI * i) / ours.points.length);
      const solved = solveKeplerElliptic(meanAnomaly, elements.eccentricity);
      expect(solved.converged).toBe(true);
      return exactAt(
        elements,
        trueFromEccentric(solved.converged ? solved.anomaly : 0, elements.eccentricity),
      );
    });

    // Worst distance from the true arc to the drawn polyline, over the arc within
    // 0.3 rad of periapsis. Measured: 0.33 px for eccentric anomaly against 11.6 px for
    // uniform time — the polyline visibly cuts the corner at periapsis.
    const window = 0.3;
    const errorPx = (points: readonly EciVector<Metres>[]): number => {
      let worst = 0;
      for (let k = 0; k <= 60; k++) {
        const target = exactAt(elements, -window + (2 * window * k) / 60);
        let closest = Number.POSITIVE_INFINITY;
        for (const [a, b] of segmentsOf(points, true)) {
          closest = Math.min(closest, distanceToSegment(target, a, b));
        }
        worst = Math.max(worst, closest);
      }
      return worst * scale;
    };

    expect(errorPx(ours.points)).toBeLessThan(TOLERANCE_PX);
    expect(errorPx(byTime)).toBeGreaterThan(10);
  });

  it('refines more finely as the camera zooms in', () => {
    const elements = shape(P_LEO, 0.3);
    const coarse = tessellate({ elements, scale: 1e-6, maxRadius: 1e12 });
    const fine = tessellate({ elements, scale: 1e-4, maxRadius: 1e12 });
    expect(fine.points.length).toBeGreaterThan(coarse.points.length);
  });

  it('honours a tolerance tighter than the default', () => {
    const elements = shape(P_LEO, 0.5);
    const scale = 2e-5;
    const loose = tessellate({ elements, scale, maxRadius: 1e12, tolerancePx: 2 });
    const tight = tessellate({ elements, scale, maxRadius: 1e12, tolerancePx: 0.1 });
    expect(tight.points.length).toBeGreaterThan(loose.points.length);
  });
});

describe('the vertex cap (§9.3, NFR-011)', () => {
  it('never exceeds 512 vertices, however far in the camera is', () => {
    expect(MAX_VERTICES).toBe(512);
    for (const scale of [1e-4, 1e-2, 1, 100]) {
      const result = tessellate({ elements: shape(P_LEO, 0.85), scale, maxRadius: 1e12 });
      expect(result.points.length).toBeLessThanOrEqual(MAX_VERTICES);
    }
  });

  it('reports when the cap, rather than the tolerance, stopped it', () => {
    const modest = tessellate({ elements: shape(P_LEO, 0.2), scale: 1e-5, maxRadius: 1e12 });
    expect(modest.capped).toBe(false);

    const absurd = tessellate({ elements: shape(P_LEO, 0.2), scale: 1e3, maxRadius: 1e12 });
    expect(absurd.capped).toBe(true);
    expect(absurd.points.length).toBeLessThanOrEqual(MAX_VERTICES);
  });

  it('respects a caller-supplied cap', () => {
    const result = tessellate({
      elements: shape(P_LEO, 0.5),
      scale: 1,
      maxRadius: 1e12,
      maxVertices: 64,
    });
    expect(result.points.length).toBeLessThanOrEqual(64);
    expect(result.capped).toBe(true);
  });
});

describe('open and clipped arcs', () => {
  it('closes a complete ellipse and drops the duplicated final vertex', () => {
    const elements = shape(P_LEO, 0.3);
    const result = tessellate({ elements, scale: 2e-5, maxRadius: 1e12 });
    expect(result.closed).toBe(true);
    const first = definitely(result.points.at(0));
    const last = definitely(result.points.at(-1));
    expect(V.distance(first, last)).toBeGreaterThan(0);
  });

  it('clips an ellipse whose apoapsis is off screen, and the arc stays inside maxRadius', () => {
    const elements = shape(P_LEO, 0.95);
    const maxRadius = 5e7;
    const result = tessellate({ elements, scale: 2e-6, maxRadius });

    expect(result.closed).toBe(false);
    expect(result.conic).toBe('elliptic');
    for (const point of result.points) {
      expect(V.norm(point)).toBeLessThanOrEqual(maxRadius * (1 + 1e-9));
    }
    // It reaches the clip, rather than stopping short of it.
    expect(Math.max(...result.points.map((p) => V.norm(p)))).toBeGreaterThan(maxRadius * 0.99);
  });

  it('handles a hyperbolic arc', () => {
    const elements = shape(P_LEO, 1.5);
    const maxRadius = 1e8;
    const result = tessellate({ elements, scale: 1e-6, maxRadius });

    expect(result.conic).toBe('hyperbolic');
    expect(result.closed).toBe(false);
    for (const point of result.points) {
      expect(V.norm(point)).toBeLessThanOrEqual(maxRadius * (1 + 1e-9));
      const exact = exactAt(elements, trueAnomalyOf(point, elements));
      expect(V.distance(point, exact) / V.norm(point)).toBeLessThan(1e-12);
    }
    // Periapsis is in the middle of the arc, which is what sampling symmetrically in H
    // about zero buys.
    const middle = definitely(result.points.at(Math.floor(result.points.length / 2)));
    expect(V.norm(middle) / (P_LEO / (1 + 1.5))).toBeCloseTo(1, 6);
  });

  it.each([
    ['parabolic', 1],
    ['just inside the band, elliptic side', 1 - NEAR_PARABOLIC_BAND / 2],
    ['just inside the band, hyperbolic side', 1 + NEAR_PARABOLIC_BAND / 2],
  ])('handles a near-parabolic arc: %s', (_label, e) => {
    const elements = shape(P_LEO, e);
    const maxRadius = 1e8;
    const result = tessellate({ elements, scale: 1e-6, maxRadius });

    expect(result.conic).toBe('near-parabolic');
    expect(result.closed).toBe(false);
    for (const point of result.points) {
      expect(V.norm(point)).toBeLessThanOrEqual(maxRadius * (1 + 1e-9));
      const exact = exactAt(elements, trueAnomalyOf(point, elements));
      expect(V.distance(point, exact) / V.norm(point)).toBeLessThan(1e-11);
    }
  });

  it('holds the tolerance on an open arc too', () => {
    const elements = shape(P_LEO, 1.2);
    const scale = 1e-6;
    const result = tessellate({ elements, scale, maxRadius: 1e8 });
    expect(maxDeviationMetres(result, elements) * scale).toBeLessThan(TOLERANCE_PX);
  });
});

describe('rejected input', () => {
  it('rejects a semi-latus rectum that is not finite and positive', () => {
    expect(() => tessellate({ elements: shape(0, 0.1), scale: 1, maxRadius: 1e8 })).toThrow(
      RangeError,
    );
    expect(() =>
      tessellate({ elements: shape(Number.NaN, 0.1), scale: 1, maxRadius: 1e8 }),
    ).toThrow(RangeError);
  });

  it('rejects a negative eccentricity', () => {
    expect(() => tessellate({ elements: shape(P_LEO, -0.1), scale: 1, maxRadius: 1e8 })).toThrow(
      RangeError,
    );
  });

  it('rejects a scale or a maxRadius that is not finite and positive', () => {
    expect(() => tessellate({ elements: shape(P_LEO, 0.1), scale: 0, maxRadius: 1e8 })).toThrow(
      RangeError,
    );
    expect(() =>
      tessellate({ elements: shape(P_LEO, 0.1), scale: 1, maxRadius: Number.POSITIVE_INFINITY }),
    ).toThrow(RangeError);
  });

  it('ignores the true anomaly it is handed — this draws the path, not the body', () => {
    const base = shape(P_LEO, 0.4);
    const moved: OrbitShape = { ...base, trueAnomaly: radians(2.7) };
    const a = tessellate({ elements: base, scale: 2e-5, maxRadius: 1e12 });
    const b = tessellate({ elements: moved, scale: 2e-5, maxRadius: 1e12 });
    expect(b.points).toEqual(a.points);
  });

  it('draws an orbit that grazes the Earth without special-casing it', () => {
    const elements = shape(R_EARTH_EQ * 1.001, 0.2);
    const result = tessellate({ elements, scale: 2e-5, maxRadius: 1e12 });
    expect(result.points.length).toBeGreaterThan(16);
  });
});
