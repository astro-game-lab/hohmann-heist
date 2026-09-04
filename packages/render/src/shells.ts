/**
 * Hazard shells: the altitude floor, and any other forbidden annulus — §9.3, §6.5, #107.
 *
 * ## One mechanism, two constraints, no second code path
 *
 * §9.3 draws the 100 km altitude floor as "a thin hatched shell, always visible", and
 * §6.5 adds a **no-fly shell** — "never within an annulus of radii" — at C18. #107 asks
 * that the second reuse the first rather than growing its own drawing code, and the way
 * to get that is to notice they are the same shape: an annulus between two radii. The
 * floor is the annulus from Earth's surface to 100 km; a no-fly zone is an annulus
 * somewhere else. Nothing below knows which is which.
 *
 * ## The radii are parameters, and the meaning is not here
 *
 * DEP-08 — the 100 km floor being an instant fail, standing in for drag and reentry that
 * are not modelled — lives in `@hh/game/legality`, and §7.5 forbids it below the game
 * layer. So this module is handed two radii and a state, and has no idea that one
 * particular pair of them is the Kármán line. `ALT_FLOOR` appears nowhere in this file.
 *
 * ## State is carried by hatch and fill, never by colour alone
 *
 * §8.3.4's fifth principle. A shell the trajectory intersects is the `L2` legality state
 * (§6.4), and it has to be unmistakable to a player who cannot distinguish the two
 * colours — which for red against a dark field is a large number of people. So three
 * things change together: the fill deepens, the hatch **doubles in density**, and the
 * stroke thickens. Any one of them alone identifies the state in greyscale.
 *
 * ## Hatch spacing is in screen pixels, not world metres
 *
 * §8.4 spans LEO to 17 Earth radii, so a hatch spaced in metres would be a solid smear at
 * one framing and three lonely ticks at the other. Spacing the ticks by *screen* distance
 * keeps the texture identical at every zoom, which is what "legible at both LEO and GEO
 * framing" asks for. The count is derived from the annulus's on-screen circumference.
 *
 * ## Why the band is one slit polygon
 *
 * `renderer.ts` has no ring primitive and no even-odd fill — a `PolygonPrimitive` is one
 * closed subpath. An annulus is expressible anyway by tracing the outer circle one way and
 * the inner circle back the other, which closes into a ring with a hairline seam where the
 * two meet. That seam falls on a radius and is invisible under the hatch. The alternative
 * — adding a ring primitive to the `Renderer` interface — would put a shape in the seam
 * that a WebGL implementation would also have to grow, for one caller.
 */
import type { EciVector } from '@hh/astro';
import { eci } from '@hh/astro';
import type { Metres } from '@hh/math';
import { V, metres } from '@hh/math';

import type { Camera } from './camera.js';
import { worldToScreen } from './camera.js';
import type { Primitive, ScreenPoint } from './renderer.js';
import type { SceneColours } from './style.js';

/** Samples around each circle of the annulus. */
const CIRCLE_SAMPLES = 128;

/** Target screen distance between hatch ticks, in CSS pixels, when the shell is clear. */
export const HATCH_SPACING_PX = 14;

/** Ticks per unit of spacing when the shell is violated: twice as dense. */
export const VIOLATED_HATCH_FACTOR = 2;

/** Fewest and most hatch ticks, so a tiny or enormous shell stays sane. */
const MIN_HATCH_TICKS = 12;
const MAX_HATCH_TICKS = 360;

/** Fill opacity at rest, and when intersected. */
const CLEAR_FILL_ALPHA = 0.12;
const VIOLATED_FILL_ALPHA = 0.4;

/** Stroke width at rest, and when intersected. */
const CLEAR_STROKE_WIDTH = 1;
const VIOLATED_STROKE_WIDTH = 1.75;

/** The world origin, which every shell is concentric with. */
const ORIGIN: EciVector<Metres> = eci(V.vec3(metres(0), metres(0), metres(0)));

/**
 * Whether the trajectory intersects this shell.
 *
 * `violated` is §6.4's `L2` for the altitude floor, and the equivalent for any other
 * shell. Computing it is `@hh/game`'s job — this module is told.
 */
export type ShellState = 'clear' | 'violated';

/** A forbidden annulus, in metres from the centre of the world. */
export interface HazardShell {
  /** Stable identity, for the hit-test index and for a label. */
  readonly id: string;
  readonly innerRadiusMetres: number;
  readonly outerRadiusMetres: number;
  readonly state: ShellState;
}

