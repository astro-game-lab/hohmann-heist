/**
 * Earth: the disc, the coastlines, and the day/night terminator — §9.3, §8.4, #106.
 *
 * ## Drawn to scale, always
 *
 * §9.3 says so without qualification, and §8.4 explains the consequence: at LEO framing
 * the orbit sits 6% of a radius above the limb, so **Earth is allowed to overflow the
 * viewport** and the camera frames the orbits rather than the planet. Nothing here clamps
 * a radius or nudges a disc back on screen — an Earth drawn a little larger "for
 * legibility" would make every altitude on screen a lie, and altitude is the quantity the
 * game is about.
 *
 * That makes overflow the normal case rather than an edge case, and it is what the
 * coastline culling below has to survive: at LEO framing most of the disc is off-screen
 * and the visible limb is a shallow arc across a corner.
 *
 * ## The Sun vector is a parameter, and that is a layering decision
 *
 * The terminator derives from a Sun direction this module is *given*. DEP-06 — the Sun
 * held fixed for the duration of a contract — is a gameplay departure and lives in
 * `@hh/game/eclipse`; §7.5 is explicit that nothing in that table may live below the game
 * layer. A renderer that assumed a fixed Sun would have quietly imported a departure, and
 * the honesty rule exists to stop exactly that. Pass a moving Sun and this draws a moving
 * terminator, with no change here.
 *
 * ## Earth's rotation is presentational
 *
 * `rotationAngle` turns the coastlines and nothing else. §7.4's model is strictly
 * two-body about a point mass, so the planet's orientation has no dynamical consequence
 * whatsoever — it exists so that ground stations (§6.5's blackout constraint) sit over
 * the right piece of ocean. Taking the angle as a parameter rather than deriving it from
 * an epoch keeps the clock out of this package (NFR-008) and leaves the caller to
 * multiply by `OMEGA_EARTH`.
 *
 * ## Culling the far hemisphere
 *
 * A sphere's coastlines wrap all the way round, and under an orthographic projection the
 * far half lands on top of the near half — Australia drawn through the Atlantic. A point
 * is on the near side when it faces the viewer, which is `dot(p, viewDirection) > 0` where
 * the view direction is `right x up`.
 *
 * Rings are **split** at the horizon rather than filtered, because dropping the far
 * vertices from a ring and drawing the rest as one polyline would join the two ends with
 * a chord straight across the disc. That is the same failure mode the antimeridian split
 * avoids in the data, for the same reason, and it is why this returns many short
 * polylines rather than one per ring.
 */
import type { EciVector } from '@hh/astro';
import { eci } from '@hh/astro';
import type { Metres, Vec3 } from '@hh/math';
import { V, metres } from '@hh/math';

import type { Camera } from './camera.js';
import { worldToScreen } from './camera.js';
import type { Coastlines } from './coastlines.js';
import { COASTLINES } from './coastlines.js';
import type {
  DiscPrimitive,
  PolygonPrimitive,
  PolylinePrimitive,
  ScreenPoint,
} from './renderer.js';
import type { SceneColours } from './style.js';

/** Samples around the terminator ellipse. Enough that it reads as a smooth curve at any zoom. */
const TERMINATOR_SAMPLES = 128;

/** Samples around the limb when the night region has to close along it. */
const LIMB_SAMPLES = 128;

/**
 * How nearly parallel the Sun and the view direction must be before the terminator is
 * treated as absent.
 *
 * At that point the terminator ellipse has collapsed to within a pixel of the limb, and
 * the visible face is all day or all night. Sampling it anyway would produce a degenerate
 * polygon that draws as a hairline across the planet.
 */
const TERMINATOR_DEGENERATE = 1e-6;

/** The world origin — Earth's centre, and the focus of every orbit here. */
const ORIGIN: EciVector<Metres> = eci(V.vec3(metres(0), metres(0), metres(0)));

/** The direction out of the screen, toward the viewer. */
export const viewDirection = (camera: Camera): Vec3 => V.cross(camera.basis.right, camera.basis.up);

