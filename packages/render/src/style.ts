/**
 * The style slots the orbit scene draws into — §9.3, §8.3.4, #108.
 *
 * This package has **no colours of its own** (`renderer.ts`), and that rule survives
 * intact here: what follows names the *slots* §9.3 defines and says what each one means,
 * while the strings that fill them come from the caller. §11.2 puts the palette in
 * `@hh/ui`, there are five of them (NFR-018), and `@hh/render` cannot import `@hh/ui`
 * anyway — dependencies point one way and the two are siblings under `apps/web`.
 *
 * So the division is: the renderer knows there is such a thing as "the planned
 * trajectory's colour", and only the application knows it is `--plan`.
 *
 * #116 completes the five palettes in M3. Until then the harness supplies a minimal set
 * covering exactly the tokens §9.3 names — `--accent`, `--plan`, `--target` and the
 * hazard states — which is the smallest thing that lets this scene be drawn at all.
 *
 * ## Patterns carry the meaning, not colours
 *
 * §8.3.4's fifth principle, and #108's first criterion: the three trajectories are
 * **three distinct dash patterns, not three colours**. Roughly one man in twelve is
 * red–green colour blind, and the whole game is three overlapping lines on a dark field;
 * if colour were the only channel, a third of the information would be missing for a
 * meaningful slice of players. Colour is redundant reinforcement here, never the carrier.
 *
 * The same principle governs the hazard shell (#107), where the intersecting state
 * changes hatch *and* fill rather than only going red.
 */
import type { DashPattern, FillStyle, StrokeStyle } from './renderer.js';

/**
 * The current orbit: solid and heavy (§9.3).
 *
 * Solid because it is the one thing on screen that is not a prediction — it is where the
 * spacecraft actually is, and it should read as the most substantial mark in the frame.
 */
export const DASH_CURRENT_ORBIT: DashPattern = Object.freeze([]);

/**
 * The target orbit: dashed (§9.3).
 *
 * Long marks with short gaps, so it reads as a continuous path that happens to be
 * broken, rather than as a row of dots. That distinction is what keeps it separable from
 * the planned trajectory at a glance and in greyscale.
 */
export const DASH_TARGET_ORBIT: DashPattern = Object.freeze([9, 6]);

/**
 * A fallback dotted pattern — **not** how the planned trajectory is drawn.
 *
 * Here for the case of a plan arc whose dots cannot be computed (an open arc, a failed
 * Kepler solve), so that something recognisably dotted still appears rather than nothing.
 * The real planned trajectory uses positioned marks; see `trajectory.ts` for why a dash
 * array cannot express what §9.3 asks for.
 */
export const DASH_PLANNED_FALLBACK: DashPattern = Object.freeze([1, 6]);

/** Line weights in CSS pixels (§9.3: current heavy, plan and target medium). */
export const WIDTH_CURRENT_ORBIT = 2.25;
export const WIDTH_TARGET_ORBIT = 1.5;
export const WIDTH_PLANNED_TRAJECTORY = 1.5;

/** Radius of one equal-time dot on the planned trajectory, in CSS pixels. */
export const PLANNED_DOT_RADIUS = 1.4;

/**
 * Every colour the scene needs, as slots.
 *
 * Plain CSS colour strings, because that is what a `StrokeStyle` carries and what a
 * palette resolves to. Nothing here interprets them.
 */
export interface SceneColours {
  /** The page behind the scene. Absent leaves the canvas transparent. */
  readonly background?: string;
  /** Earth's disc. */
  readonly earthFill: string;
  /** Earth's limb and its coastlines. */
  readonly earthCoastline: string;
  /** The night side, drawn over the disc (#106). */
  readonly earthNight: string;
  /** A hazard shell at rest — the 100 km floor, always visible (§9.3). */
  readonly hazard: string;
  /** A hazard shell the trajectory intersects: the `L2` state (§6.4, #107). */
  readonly hazardViolated: string;
  /** `--accent`: the current orbit. */
  readonly current: string;
  /** `--plan`: the planned trajectory. */
  readonly planned: string;
  /** `--target`: the target orbit. */
  readonly target: string;
  /** The ship marker. */
  readonly ship: string;
  /** The target marker. */
  readonly targetMarker: string;
  /** A maneuver node, and its handle cross. */
  readonly node: string;
  /** The ring on a selected node. */
  readonly nodeSelected: string;
  /** Apsis ticks and the closest-approach tie line. */
  readonly annotation: string;
}

/** The stroke for the current orbit. */
export const currentOrbitStroke = (colours: SceneColours): StrokeStyle => ({
  colour: colours.current,
  width: WIDTH_CURRENT_ORBIT,
  dash: DASH_CURRENT_ORBIT,
});

/** The stroke for the target orbit. */
export const targetOrbitStroke = (colours: SceneColours): StrokeStyle => ({
  colour: colours.target,
  width: WIDTH_TARGET_ORBIT,
  dash: DASH_TARGET_ORBIT,
});

/** The fill for one equal-time dot on the planned trajectory. */
export const plannedDotFill = (colours: SceneColours): FillStyle => ({ colour: colours.planned });

/**
 * The three trajectory patterns, for a test that asserts they are distinguishable
 * without reference to colour.
 *
 * A tuple rather than three loose constants so the "three distinct patterns" claim has
 * one thing to check.
 */
export const TRAJECTORY_PATTERNS: readonly DashPattern[] = Object.freeze([
  DASH_CURRENT_ORBIT,
  DASH_PLANNED_FALLBACK,
  DASH_TARGET_ORBIT,
]);
