/**
 * The orbit view during playback — §8.3.8, #144, #147.
 *
 * > *Same orbit view, different chrome.*
 *
 * The same `buildScene`, the same tessellation cache, the same Earth and target and
 * altitude shell — all of it from `scene/content.ts`, which is where the two views'
 * shared definitions live so they cannot drift. What differs is exactly two things, and
 * they are the two this file owns:
 *
 * - **The camera follows the ship** rather than framing the plan (`camera.ts`, #147).
 * - **Nothing can be clicked.** There is no hit index, no node marker to grab, no
 *   trajectory to place a burn on. §8.3.8's *"pausing does not allow editing"* is
 *   therefore not a disabled control here; there is no control. The only pointer
 *   gestures are pan and zoom, which are camera operations and change nothing about the
 *   run (FR-601).
 *
 * ## Why this is a separate component rather than a mode on `OrbitView`
 *
 * `OrbitView` is 700 lines of interaction: a hit index rebuilt on layout change, a
 * gesture state machine over §8.5.2's table, drag previews, an overlay anchor reported
 * back to the parent. None of it applies to a run that is already decided, and an
 * `interactive: boolean` threaded through all of it would make every one of those paths
 * conditional — which is the shape where an editing gesture eventually leaks into a
 * screen that must not have one.
 *
 * The cost is the canvas boilerplate below: a ref, a viewport observer, an animation
 * frame. That is about forty lines, and it buys a component in which *"the plan cannot
 * be edited here"* is true because nothing in the file can edit a plan.
 *
 * ## The draw is not the render
 *
 * The playback epoch changes every frame, and re-creating a renderer, a label layer and
 * a tessellation cache sixty times a second would throw away the caching that makes the
 * frame budget (§11.9). So the expensive things are built once in an effect keyed on the
 * *scenario* and held in a ref, and a second effect — with no dependency array, so it
 * runs after every render — asks that ref to draw at the current epoch. Preact's diff
 * over the chrome is the only per-frame work in the DOM.
 */
import { R_EARTH_EQ, period, semiMajorAxis, type Epoch, type EciVector } from '@hh/astro';
import type { LoadedScenario } from '@hh/game';
import { targetArc } from '@hh/game';
import type { Metres } from '@hh/math';
import type { Camera, ViewBasis } from '@hh/render';
import {
  EQUATORIAL_BASIS,
  buildScene,
  createTessellationCache,
  pan as panCamera,
  zoomAt,
} from '@hh/render';
import { createCanvas2DRenderer } from '@hh/render/canvas2d';
import { createLabelLayer } from '@hh/render/labels';
import { observeViewport } from '@hh/render/resize';
import { stateAt as stateOnArc } from '@hh/propagation';
import { stateAt, type Timeline } from '@hh/sim';
import type { Catalogue } from '@hh/ui';
import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

import { useSceneColours } from '../planner/colours.js';
import {
  EARTH_ROTATION_ANGLE,
  MAX_RADIUS_M,
  SUN_DIRECTION,
  elementsOf,
  floorShellOf,
  shipMarkerOf,
  targetMarkerOf,
} from '../scene/content.js';
import {
  createFollow,
  followCamera,
  followTo,
  manualFollow,
  recentreFollow,
  type FollowContext,
  type FollowState,
} from './camera.js';

/** One press of ⊕ or ⊖. Matches the planner's, so the two views zoom by the same step. */
const BUTTON_ZOOM_FACTOR = 1.4;

/** How much a wheel notch zooms, per pixel of delta. The planner's constant. */
const WHEEL_ZOOM_PER_PIXEL = 0.0015;

/** A press that moves further than this is a pan rather than a click. */
const DRAG_THRESHOLD_PX = 4;

export interface ExecutionViewProps {
  readonly t: Catalogue['resolve'];
  readonly resolveDynamic: Catalogue['resolveDynamic'];
  readonly scenario: LoadedScenario;
  /** The committed timeline. Read, never rebuilt (FR-601). */
  readonly timeline: Timeline;
  /** Where playback has reached. The only thing that changes per frame. */
  readonly epoch: Epoch;
  /** Epoch of the closest approach, so the camera knows what to close in on (#147). */
  readonly encounterEpoch: Epoch | null;
}

