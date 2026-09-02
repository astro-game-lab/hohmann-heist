/**
 * The tessellation cache, keyed by (elements, screen scale bucket) — §11.8, NFR-011.
 *
 * The requirement it exists for is stated as a behaviour rather than a hit rate:
 * "dragging a node's Δv re-tessellates **one** orbit, not all of them". A planner with
 * an eight-node plan holds nine or ten conics, and a drag changes exactly one of them
 * per frame. Without a cache every frame pays for all ten and the §11.9 drag budget of
 * 8 ms is spent on nine orbits that did not move.
 *
 * ## What is in the key, and what is deliberately not
 *
 * The key is the five path-defining elements plus a scale bucket. Three omissions are
 * each doing work:
 *
 * - **True anomaly is not in the key.** It says where the body is on the path, not what
 *   the path is. Including it would miss on every frame of a scrub, which is the single
 *   most common thing a player does.
 * - **The camera's view basis is not in the key.** Refinement measures the sagitta in
 *   world metres and only scales it by pixels-per-metre, which over-estimates the
 *   on-screen error for a foreshortened orbit and never under-estimates it, so a
 *   tessellation stays valid as the camera rotates. See `tessellate.ts`.
 * - **The camera centre is not in the key.** Panning changes no vertex.
 *
 * So the cache is invalidated by exactly two things: editing the orbit, and zooming.
 *
 * ## Why the scale is bucketed, and why the bucket rounds up
 *
 * Keying on the raw scale would miss on every frame of a pinch-zoom, which is when the
 * budget is tightest. Buckets are quarter-octaves — successive buckets are 19% apart —
 * so a continuous zoom crosses one about every 19% and reuses the tessellation in
 * between.
 *
 * The bucket rounds **up** to the next quarter-octave, and the tessellation is computed
 * at that upper bound rather than at the requested scale. That is what makes reuse
 * sound rather than merely convenient: the cached polyline was refined for a scale at
 * least as large as the one it is being drawn at, so its sagitta on screen is at most
 * the 0.5 px it was refined to. Rounding to the nearest bucket instead would let an
 * orbit be drawn up to 19% coarser than §9.3 permits, which is the kind of tolerance
 * violation that never shows up in a test and always shows up on a curve.
 *
 * ## Eviction
 *
 * A bounded LRU over a `Map`. JavaScript's `Map` iterates in insertion order, so
 * deleting and re-inserting on a hit moves an entry to the back and the oldest key is
 * the first one the iterator yields — no timestamps, no clock, and an eviction order
 * that is a pure function of the access sequence. NFR-008 forbids reading a clock in
 * the simulation; this package could, but a cache whose contents depend on wall time
 * would make a replay's frames depend on how fast the machine ran.
 */
import type { OrbitShape } from '@hh/astro';

import type { Tessellation, TessellationRequest } from './tessellate.js';
import { tessellate } from './tessellate.js';

/** Cache buckets per doubling of scale. Four gives 19% steps. */
export const BUCKETS_PER_OCTAVE = 4;

/** Entries held before the least recently used one is evicted. */
export const DEFAULT_CAPACITY = 64;

/** The scale bucket a scale falls in, rounded up. See the module docstring. */
export const scaleBucket = (scale: number): number =>
  Math.ceil(Math.log2(scale) * BUCKETS_PER_OCTAVE);

/** The scale a bucket's tessellation is computed at: the bucket's upper bound. */
export const bucketScale = (bucket: number): number => Math.pow(2, bucket / BUCKETS_PER_OCTAVE);

/**
 * The cache key for an orbit at a scale.
 *
 * A string rather than a structural key because `Map` compares objects by identity, and
 * every frame builds fresh element objects. `String(n)` round-trips a float64 exactly,
 * so two orbits share a key only if they are bit-identical.
 */
export const tessellationKey = (elements: OrbitShape, bucket: number, maxRadius: number): string =>
  `${String(bucket)}|${String(elements.semiLatusRectum)}|${String(elements.eccentricity)}|` +
  `${String(elements.inclination)}|${String(elements.raan)}|${String(elements.argp)}|` +
  String(maxRadius);

/** Hit and miss counts, for tests and for the performance overlay. */
export interface CacheStats {
  readonly hits: number;
  readonly misses: number;
  readonly evictions: number;
}

/** A bounded, deterministic tessellation cache. */
export interface TessellationCache {
  /** The tessellation for this request, computed on a miss. */
  get(request: TessellationRequest): Tessellation;
  /** Entries currently held. */
  readonly size: number;
  /** Hit, miss and eviction counts since construction. */
  readonly stats: CacheStats;
  /** Drop everything. */
  clear(): void;
}

/**
 * Build a tessellation cache.
 *
 * @throws RangeError when the capacity is not a positive integer.
 */
export const createTessellationCache = (capacity: number = DEFAULT_CAPACITY): TessellationCache => {
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new RangeError(`capacity must be a positive integer, got ${String(capacity)}`);
  }

  const entries = new Map<string, Tessellation>();
  let hits = 0;
  let misses = 0;
  let evictions = 0;

  return {
    get(request: TessellationRequest): Tessellation {
      const bucket = scaleBucket(request.scale);
      const key = tessellationKey(request.elements, bucket, request.maxRadius);

      const hit = entries.get(key);
      if (hit !== undefined) {
        hits++;
        // Re-insert to move this entry to the most-recently-used end.
        entries.delete(key);
        entries.set(key, hit);
        return hit;
      }

      misses++;
      // Refine at the bucket's upper bound, not at the requested scale, so the entry is
      // never coarser than §9.3 allows anywhere in the bucket.
      const computed = tessellate({ ...request, scale: bucketScale(bucket) });

      if (entries.size >= capacity) {
        const oldest = entries.keys().next();
        if (!oldest.done) {
          entries.delete(oldest.value);
          evictions++;
        }
      }
      entries.set(key, computed);
      return computed;
    },

    get size(): number {
      return entries.size;
    },

    get stats(): CacheStats {
      return { hits, misses, evictions };
    },

    clear(): void {
      entries.clear();
    },
  };
};
