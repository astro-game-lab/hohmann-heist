/**
 * Apsis ticks and the closest-approach tie line — §9.3, §8.4, §6.6, #111, #60.
 *
 * ## The suppression threshold is imported, never restated
 *
 * §9.3 suppresses apsis markers "for near-circular orbits (e < 1e-3)", and #111 asks that
 * the threshold "agree with the apsis finder's convention (#60) — the renderer and the
 * physics must not disagree about whether an apsis exists".
 *
 * The only way to guarantee that is to have one number. `APSIS_ECCENTRICITY_FLOOR` lives
 * in `@hh/propagation`, where the event finder uses it to decide there are no crossings to
 * report, and this module imports it. Writing `1e-3` here would compile, pass every test,
 * and then drift the first time either side was tuned — leaving a band of eccentricities
 * where the planner draws a periapsis the physics says does not exist, or vice versa. That
 * disagreement would look like a bug in the solver.
 *
 * It also means the degenerate case needs no special handling: below the floor there is no
 * apse line, the convention is stated rather than fudged, and this module draws nothing.
 *
 * ## Labels are DOM, so this returns anchors and keys
 *
 * D8 puts all text in the DOM (#113), so an apsis marker here is a **tick** plus a
 * `LabelSpec`'s worth of anchor and content. The altitude is a *number* in the label's
 * parameters — this package never formats one, because formatting a length is locale
 * work and `Intl` lives with the catalogue (FR-910).
 *
 * §8.4 explains why the labels matter more than they look: at LEO framing the two orbits
 * of C01 are 400 km apart on a 6 378 km ball, which is a few pixels. "Apsis labels
 * carrying altitude in text, so the number is legible even when the geometric separation
 * is a few pixels" is that section's stated answer, which makes these labels load-bearing
 * rather than annotation.
 *
 * ## The tie line honours the assist
 *
 * §6.6 makes closest-approach markers an assist that can be switched off — disabling it
 * earns the *Blind* modifier. So the tie line is drawn only when asked. `undefined` rather
 * than an empty array, so a caller cannot accidentally render "nothing" and think the
 * assist was on.
 */
import { APSIS_ECCENTRICITY_FLOOR } from '@hh/propagation';
import type { EciVector, OrbitShape } from '@hh/astro';
import {
  apoapsisRadius,
  eccentricFromTrue,
  eci,
  meanFromEccentric,
  periapsisRadius,
} from '@hh/astro';
import type { Metres } from '@hh/math';
import { V, metres } from '@hh/math';

import type { Camera } from './camera.js';
import { worldToScreen } from './camera.js';
import type { Primitive, PolylinePrimitive, ScreenPoint } from './renderer.js';
import type { SceneColours } from './style.js';
import { keplerianSampler } from './trajectory.js';

/** The world origin, which every apse's radius is measured from. */
const ORIGIN: EciVector<Metres> = eci(V.vec3(metres(0), metres(0), metres(0)));

/** Half-length of an apsis tick, in CSS pixels, measured along the radius. */
export const APSIS_TICK_PX = 7;

/** Which apsis a marker is. */
export type ApsisKind = 'periapsis' | 'apoapsis';

/** An apsis marker: a tick to draw, and a label to place. */
export interface ApsisMarker {
  readonly id: string;
  readonly kind: ApsisKind;
  /** Where the tick sits, in CSS pixels. */
  readonly at: ScreenPoint;
  /** The tick itself. */
  readonly tick: PolylinePrimitive;
  /** Where the label goes. */
  readonly labelAt: ScreenPoint;
  /** Catalogue key for the label. Resolved by `@hh/ui` (FR-910). */
  readonly labelKey: string;
  /** Altitude above the reference radius, in metres. A number, never a formatted string. */
  readonly altitudeMetres: number;
}

/** The two catalogue keys this module can emit. */
export const APSIS_LABEL_KEYS = Object.freeze({
  periapsis: 'planner.apsis.periapsis',
  apoapsis: 'planner.apsis.apoapsis',
} as const);

/**
 * Whether an orbit has apsides worth drawing.
 *
 * Exported so a caller can ask the same question the renderer asks, and so a test can
 * pin that the answer comes from `@hh/propagation` rather than from a local constant.
 */
export const hasDistinctApsides = (eccentricity: number): boolean =>
  eccentricity >= APSIS_ECCENTRICITY_FLOOR && eccentricity < 1;

/** A tick across the orbit at `at`, oriented along the radial direction `direction`. */
const apsisTick = (
  at: ScreenPoint,
  direction: ScreenPoint,
  colour: string,
  halfLengthPx: number,
): PolylinePrimitive => ({
  kind: 'polyline',
  points: [
    { x: at.x - direction.x * halfLengthPx, y: at.y - direction.y * halfLengthPx },
    { x: at.x + direction.x * halfLengthPx, y: at.y + direction.y * halfLengthPx },
  ],
  stroke: { colour, width: 1.5 },
});

/**
 * The apsis markers of one orbit.
 *
 * Empty below the eccentricity floor — see the docstring. `referenceRadiusMetres` is what
 * altitude is measured above, which is Earth's equatorial radius for every v1.0 contract
 * but is a parameter because the renderer has no business owning a planet.
 */
