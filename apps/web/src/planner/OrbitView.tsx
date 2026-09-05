/**
 * The orbit view — §8.3.4's centre panel, §8.4's framing, §9.3's rendering language.
 *
 * Composition, and only composition. Every line drawn here comes from `@hh/render`'s
 * `buildScene`; every framing decision comes from `camera.ts`; the policy that drives
 * them is `framing.ts`. What this file owns is the browser: a canvas, a resize observer,
 * an animation frame, and the pointer.
 *
 * ## The union is built from the content, per frame (#103)
 *
 * #103's first criterion is that the auto-frame's union comes from *"the **actual**
 * content — ship orbit, target orbit, planned trajectory and Earth's disc — rather than
 * from a fixture"*. {@link contentBounds} is that: it unions `boundsOfSphere` for Earth
 * with `boundsOfPoints` over every tessellated arc and the target's orbit.
 *
 * Reading the tessellation out of the cache is what makes this affordable. The points are
 * already computed for drawing, so the union costs a pass over an array that was going to
 * be built anyway rather than a second tessellation at a different scale.
 *
 * ## The clock enters in exactly one place
 *
 * `requestAnimationFrame` supplies a timestamp, the difference between frames is handed
 * to `advanceFraming`, and nothing else in the planner reads a clock. That is what keeps
 * the ease testable — `framing.test.ts` drives the same function with plain numbers — and
 * it is why the loop only runs while an ease is in flight. An idle planner schedules no
 * frames at all.
 *
 * ## The hit index is rebuilt on layout change, never per frame
 *
 * §11.8's step 6. A scrub moves the ship marker and changes nothing a click can land on,
 * so rebuilding the index for it would be work with no result. Zoom, resize, a plan edit
 * and a camera move are layout changes; the scrub head is not.
 */
import { R_EARTH_EQ, type Epoch } from '@hh/astro';
import type { LoadedScenario } from '@hh/game';
import type { Camera, HitIndex, NodeSpec, ScreenPoint, ViewBounds } from '@hh/render';
import {
  EQUATORIAL_BASIS,
  MAX_ZOOM,
  MIN_ZOOM,
  boundsOfPoints,
  boundsOfSphere,
  buildHitIndex,
  buildScene,
  createTessellationCache,
  HANDLE_ARM_PX,
  nodeGeometry,
  frameBounds,
  hitTest,
  pan as panCamera,
  unionOf,
  zoomAt,
} from '@hh/render';
import { createCanvas2DRenderer } from '@hh/render/canvas2d';
import { createLabelLayer } from '@hh/render/labels';
import { observeViewport } from '@hh/render/resize';
import type { Catalogue, HandleAxis } from '@hh/ui';
import { EMPTY_PLAN, buildTimeline, type Timeline } from '@hh/sim';
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import { useReducedMotion } from '../motion.js';
import {
  EARTH_ROTATION_ANGLE,
  MAX_RADIUS_M,
  SUN_DIRECTION,
  elementsOf,
  floorShellOf,
  shipMarkerOf,
  targetMarkerOf,
} from '../scene/content.js';
import { SCENE_COLOURS } from './colours.js';
import {
  advanceFraming,
  contentChanged,
  createFraming,
  isEasing,
  manualCamera,
  recentreFraming,
  type FramingState,
} from './framing.js';
import { pickEpoch } from './pick.js';
import { isTypingTarget } from './keys.js';
import { nodeIdOf } from './store.js';

/**
 * How much a wheel notch zooms — §8.5.2's "scroll / pinch: zoom about the cursor".
 *
 * Exponential in the delta rather than linear, so a notch multiplies the scale by a
 * constant factor wherever the player is in §8.4's 0.5x–40x range. A linear step would
 * crawl at GEO framing and jump at LEO, which is the same complaint about a linear radial
 * scale that §8.4 rejects for the same reason. 0.0015 per pixel puts a typical 100-pixel
 * notch at about 1.16x, which takes roughly twenty-five notches to cross the whole range.
 */
const WHEEL_ZOOM_PER_PIXEL = 0.0015;