/** Earth's disc: filled, outlined at the limb, always to scale. */
export const earthDisc = (
  camera: Camera,
  radiusMetres: number,
  colours: SceneColours,
): DiscPrimitive => ({
  kind: 'disc',
  centre: worldToScreen(camera, ORIGIN),
  radius: radiusMetres * camera.scale,
  fill: { colour: colours.earthFill },
  stroke: { colour: colours.earthCoastline, width: 1 },
});

/** Rotate an Earth-fixed direction into the inertial frame by `angle` about +z. */
const toInertial = (x: number, y: number, z: number, cos: number, sin: number): Vec3 => ({
  x: x * cos - y * sin,
  y: x * sin + y * cos,
  z,
});

/**
 * The coastlines, as screen-space polylines with the far hemisphere removed.
 *
 * Returns many short runs rather than one polyline per ring: see the module docstring on
 * why splitting beats filtering.
 */
export const coastlinePolylines = (
  camera: Camera,
  radiusMetres: number,
  rotationAngle: number,
  colours: SceneColours,
  coastlines: Coastlines = COASTLINES,
): PolylinePrimitive[] => {
  const view = viewDirection(camera);
  const cos = Math.cos(rotationAngle);
  const sin = Math.sin(rotationAngle);
  const { right, up } = camera.basis;
  const centre = worldToScreen(camera, ORIGIN);
  const pixels = radiusMetres * camera.scale;

  const out: PolylinePrimitive[] = [];
  const stroke = { colour: colours.earthCoastline, width: 1 };

  for (let ring = 0; ring < coastlines.ringCount; ring++) {
    const from = coastlines.offsets[ring] ?? 0;
    const to = coastlines.offsets[ring + 1] ?? 0;

    let run: ScreenPoint[] = [];
    for (let i = from; i < to; i++) {
      const p = toInertial(
        coastlines.vertices[i * 3] ?? 0,
        coastlines.vertices[i * 3 + 1] ?? 0,
        coastlines.vertices[i * 3 + 2] ?? 0,
        cos,
        sin,
      );

      if (p.x * view.x + p.y * view.y + p.z * view.z <= 0) {
        // Over the horizon. End the run here; the next visible vertex starts a new one.
        if (run.length >= 2) out.push({ kind: 'polyline', points: run, stroke });
        run = [];
        continue;
      }

      // The unit vector is already in the camera's frame of reference once dotted with
      // the basis, so this is `worldToScreen` with the radius folded in — and without
      // building an `EciVector` per vertex, which at 5 098 vertices a frame matters.
      run.push({
        x: centre.x + (p.x * right.x + p.y * right.y + p.z * right.z) * pixels,
        y: centre.y - (p.x * up.x + p.y * up.y + p.z * up.z) * pixels,
      });
    }
    if (run.length >= 2) out.push({ kind: 'polyline', points: run, stroke });
  }

  return out;
};

/**
 * The night side of the visible disc, as a polygon to lay over it.
 *
 * The terminator is the great circle of surface points perpendicular to the Sun. Under an
 * orthographic projection it draws as an ellipse, and rather than deriving that ellipse's
 * axes this samples the circle in three dimensions and projects each sample — which is the
 * same answer, is obviously correct, and costs 128 points once a frame.
 *
 * The night region is bounded by the visible half of that ellipse plus the unlit part of
 * the limb, so the polygon is built in two passes and joined.
 *
 * @returns `undefined` when the visible face is entirely lit, and the whole disc when it
 * is entirely dark.
 */
