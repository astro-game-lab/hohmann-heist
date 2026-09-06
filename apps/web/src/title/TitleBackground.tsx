/**
 * The title screen's live background — §8.3.1, §8.8, #118.
 *
 * `background.ts` propagates the transfer; this draws it. The split is the point: the part
 * that has to be *correct* is a pure function testable under Node, and the part that has to
 * be *smooth* is this, which needs a browser and is checked by looking at it.
 *
 * ## It is the simulation, and this is what makes that true
 *
 * The only thing this animates is the **scrub epoch**. Every frame calls `buildScene` with
 * a new `scrubEpoch` and lets `@hh/render` place the ship where `stateAt` says it is — the
 * same call, on the same timeline, that the planner's scrubber makes. There is no cached
 * path, no interpolation between keyframes, and no way for the picture to drift from the
 * trajectory, because there is only one trajectory and the picture is read out of it.
 *
 * ## Decorative, and it behaves like it
 *
 * §8.3.1 calls it *"purely decorative"* and §8.8 says nothing conveys information by
 * decoration alone, so:
 *
 * - `aria-hidden` on the host, and a `<canvas>` carries no accessible content anyway. It
 *   contributes nothing to the accessibility tree and the screen reads identically with
 *   this component deleted, which is what #118's fifth criterion asks.
 * - Never focusable — no `tabIndex`, and `pointer-events: none` in the stylesheet, so it
 *   cannot take a click meant for an entry underneath it.
 * - **It stops entirely under reduced motion** (§8.8: *"the title background stops"*), and
 *   separately under §8.3.12's `accessibility.backgroundAnimation`, which this is the
 *   first consumer of. Stopped means one static frame, not a blank canvas: the transfer is
 *   still shown, it just is not moving.
 *
 * ## It is never the thing that delays interactivity
 *
 * The canvas is set up in an effect, and Preact runs effects after paint — so the wordmark
 * and the five entries are on screen and clickable before this has a context, let alone a
 * frame. NFR-012's 8 ms rule is met by keeping per-frame work to one `buildScene` over a
 * three-arc timeline; the propagation happens once, on mount, and the tessellation cache
 * makes the conics free after the first frame.
 *
 * A browser that will not give a 2-D context gets nothing here and says so upward, which
 * is §8.7's canvas-unavailable row — the title still works, because everything it does is
 * DOM.
 */
import { R_EARTH_EQ, addSeconds } from '@hh/astro';
import { V, seconds } from '@hh/math';
import type { Camera } from '@hh/render';
import {
  EQUATORIAL_BASIS,
  boundsOfSphere,
  buildScene,
  createTessellationCache,
  frameBounds,
} from '@hh/render';
import { createCanvas2DRenderer } from '@hh/render/canvas2d';
import { observeViewport } from '@hh/render/resize';
import { arcAt } from '@hh/sim';
import type { Catalogue } from '@hh/ui';
import type { PaletteId } from '@hh/ui';
import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

import { sceneColoursFor } from '../palette.js';

import { BACKGROUND_TIME_SCALE, buildBackgroundTransfer } from './background.js';

export interface TitleBackgroundProps {
  readonly palette: PaletteId;
  /** True when §9.4's rule or §8.3.12's control says the background must not move. */
  readonly still: boolean;
  /** For the labels the renderer emits. None are drawn here, but the seam is required. */
  readonly resolveDynamic: Catalogue['resolveDynamic'];
  /** Told when the browser cannot give a 2-D context — §8.7's row, owned by #125. */
  readonly onCanvasUnavailable?: () => void;
}

/**
 * How much of the framed radius the transfer fills.
 *
 * Below 1, so GEO sits inside the viewport with room around it rather than touching the
 * edges — the mockup's transfer is a shape on a field, not a diagram cropped to its bounds.
 */
const FRAMING_MARGIN = 0.78;

/** DEP-06's fixed Sun. The game layer's choice; the renderer is handed a vector. */
const SUN_DIRECTION = V.normalize({ x: 0.6, y: -0.8, z: 0 });

/** Presentational only (#106): a fixed angle, because nothing here depends on the planet's facing. */
const EARTH_ROTATION_ANGLE = 0.9;