/** A circle of `radius` screen pixels about `centre`, sampled. */
const circle = (centre: ScreenPoint, radius: number, reverse: boolean): ScreenPoint[] => {
  const points: ScreenPoint[] = [];
  for (let i = 0; i < CIRCLE_SAMPLES; i++) {
    const index = reverse ? CIRCLE_SAMPLES - 1 - i : i;
    const angle = (2 * Math.PI * index) / CIRCLE_SAMPLES;
    points.push({
      x: centre.x + radius * Math.cos(angle),
      y: centre.y + radius * Math.sin(angle),
    });
  }
  return points;
};

/**
 * How many hatch ticks a shell gets at this zoom.
 *
 * Derived from the on-screen circumference so the texture is scale-invariant, then
 * clamped: an off-screen-large shell would otherwise ask for tens of thousands of ticks
 * and spend the whole frame budget drawing texture nobody can resolve.
 */
export const hatchTickCount = (outerRadiusPx: number, state: ShellState): number => {
  const spacing = HATCH_SPACING_PX / (state === 'violated' ? VIOLATED_HATCH_FACTOR : 1);
  const circumference = 2 * Math.PI * Math.max(outerRadiusPx, 0);
  const wanted = Math.round(circumference / spacing);
  return Math.min(Math.max(wanted, MIN_HATCH_TICKS), MAX_HATCH_TICKS);
};

/**
 * Draw one hazard shell.
 *
 * Returns the band, then the hatch, then the two boundary circles, in that order — the
 * caller drops them into the `hazard-shells` layer and `DRAW_ORDER` handles the rest.
 *
 * A shell whose radii are inverted or non-finite draws nothing rather than throwing: a
 * scenario can produce one, and a missing hazard band is a better failure than a crashed
 * planner. A degenerate shell is a content bug that `tools/content` should catch, not a
 * runtime exception in the middle of a drag.
 */
export const hazardShellPrimitives = (
  camera: Camera,
  shell: HazardShell,
  colours: SceneColours,
): Primitive[] => {
  const { innerRadiusMetres: inner, outerRadiusMetres: outer } = shell;
  if (!Number.isFinite(inner) || !Number.isFinite(outer)) return [];
  if (!(outer > inner) || !(inner >= 0)) return [];

  const centre = worldToScreen(camera, ORIGIN);
  const innerPx = inner * camera.scale;
  const outerPx = outer * camera.scale;
  if (!(outerPx > 0)) return [];

  const violated = shell.state === 'violated';
  const colour = violated ? colours.hazardViolated : colours.hazard;
  const alpha = violated ? VIOLATED_FILL_ALPHA : CLEAR_FILL_ALPHA;
  const width = violated ? VIOLATED_STROKE_WIDTH : CLEAR_STROKE_WIDTH;

  // The band: outer circle forward, inner circle back. See the module docstring on why
  // this is one polygon rather than a ring primitive.
  const band: Primitive = {
    kind: 'polygon',
    points: [...circle(centre, outerPx, false), ...circle(centre, innerPx, true)],
    fill: { colour, alpha },
  };

  // Radial ticks across the band, spaced by screen distance so the texture holds at every
  // zoom from LEO to 17 Earth radii.
  const ticks = hatchTickCount(outerPx, shell.state);
  const hatch: Primitive[] = [];
  for (let i = 0; i < ticks; i++) {
    const angle = (2 * Math.PI * i) / ticks;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    hatch.push({
      kind: 'polyline',
      points: [
        { x: centre.x + innerPx * cos, y: centre.y + innerPx * sin },
        { x: centre.x + outerPx * cos, y: centre.y + outerPx * sin },
      ],
      stroke: { colour, width: violated ? 1.25 : 0.75, alpha: violated ? 0.95 : 0.6 },
    });
  }

  const boundary = (radiusPx: number): Primitive => ({
    kind: 'polyline',
    points: circle(centre, radiusPx, false),
    closed: true,
    stroke: { colour, width },
  });

  // The inner boundary is dropped when it has collapsed to a point — a shell sitting on
  // the world origin, which the altitude floor never is but a scenario could ask for.
  return innerPx > 0.5
    ? [band, ...hatch, boundary(innerPx), boundary(outerPx)]
    : [band, ...hatch, boundary(outerPx)];
};