export const terminatorPolygon = (
  camera: Camera,
  radiusMetres: number,
  sunDirection: Vec3,
  colours: SceneColours,
): PolygonPrimitive | undefined => {
  const sunNorm = V.normSq(sunDirection);
  if (sunNorm === 0) return undefined;
  const sun = V.normalize(sunDirection);
  const view = viewDirection(camera);
  const { right, up } = camera.basis;
  const centre = worldToScreen(camera, ORIGIN);
  const pixels = radiusMetres * camera.scale;

  const fill = { colour: colours.earthNight };
  const toScreen = (p: Vec3): ScreenPoint => ({
    x: centre.x + (p.x * right.x + p.y * right.y + p.z * right.z) * pixels,
    y: centre.y - (p.x * up.x + p.y * up.y + p.z * up.z) * pixels,
  });

  // How much of the terminator is on the near side is governed by the angle between the
  // Sun and the view direction. At the extremes the ellipse degenerates onto the limb.
  const alignment = V.dot(sun, view);
  if (alignment >= 1 - TERMINATOR_DEGENERATE) {
    // Sun behind the viewer: the whole visible face is day.
    return undefined;
  }
  if (alignment <= -1 + TERMINATOR_DEGENERATE) {
    // Sun behind the planet: the whole visible face is night. A polygon around the limb,
    // because there is no terminator on this side to bound it.
    const points: ScreenPoint[] = [];
    for (let i = 0; i < LIMB_SAMPLES; i++) {
      const phi = (2 * Math.PI * i) / LIMB_SAMPLES;
      points.push(toScreen(V.add(V.scale(right, Math.cos(phi)), V.scale(up, Math.sin(phi)))));
    }
    return { kind: 'polygon', points, fill };
  }

  // An orthonormal pair spanning the plane perpendicular to the Sun — the terminator
  // circle's own basis. `e1` is the part of the view direction perpendicular to the Sun,
  // which makes `dot(e1, view) > 0` by construction and is what the sampling range below
  // depends on.
  const e1 = V.normalize(V.sub(view, V.scale(sun, V.dot(view, sun))));
  const e2 = V.cross(sun, e1);

  // The visible half of the terminator, sampled over a *contiguous* range.
  //
  // Worth being explicit about, because the obvious version is wrong. Walking theta from
  // 0 to 2pi and keeping the samples that face the viewer collects two arcs — one either
  // side of theta = 0 — and appending them in index order produces a polyline that jumps
  // across the disc between them, and endpoints that are both at theta ~ 0 rather than at
  // opposite ends of the arc. The limb closure then sweeps the whole way round and the
  // night polygon swallows the daylit half.
  //
  // The visible range is exactly `[-pi/2, pi/2]`, and that is a fact rather than a
  // guess: `p = e1 cos t + e2 sin t`, `e2` is perpendicular to both the Sun and `e1` so
  // it is perpendicular to `view`, and therefore `dot(p, view) = cos t * dot(e1, view)`
  // with the second factor positive. Sampling that range directly gives one contiguous
  // arc whose two endpoints sit exactly on the limb, where `dot(p, view) = 0` — so the
  // closure below joins onto it without a seam.
  const terminator: ScreenPoint[] = [];
  for (let i = 0; i <= TERMINATOR_SAMPLES; i++) {
    const theta = -Math.PI / 2 + (Math.PI * i) / TERMINATOR_SAMPLES;
    terminator.push(toScreen(V.add(V.scale(e1, Math.cos(theta)), V.scale(e2, Math.sin(theta)))));
  }

  // Close along the limb, from the arc's end back to its start, through the unlit side.
  // The limb is `right cos phi + up sin phi`; the unlit part is where that faces away
  // from the Sun.
  const angleOf = (p: Vec3): number => Math.atan2(V.dot(p, up), V.dot(p, right));
  const startAngle = angleOf(e2); // theta = +pi/2
  const endAngle = angleOf(V.negate(e2)); // theta = -pi/2

  // Two ways round the limb; take the one whose midpoint is on the night side, so the
  // polygon encloses darkness rather than daylight.
  let sweep = endAngle - startAngle;
  while (sweep <= 0) sweep += 2 * Math.PI;
  const midpoint = V.add(
    V.scale(right, Math.cos(startAngle + sweep / 2)),
    V.scale(up, Math.sin(startAngle + sweep / 2)),
  );
  if (V.dot(midpoint, sun) > 0) sweep -= 2 * Math.PI;

  const limb: ScreenPoint[] = [];
  for (let i = 1; i < LIMB_SAMPLES; i++) {
    const phi = startAngle + (sweep * i) / LIMB_SAMPLES;
    limb.push(toScreen(V.add(V.scale(right, Math.cos(phi)), V.scale(up, Math.sin(phi)))));
  }

  return { kind: 'polygon', points: [...terminator, ...limb], fill };
};