export const TitleBackground = ({
  palette,
  still,
  resolveDynamic,
  onCanvasUnavailable,
}: TitleBackgroundProps): JSX.Element => {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // The callback is read through a ref so that a caller passing a fresh closure on every
  // render cannot tear down and rebuild the renderer. The effect below depends on the palette
  // and the motion decision, and on nothing else.
  const unavailableRef = useRef(onCanvasUnavailable);
  unavailableRef.current = onCanvasUnavailable;

  useEffect(() => {
    const frame = frameRef.current;
    const canvas = canvasRef.current;
    if (frame === null || canvas === null) return;

    // §8.7's canvas-unavailable row. Not a throw: the title screen is entirely DOM and
    // works without this, so the failure is reported and the region stays empty. It is
    // also the branch jsdom takes, which is what lets the title's tests render the real
    // component rather than a stub.
    if (canvas.getContext('2d') === null) {
      unavailableRef.current?.();
      return;
    }

    const rect = frame.getBoundingClientRect();
    let viewport = {
      width: rect.width,
      height: rect.height,
      devicePixelRatio: window.devicePixelRatio,
    };

    const renderer = createCanvas2DRenderer(canvas, viewport);
    const cache = createTessellationCache();
    const colours = sceneColoursFor(palette);

    // Propagated once, on mount. Everything after this is a read.
    const transfer = buildBackgroundTransfer();
    const { timeline, loopEnd } = transfer;
    const loopSeconds = loopEnd - timeline.startEpoch;

    let raf = 0;
    let lastTimestamp: number | null = null;
    let elapsed = 0;

    const draw = (): void => {
      const base: Camera = frameBounds(
        boundsOfSphere(transfer.maxRadiusM / FRAMING_MARGIN),
        viewport,
        EQUATORIAL_BASIS,
      );

      const scrubEpoch = addSeconds(timeline.startEpoch, seconds(elapsed));
      // The arc the ship is on *now*, so the marker moves onto the transfer ellipse at the
      // first burn and onto the destination circle at the second. Reading `arcs[0]` instead
      // would draw the ship forever on the parking orbit while the trail moved without it.
      const arc = arcAt(timeline, scrubEpoch);

      const built = buildScene({
        camera: base,
        colours,
        timeline,
        scrubEpoch,
        cache,
        maxRadiusMetres: transfer.maxRadiusM * 2,
        earthRadiusMetres: R_EARTH_EQ,
        earthRotationAngle: EARTH_ROTATION_ANGLE,
        sunDirection: SUN_DIRECTION,
        // No hazard shells and no nodes: §8.3.1's background is the transfer and the
        // planet. Drawing the altitude floor and two node handles would make the title
        // look like the planner with the controls missing.
        shells: [],
        nodes: [],
        ship: {
          id: 'ship',
          kind: 'ship',
          elements: arc.elements,
          mu: timeline.mu,
          offsetSeconds: scrubEpoch - arc.startEpoch,
        },
        resolve: resolveDynamic,
      });

      renderer.draw(built.scene);
    };

    /** One frame: advance simulated time at §8.3.1's rate, wrap at the loop, redraw. */
    const tick = (timestamp: number): void => {
      const deltaSeconds = lastTimestamp === null ? 0 : (timestamp - lastTimestamp) / 1000;
      lastTimestamp = timestamp;

      // Modulo rather than a subtraction, so a tab that was backgrounded for a minute
      // resumes at the right point in the loop instead of walking past the horizon.
      elapsed = (elapsed + deltaSeconds * BACKGROUND_TIME_SCALE) % loopSeconds;

      draw();
      raf = window.requestAnimationFrame(tick);
    };

    draw();
    if (!still) raf = window.requestAnimationFrame(tick);

    const stopObserving = observeViewport({
      target: frame,
      onChange: (next) => {
        viewport = next;
        renderer.resize(viewport);
        draw();
      },
    });

    return () => {
      if (raf !== 0) window.cancelAnimationFrame(raf);
      stopObserving();
    };
  }, [palette, still, resolveDynamic]);

  return (
    <div
      class="hh-title__background"
      ref={frameRef}
      aria-hidden="true"
      data-testid="title-background"
    >
      <canvas class="hh-title__canvas" ref={canvasRef} />
    </div>
  );
};
