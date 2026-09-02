import type { OrbitShape } from '@hh/astro';
import type { Metres } from '@hh/math';
import { radians } from '@hh/math';
import { describe, expect, it } from 'vitest';

import {
  BUCKETS_PER_OCTAVE,
  bucketScale,
  createTessellationCache,
  scaleBucket,
  tessellationKey,
} from './cache.js';
import { tessellate } from './tessellate.js';

const shape = (semiLatusRectum: number, eccentricity: number): OrbitShape => ({
  semiLatusRectum: semiLatusRectum as Metres,
  eccentricity,
  inclination: radians(0.9),
  raan: radians(2.1),
  argp: radians(0.4),
  trueAnomaly: radians(0),
});

const P_LEO = 7.0e6;
const REQUEST = { scale: 2e-5, maxRadius: 1e12 } as const;

describe('scale buckets', () => {
  it('rounds up, so a cached entry is never refined for a coarser scale than it is drawn at', () => {
    for (const scale of [1e-7, 3.2e-6, 1e-5, 2e-5, 7.7e-5, 1e-3, 1]) {
      expect(bucketScale(scaleBucket(scale))).toBeGreaterThanOrEqual(scale);
    }
  });

  it('is a quarter-octave, so a continuous zoom crosses a bucket about every 19%', () => {
    expect(BUCKETS_PER_OCTAVE).toBe(4);
    const step = bucketScale(1) / bucketScale(0);
    expect(step).toBeCloseTo(2 ** 0.25, 12);
    expect(step - 1).toBeCloseTo(0.189, 3);
  });

  it('puts a doubling exactly four buckets apart', () => {
    expect(scaleBucket(2e-5) - scaleBucket(1e-5)).toBe(BUCKETS_PER_OCTAVE);
  });
});

describe('the cache key', () => {
  it('ignores true anomaly — scrubbing the timeline does not change the path', () => {
    const base = shape(P_LEO, 0.4);
    const later: OrbitShape = { ...base, trueAnomaly: radians(2.7) };
    expect(tessellationKey(later, 3, 1e12)).toBe(tessellationKey(base, 3, 1e12));
  });

  it('separates orbits that differ in any path-defining element', () => {
    const base = shape(P_LEO, 0.4);
    const key = tessellationKey(base, 3, 1e12);
    expect(tessellationKey(shape(P_LEO * 1.0000001, 0.4), 3, 1e12)).not.toBe(key);
    expect(tessellationKey(shape(P_LEO, 0.4000001), 3, 1e12)).not.toBe(key);
    expect(tessellationKey({ ...base, raan: radians(2.2) }, 3, 1e12)).not.toBe(key);
    expect(tessellationKey({ ...base, argp: radians(0.5) }, 3, 1e12)).not.toBe(key);
    expect(tessellationKey({ ...base, inclination: radians(1.0) }, 3, 1e12)).not.toBe(key);
    expect(tessellationKey(base, 4, 1e12)).not.toBe(key);
    expect(tessellationKey(base, 3, 5e7)).not.toBe(key);
  });
});

describe('reuse', () => {
  it('returns the identical object on a repeat request', () => {
    const cache = createTessellationCache();
    const elements = shape(P_LEO, 0.3);
    const first = cache.get({ elements, ...REQUEST });
    const second = cache.get({ elements, ...REQUEST });

    expect(second).toBe(first);
    expect(cache.stats).toMatchObject({ hits: 1, misses: 1 });
  });

  it('hits across a pan and across a small zoom inside one bucket', () => {
    const cache = createTessellationCache();
    const elements = shape(P_LEO, 0.3);
    const bucket = scaleBucket(REQUEST.scale);

    cache.get({ elements, ...REQUEST });
    // A zoom that stays inside the same bucket. Panning is not represented here at all,
    // which is the point: the camera centre is not an input to tessellation.
    const nudged = bucketScale(bucket) * 0.99;
    expect(scaleBucket(nudged)).toBe(bucket);
    cache.get({ elements, ...REQUEST, scale: nudged });

    expect(cache.stats.misses).toBe(1);
    expect(cache.stats.hits).toBe(1);
  });

  it('misses once the zoom crosses a bucket', () => {
    const cache = createTessellationCache();
    const elements = shape(P_LEO, 0.3);
    cache.get({ elements, ...REQUEST });
    cache.get({ elements, ...REQUEST, scale: REQUEST.scale * 2 });
    expect(cache.stats.misses).toBe(2);
  });

  it('is never coarser than the scale it is drawn at', () => {
    // A scale just above a bucket boundary: the entry is refined at the bucket's upper
    // bound, so it has at least as many vertices as tessellating at the request would.
    const cache = createTessellationCache();
    const elements = shape(P_LEO, 0.6);
    const scale = bucketScale(3) * 1.0001;
    const cached = cache.get({ elements, scale, maxRadius: 1e12 });
    const direct = tessellate({ elements, scale, maxRadius: 1e12 });

    expect(cached.points.length).toBeGreaterThanOrEqual(direct.points.length);
  });
});

