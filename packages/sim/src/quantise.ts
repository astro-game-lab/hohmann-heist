/**
 * Quantisation of plan input — DEP-09.
 *
 * Node epochs are quantised to 1/1024 s and delta-v components to 1e-4 m/s, at the
 * moment they enter a plan. This is the first line of defence in the determinism
 * specification (`docs/PRODUCT.md` §11.4): the *input* to the simulation is made
 * exact and identical on every runtime, so that whatever a propagator then does with
 * it starts from the same numbers everywhere.
 *
 * ## The integer is the value; the SI float is derived
 *
 * §11.4 is precise about this and it is easy to misread: *"node epochs are
 * **integers** in 1/1024 s; delta-v components are **integers** in 1e-4 m/s. Both are
 * exactly representable in float64 and survive JSON round-trips exactly."* What is
 * exact is the **integer count**, not the SI quantity it stands for.
 *
 * The distinction is real, and only one of the two quanta hides it:
 *
 * - `1/1024` is a power of two, so `ticks / 1024` is exact and `t * 1024` recovers
 *   `ticks` with no rounding at all. Epochs really are exactly representable.
 * - `1e-4` is **not** a binary fraction. `7240 * 1e-4` is not 0.724; it is the
 *   float64 nearest to 0.724. Quantising a delta-v does not make it exactly
 *   representable, and a module claiming otherwise would be stating something false
 *   in the one place the honesty rule cares most about.
 *
 * So a quantised value's canonical identity is its integer count. That is what a
 * node stores, what serialisation writes, and what equality compares. The branded SI
 * value is derived from it for the physics to consume, and is never the thing round-
 * tripped or compared.
 *
 * ## Why the derived float is still deterministic
 *
 * `counts * 1e-4` involves a rounding, but IEEE 754 **requires** multiplication and
 * division to be correctly rounded — unlike `Math.sin`, `Math.cos` and `Math.exp`,
 * which are not required to be and do differ between V8, SpiderMonkey and
 * JavaScriptCore. §11.4 declines to claim bit-identical trajectories for exactly that
 * reason. It does not apply here: the same integer yields bit-identical floats on
 * every conforming runtime, because the operation producing them is one the standard
 * pins down.
 *
 * ## Rounding at a half-count
 *
 * `Math.round` breaks ties toward `+∞`, so `+0.5` counts up and `−0.5` counts to
 * zero. That is asymmetric about the origin, and it is kept anyway: it is fully
 * specified by ECMAScript, so it is the same on every runtime, which is the property
 * that matters. A symmetric rule would be prettier and no more correct — the error is
 * half a count either way, or 5e-5 m/s, some nine orders of magnitude below anything
 * a player or a medal threshold can distinguish.
 */
import type { Epoch } from '@hh/astro';
import { epoch } from '@hh/astro';
import type { MetresPerSec } from '@hh/math';
import { metresPerSec } from '@hh/math';

/**
 * Epoch quantum, in seconds (DEP-09).
 *
 * A power of two, which is what makes an epoch tick exactly representable rather
 * than merely nearly so. This is a deliberate choice and not an arbitrary
 * millisecond-ish number.
 */
export const EPOCH_QUANTUM_S = 1 / 1024;

/** Epoch ticks per second. The exact reciprocal of {@link EPOCH_QUANTUM_S}. */
export const EPOCH_TICKS_PER_SECOND = 1024;

/** Delta-v component quantum, in metres per second (DEP-09). */
export const DELTA_V_QUANTUM_MPS = 1e-4;

/** Delta-v counts per metre per second. The exact reciprocal of {@link DELTA_V_QUANTUM_MPS}. */
export const DELTA_V_COUNTS_PER_MPS = 10000;

/**
 * Largest count either quantisation will accept.
 *
 * Beyond `Number.MAX_SAFE_INTEGER` an integer is no longer uniquely representable, so
 * two different counts can collapse onto one float and the round-trip this module
 * exists to guarantee silently stops holding. The cap is far outside anything
 * physical — it is 2.8e11 seconds of epoch and 9e11 m/s of delta-v — so hitting it
 * means a unit error or a corrupted replay, both of which should be loud.
 */
const MAX_COUNT = Number.MAX_SAFE_INTEGER;

/** Normalise `-0` to `0` so that a count has one representation, never two. */
const withoutNegativeZero = (n: number): number => (n === 0 ? 0 : n);

const requireFinite = (value: number, what: string): void => {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${what} must be finite, got ${String(value)}`);
  }
};

const requireCount = (count: number, what: string): void => {
  if (!Number.isSafeInteger(count)) {
    throw new RangeError(
      `${what} must be a safe integer count, got ${String(count)}. ` +
        'Beyond 2^53 a count no longer round-trips through float64. See docs/PRODUCT.md §11.4.',
    );
  }
};

/**
 * Quantise an epoch to whole ticks of 1/1024 s.
 *
 * Exact in both directions: the multiplication by 1024 is a binary exponent shift, so
 * nothing is lost on the way in and nothing is lost on the way back out.
 *
 * @throws RangeError when the epoch is not finite, or lies beyond the safe-integer
 * range once expressed in ticks.
 */
export const toEpochTicks = (t: Epoch): number => {
  requireFinite(t, 'epoch');
  const ticks = withoutNegativeZero(Math.round(t * EPOCH_TICKS_PER_SECOND));
  if (Math.abs(ticks) > MAX_COUNT) {
    throw new RangeError(`epoch ${String(t)} s is beyond the representable tick range`);
  }
  return ticks;
};

/** The epoch a tick count stands for. Exact — a division by a power of two. */
export const fromEpochTicks = (ticks: number): Epoch => {
  requireCount(ticks, 'epoch ticks');
  return epoch(ticks / EPOCH_TICKS_PER_SECOND);
};

/**
 * Quantise a delta-v component to whole counts of 1e-4 m/s.
 *
 * @throws RangeError when the component is not finite, or lies beyond the
 * safe-integer range once expressed in counts.
 */
export const toDeltaVCounts = (component: number): number => {
  requireFinite(component, 'delta-v component');
  const counts = withoutNegativeZero(Math.round(component / DELTA_V_QUANTUM_MPS));
  if (Math.abs(counts) > MAX_COUNT) {
    throw new RangeError(
      `delta-v component ${String(component)} m/s is beyond the representable count range`,
    );
  }
  return counts;
};

/**
 * The delta-v a count stands for.
 *
 * Correctly rounded, therefore identical on every conforming runtime — but *not*
 * exact, because 1e-4 is not a binary fraction. See the module docstring.
 */
export const fromDeltaVCounts = (counts: number): MetresPerSec => {
  requireCount(counts, 'delta-v counts');
  return metresPerSec(counts * DELTA_V_QUANTUM_MPS);
};
