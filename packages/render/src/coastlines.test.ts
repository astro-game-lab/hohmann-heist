import { describe, expect, it } from 'vitest';

import data from '../data/coastlines-110m.json' with { type: 'json' };
import { COASTLINES, decodeCoastlines } from './coastlines.js';

/**
 * Read one element of a typed array as a number.
 *
 * `noUncheckedIndexedAccess` types every indexed read as possibly `undefined`, and the
 * lint config rules out both ways of asserting otherwise. `NaN` rather than `0` for the
 * impossible case: a substituted zero could satisfy an assertion by accident, where NaN
 * propagates and fails the test it was standing in for.
 */
const at = (array: Float64Array | Uint32Array, index: number): number => array[index] ?? Number.NaN;

/**
 * The delta arithmetic is checked against a document small enough to verify by hand.
 * Asserting it against the 5 098-point shipped file would be asserting that the decoder
 * agrees with itself.
 */
describe('decodeCoastlines', () => {
  it('reconstructs absolute positions from deltas', () => {
    // One ring: (0 deg E, 0 deg N) then +90 deg of longitude, at precision 3.
    const decoded = decodeCoastlines({
      precision: 3,
      ringCount: 1,
      pointCount: 2,
      rings: [[0, 0, 90_000, 0]],
    });

    expect(decoded.vertexCount).toBe(2);
    // (0, 0) is the +x axis; (90 deg E, 0) is the +y axis.
    expect(decoded.vertices[0]).toBeCloseTo(1, 12);
    expect(decoded.vertices[1]).toBeCloseTo(0, 12);
    expect(decoded.vertices[2]).toBeCloseTo(0, 12);
    expect(decoded.vertices[3]).toBeCloseTo(0, 12);
    expect(decoded.vertices[4]).toBeCloseTo(1, 12);
    expect(decoded.vertices[5]).toBeCloseTo(0, 12);
  });

  it('places the north pole on +z', () => {
    const decoded = decodeCoastlines({
      precision: 3,
      ringCount: 1,
      pointCount: 2,
      rings: [[0, 90_000, 0, 0]],
    });
    expect(decoded.vertices[2]).toBeCloseTo(1, 12);
  });

  it('lays rings out contiguously with a terminating offset', () => {
    const decoded = decodeCoastlines({
      precision: 3,
      ringCount: 2,
      pointCount: 5,
      rings: [
        [0, 0, 1000, 0],
        [0, 0, 1000, 0, 1000, 0],
      ],
    });

    expect(decoded.ringCount).toBe(2);
    expect([...decoded.offsets]).toEqual([0, 2, 5]);
    // The terminating offset is the total, which is what lets a consumer iterate
    // `offsets[i]..offsets[i + 1]` for every ring without special-casing the last.
    expect(decoded.offsets[decoded.ringCount]).toBe(decoded.vertexCount);
  });

  it('rejects a ring with an odd value count rather than dropping a coordinate', () => {
    expect(() =>
      decodeCoastlines({ precision: 3, ringCount: 1, pointCount: 1, rings: [[0, 0, 5]] }),
    ).toThrow(RangeError);
  });

  it('accumulates in integers, so a long ring does not drift', () => {
    // 1 000 steps of 0.001 deg. Summing 0.001 as a float a thousand times lands about
    // 1e-13 deg away from 1.0; summing the integers and scaling once is exact.
    const deltas: number[] = [0, 0];
    for (let i = 0; i < 1000; i++) deltas.push(1, 0);
    const decoded = decodeCoastlines({
      precision: 3,
      ringCount: 1,
      pointCount: 1001,
      rings: [deltas],
    });

    const last = decoded.vertexCount - 1;
    const lon = Math.atan2(at(decoded.vertices, last * 3 + 1), at(decoded.vertices, last * 3));
    expect(lon).toBeCloseTo((1 * Math.PI) / 180, 15);
  });
});

describe('the shipped Natural Earth data', () => {
  it('decodes every ring the document declares', () => {
    expect(COASTLINES.ringCount).toBe(data.ringCount);
    expect(COASTLINES.vertexCount).toBe(data.pointCount);
    expect(COASTLINES.vertices.length).toBe(data.pointCount * 3);
  });

  it('is entirely unit vectors', () => {
    // Every vertex is a direction on the sphere; a magnitude that is not 1 would mean
    // the decode dropped or transposed a component, which would show on screen as a
    // coastline sunk into the planet rather than as an obvious failure.
    let worst = 0;
    for (let i = 0; i < COASTLINES.vertexCount; i++) {
      const magnitude = Math.hypot(
        at(COASTLINES.vertices, i * 3),
        at(COASTLINES.vertices, i * 3 + 1),
        at(COASTLINES.vertices, i * 3 + 2),
      );
      worst = Math.max(worst, Math.abs(magnitude - 1));
    }
    expect(worst).toBeLessThan(1e-15);
  });

  it('carries no segment that crosses the antimeridian', () => {
    // `process.mjs` splits those rings, because a +179 deg to -179 deg step is two
    // degrees of coastline and 358 degrees of arithmetic, and nothing downstream can
    // tell them apart from the coordinates. If this fails, the renderer will draw a
    // line straight across the globe.
    for (let ring = 0; ring < COASTLINES.ringCount; ring++) {
      const from = at(COASTLINES.offsets, ring);
      const to = at(COASTLINES.offsets, ring + 1);
      for (let i = from + 1; i < to; i++) {
        const previous = Math.atan2(
          at(COASTLINES.vertices, (i - 1) * 3 + 1),
          at(COASTLINES.vertices, (i - 1) * 3),
        );
        const current = Math.atan2(
          at(COASTLINES.vertices, i * 3 + 1),
          at(COASTLINES.vertices, i * 3),
        );
        let step = current - previous;
        if (step > Math.PI) step -= 2 * Math.PI;
        if (step < -Math.PI) step += 2 * Math.PI;
        expect(Math.abs(step)).toBeLessThan(Math.PI);
      }
    }
  });

  it('stays inside the size the attribution and NFR-020 claim for it', () => {
    // The point is not the exact byte count; it is that a regeneration at a finer
    // precision, or a switch to the 1:50 m source, cannot land in the bundle unnoticed.
    // §9.6 estimates ~15 kB and that estimate does not hold — see the PR and
    // `tools/coastlines/process.mjs` for the measurement.
    const raw = JSON.stringify(data).length;
    expect(raw).toBeLessThan(60_000);
    expect(data.precision).toBe(3);
    expect(data.toleranceMetres).toBe(200);
  });

  it('records where it came from', () => {
    // Provenance is a licensing requirement (NFR-024), not a nicety: an asset whose
    // source is only in a commit message is one rebase from being unattributable.
    expect(data.source).toContain('naturalearth');
    expect(data.sourceSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(data.licence).toContain('Public domain');
  });
});