export const ExecutionView = ({
  t,
  resolveDynamic,
  scenario,
  timeline,
  epoch,
  encounterEpoch,
}: ExecutionViewProps): JSX.Element => {
  const colours = useSceneColours();

  const frameRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const labelHostRef = useRef<HTMLDivElement | null>(null);

  /** Draw at an epoch. Installed by the setup effect; called after every render. */
  const drawRef = useRef<((at: Epoch) => void) | null>(null);
  const recentreRef = useRef<(() => void) | null>(null);
  const zoomRef = useRef<((factor: number) => void) | null>(null);
  /** The camera, and whether the player has taken it over. Survives every re-render. */
  const followRef = useRef<FollowState | null>(null);
  /** The epoch the next draw should use, read by handlers that fire between renders. */
  const epochRef = useRef<Epoch>(epoch);
  epochRef.current = epoch;

  useEffect(() => {
    const frame = frameRef.current;
    const canvas = canvasRef.current;
    const host = labelHostRef.current;
    if (frame === null || canvas === null || host === null) return;

    // A canvas with no 2-D context is not a crash — §8.8's canvas-parity rule means the
    // flight log carries the same information in the DOM, so the run stays watchable and
    // the debrief still arrives. It is also what lets this render under jsdom.
    if (canvas.getContext('2d') === null) return;

    const rect = frame.getBoundingClientRect();
    let viewport = {
      width: rect.width,
      height: rect.height,
      devicePixelRatio: window.devicePixelRatio,
    };

    const renderer = createCanvas2DRenderer(canvas, viewport);
    const labels = createLabelLayer(host);
    const cache = createTessellationCache();
    const basis: ViewBasis = EQUATORIAL_BASIS;

    // No hoisted target spec here, unlike the planner: this camera follows the ship and
    // reads the target through `context.targetAt` below, so the only marker the run needs
    // is the one built per frame inside `draw`.
    const target = scenario.targets[0];
    const orbitOfTarget =
      target === undefined
        ? null
        : targetArc(target.state, scenario.startEpoch, scenario.horizon, scenario.mu);

    /**
     * Where the two craft are — the camera's only inputs.
     *
     * Both go through the same propagation the scene draws from, so the camera frames
     * what is on screen rather than an independently computed position that could be an
     * ulp away from it. A non-convergent lookup yields `null` and the sample is skipped:
     * a camera is not the place to report a solver failure.
     */
    const context: FollowContext = {
      shipAt: (at): EciVector<Metres> | null => {
        const result = stateAt(timeline, at);
        return result.converged ? result.state.position : null;
      },
      targetAt:
        orbitOfTarget === null
          ? null
          : (at): EciVector<Metres> | null => {
              const result = stateOnArc(orbitOfTarget, at);
              return result.converged ? result.state.position : null;
            },
      startEpoch: timeline.startEpoch,
      endEpoch: timeline.horizon,
      encounterEpoch,
      periodSeconds: Number.POSITIVE_INFINITY,
    };

    /** The framing the run would choose right now. */
    const autoCamera = (at: Epoch): Camera | null =>
      followCamera(at, { ...context, periodSeconds: periodAt(timeline, at) }, viewport, basis);

    followRef.current ??= (() => {
      const camera = autoCamera(timeline.startEpoch);
      return camera === null ? null : createFollow(camera);
    })();
    // A camera built before a resize carries a stale viewport into `worldToScreen`, so
    // it is re-derived against the current one rather than trusted.
    const held = followRef.current;
    if (held !== null) {
      followRef.current = { ...held, camera: { ...held.camera, viewport } };
    }

    const draw = (at: Epoch): void => {
      // Rebuilt per frame rather than hoisted with `targetSpec`: the offset is where the
      // body is, so it changes with the playback epoch and a hoisted spec would freeze it.
      const targetMarker = targetMarkerOf(scenario, at - scenario.startEpoch);
      const wanted = autoCamera(at);
      const current = followRef.current;
      // No camera yet means the first frame; after that, `followTo` decides — and
      // declines while the player has taken the camera over (FR-404).
      const follow = current === null ? createFollowAt(wanted) : followTo(current, wanted);
      if (follow === null) return;
      followRef.current = follow;
      const { camera } = follow;

      const built = buildScene({
        camera,
        colours,
        timeline,
        scrubEpoch: at,
        // No node markers. A burn that has already fired is in the flight log, and a
        // grabbable marker on a run that cannot be edited would be an affordance for
        // something that is not possible (§8.3.8).
        nodes: [],
        cache,
        maxRadiusMetres: MAX_RADIUS_M,
        earthRadiusMetres: R_EARTH_EQ,
        earthRotationAngle: EARTH_ROTATION_ANGLE,
        sunDirection: SUN_DIRECTION,
        shells: [floorShellOf(scenario)],
        // Placed at the **playback epoch**, which is the one thing that changes per frame
        // — so this is what makes the two craft fly. `at` is clamped inside
        // `shipMarkerOf`; the target's offset is measured from the contract start because
        // a target coasts on one arc for the whole run (it never manoeuvres, DEP-11).
        ship: shipMarkerOf(timeline, at, elementsOf(scenario.ship.state, scenario.mu), scenario.mu),
        ...(targetMarker === undefined ? {} : { targetOrbit: targetMarker }),
        resolve: resolveDynamic,
      });

      renderer.draw(built.scene);
      labels.update(built.labels, viewport);
    };

    drawRef.current = draw;

    recentreRef.current = () => {
      const at = epochRef.current;
      const follow = followRef.current;
      if (follow === null) return;
      followRef.current = recentreFollow(follow, autoCamera(at));
      draw(at);
    };

    zoomRef.current = (factor) => {
      const follow = followRef.current;
      if (follow === null) return;
      // About the viewport centre: a button has no cursor to zoom about, and the centre
      // is what a player pressing ⊕ means.
      const anchor = { x: viewport.width / 2, y: viewport.height / 2 };
      followRef.current = manualFollow(follow, zoomAt(follow.camera, factor, anchor));
      draw(epochRef.current);
    };

    draw(epochRef.current);

    const stopObserving = observeViewport({
      target: frame,
      onChange: (next) => {
        viewport = next;
        renderer.resize(next);
        const follow = followRef.current;
        if (follow !== null) {
          followRef.current = { ...follow, camera: { ...follow.camera, viewport: next } };
        }
        draw(epochRef.current);
      },
    });

    // ── Pointer: pan and zoom, and nothing else ────────────────────────────
    //
    // FR-404's *"manual pan/zoom MUST suspend auto-framing until explicitly recentred"*,
    // and #147's fourth criterion that neither touches the outcome. Both hold because
    // every handler below ends at a `Camera`, and a `Camera` is read only by the
    // renderer.
    let pressed: { x: number; y: number; moved: boolean } | null = null;

    const onPointerDown = (event: PointerEvent): void => {
      pressed = { x: event.clientX, y: event.clientY, moved: false };
      canvas.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (pressed === null) return;
      const dx = event.clientX - pressed.x;
      const dy = event.clientY - pressed.y;
      if (!pressed.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;

      pressed.moved = true;
      pressed.x = event.clientX;
      pressed.y = event.clientY;

      const follow = followRef.current;
      if (follow === null) return;
      followRef.current = manualFollow(follow, panCamera(follow.camera, dx, dy));
      draw(epochRef.current);
    };

    const onPointerUp = (event: PointerEvent): void => {
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      pressed = null;
    };

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const follow = followRef.current;
      if (follow === null) return;
      const box = canvas.getBoundingClientRect();
      const anchor = { x: event.clientX - box.left, y: event.clientY - box.top };
      const factor = Math.exp(-event.deltaY * WHEEL_ZOOM_PER_PIXEL);
      followRef.current = manualFollow(follow, zoomAt(follow.camera, factor, anchor));
      draw(epochRef.current);
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      stopObserving();
      labels.destroy();
      drawRef.current = null;
      recentreRef.current = null;
      zoomRef.current = null;
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [scenario, timeline, encounterEpoch, resolveDynamic, colours]);

  // After every render, including the sixty a second playback produces. Deliberately
  // without a dependency array: the epoch is the dependency, and listing it would be the
  // same thing written twice.
  useEffect(() => {
    drawRef.current?.(epoch);
  });

  return (
    <div class="hh-orbit" ref={frameRef} data-testid="execution-view">
      <canvas
        class="hh-orbit__canvas"
        ref={canvasRef}
        role="img"
        aria-label={t('execution.region.orbitView', {})}
      />
      <div class="hh-orbit__labels" ref={labelHostRef} />
      <div class="hh-orbit__controls">
        <button
          type="button"
          class="hh-orbit__control"
          data-testid="execution-zoom-in"
          onClick={() => {
            zoomRef.current?.(BUTTON_ZOOM_FACTOR);
          }}
        >
          {t('planner.camera.zoomIn', {})}
        </button>
        <button
          type="button"
          class="hh-orbit__control"
          data-testid="execution-zoom-out"
          onClick={() => {
            zoomRef.current?.(1 / BUTTON_ZOOM_FACTOR);
          }}
        >
          {t('planner.camera.zoomOut', {})}
        </button>
        <button
          type="button"
          class="hh-orbit__control"
          data-testid="execution-recentre"
          onClick={() => {
            recentreRef.current?.();
          }}
        >
          {t('planner.camera.recentre', {})}
        </button>
      </div>
    </div>
  );
};

/** A follow state around a camera that may not exist yet. */
const createFollowAt = (camera: Camera | null): FollowState | null =>
  camera === null ? null : createFollow(camera);

/**
 * The ship's orbital period at an epoch, in seconds.
 *
 * The camera's widest context is one revolution of *the orbit the ship is on now*,
 * which changes at every burn — a phasing orbit is shorter than the parking orbit it
 * came from, and framing the run to the wrong one would leave the view too wide or too
 * tight for a whole arc.
 *
 * `Infinity` for an open arc, which {@link followWindowSeconds} already handles: `L4`
 * makes an escape illegal to commit, so this is defensive rather than a case that
 * reaches a real run.
 */
const periodAt = (timeline: Timeline, at: Epoch): number => {
  const clamped = Math.min(Math.max(at, timeline.startEpoch), timeline.horizon) as Epoch;
  const arc = timeline.arcs.find(
    (candidate) => clamped >= candidate.startEpoch && clamped <= candidate.endEpoch,
  );
  const elements = arc?.elements ?? timeline.arcs[0]?.elements;
  if (elements === undefined || elements.eccentricity >= 1) return Number.POSITIVE_INFINITY;
  // `@hh/astro`'s closed form rather than a second copy of it here. The guard above is
  // what keeps `semiMajorAxis` away from the eccentricity at which it is infinite.
  return period(semiMajorAxis(elements), timeline.mu);
};
