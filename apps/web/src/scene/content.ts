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
import { R_EARTH_EQ, elementsFromState, type Epoch, type OrbitShape, type State } from '@hh/astro';
import type { LoadedScenario } from '@hh/game';
import { V } from '@hh/math';
import type { HazardShell, MarkerSpec } from '@hh/render';
import { arcAt, type Timeline } from '@hh/sim';

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

/** The orbit a state is on. Spelled once; several call sites need it. */
export const elementsOf = (state: State, mu: number) =>
  elementsFromState(state.position, state.velocity, mu);

/**
 * The contract's target, as a marker at `offsetSeconds` along its orbit.
 *
 * The first target only. Every v1.0 contract has at most one, and a view that drew a
 * second would need a way to say which one the objective is about — which is a design
 * question, not an oversight to fix here.
 *
 * ## `offsetSeconds` is a position, and used not to be passed one
 *
 * `MarkerSpec.offsetSeconds` is *"seconds from the arc's start to the scrub epoch"* —
 * where the body **is**. This function used to hand it a module constant,
 * `MARKER_TRAIL_SECONDS = 900`, whose own docstring called it *"how far ahead of a marker
 * its motion trail is drawn"*. Those are two different quantities, and the constant was
 * the wrong one: 900 s is a trail length chosen so that `markers.ts`' 600 s trail would
 * always have room to be fully drawn.
 *
 * The consequence was that both markers sat permanently 900 seconds along their opening
 * orbit and never moved — while scrubbing the planner's timeline, and for the whole of a
 * playback run. The orbits, the trails and the closest-approach tie line all moved
 * correctly around two stationary glyphs, which is why it read as the markers being
 * broken rather than as the epoch not arriving.
 *
 * So the offset is now a parameter, and both callers pass the epoch they are drawing.
 * Nothing here decides it: the planner's is the scrub head and execution's is the
 * playback epoch, and neither is this module's to guess.
 */
export const targetMarkerOf = (
  scenario: LoadedScenario,
  offsetSeconds: number,
): MarkerSpec | undefined => {
  const target = scenario.targets[0];
  if (target === undefined) return undefined;
  return {
    id: target.id,
    kind: 'target',
    elements: elementsOf(target.state, scenario.mu),
    mu: scenario.mu,
    // Never negative: an epoch before the contract starts has no trail behind it, and
    // `keplerianSampler` would happily propagate backwards into an orbit that has not been flown.
    offsetSeconds: Math.max(offsetSeconds, 0),
  };
};

/**
 * Where the ship is, as a marker, at `epoch`.
 *
 * The arc that owns the epoch and the offset into it — which is what `MarkerSpec` asks
 * for, and is why this cannot be a constant. Both views need it and both had the same
 * bug, so it is spelled once here rather than twice at the call sites.
 *
 * The arc matters as much as the offset: after a burn the ship is on a *different* conic,
 * and a marker drawn on `arcs[0]` would sit on the parking orbit for the rest of the run.
 * The trail follows from the same pair, and `trailPoints` clips it at the arc's start so
 * it never runs back through an impulse (see `markers.ts`).
 */
export const shipMarkerOf = (
  timeline: Timeline,
  epoch: Epoch,
  fallbackElements: OrbitShape,
  mu: number,
): MarkerSpec => {
  const arc =
    timeline.arcs.length === 0 ? undefined : arcAt(timeline, clampToTimeline(timeline, epoch));
  return {
    id: 'ship',
    kind: 'ship',
    elements: arc?.elements ?? fallbackElements,
    mu,
    offsetSeconds:
      arc === undefined ? 0 : Math.max(clampToTimeline(timeline, epoch) - arc.startEpoch, 0),
  };
};

/**
 * `epoch` brought inside the timeline's span.
 *
 * `arcAt` is defined on `[startEpoch, horizon]` and a playback epoch can land a float
 * past the end on the last frame. Clamping is the honest answer — the run is over, so the
 * marker belongs at the horizon — and it keeps the lookup a total function.
 */
const clampToTimeline = (timeline: Timeline, epoch: Epoch): Epoch =>
  Math.min(Math.max(epoch, timeline.startEpoch), timeline.horizon) as Epoch;

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
