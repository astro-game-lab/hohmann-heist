/**
 * Impulsive delta-v application — FR-006.
 *
 * The whole of DEP-01: a burn is instantaneous, so a maneuver changes velocity and
 * nothing else. Same epoch, same position, new velocity. There is no burn duration
 * here and no mass — DEP-01 and DEP-02 live in `@hh/game`, and the gameplay-departure
 * table's own rule is that nothing in it may live in the core.
 *
 * The conversion is `@hh/astro`'s `fromRtn`, unchanged and unwrapped. This module
 * adds one vector addition to it; the value it adds is the *contract* around that
 * addition, which is what the tests pin down.
 *
 * ## "Same position" is identity, not tolerance
 *
 * The returned state shares its `position` object with the input. So the FR-006
 * guarantee is checkable with `toBe`, not `toBeCloseTo` — there is no arithmetic on
 * the position at all, so there is no tolerance to argue about and no way for a
 * refactor to introduce a drift that a loose comparison would wave through.
 *
 * `State` carries no epoch (see `@hh/astro/elements`), so "at the same epoch" is
 * structural rather than asserted: this function has no epoch to change. Pairing
 * epochs with states is the timeline's job (#67–#69).
 *
 * ## Two impulses at one epoch do *not* add in RTN components
 *
 * `docs/PRODUCT.md` §13.3 lists "two impulses at the same epoch equal their vector
 * sum" as a property. Read as *"applying `a` then `b` equals applying `a + b`, with
 * all three expressed as RTN components"*, *it is false* — and the failure is
 * structural rather than numerical, so it is worth stating here rather than
 * discovering it from a red test later.
 *
 * The RTN basis is built from the state it is attached to:
 *
 * ```
 * R̂ = r / |r|        N̂ = (r × v) / |r × v|        T̂ = N̂ × R̂
 * ```
 *
 * An impulse leaves `r` alone, so `R̂` survives it. But it changes `v`, so `r × v`
 * changes, so `N̂` and `T̂` rotate. The second impulse is therefore interpreted in a
 * *different frame* from the first, and summing their components adds two vectors
 * that were never expressed in the same basis.
 *
 * What is true is the inertial statement: `Δv` composes by vector addition in ECI,
 * because that is where the addition actually happens. The RTN reading holds exactly
 * when the second delta-v is re-expressed into the post-impulse basis first, and
 * `maneuver.test.ts` asserts it in that form.
 *
 * In practice a plan cannot reach the ambiguous case anyway: FR-101 keeps consecutive
 * nodes at least a second apart, so no two impulses in a plan share an epoch.
 */
import type { RtnVector, State } from '@hh/astro';
import { eci, fromRtn } from '@hh/astro';
import type { MetresPerSec } from '@hh/math';
import { V } from '@hh/math';

/**
 * Apply an impulsive delta-v expressed in the RTN frame of `state`.
 *
 * Returns a new state at the same position with the delta-v added to its velocity.
 * The input is not modified.
 *
 * A zero delta-v returns a state whose velocity equals the input's exactly, not
 * merely closely: `fromRtn` maps the zero vector to the zero vector under an exact
 * rotation — every term is a product with zero — and adding zero to a float is
 * exact. §13.3's "applying zero Δv changes nothing" is an equality, and is asserted
 * as one.
 *
 * @throws RangeError when the state is rectilinear. `r × v` is then zero, the RTN
 * basis is undefined, and `eciToRtnMatrix` refuses rather than returning a basis full
 * of `NaN` that would travel silently into a trajectory. This module deliberately
 * does not catch and re-wrap that error: it is already the right error with the right
 * message, and re-throwing it as something else would only obscure where it came
 * from.
 */
export const applyImpulse = (state: State, deltaVRtn: RtnVector<MetresPerSec>): State => {
  const deltaVEci = fromRtn(deltaVRtn, state.position, state.velocity);
  return {
    position: state.position,
    velocity: eci(V.add(state.velocity, deltaVEci)),
  };
};
