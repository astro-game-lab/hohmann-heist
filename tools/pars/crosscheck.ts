/**
 * An independent check on the search — #89's "reference and citation" requirement.
 *
 * §7.6's process rule is that a physics result is checked against something that does not
 * share its assumptions. A search cannot check itself: if the grid, the simplex and the
 * Lambert solver all agreed on a wrong answer they would agree quietly. So where a
 * contract's geometry admits a closed form, the derivation reports both numbers and their
 * difference, and a reader can see that two unrelated code paths met.
 *
 * ## What is being compared, and what that is worth
 *
 * For an **intercept between two coplanar circular orbits**, the cheapest way to reach the
 * outer radius is the tangential impulse that raises apoapsis to it — the first burn of a
 * Hohmann transfer, and no more, because DEP-04 asks for 1 000 m of range and nothing
 * about relative velocity. That is a closed form: `Δv₁ = √(μ/r₁)·(√(2r₂/(r₁+r₂)) − 1)`.
 *
 * The two paths share `MU_EARTH` and nothing else. The search propagates two orbits,
 * solves Lambert's problem over a grid of departure and arrival epochs, refines with a
 * simplex, quantises the winner to DEP-09's counts and evaluates it through the game's own
 * timeline; `hohmannTransfer` evaluates one algebraic expression. Agreement is therefore
 * evidence about the *search*, not about the physics.
 *
 * The physics underneath it is checked elsewhere and independently: `docs/PHYSICS.md`'s
 * Tier 1 table asserts `hohmannTransfer` against the LEO→GEO figures to 0.05 m/s, and
 * Tier 3 asserts the propagator and Lambert against Vallado, Curtis and a poliastro-lineage
 * fixture. **No number in this file is copied from `docs/PRODUCT.md`** — §7.6's rule — and
 * the closed form is recomputed from the constants rather than quoted.
 *
 * ## When it does not apply
 *
 * An eccentric target, an inclined transfer, or any objective that needs an arrival burn
 * has no one-line closed form, and this returns `null` rather than a comparison that is
 * not one. A contract in that position states in its derivation that it has no closed-form
 * cross-check, which is a worse position to be in and is worth saying out loud.
 */
import { MU_EARTH, hohmannTransfer } from '@hh/astro';
import type { LoadedScenario } from '@hh/game';
import { metres } from '@hh/math';

/** How close two element values must be to count as "the same" for this test. */
const COPLANAR_TOLERANCE_RAD = 1e-12;
const CIRCULAR_TOLERANCE = 1e-12;

/** The closed-form comparison, when the geometry admits one. */
export interface HohmannReference {
  readonly shipRadiusM: number;
  readonly targetRadiusM: number;
  /** The tangential impulse that raises apoapsis to the target radius, m/s. */
  readonly firstBurnMps: number;
  /** Both impulses — what a *rendezvous* would cost, and what §6.8's C03 row quotes. */
  readonly totalMps: number;
  /** Half the period of the transfer ellipse, seconds. */
  readonly timeOfFlightSeconds: number;
}

/**
 * The closed-form intercept cost for this contract, or `null` when it has none.
 *
 * Read from the **document's declared elements** rather than from the propagated state:
 * the author wrote `"e": 0`, and that statement is what makes the closed form applicable.
 * Re-deriving eccentricity from a Cartesian state to decide whether the author meant zero
 * would put a cancellation-prone quantity in the way of a question the file already
 * answers (`docs/PHYSICS.md` § Element conditioning near a circular orbit).
 */
export const hohmannReference = (scenario: LoadedScenario): HohmannReference | null => {
  const document = scenario.document;
  const objective = document.objective;
  if (objective.kind !== 'intercept') return null;

  const target = (document.targets ?? []).find((candidate) => candidate.id === objective.targetId);
  if (target === undefined) return null;

  const ship = document.ship.state;
  if (ship.e > CIRCULAR_TOLERANCE || target.state.e > CIRCULAR_TOLERANCE) return null;
  if (Math.abs(ship.i_rad - target.state.i_rad) > COPLANAR_TOLERANCE_RAD) return null;

  const transfer = hohmannTransfer(metres(ship.a_m), metres(target.state.a_m), MU_EARTH);
  return {
    shipRadiusM: ship.a_m,
    targetRadiusM: target.state.a_m,
    firstBurnMps: transfer.firstBurn,
    totalMps: transfer.totalDeltaV,
    timeOfFlightSeconds: transfer.timeOfFlight,
  };
};
