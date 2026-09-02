/**
 * PCG32 — a small, fast, statistically sound seeded generator.
 *
 * Determinism is a product feature here, not an implementation detail: replays,
 * shared scenarios and reproducible bug reports all depend on the same seed
 * producing the same sequence on every platform, forever. `Math.random` is banned
 * in the core by lint (NFR-008), so this is the only legal source of randomness in
 * the simulation.
 *
 * Algorithm: PCG-XSH-RR 64/32, from M. E. O'Neill, *PCG: A Family of Simple Fast
 * Space-Efficient Statistically Good Algorithms for Random Number Generation*
 * (2014), and the reference C implementation at https://www.pcg-random.org/.
 *
 * **`BigInt` for the 64-bit state, exactness over speed.** Cross-platform
 * reproducibility is the entire point, and a hand-rolled 32-bit-pair
 * implementation is easy to get subtly wrong in a way no casual test catches.
 * The generator is not on a per-frame path — it is used for scenario generation,
 * where the budget is tens of milliseconds. If profiling ever disagrees, the
 * internals can be swapped behind this interface without touching a caller.
 */

const MASK64 = (1n << 64n) - 1n;
const MASK32 = (1n << 32n) - 1n;
const MULTIPLIER = 6364136223846793005n;

/** A seeded generator. Created only from an explicit seed, and never global. */
export interface Rng {
  /** Internal state. Mutated on every draw. */
  state: bigint;
  /** Stream selector. Always odd. */
  readonly inc: bigint;
}

/**
 * Create a generator.
 *
 * `seed` selects the starting point, `sequence` selects the stream — two
 * generators with the same seed but different sequences produce unrelated output,
 * which is how independent substreams are obtained without correlation.
 */
export const createRng = (seed: bigint | number, sequence: bigint | number = 1n): Rng => {
  const inc = ((BigInt(sequence) << 1n) | 1n) & MASK64;
  const rng: Rng = { state: 0n, inc };
  nextUint32(rng);
  rng.state = (rng.state + (BigInt(seed) & MASK64)) & MASK64;
  nextUint32(rng);
  return rng;
};

/** Draw the next 32-bit unsigned integer. */
export const nextUint32 = (rng: Rng): number => {
  const old = rng.state;
  rng.state = (old * MULTIPLIER + rng.inc) & MASK64;
  const xorshifted = (((old >> 18n) ^ old) >> 27n) & MASK32;
  const rot = old >> 59n;
  const rotated = ((xorshifted >> rot) | (xorshifted << (-rot & 31n))) & MASK32;
  return Number(rotated);
};

/**
 * Draw a float in `[0, 1)`.
 *
 * Uses the top 32 bits only, so the result has 32 bits of entropy rather than 53.
 * That is ample for scenario generation and keeps the mapping exactly reproducible.
 */
export const nextFloat = (rng: Rng): number => nextUint32(rng) / 2 ** 32;

/** Draw a float in `[min, max)`. */
export const nextRange = (rng: Rng, min: number, max: number): number =>
  min + nextFloat(rng) * (max - min);

/**
 * Draw an integer in `[min, max)`, uniformly.
 *
 * Uses rejection sampling rather than a modulo, which would bias the low values
 * whenever the range does not divide 2³². The loop is bounded in expectation and
 * rejects at most half the draws in the worst case.
 */
export const nextInt = (rng: Rng, min: number, max: number): number => {
  const range = max - min;
  if (!Number.isInteger(min) || !Number.isInteger(max)) {
    throw new RangeError('nextInt bounds must be integers');
  }
  if (range <= 0) throw new RangeError('nextInt requires max > min');
  const limit = 2 ** 32 - (2 ** 32 % range);
  let draw = nextUint32(rng);
  while (draw >= limit) draw = nextUint32(rng);
  return min + (draw % range);
};

/** Snapshot a generator so a sequence can be replayed from a known point. */
export const cloneRng = (rng: Rng): Rng => ({ state: rng.state, inc: rng.inc });