/**
 * How far a Δv handle drag moves the component, per pixel along the arm.
 *
 * A stated scale rather than a projection of anything, and it has to be: §8.5.2 requires
 * the handles to keep "a 32 px hit target and constant screen size", so the arm is
 * `HANDLE_ARM_PX` long at every zoom and represents no particular quantity. There is
 * nothing in the geometry to derive a metres-per-second from.
 *
 * 0.5 m/s per pixel puts the arm's own length at about 20 m/s and a comfortable 200 px
 * drag at 100 m/s, which spans the range C03's transfers actually use. The precise value
 * is a feel decision and the numeric fields (#137) are what a player uses when they want
 * an exact one — which is the division of labour §8.3.5 sets up.
 */
const DRAG_MPS_PER_PX = 0.5;

/** One press of ⊕ or ⊖. Coarser than a wheel notch, because a button is a deliberate act. */
const BUTTON_ZOOM_FACTOR = 1.4;

export interface OrbitViewProps {
  readonly t: Catalogue['resolve'];
  /** FR-910's seam for the renderer's own label keys, which are not known statically. */
  readonly resolveDynamic: Catalogue['resolveDynamic'];
  readonly scenario: LoadedScenario;
  /** `null` when the plan produced no trajectory; the view then shows the current orbit only. */
  readonly timeline: Timeline | null;
  readonly scrubEpoch: Epoch;
  readonly selectedNodeId: string | null;
  readonly onSelectNode: (nodeId: string) => void;
  readonly onDeselect: () => void;
  /** §8.5.2: clicking the planned trajectory places a node there (#133). */
  readonly onPlaceNode: (epoch: Epoch) => void;
  /** Double-click a node marker: §8.3.5's third way in (#137). */
  readonly onOpenEditor: (nodeId: string) => void;
  /** A node marker was grabbed (#134), or one of its Δv handles (#135). */
  readonly onBeginEpochDrag: (nodeId: string) => void;
  readonly onBeginDeltaVDrag: (nodeId: string, axis: HandleAxis) => void;
  readonly onDragEpochTo: (epoch: Epoch) => void;
  readonly onDragDeltaVTo: (progradeMps: number, radialMps: number) => void;
  readonly onReleaseDrag: () => void;
  readonly onCancelDrag: () => void;
  /** The node being dragged, and its live values, so the scene can draw the gesture. */
  readonly dragging: DragPreview | null;
  /**
   * The node §8.3.5's overlay is anchored to, and where to report it.
   *
   * The overlay lives outside this component — it is DOM, and this owns a canvas — but
   * only this knows where a node is *drawn*, and "anchored to the node" is a statement
   * about pixels. So the position comes back out. `null` when the node is off screen or
   * there is no overlay open, which the caller renders as a docked panel instead of one
   * pointing at nothing.
   */
  readonly anchorNodeId: string | null;
  readonly onAnchor: (at: ScreenPoint | null) => void;
}

/** What the orbit view needs to know about a gesture in flight. */
export interface DragPreview {
  readonly nodeId: string;
  readonly kind: 'epoch' | 'deltaV';
  /** The node's index, for reading its pre-drag Δv when a handle is being pulled. */
  readonly index: number;
  readonly progradeMps: number;
  readonly radialMps: number;
}

