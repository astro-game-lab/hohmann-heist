/**
 * What a scenario looks like to the renderer — the pieces the planner and execution
 * both draw.
 *
 * §8.3.8 opens with *"same orbit view, different chrome"*, and this module is the "same"
 * half made literal. The planner (§8.3.4) and execution (§8.3.8) show the same Earth,
 * the same target orbit, the same altitude-floor shell and the same tessellation
 * budget; what differs is the camera policy and whether anything can be clicked.
 *
 * These definitions were `OrbitView.tsx`'s until execution needed them too. They are
 * here rather than duplicated because every one of them is a *number or a vector the
 * two views must agree on* — a target drawn with a different phase offset in the
 * planner than in the run would be the game contradicting itself between two screens
 * that are supposed to be the same picture.
 *
 * Deliberately not in `@hh/render`: the Sun direction is DEP-06, the floor is DEP-08,
 * and both are gameplay decisions rather than rendering ones. §11.2 puts them in the
 * game layer or above, and `apps/web` is the composition point that sees both.
 */
import { R_EARTH_EQ, elementsFromState, type State } from '@hh/astro';
import type { LoadedScenario } from '@hh/game';
import { V } from '@hh/math';
import type { HazardShell, MarkerSpec } from '@hh/render';

/**
 * How far past the last drawn orbit the tessellator is allowed to run, in metres.
 *
 * A ceiling on work rather than on physics: an escape trajectory (`L4`) is illegal to
 * commit but legal to *build*, and its conic runs to infinity. Something has to stop
 * the tessellator, and 80 000 km is comfortably past GEO — the furthest any v1.0
 * contract reaches — while keeping a hyperbola from asking for an unbounded polyline.
 */
export const MAX_RADIUS_M = 80_000_000;

/**
 * DEP-06's fixed Sun.
 *
 * A game-layer decision rather than the renderer's, which is why it is a vector here and
 * a parameter there. The direction is arbitrary and constant for the contract; it exists
 * so the terminator has a side to be on.
 */
export const SUN_DIRECTION = V.normalize({ x: 0.6, y: -0.8, z: 0 });

/**
 * Earth's rotation angle, as drawn.
 *
 * Presentational only (#106). A fixed angle: the simulation does not care which way the
 * planet is facing, and DEP-06 fixes the Sun for the contract anyway. Shared so that
 * committing a plan does not silently spin the planet as the screen changes.
 */
export const EARTH_ROTATION_ANGLE = 0.9;

/** How far ahead of a marker its motion trail is drawn, in seconds. */
export const MARKER_TRAIL_SECONDS = 900;

/** The orbit a state is on. Spelled once; several call sites need it. */
export const elementsOf = (state: State, mu: number) =>
  elementsFromState(state.position, state.velocity, mu);

/**
 * The contract's target, as a marker, or `undefined` when it has none.
 *
 * The first target only. Every v1.0 contract has at most one, and a view that drew a
 * second would need a way to say which one the objective is about — which is a design
 * question, not an oversight to fix here.
 */
export const targetMarkerOf = (scenario: LoadedScenario): MarkerSpec | undefined => {
  const target = scenario.targets[0];
  if (target === undefined) return undefined;
  return {
    id: target.id,
    kind: 'target',
    elements: elementsOf(target.state, scenario.mu),
    mu: scenario.mu,
    offsetSeconds: MARKER_TRAIL_SECONDS,
  };
};

/**
 * DEP-08's altitude floor, as a shell.
 *
 * `state: 'clear'` because the planner never lets an illegal plan be committed and
 * execution plays back a legal one — a violated floor is drawn on the timeline as a
 * band (FR-409), which is where a *plan* being wrong belongs. Colouring the shell would
 * be saying it at the moment the player can no longer do anything about it.
 */
export const floorShellOf = (scenario: LoadedScenario): HazardShell => ({
  id: 'altitude-floor',
  innerRadiusMetres: R_EARTH_EQ,
  outerRadiusMetres: R_EARTH_EQ + (scenario.rules.floorAltitudeM ?? 100_000),
  state: 'clear',
});