export const apsisMarkers = (
  camera: Camera,
  elements: OrbitShape,
  mu: number,
  referenceRadiusMetres: number,
  colours: SceneColours,
  idPrefix = 'apsis',
): ApsisMarker[] => {
  if (!hasDistinctApsides(elements.eccentricity)) return [];

  const sample = keplerianSampler(elements, mu);
  const centre = worldToScreen(camera, ORIGIN);
  const out: ApsisMarker[] = [];

  const entries: readonly { kind: ApsisKind; radius: number }[] = [
    { kind: 'periapsis', radius: periapsisRadius(elements) },
    { kind: 'apoapsis', radius: apoapsisRadius(elements) },
  ];

  for (const entry of entries) {
    // The apse's position comes from the *same sampler the trajectory is drawn with*,
    // stepped to the right mean anomaly, rather than reconstructed from the elements.
    // Building it independently would put the tick a fraction of a pixel off the curve at
    // high zoom, which reads as a seam in the rendering rather than as the rounding it is.
    const world = sample(offsetToApse(elements, mu, entry.kind));
    if (world === undefined) continue;

    const at = worldToScreen(camera, world);
    const dx = at.x - centre.x;
    const dy = at.y - centre.y;
    const length = Math.hypot(dx, dy);
    // Along the radius. At an apse the radial direction is the normal to the path, so a
    // radial tick crosses the orbit square-on — which is the only orientation that reads
    // as a tick rather than as a stray tangent.
    const direction = length > 1e-9 ? { x: dx / length, y: dy / length } : { x: 1, y: 0 };

    out.push({
      id: `${idPrefix}:${entry.kind}`,
      kind: entry.kind,
      at,
      tick: apsisTick(at, direction, colours.annotation, APSIS_TICK_PX),
      // Outside the tick, along the radius, so the label sits off the orbit rather than
      // on it — which is what keeps it readable when two orbits are a few pixels apart.
      labelAt: {
        x: at.x + direction.x * (APSIS_TICK_PX + 8),
        y: at.y + direction.y * (APSIS_TICK_PX + 8),
      },
      labelKey: APSIS_LABEL_KEYS[entry.kind],
      altitudeMetres: entry.radius - referenceRadiusMetres,
    });
  }

  return out;
};

/**
 * Seconds from the arc's start to an apse.
 *
 * Periapsis is mean anomaly 0 and apoapsis is pi, so this is the difference from the
 * arc's own starting mean anomaly divided by the mean motion. The anomaly conversions
 * come from `@hh/astro` rather than being written out here: `eccentricFromTrue` already
 * uses the half-angle form that stays conditioned at high eccentricity, and a second copy
 * of it in the renderer is a second thing to get wrong.
 */
const offsetToApse = (elements: OrbitShape, mu: number, kind: ApsisKind): number => {
  const a = (elements.semiLatusRectum as number) / (1 - elements.eccentricity ** 2);
  const n = Math.sqrt(mu / (a * a * a));
  const startMean = meanFromEccentric(
    eccentricFromTrue(elements.trueAnomaly, elements.eccentricity),
    elements.eccentricity,
  );
  const targetMean = kind === 'periapsis' ? 0 : Math.PI;
  return (targetMean - startMean) / n;
};

/**
 * The closest-approach tie line, or `undefined` when the assist is off.
 *
 * §6.6 makes closest-approach markers an assist; disabling it earns the *Blind* modifier,
 * so it has to be genuinely absent rather than drawn faintly. `undefined` rather than an
 * empty array so a caller cannot mistake "nothing to draw" for "assist off".
 */
export interface TieLine {
  readonly line: Primitive;
  readonly labelAt: ScreenPoint;
  readonly labelKey: string;
  /** Separation in metres, and relative speed in m/s. Numbers, never formatted here. */
  readonly separationMetres: number;
  readonly relativeSpeedMps: number;
}

/** Catalogue key for the tie line's label. */
export const TIE_LINE_LABEL_KEY = 'planner.closestApproach';

export interface TieLineRequest {
  /** The two positions at the closest-approach epoch. */
  readonly shipPosition: EciVector<Metres>;
  readonly targetPosition: EciVector<Metres>;
  /** Separation and relative speed, computed by `@hh/propagation`'s approach finder. */
  readonly separationMetres: number;
  readonly relativeSpeedMps: number;
  /** §6.6's assist. `false` draws nothing at all. */
  readonly assistEnabled: boolean;
}

export const closestApproachTieLine = (
  camera: Camera,
  request: TieLineRequest,
  colours: SceneColours,
): TieLine | undefined => {
  if (!request.assistEnabled) return undefined;

  const from = worldToScreen(camera, request.shipPosition);
  const to = worldToScreen(camera, request.targetPosition);

  return {
    line: {
      kind: 'polyline',
      points: [from, to],
      // Dashed, so it reads as an annotation rather than as a path anything flies.
      stroke: { colour: colours.annotation, width: 1, dash: [3, 3], alpha: 0.9 },
    },
    labelAt: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 - 10 },
    labelKey: TIE_LINE_LABEL_KEY,
    separationMetres: request.separationMetres,
    relativeSpeedMps: request.relativeSpeedMps,
  };
};