export const OrbitView = ({
  t,
  resolveDynamic,
  scenario,
  timeline,
  scrubEpoch,
  selectedNodeId,
  onSelectNode,
  onDeselect,
  onPlaceNode,
  onOpenEditor,
  onBeginEpochDrag,
  onBeginDeltaVDrag,
  onDragEpochTo,
  onDragDeltaVTo,
  onReleaseDrag,
  onCancelDrag,
  dragging,
  anchorNodeId,
  onAnchor,
}: OrbitViewProps): JSX.Element => {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const labelHostRef = useRef<HTMLDivElement | null>(null);
  const reducedMotion = useReducedMotion();

  // Everything the render loop needs that must not re-run it. Props change often — the
  // scrub head moves on every input event — and the renderer, the cache and the framing
  // state have to survive that, so they live in refs and the effect below reads them.
  const framingRef = useRef<FramingState | null>(null);
  // The camera lives inside the effect, because it needs the renderer and the viewport.
  // These are how the DOM controls reach it: the effect installs the handlers, the
  // buttons call them. Reaching past the effect to a camera in component state would put
  // a second owner on the framing #103 deliberately keeps in one place.
  const recentreRef = useRef<(() => void) | null>(null);
  const zoomRef = useRef<((factor: number) => void) | null>(null);
  const [recentreRequested, setRecentreRequested] = useState(0);
  const anchorRef = useRef<ScreenPoint | null>(null);

  useEffect(() => {
    const frame = frameRef.current;
    const canvas = canvasRef.current;
    const host = labelHostRef.current;
    if (frame === null || canvas === null || host === null) return;

    // A canvas that cannot give a 2-D context is not a crash. §8.8's canvas-parity rule
    // says everything the orbit view shows is also available in the DOM — the plan panel,
    // the readouts and the timeline are the same information, keyboard-operable — so the
    // right behaviour is to leave the canvas blank and let the rest of the planner work.
    // Throwing here would take the whole screen down over the one region a player can
    // manage without.
    //
    // It is also what makes the planner renderable under jsdom, which has no 2-D context
    // and is where #123's layout tests run. That is a consequence rather than the reason:
    // the same branch answers a real browser with canvas disabled.
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
    let index: HitIndex = buildHitIndex([]);
    let raf = 0;
    let lastTimestamp: number | null = null;

    /**
     * What the scene is built from.
     *
     * `timeline` is `null` when the plan produced none — a burn that left position and
     * velocity parallel, or a propagation that did not converge (§6.4's non-evaluable
     * case). The view still has to render, and what it renders is the ship's current
     * orbit: the empty plan's timeline is exactly that, one coasting arc to the horizon.
     * Blanking the canvas instead would take the picture away at the moment the player
     * most needs to see what they did.
     */
    const fallback = buildTimeline({
      startEpoch: scenario.startEpoch,
      initialState: scenario.ship.state,
      plan: EMPTY_PLAN,
      horizon: scenario.horizon,
      mu: scenario.mu,
    });
    const drawn = timeline ?? (fallback.ok ? fallback.timeline : null);
    if (drawn === null) return;

    /**
     * The target orbit, when the contract has one — for the camera's framing union only.
     *
     * `frameBounds` reads the elements and tessellates the whole conic, so the offset it
     * is built with cannot affect the answer; zero says that rather than passing an epoch
     * that would look meaningful and be ignored. The *marker* is built per draw, inside
     * `draw`, because there the offset is the whole point.
     */
    const targetSpec = targetMarkerOf(scenario, 0);

    /**
     * The union the camera frames — #103's first criterion.
     *
     * Earth first, then every arc the plan produced, then the target. `frameBounds`
     * applies §8.4's 12% margin and lets Earth overflow, which is what makes a LEO
     * contract legible: framing to the planet would put both orbits in the same few
     * pixels above the limb.
     */
    const contentBounds = (scale: number): ViewBounds => {
      const parts: ViewBounds[] = [boundsOfSphere(R_EARTH_EQ)];

      for (const arc of drawn.arcs) {
        const tessellation = cache.get({
          elements: arc.elements,
          scale,
          maxRadius: MAX_RADIUS_M,
        });
        parts.push(boundsOfPoints(tessellation.points, EQUATORIAL_BASIS));
      }
      if (targetSpec !== undefined) {
        const tessellation = cache.get({
          elements: targetSpec.elements,
          scale,
          maxRadius: MAX_RADIUS_M,
        });
        parts.push(boundsOfPoints(tessellation.points, EQUATORIAL_BASIS));
      }
      return unionOf(parts);
    };

    /** Where auto-framing would put the camera right now. */
    const autoCamera = (scale: number): Camera =>
      frameBounds(contentBounds(scale), viewport, EQUATORIAL_BASIS);

    // The scale passed here only picks a tessellation bucket for the union; `frameBounds`
    // then derives the real one. Any small value works, and this is replaced on the first
    // `reframe` below.
    framingRef.current ??= createFraming(autoCamera(1e-5));
    // The viewport may have changed size since the framing was created — a layout switch,
    // a rotated phone — so the camera is re-derived against the current one rather than
    // carrying a stale viewport into `worldToScreen`.
    framingRef.current = {
      ...framingRef.current,
      camera: { ...framingRef.current.camera, viewport },
    };

    const draw = (): void => {
      const framing = framingRef.current;
      if (framing === null) return;
      const { camera } = framing;

      // Rebuilt per draw rather than hoisted with `targetSpec`: the offset is where the
      // body is, so it changes with the scrub head and a hoisted spec would freeze it.
      const targetMarker = targetMarkerOf(scenario, scrubEpoch - scenario.startEpoch);

      const nodes: NodeSpec[] = drawn.impulses.map((impulse, i) => {
        const node = drawn.plan.nodes[i];
        const id = node === undefined ? `node:${String(i)}` : nodeIdOf(node);
        return { id, state: impulse.after, selected: id === selectedNodeId };
      });

      const built = buildScene({
        camera,
        colours: SCENE_COLOURS,
        timeline: drawn,
        scrubEpoch,
        nodes,
        cache,
        maxRadiusMetres: MAX_RADIUS_M,
        earthRadiusMetres: R_EARTH_EQ,
        earthRotationAngle: EARTH_ROTATION_ANGLE,
        sunDirection: SUN_DIRECTION,
        shells: [floorShellOf(scenario)],
        // Both markers are placed at the **scrub head**, which is what makes them move
        // when it does. `targetSpec` above is the same orbit and is kept for the camera's
        // framing union, where only the elements are read and the offset is irrelevant.
        ship: shipMarkerOf(
          drawn,
          scrubEpoch,
          elementsOf(scenario.ship.state, scenario.mu),
          scenario.mu,
        ),
        ...(targetMarker === undefined ? {} : { targetOrbit: targetMarker }),
        resolve: resolveDynamic,
      });

      renderer.draw(built.scene);
      labels.update(built.labels, viewport);
      index = buildHitIndex(built.targets);

      // Report where the anchored node is drawn, if it moved. `draw` runs on every frame
      // of a re-frame ease, and reporting unconditionally would set state sixty times a
      // second and re-enter this effect — so the half-pixel threshold is not a
      // micro-optimisation, it is what stops the loop.
      const anchored =
        anchorNodeId === null
          ? undefined
          : built.targets.find(
              (target) =>
                target.shape === 'point' && target.kind === 'node' && target.id === anchorNodeId,
            );
      const at = anchored?.shape === 'point' ? { x: anchored.at.x, y: anchored.at.y } : null;
      const last = anchorRef.current;
      const moved =
        (last === null) !== (at === null) ||
        (last !== null && at !== null && Math.hypot(at.x - last.x, at.y - last.y) > 0.5);
      if (moved) {
        anchorRef.current = at;
        onAnchor(at);
      }
    };

    /** One animation frame: advance the ease, redraw, and stop when it settles. */
    const tick = (timestamp: number): void => {
      const framing = framingRef.current;
      if (framing === null) return;
      const deltaSeconds = lastTimestamp === null ? 0 : (timestamp - lastTimestamp) / 1000;
      lastTimestamp = timestamp;

      framingRef.current = advanceFraming(framing, deltaSeconds, reducedMotion);
      draw();

      if (isEasing(framingRef.current)) {
        raf = window.requestAnimationFrame(tick);
      } else {
        raf = 0;
        lastTimestamp = null;
      }
    };

    /** Start the loop if an ease is in flight and one is not already running. */
    const pump = (): void => {
      if (raf === 0 && framingRef.current !== null && isEasing(framingRef.current)) {
        raf = window.requestAnimationFrame(tick);
      }
    };

    /** Re-frame if the content moved past §8.4's 20% threshold, then draw. */
    const reframe = (): void => {
      const framing = framingRef.current;
      if (framing === null) return;
      framingRef.current = contentChanged(framing, autoCamera(framing.camera.scale));
      draw();
      pump();
    };

    recentreRef.current = () => {
      const framing = framingRef.current;
      if (framing === null) return;
      framingRef.current = recentreFraming(framing, autoCamera(framing.camera.scale));
      draw();
      pump();
    };

    zoomRef.current = (factor) => {
      const framing = framingRef.current;
      if (framing === null) return;
      // About the viewport centre, where a wheel zooms about the cursor. A button has no
      // cursor position to zoom about, and the centre is what a player pressing ⊕ means.
      const anchor = { x: viewport.width / 2, y: viewport.height / 2 };
      framingRef.current = manualCamera(framing, zoomAt(framing.camera, factor, anchor));
      draw();
    };

    reframe();

    const stopObserving = observeViewport({
      target: frame,
      onChange: (next) => {
        viewport = next;
        renderer.resize(next);
        const framing = framingRef.current;
        if (framing !== null) {
          framingRef.current = { ...framing, camera: { ...framing.camera, viewport: next } };
        }
        reframe();
      },
    });

    // ── Pointer ────────────────────────────────────────────────────────────
    //
    // §8.5.2's table, minus the edits that are #133–#135. A press that moves more than a
    // few pixels is a pan; one that does not is a click, and the distinction is made on
    // release rather than by a timer, so a slow deliberate click still selects.
    const DRAG_THRESHOLD_PX = 4;
    /** What the press started on, and therefore what moving it means. */
    type Gesture =
      | { readonly kind: 'camera' }
      | { readonly kind: 'node'; readonly nodeId: string }
      | { readonly kind: 'handle'; readonly nodeId: string; readonly axis: HandleAxis };

    let pressed: {
      x: number;
      y: number;
      moved: boolean;
      gesture: Gesture;
      started: boolean;
    } | null = null;

    const localPoint = (event: PointerEvent | WheelEvent): ScreenPoint => {
      const box = canvas.getBoundingClientRect();
      return { x: event.clientX - box.left, y: event.clientY - box.top };
    };

    /**
     * The handle id `buildScene` puts in the index is `<nodeId>:<axisId>`, and a node id
     * is itself `node:<ticks>` — so the axis is after the *last* colon, not the first.
     */
    const axisOf = (id: string): HandleAxis | null => {
      const axis = id.slice(id.lastIndexOf(':') + 1);
      return axis === 'prograde' || axis === 'radial' ? axis : null;
    };
    const nodeOf = (id: string): string => id.slice(0, id.lastIndexOf(':'));

    const gestureFor = (point: ScreenPoint): Gesture => {
      const hit = hitTest(index, point);
      if (hit === undefined) return { kind: 'camera' };
      if (hit.kind === 'handle') {
        const axis = axisOf(hit.id);
        return axis === null
          ? { kind: 'camera' }
          : { kind: 'handle', nodeId: nodeOf(hit.id), axis };
      }
      if (hit.kind === 'node') return { kind: 'node', nodeId: hit.id };
      return { kind: 'camera' };
    };

    const onPointerDown = (event: PointerEvent): void => {
      const gesture = gestureFor(localPoint(event));
      pressed = { x: event.clientX, y: event.clientY, moved: false, gesture, started: false };
      // Selecting on press rather than on release, because §8.5.1 requires SELECTED
      // before DRAGGING — `beginDrag` accepts no other state — and a drag has to be able
      // to start on the very next pointermove.
      if (gesture.kind !== 'camera') onSelectNode(gesture.nodeId);
      canvas.setPointerCapture(event.pointerId);
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (pressed === null) return;
      const dx = event.clientX - pressed.x;
      const dy = event.clientY - pressed.y;
      if (!pressed.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      pressed = { ...pressed, moved: true };

      const framing = framingRef.current;
      if (framing === null) return;
      const point = localPoint(event);

      // Captured once. `pressed` is reassigned below and TypeScript widens the
      // discriminated union back out across the assignment, so every later branch would
      // otherwise have to re-narrow it.
      const gesture = pressed.gesture;

      if (gesture.kind === 'camera') {
        // A pan is manual control: FR-404 suspends auto-framing until ⌖.
        pressed = { ...pressed, x: event.clientX, y: event.clientY };
        framingRef.current = manualCamera(framing, panCamera(framing.camera, dx, dy));
        draw();
        return;
      }

      if (!pressed.started) {
        pressed = { ...pressed, started: true };
        if (gesture.kind === 'node') onBeginEpochDrag(gesture.nodeId);
        else onBeginDeltaVDrag(gesture.nodeId, gesture.axis);
      }

      if (gesture.kind === 'node') {
        // #134: the epoch under the cursor, on the burn's **own** revolution. `pickEpoch`
        // needs a reference for that, and the node's current epoch is it — without one, a
        // small drag can land on a later pass through the same pixels and teleport the
        // burn an orbit away. See `pick.ts`.
        const id = gesture.nodeId;
        const node = drawn.plan.nodes.find((candidate) => nodeIdOf(candidate) === id);
        onDragEpochTo(pickEpoch(drawn, framing.camera, point, node?.epoch ?? scrubEpoch).epoch);
        return;
      }

      // #135: the handle's screen axis, and how far along it the cursor is.
      if (dragging === null) return;

      const node = drawn.impulses.find((_impulse, i) => {
        const candidate = drawn.plan.nodes[i];
        return candidate !== undefined && nodeIdOf(candidate) === gesture.nodeId;
      });
      if (node === undefined) return;

      // The same `nodeGeometry` the scene drew the handles with, so the arm the player is
      // pulling and the axis this measures along are the one calculation.
      const geometry = nodeGeometry(framing.camera, {
        id: gesture.nodeId,
        state: node.after,
        selected: true,
      });
      const handle = geometry.handles.find((candidate) => candidate.axisId === gesture.axis);
      if (handle === undefined) return;

      const ux = (handle.positive.x - geometry.centre.x) / HANDLE_ARM_PX;
      const uy = (handle.positive.y - geometry.centre.y) / HANDLE_ARM_PX;
      const along = (point.x - geometry.centre.x) * ux + (point.y - geometry.centre.y) * uy;
      const value = along * DRAG_MPS_PER_PX;

      onDragDeltaVTo(
        gesture.axis === 'prograde' ? value : dragging.progradeMps,
        gesture.axis === 'radial' ? value : dragging.radialMps,
      );
    };

    const onPointerUp = (event: PointerEvent): void => {
      const press = pressed;
      pressed = null;
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      if (press === null) return;

      if (press.started) {
        // §8.5.1's `release → recompute arcs k…n`, and where FR-105 quantises (#134).
        onReleaseDrag();
        return;
      }
      if (press.moved) return;

      // A click that did not become a drag. §8.5.2's first three rows.
      const point = localPoint(event);
      const hit = hitTest(index, point);
      if (hit?.kind === 'node') return; // already selected on press
      if (hit?.kind === 'handle') return;
      if (hit?.kind === 'trajectory') {
        const framing = framingRef.current;
        if (framing === null) return;
        // #133. The scrub head is the reference: the pass the player is looking at is the
        // one the scrub head is on, and without a reference a closed orbit is ambiguous.
        onPlaceNode(pickEpoch(drawn, framing.camera, point, scrubEpoch).epoch);
        return;
      }
      onDeselect();
    };

    const onDoubleClick = (event: MouseEvent): void => {
      const box = canvas.getBoundingClientRect();
      const hit = hitTest(index, { x: event.clientX - box.left, y: event.clientY - box.top });
      if (hit?.kind === 'node') onOpenEditor(hit.id);
    };

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const framing = framingRef.current;
      if (framing === null) return;
      // `zoomAt` applies §8.4's [0.5x, 40x] clamp itself, measured against the camera's
      // `autoScale` — which is carried on the camera precisely so the clamp survives a
      // pan. Nothing to re-clamp here.
      const factor = Math.exp(-event.deltaY * WHEEL_ZOOM_PER_PIXEL);
      framingRef.current = manualCamera(framing, zoomAt(framing.camera, factor, localPoint(event)));
      draw();
    };

    /**
     * The camera keys, and Escape.
     *
     * §8.5.3 gives `+`, `-` and `F` to the camera, and they are handled here rather than
     * in the screen's map for the same reason the buttons are: the camera lives in this
     * effect, and a second owner is exactly what #103 puts the framing in one place to
     * avoid. Escape cancels a gesture in flight (#134, #135) and is checked first, since
     * a drag is the more immediate thing to be getting out of.
     */
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isTypingTarget(event.target)) return;

      if (event.key === 'Escape') {
        if (pressed?.started !== true) return;
        event.preventDefault();
        pressed = null;
        onCancelDrag();
        return;
      }

      const framing = framingRef.current;
      if (framing === null) return;
      const centre = { x: viewport.width / 2, y: viewport.height / 2 };

      switch (event.key) {
        case '+':
        case '=':
          framingRef.current = manualCamera(
            framing,
            zoomAt(framing.camera, BUTTON_ZOOM_FACTOR, centre),
          );
          break;
        case '-':
          framingRef.current = manualCamera(
            framing,
            zoomAt(framing.camera, 1 / BUTTON_ZOOM_FACTOR, centre),
          );
          break;
        case 'f':
        case 'F':
          framingRef.current = recentreFraming(framing, autoCamera(framing.camera.scale));
          pump();
          break;
        default:
          return;
      }
      event.preventDefault();
      draw();
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('dblclick', onDoubleClick);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    // On the window rather than the canvas: a pointer capture keeps the events coming,
    // but focus may be anywhere, and Escape has to reach a drag from wherever it is.
    window.addEventListener('keydown', onKeyDown);

    return () => {
      if (raf !== 0) window.cancelAnimationFrame(raf);
      stopObserving();
      labels.destroy();
      recentreRef.current = null;
      zoomRef.current = null;
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('dblclick', onDoubleClick);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [
    scenario,
    timeline,
    scrubEpoch,
    selectedNodeId,
    reducedMotion,
    recentreRequested,
    t,
    onSelectNode,
    onDeselect,
    onPlaceNode,
    onOpenEditor,
    onBeginEpochDrag,
    onBeginDeltaVDrag,
    onDragEpochTo,
    onDragDeltaVTo,
    onReleaseDrag,
    onCancelDrag,
    dragging,
    anchorNodeId,
    onAnchor,
  ]);

  return (
    <div class="hh-orbit" ref={frameRef} data-testid="orbit-view">
      <canvas
        class="hh-orbit__canvas"
        ref={canvasRef}
        role="img"
        aria-label={t('planner.region.orbitView', {})}
      />
      <div class="hh-orbit__labels" ref={labelHostRef} />
      {/* §8.3.4's ⊕ ⊖ ⌖. Buttons rather than canvas affordances, so they are reachable
          by keyboard and announced — §8.8's rule that nothing lives on the canvas alone. */}
      <div class="hh-orbit__controls">
        <button
          type="button"
          class="hh-orbit__control"
          data-testid="orbit-zoom-in"
          onClick={() => {
            zoomRef.current?.(BUTTON_ZOOM_FACTOR);
          }}
        >
          {t('planner.camera.zoomIn', {})}
        </button>
        <button
          type="button"
          class="hh-orbit__control"
          data-testid="orbit-zoom-out"
          onClick={() => {
            zoomRef.current?.(1 / BUTTON_ZOOM_FACTOR);
          }}
        >
          {t('planner.camera.zoomOut', {})}
        </button>
        <button
          type="button"
          class="hh-orbit__control"
          data-testid="orbit-recentre"
          onClick={() => {
            // The ⌖ control (FR-404, §8.5.2). Bumping the counter re-runs the effect,
            // which re-installs the handlers and re-frames — the effect owns the camera,
            // so the button asks it rather than reaching past it.
            recentreRef.current?.();
            setRecentreRequested((n) => n + 1);
          }}
        >
          {t('planner.camera.recentre', {})}
        </button>
      </div>
    </div>
  );
};

/** Zoom bounds, re-exported so the camera controls can be disabled at the ends later. */
export const ZOOM_LIMITS = { min: MIN_ZOOM, max: MAX_ZOOM } as const;
