/**
 * `Arc` — one Keplerian segment between impulses.
 *
 * A plan is a sequence of impulses; the trajectory between two of them is a single
 * unperturbed conic, and that is an arc. FR-102 builds a timeline by alternating
 * these with the impulses that separate them, and FR-104 requires that editing node
 * *k* recompute only arcs *k* through *n*. Both of those rest on the same property,
 * so it is the one this module is built around:
 *
 * **An arc is an immutable value.** Changing the state it starts from does not
 * modify an arc, it produces a different one. `withState` and the other derivations
 * return new arcs and leave the original exactly as it was.
 *
 * That is what makes FR-104's incremental recompute *safe* rather than merely fast.
 * If arcs were mutable, an editor holding a reference to arc *k-1* — an undo stack,
 * a cached tessellation, a half-finished porkchop grid — would silently observe the
 * edit to arc *k*, and the bug would appear as a trajectory that changed without
 * being edited. With immutable arcs, recomputing from *k* onward cannot reach
 * anything before *k*, because there is nothing there to reach.
 *
 * ## The element cache falls out of that, rather than being bolted onto it
 *
 * #57 asks for elements computed once per arc and cached, and for the cache to be
 * invalidated "when and only when the arc's defining state or epoch changes". On an
 * immutable value there is no invalidation to get wrong: a change *is* a new arc,
 * and a new arc has its own empty cache. The two halves of "when and only when" are
 * then structural rather than enforced — nothing can change under a cache, and no
 * cache can outlive the value it describes.
 *
 * The cache is lazy because `stateAt` does not need it. Universal-variable
 * propagation works from the Cartesian state directly and never asks for elements,
 * so an arc that is only ever propagated never pays for them. They are computed on
 * first access, for the readouts, apsis searches and orbit tessellation that do want
 * them, and then not again.
 *
 * ## Evaluating outside the span is allowed, and is not the same as being inside it
 *
 * `stateAt` propagates the conic to whatever epoch it is handed. The conic is
 * defined for all time and an event search legitimately probes just outside a
 * bracket, so refusing would break a caller that is not doing anything wrong.
 * `containsEpoch` is separate, and is what a timeline uses to choose *which* arc to
 * ask.
 */
import type { ClassicalElements, Epoch, State } from '@hh/astro';
import { differenceSeconds, elementsFromState } from '@hh/astro';
import type { Seconds } from '@hh/math';
import { V, seconds } from '@hh/math';

import type { PropagationOptions, PropagationResult } from './universal.js';
import { propagate } from './universal.js';

/** One Keplerian segment. Frozen; derive a new one rather than reaching for a setter. */
export interface Arc {
  /** Epoch of `state`, and the start of the segment. */
  readonly startEpoch: Epoch;
  /** End of the segment — the next impulse, or the plan's horizon. */
  readonly endEpoch: Epoch;
  /** The state at `startEpoch`, in an inertial frame. */
  readonly state: State;
  /** Gravitational parameter of the central body, in m^3 s^-2. */
  readonly mu: number;
  /**
   * Classical elements of this arc, computed on first access and then cached.
   *
   * Degenerate orbits do not error here and never return `NaN`: `elementsFromState`
   * applies the stated conventions and reports which one it used on `degeneracy`.
   * Circular and equatorial are the common case in this game, so this is the
   * ordinary path rather than an edge case.
   */
  readonly elements: ClassicalElements;
}

/** What an arc is built from. `elements` is derived, so it is not one of these. */
export interface ArcSpec {
  readonly startEpoch: Epoch;
  readonly endEpoch: Epoch;
  readonly state: State;
  readonly mu: number;
}

/**
 * Build an arc.
 *
 * @throws RangeError when `mu` is not finite and positive, when `endEpoch` is before
 * `startEpoch`, or when the state is rectilinear.
 *
 * The rectilinear check is done here rather than being left to the element cache.
 * `elementsFromState` rejects a zero angular momentum — the orbital plane is
 * undefined and there are no elements to return — but the cache is lazy, so
 * deferring would raise that error at some unrelated later moment, from whichever
 * caller happened to touch `elements` first. `docs/PHYSICS.md` says rectilinear
 * orbits are rejected at construction, and this is that construction.
 */
export const createArc = (spec: ArcSpec): Arc => {
  const { startEpoch, endEpoch, state, mu } = spec;

  if (!(mu > 0) || !Number.isFinite(mu)) {
    throw new RangeError(`gravitational parameter must be finite and positive, got ${String(mu)}`);
  }
  if (!Number.isFinite(startEpoch) || !Number.isFinite(endEpoch)) {
    throw new RangeError(
      `arc epochs must be finite, got [${String(startEpoch)}, ${String(endEpoch)}]`,
    );
  }
  if (endEpoch < startEpoch) {
    throw new RangeError(`arc ends before it starts: [${String(startEpoch)}, ${String(endEpoch)}]`);
  }
  if (V.norm(V.cross(state.position, state.velocity)) === 0) {
    throw new RangeError(
      'an arc cannot be rectilinear: position and velocity are parallel, so the orbital plane is undefined',
    );
  }

  let cached: ClassicalElements | undefined;
  const arc: Arc = {
    startEpoch,
    endEpoch,
    state,
    mu,
    get elements(): ClassicalElements {
      cached ??= elementsFromState(state.position, state.velocity, mu);
      return cached;
    },
  };
  return Object.freeze(arc);
};

/**
 * The state on this arc at `epoch`.
 *
 * At `startEpoch` this returns the arc's own state by reference, not a copy that
 * agrees to round-off — the elapsed time is exactly zero and `propagate` answers
 * that case by identity. #57 asks for exactly this, and "equal to 1e-16" would be a
 * different and weaker promise.
 *
 * This is the call §11.9 budgets at 5 microseconds. See `tools/bench/`.
 */
export const stateAt = (
  arc: Arc,
  epoch: Epoch,
  options: PropagationOptions = {},
): PropagationResult =>
  propagate(arc.state, differenceSeconds(arc.startEpoch, epoch), arc.mu, options);

/** Whether `epoch` lies within the arc's span, ends included. */
export const containsEpoch = (arc: Arc, epoch: Epoch): boolean =>
  epoch >= arc.startEpoch && epoch <= arc.endEpoch;

/** How long the arc runs. Zero is legal: a plan may hold two impulses at one epoch. */
export const duration = (arc: Arc): Seconds => seconds(arc.endEpoch - arc.startEpoch);

/**
 * A new arc with a different defining state.
 *
 * The original is untouched, and the new arc's element cache starts empty. This is
 * the operation an edit at node *k* performs on arc *k*.
 */
export const withState = (arc: Arc, state: State): Arc =>
  createArc({ startEpoch: arc.startEpoch, endEpoch: arc.endEpoch, state, mu: arc.mu });

/** A new arc starting at a different epoch, carrying the same state. */
export const withStartEpoch = (arc: Arc, startEpoch: Epoch): Arc =>
  createArc({ startEpoch, endEpoch: arc.endEpoch, state: arc.state, mu: arc.mu });

/**
 * A new arc ending at a different epoch.
 *
 * The elements are equal in value — they depend on the state, not on the span — but
 * the new arc computes its own rather than inheriting the cache. Sharing it would
 * make the cache outlive the value it was derived for, which is the one thing the
 * immutability here exists to prevent; recomputing is cheap and unconditional
 * correctness is not.
 */
export const withEndEpoch = (arc: Arc, endEpoch: Epoch): Arc =>
  createArc({ startEpoch: arc.startEpoch, endEpoch, state: arc.state, mu: arc.mu });
