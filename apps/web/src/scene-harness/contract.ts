/**
 * The real `c03-cold-open` contract, loaded and turned into something the scene can draw.
 *
 * The harness exists to look at the orbit scene against **real** geometry rather than a
 * fixture, which is why this reads the shipped contract through `@hh/game`'s own loader
 * instead of hand-building elements. A fixture would let a scale error or a bad
 * eccentricity look perfectly reasonable; the actual C03 numbers are a 400 km circular
 * LEO and a target 400 km above it, which is §8.4's "genuinely tight" case and the one
 * most likely to expose a legibility problem.
 *
 * Everything here is throwaway along with the rest of `scene-harness/`, and it is
 * deliberately the only file that knows which contract is being shown.
 */
import { MU_EARTH, elementsFromState } from '@hh/astro';
import type { OrbitShape, State } from '@hh/astro';
import { parseScenario } from '@hh/game';
import type { LoadedScenario } from '@hh/game';
import { buildTimeline, createPlan, maneuverNodeFromCounts } from '@hh/sim';
import type { Timeline } from '@hh/sim';

import contractJson from '../../../../content/contracts/c03-cold-open.json' with { type: 'json' };

/** The loaded contract, or a thrown error — a harness that cannot load its own contract is a bug. */
export const loadContract = (): LoadedScenario => {
  // `parseScenario`, not `loadScenario`: the contract arrives as a bundled object here,
  // and re-serialising it just to parse it again would be silly — which is the reason
  // that overload exists.
  const result = parseScenario(contractJson);
  if (!result.ok) {
    throw new Error(
      `c03-cold-open failed to load: ${result.errors.map((e) => e.message.key).join(', ')}`,
    );
  }
  return result.scenario;
};

/**
 * A two-burn plan, roughly a Hohmann transfer between the two orbits.
 *
 * Not the par solution and not claiming to be — `docs/PARS.md` owns that. It is a plan
 * with enough shape to exercise every layer: two nodes, three arcs, a transfer ellipse
 * with real eccentricity so the equal-time dots have something to say, and an apsis pair
 * clear of the suppression floor.
 *
 * Counts rather than metres per second, because that is DEP-09's quantised
 * representation and the constructor that does not need a branded `RtnVector` at the call
 * site. 1 count is 1e-4 m/s.
 */
export const demoPlan = (departureSeconds: number, transverseMps: number) =>
  createPlan([
    maneuverNodeFromCounts(Math.round(departureSeconds * 1024), [
      0,
      Math.round(transverseMps * 10_000),
      0,
    ]),
    maneuverNodeFromCounts(Math.round((departureSeconds + 2800) * 1024), [
      0,
      Math.round(52 * 10_000),
      0,
    ]),
  ]);

/** Build the timeline for a plan, or throw. */
export const timelineFor = (
  scenario: LoadedScenario,
  departureSeconds: number,
  dv: number,
): Timeline => {
  const result = buildTimeline({
    startEpoch: scenario.startEpoch,
    initialState: scenario.ship.state,
    plan: demoPlan(departureSeconds, dv),
    horizon: scenario.horizon,
    mu: scenario.mu,
  });
  if (!result.ok) throw new Error('demo timeline failed to build');
  return result.timeline;
};

/** The orbit shape of a state, for the target marker. */
export const shapeOf = (state: State): OrbitShape =>
  elementsFromState(state.position, state.velocity, MU_EARTH);

/** Earth's gravitational parameter, re-exported so the page needs one import. */
export { MU_EARTH };
