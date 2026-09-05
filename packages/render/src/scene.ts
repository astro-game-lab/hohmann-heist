/**
 * Composing one frame of the orbit scene — §9.3, §11.8.
 *
 * Every other module here draws one thing. This is the one that decides what a frame
 * *is*: which layers get which primitives, which labels the DOM layer is asked for, and
 * which targets the hit-test index is built from. §11.8's step 5 in one function.
 *
 * ## Three outputs, built together on purpose
 *
 * A frame produces geometry (the `Scene`), text (the `LabelSpec`s) and interaction (the
 * `HitTarget`s), and they have to agree. A node's diamond, the label beside it and the
 * target under it are the same point, and computing that point three times in three
 * places is how they drift apart — the classic symptom being a click that selects
 * nothing because the target is two pixels from the mark.
 *
 * So they are returned together from one pass. The hit index is *not* rebuilt here per
 * frame, though: `buildHitIndex` is the caller's to run, on layout change only (§11.8's
 * step 6). This returns the targets; when to index them is the planner's decision.
 *
 * ## Labels are keys, not sentences
 *
 * Every label comes back as a catalogue key and a parameter bag. FR-910 puts the wording
 * in `@hh/ui`, and this package cannot import it, so the caller resolves each one before
 * handing it to the label layer. The `resolve` callback is that seam — one function,
 * supplied by the application, that turns a key and its parameters into a string.
 *
 * ## Ordering
 *
 * Primitives go into `DRAW_ORDER`'s layers by name, never by call order, so a frame is
 * independent of the sequence this function happens to build things in (NFR-009). The
 * hit targets are ordered most-specific-first because `hit-test.ts` breaks exact
 * distance ties by input order, and because keyboard focus walks the same list.
 */
import type { Epoch, OrbitShape } from '@hh/astro';
import type { Vec3 } from '@hh/math';
import type { Timeline } from '@hh/sim';

import type { ApsisMarker } from './apsis.js';
import { apsisMarkers, closestApproachTieLine } from './apsis.js';
import type { TieLineRequest } from './apsis.js';
import type { Camera } from './camera.js';
import { worldToScreen } from './camera.js';
import { coastlinePolylines, earthDisc, terminatorPolygon } from './earth.js';
import type { HitTarget } from './hit-test.js';
import type { LabelSpec } from './label-spec.js';
import type { MarkerSpec } from './markers.js';
import { markerPrimitive, trailPrimitives } from './markers.js';
import type { NodeSpec } from './nodes.js';
import { handlePrimitives, nodeGeometry, nodePrimitives } from './nodes.js';
import type { Layer, Primitive, Scene } from './renderer.js';
import type { HazardShell } from './shells.js';
import { hazardShellPrimitives } from './shells.js';
import type { SceneColours } from './style.js';
import {
  PLANNED_DOT_RADIUS,
  currentOrbitStroke,
  plannedDotFill,
  targetOrbitStroke,
} from './style.js';
import type { TessellationCache } from './cache.js';
import { equalTimeDots } from './trajectory.js';

/**
 * How the caller turns a catalogue key and its parameters into text.
 *
 * The whole of FR-910's seam. `@hh/ui`'s `createCatalogue` produces exactly this shape.
 */
export type ResolveMessage = (key: string, params: Record<string, number>) => string;

export interface SceneRequest {
  readonly camera: Camera;
  readonly colours: SceneColours;
  /** The evaluated plan: arcs, impulses, and the conics they lie on. */
  readonly timeline: Timeline;
  /** Where the scrub head is. Everything drawn "now" is drawn here. */
  readonly scrubEpoch: Epoch;
  /** Tessellation cache — dragging one node must not re-tessellate every orbit (NFR-011). */
  readonly cache: TessellationCache;
  /** Largest radius worth drawing, in metres. Clips open and very eccentric arcs. */
  readonly maxRadiusMetres: number;
  /** Earth's radius, and the radius altitudes are measured above. */
  readonly earthRadiusMetres: number;
  /** Earth's rotation angle at the scrub epoch. Presentational only (#106). */
  readonly earthRotationAngle: number;
  /** The Sun direction. DEP-06's fixed Sun is the caller's choice, not this module's. */
  readonly sunDirection: Vec3;
  /** Hazard shells to draw, with their states already decided by `@hh/game` (#107). */
  readonly shells: readonly HazardShell[];
  /** The target orbit, when the contract has one. */
  readonly targetOrbit?: MarkerSpec;
  /** The ship at the scrub epoch. */
  readonly ship: MarkerSpec;
  /** Maneuver nodes, with selection already decided by the planner. */
  readonly nodes: readonly NodeSpec[];
  /** The closest-approach tie line, or absent when §6.6's assist is off. */
  readonly closestApproach?: Omit<TieLineRequest, 'assistEnabled'> & {
    readonly assistEnabled: boolean;
  };
  /** Turns catalogue keys into text (FR-910). */
  readonly resolve: ResolveMessage;
}