describe('dragging one node re-tessellates one orbit (§11.8, NFR-011)', () => {
  it('recomputes only the arc whose elements changed', () => {
    const cache = createTessellationCache();
    // A plan's worth of arcs, as a drag would present them frame after frame.
    const plan = [shape(P_LEO, 0.01), shape(P_LEO, 0.15), shape(1.1e7, 0.28), shape(4.2e7, 0.02)];
    const draw = (arcs: readonly OrbitShape[]): void => {
      for (const elements of arcs) cache.get({ elements, ...REQUEST });
    };

    draw(plan);
    expect(cache.stats).toMatchObject({ hits: 0, misses: 4 });

    // The next frame: the node being dragged changed one arc's Δv, so one arc's
    // eccentricity moved. The other three are the same objects they were.
    const edited = [plan[0], shape(P_LEO, 0.1503), plan[2], plan[3]] as OrbitShape[];
    draw(edited);

    expect(cache.stats.misses).toBe(5);
    expect(cache.stats.hits).toBe(3);
  });

  it('hits on every arc when the drag has not moved anything yet', () => {
    const cache = createTessellationCache();
    const plan = [shape(P_LEO, 0.01), shape(P_LEO, 0.15), shape(1.1e7, 0.28)];
    for (const elements of plan) cache.get({ elements, ...REQUEST });
    for (const elements of plan) cache.get({ elements, ...REQUEST });
    expect(cache.stats).toMatchObject({ hits: 3, misses: 3 });
  });
});

describe('eviction', () => {
  it('evicts the least recently used entry, not the oldest inserted one', () => {
    const cache = createTessellationCache(2);
    const a = shape(P_LEO, 0.1);
    const b = shape(P_LEO, 0.2);
    const c = shape(P_LEO, 0.3);

    cache.get({ elements: a, ...REQUEST });
    cache.get({ elements: b, ...REQUEST });
    // Touch `a`, so `b` becomes the least recently used.
    cache.get({ elements: a, ...REQUEST });
    cache.get({ elements: c, ...REQUEST });

    expect(cache.size).toBe(2);
    expect(cache.stats.evictions).toBe(1);

    const beforeMisses = cache.stats.misses;
    cache.get({ elements: a, ...REQUEST });
    expect(cache.stats.misses).toBe(beforeMisses);

    cache.get({ elements: b, ...REQUEST });
    expect(cache.stats.misses).toBe(beforeMisses + 1);
  });

  it('stays within capacity', () => {
    const cache = createTessellationCache(4);
    for (let i = 0; i < 20; i++) {
      cache.get({ elements: shape(P_LEO, 0.01 * i), ...REQUEST });
    }
    expect(cache.size).toBe(4);
  });

  it('rejects a capacity that is not a positive integer', () => {
    expect(() => createTessellationCache(0)).toThrow(RangeError);
    expect(() => createTessellationCache(-1)).toThrow(RangeError);
    expect(() => createTessellationCache(2.5)).toThrow(RangeError);
  });

  it('clears', () => {
    const cache = createTessellationCache();
    cache.get({ elements: shape(P_LEO, 0.3), ...REQUEST });
    cache.clear();
    expect(cache.size).toBe(0);
  });
});

describe('determinism (NFR-008, NFR-009)', () => {
  it('gives the same vertices for the same inputs, whatever the access order', () => {
    const plan = [shape(P_LEO, 0.05), shape(1.1e7, 0.4), shape(4.2e7, 0.01)];

    const forwards = createTessellationCache(2);
    for (const elements of plan) forwards.get({ elements, ...REQUEST });

    const backwards = createTessellationCache(2);
    for (const elements of [...plan].reverse()) backwards.get({ elements, ...REQUEST });

    for (const elements of plan) {
      expect(forwards.get({ elements, ...REQUEST }).points).toEqual(
        backwards.get({ elements, ...REQUEST }).points,
      );
    }
  });
});