export interface SceneResult {
  readonly scene: Scene;
  /** Text for the DOM layer (#113). Already resolved. */
  readonly labels: readonly LabelSpec[];
  /** Targets for `buildHitIndex` (#114). Most specific first. */
  readonly targets: readonly HitTarget[];
}

/** One apsis marker's label, resolved. */
const apsisLabel = (marker: ApsisMarker, resolve: ResolveMessage): LabelSpec => ({
  id: marker.id,
  text: resolve(marker.labelKey, { altitudeMetres: marker.altitudeMetres }),
  at: marker.labelAt,
  anchor: 'left',
  className: 'hh-label--apsis',
});

/**
 * Build one frame.
 *
 * Pure: no clock, no DOM, no randomness, and no mutation of anything passed in. The same
 * request produces the same frame, which is what lets a replay be checked frame by frame
 * and a test assert a scene without a canvas.
 */
export const buildScene = (request: SceneRequest): SceneResult => {
  const { camera, colours, timeline, cache } = request;

  const earth: Primitive[] = [earthDisc(camera, request.earthRadiusMetres, colours)];
  const night = terminatorPolygon(camera, request.earthRadiusMetres, request.sunDirection, colours);
  if (night !== undefined) earth.push(night);
  earth.push(
    ...coastlinePolylines(camera, request.earthRadiusMetres, request.earthRotationAngle, colours),
  );

  const hazardShells: Primitive[] = [];
  for (const shell of request.shells) {
    hazardShells.push(...hazardShellPrimitives(camera, shell, colours));
  }

  // Arc 0 is the orbit the ship is on now; every later arc is a consequence of the plan,
  // so they land on different layers and read differently. §9.3's distinction, and it
  // costs nothing to honour.
  const currentOrbit: Primitive[] = [];
  const plannedTrajectory: Primitive[] = [];
  const targets: HitTarget[] = [];

  for (const [index, arc] of timeline.arcs.entries()) {
    const tessellation = cache.get({
      elements: arc.elements,
      scale: camera.scale,
      maxRadius: request.maxRadiusMetres,
    });
    const points = tessellation.points.map((p) => worldToScreen(camera, p));

    if (index === 0) {
      currentOrbit.push({
        kind: 'polyline',
        points,
        closed: tessellation.closed,
        stroke: currentOrbitStroke(colours),
      });
    } else {
      // The planned trajectory is dots at equal *time*, not a dashed polyline — see
      // `trajectory.ts` for why a dash array cannot express what §9.3 asks for.
      const durationSeconds = (arc.endEpoch as number) - (arc.startEpoch as number);
      if (arc.elements.eccentricity < 1 && durationSeconds > 0) {
        const dots = equalTimeDots({
          elements: arc.elements,
          mu: timeline.mu,
          durationSeconds,
        });
        const fill = plannedDotFill(colours);
        for (const point of dots.points) {
          plannedTrajectory.push({
            kind: 'disc',
            centre: worldToScreen(camera, point),
            radius: PLANNED_DOT_RADIUS,
            fill,
          });
        }
      } else {
        // An open or degenerate arc has no period to divide, so it falls back to a dashed
        // path rather than disappearing. §6.4's L4 makes it illegal to commit, and the
        // player should be able to see the thing they are being told about.
        plannedTrajectory.push({
          kind: 'polyline',
          points,
          stroke: { ...targetOrbitStroke(colours), colour: colours.planned },
        });
      }
    }

    /*
     * **Every** arc is a hit target, arc 0 included — §8.5.2 places a node by clicking a
     * trajectory, and FR-405 requires every node to be creatable by pointer.
     *
     * Arc 0 used to be drawn and then `continue`d past this, which made the current orbit
     * the one curve on screen that could not be clicked. That is invisible as long as a
     * plan already has a burn in it, because arcs 1…n cover the same pixels; it bites on
     * the **empty plan**, where arc 0 is the only arc there is. The first node of every
     * contract therefore could not be placed with the pointer at all — the player had to
     * find `N` or the plan panel's Add button — while the second one could, which reads
     * as the click target being unreliable rather than absent.
     *
     * Drawing and hit-testing stay separate concerns: arc 0 keeps §9.3's current-orbit
     * stroke and does not become dots. Only its clickability changes. `pickEpoch` already
     * searches every arc's span regardless of which one the index named, so nothing
     * downstream needed to learn about this.
     */
    targets.push({
      shape: 'path',
      kind: 'trajectory',
      id: `arc:${String(index)}`,
      points,
    });
  }

  const targetOrbitLayer: Primitive[] = [];
  if (request.targetOrbit !== undefined) {
    const tessellation = cache.get({
      elements: request.targetOrbit.elements,
      scale: camera.scale,
      maxRadius: request.maxRadiusMetres,
    });
    targetOrbitLayer.push({
      kind: 'polyline',
      points: tessellation.points.map((p) => worldToScreen(camera, p)),
      closed: tessellation.closed,
      stroke: targetOrbitStroke(colours),
    });
  }

  const trails: Primitive[] = [...trailPrimitives(camera, request.ship, colours)];
  const markers: Primitive[] = [];
  const shipMark = markerPrimitive(camera, request.ship, colours);
  if (shipMark !== undefined) markers.push(shipMark);
  if (request.targetOrbit !== undefined) {
    trails.push(...trailPrimitives(camera, request.targetOrbit, colours));
    const targetMark = markerPrimitive(camera, request.targetOrbit, colours);
    if (targetMark !== undefined) markers.push(targetMark);
  }

  const labels: LabelSpec[] = [];
  const constraintGeometry: Primitive[] = [];

  // Apsis ticks on **every orbit shown** (§9.3) — which means the planned arcs too, not
  // just the current and target orbits. That distinction is not pedantic: in a transfer
  // contract the starting orbit and the target are both circular and have no apsides at
  // all, while the transfer ellipse between them is the one place an apoapsis exists and
  // the one the player is actually steering by. Drawing only the endpoints would suppress
  // every marker in the scene and look like the feature was not working.
  //
  // `apsisMarkers` applies the eccentricity floor itself, so a circular arc contributes
  // nothing here and needs no special case.
  //
  // `OrbitShape` rather than `ClassicalElements`: an arc's elements carry a `degeneracy`
  // tag and a marker's do not, and nothing here needs it — apsis geometry is a function of
  // the shape alone.
  const withApsides: readonly { elements: OrbitShape; id: string }[] = [
    ...timeline.arcs.map((arc, index) => ({
      elements: arc.elements,
      id: index === 0 ? 'current' : `arc-${String(index)}`,
    })),
    ...(request.targetOrbit === undefined
      ? []
      : [{ elements: request.targetOrbit.elements, id: 'target' }]),
  ];
  for (const orbit of withApsides) {
    for (const marker of apsisMarkers(
      camera,
      orbit.elements,
      timeline.mu,
      request.earthRadiusMetres,
      colours,
      `apsis:${orbit.id}`,
    )) {
      constraintGeometry.push(marker.tick);
      labels.push(apsisLabel(marker, request.resolve));
    }
  }

  const tie =
    request.closestApproach === undefined
      ? undefined
      : closestApproachTieLine(camera, request.closestApproach, colours);
  if (tie !== undefined) {
    constraintGeometry.push(tie.line);
    labels.push({
      id: 'closest-approach',
      text: request.resolve(tie.labelKey, {
        separationMetres: tie.separationMetres,
        relativeSpeedMps: tie.relativeSpeedMps,
      }),
      at: tie.labelAt,
      anchor: 'bottom',
      className: 'hh-label--approach',
    });
  }

  const nodeLayer: Primitive[] = [];
  const handleLayer: Primitive[] = [];
  for (const node of request.nodes) {
    const geometry = nodeGeometry(camera, node);
    nodeLayer.push(...nodePrimitives(geometry, node, colours));
    handleLayer.push(...handlePrimitives(geometry, node, colours));

    // Handles beat nodes beat markers beat the trajectory (#114), so they go in first.
    for (const handle of geometry.handles) {
      targets.unshift({
        shape: 'point',
        kind: 'handle',
        id: `${handle.nodeId}:${handle.axisId}`,
        at: handle.positive,
      });
      // Only a selected node shows its axis labels; forty handle labels would swamp
      // §11.8's budget of forty labels for the whole scene.
      if (node.selected) {
        labels.push({
          id: `${handle.nodeId}:${handle.axisId}:label`,
          text: request.resolve(handle.labelKey, {}),
          at: handle.labelAt,
          anchor: 'centre',
          className: 'hh-label--handle',
        });
      }
    }
    targets.push({ shape: 'point', kind: 'node', id: node.id, at: geometry.centre });
  }

  const layers: Partial<Record<Layer, readonly Primitive[]>> = {
    earth,
    'hazard-shells': hazardShells,
    'constraint-geometry': constraintGeometry,
    'target-orbit': targetOrbitLayer,
    'current-orbit': currentOrbit,
    'planned-trajectory': plannedTrajectory,
    trails,
    markers,
    nodes: nodeLayer,
    handles: handleLayer,
  };

  return {
    scene: {
      layers,
      ...(colours.background === undefined ? {} : { background: { colour: colours.background } }),
    },
    labels,
    targets,
  };
};
