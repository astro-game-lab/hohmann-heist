/**
 * The orbit-scene harness — a place to *look at* §9.3 before there is a planner.
 *
 * M2's planner screen is separate work (E09), so the nine renderer issues in this PR have
 * nowhere on screen to be checked. Their unit tests assert geometry, and geometry is not
 * the whole claim: "crisp at DPR 1, 2 and 3", "the three trajectory styles remain
 * distinguishable in greyscale", "legible at both LEO and GEO framing" and "correct when
 * Earth overflows the viewport" are all statements about pixels, and the only honest way
 * to check them is to render the thing and look.
 *
 * Throwaway, and structured so throwing it away is one `rm -r`: everything it owns lives
 * under `apps/web/src/scene-harness/`, and the only hooks into the rest of the app are one
 * route name and one import. It goes when the planner screen lands.
 *
 * ## What it wires together
 *
 * Deliberately the whole pipeline rather than a shortcut through it, because the seams are
 * as much of this PR as the drawing:
 *
 * - `observeViewport` (#115) for size and pixel-ratio changes, feeding `renderer.resize`.
 * - `buildScene` for the frame, `createCanvas2DRenderer` to draw it.
 * - `createLabelLayer` (#113) for the text, with **every string resolved through
 *   `@hh/ui`'s catalogue** (FR-910) — which is what makes that requirement true in
 *   practice rather than merely intended by the renderer.
 * - `buildHitIndex` (#114) rebuilt on layout change, never per frame, with the hovered
 *   target reported so the priority order can be seen working.
 *
 * ## The controls exist to reach the cases the tests cannot
 *
 * Zoom spans LEO framing to well past GEO, so the hatch spacing and line weights can be
 * judged at both. The greyscale toggle is not a novelty: §8.3.4's fifth principle says
 * patterns carry meaning and colours only reinforce it, and the fastest way to check that
 * claim is to remove the colour. The DPR override drives #115's cap without needing three
 * physical displays.
 */
import { R_EARTH_EQ } from '@hh/astro';
import { V } from '@hh/math';
import type { Camera, HitIndex, SceneColours } from '@hh/render';
import {
  EQUATORIAL_BASIS,
  boundsOfSphere,
  buildHitIndex,
  buildScene,
  createTessellationCache,
  frameBounds,
  hitTest,
} from '@hh/render';
import { createCanvas2DRenderer } from '@hh/render/canvas2d';
import { createLabelLayer } from '@hh/render/labels';
import { observeViewport } from '@hh/render/resize';
import { createCatalogue } from '@hh/ui';
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import { PALETTE_IDS, greyscale, type PaletteId } from '@hh/ui';
import { sceneColoursFor } from '../palette.js';

import { MU_EARTH, loadContract, shapeOf, timelineFor } from './contract.js';

/**
 * The scene's inks, from whichever of §9.2's five palettes is selected.
 *
 * This file used to carry two hand-written sets — a copy of the M2 colours and a
 * hand-mixed grey ramp — with a note saying #116 would bring the palettes. It has, and
 * copies of a palette are exactly what #116 exists to delete: a harness showing colours
 * the game no longer draws is worse than no harness, because it is the thing people look
 * at to decide whether the scene is right.
 *
 * So the harness now draws what the planner draws, and gains the control the planner does
 * not have yet: a palette selector. Until §8.3.12's settings screen lands (#122), this is
 * the only place all five can be compared side by side, which is what makes FR-907
 * something a person can check rather than something a test asserts.
 */
const sceneColoursOf = (palette: PaletteId, grey: boolean): SceneColours => {
  const colours = sceneColoursFor(palette);
  if (!grey) return colours;

  // §8.3.4's fifth principle, checkable: strip the hue and see whether the three
  // trajectories, the two markers and the two hazard states are still tellable apart.
  // Derived rather than hand-mixed, so it works for all five palettes rather than for the
  // one somebody wrote a grey ramp for — and by luminance rather than by channel average,
  // for the reason `greyscale` gives.
  const grey_ = (value: string): string => greyscale(value) ?? value;
  return {
    ...colours,
    background: grey_(colours.background ?? ''),
    earthFill: grey_(colours.earthFill),
    earthCoastline: grey_(colours.earthCoastline),
    earthNight: grey_(colours.earthNight),
    hazard: grey_(colours.hazard),
    hazardViolated: grey_(colours.hazardViolated),
    current: grey_(colours.current),
    planned: grey_(colours.planned),
    target: grey_(colours.target),
    ship: grey_(colours.ship),
    targetMarker: grey_(colours.targetMarker),
    node: grey_(colours.node),
    nodeSelected: grey_(colours.nodeSelected),
    annotation: grey_(colours.annotation),
  };
};

const scenario = loadContract();
const catalogue = createCatalogue();

/** FR-910's seam: a key and its numbers in, a sentence out. */
const resolve = (key: string, params: Record<string, number>): string =>
  catalogue.resolveDynamic(key, params);

/**
 * The harness's own CSS, in one block so removing the harness removes its styles too.
 *
 * `.hh-label` is `@hh/render`'s class name (`LABEL_CLASS`) and the palette that fills it
 * is `@hh/ui`'s in the real planner — this is the minimal styling that makes the labels
 * legible here. `pointer-events: none` on the host is load-bearing rather than tidy: the
 * label layer sits over the canvas, and without it a label would swallow the pointer
 * events the hit-test index is there to answer.
 */
const CSS = `
.scene-harness { display: flex; gap: 16px; align-items: stretch; min-height: 70vh; padding: 12px; }
.scene-harness__frame { position: relative; flex: 1 1 auto; min-width: 0; background: #05070d; border-radius: 6px; overflow: hidden; }
.scene-harness__canvas { display: block; width: 100%; height: 100%; }
.scene-harness__labels { position: absolute; inset: 0; pointer-events: none; }
.scene-harness__labels .hh-label {
  font: 11px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: #cfe0f0; white-space: nowrap; text-shadow: 0 0 3px #05070d, 0 0 6px #05070d;
  pointer-events: auto; user-select: text;
}
.scene-harness__labels .hh-label--handle { color: #ffd479; }
.scene-harness__labels .hh-label--approach { color: #8fa3bb; }
.scene-harness__controls { flex: 0 0 260px; display: flex; flex-direction: column; gap: 10px;
  font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
.scene-harness__controls label { display: flex; flex-direction: column; gap: 3px; }
.scene-harness__controls input[type="range"] { width: 100%; }
.scene-harness__toggle { flex-direction: row !important; align-items: center; gap: 6px; }
.scene-harness__readout { margin: 8px 0 0; display: grid; grid-template-columns: auto 1fr; gap: 2px 8px; }
.scene-harness__readout dt { opacity: 0.6; }
.scene-harness__readout dd { margin: 0; }
`;

export const ScenePage = (): JSX.Element => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const labelHostRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);

  const [zoom, setZoom] = useState(1);
  const [grey, setGrey] = useState(false);
  const [palette, setPalette] = useState<PaletteId>('default');
  const [dpr, setDpr] = useState(0);
  const [departure, setDeparture] = useState(1200);
  const [dv, setDv] = useState(55);
  const [selected, setSelected] = useState(0);
  const [hovered, setHovered] = useState('—');
  const [stats, setStats] = useState('');

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = labelHostRef.current;
    const frame = frameRef.current;
    if (canvas === null || host === null || frame === null) return;

    const rect = frame.getBoundingClientRect();
    const reportedDpr = dpr > 0 ? dpr : window.devicePixelRatio;
    let viewport = { width: rect.width, height: rect.height, devicePixelRatio: reportedDpr };

    const renderer = createCanvas2DRenderer(canvas, viewport);
    const labels = createLabelLayer(host);
    const cache = createTessellationCache();
    let index: HitIndex = buildHitIndex([]);

    const timeline = timelineFor(scenario, departure, dv);
    const target = scenario.targets[0];

    const draw = (): void => {
      // §8.4's auto-frame, then the manual zoom on top of it.
      const base: Camera = frameBounds(
        boundsOfSphere(R_EARTH_EQ + 3_000_000),
        viewport,
        EQUATORIAL_BASIS,
      );
      const camera: Camera = { ...base, scale: base.scale * zoom };

      const built = buildScene({
        camera,
        colours: sceneColoursOf(palette, grey),
        timeline,
        scrubEpoch: timeline.startEpoch,
        cache,
        maxRadiusMetres: 80_000_000,
        earthRadiusMetres: R_EARTH_EQ,
        // Presentational only (#106) — a fixed angle here, because this harness has no
        // clock and the simulation does not care which way the planet is facing.
        earthRotationAngle: 0.9,
        // DEP-06's fixed Sun is the game layer's choice; the renderer is handed a vector.
        sunDirection: V.normalize({ x: 0.6, y: -0.8, z: 0 }),
        shells: [
          {
            id: 'altitude-floor',
            innerRadiusMetres: R_EARTH_EQ,
            outerRadiusMetres: R_EARTH_EQ + 100_000,
            state: 'clear',
          },
        ],
        ship: {
          id: 'ship',
          kind: 'ship',
          elements: timeline.arcs[0]?.elements ?? shapeOf(scenario.ship.state),
          mu: MU_EARTH,
          offsetSeconds: 900,
        },
        ...(target === undefined
          ? {}
          : {
              targetOrbit: {
                id: target.id,
                kind: 'target' as const,
                elements: shapeOf(target.state),
                mu: MU_EARTH,
                offsetSeconds: 900,
              },
            }),
        nodes: timeline.impulses.map((impulse, i) => ({
          id: `node-${String(i)}`,
          state: impulse.after,
          selected: i === selected,
        })),
        // A stand-in encounter, so #111's tie line is on screen. The real one comes from
        // `@hh/propagation`'s approach finder once the planner wires it up; the point here
        // is that the renderer draws what it is handed and honours the assist flag.
        ...(target === undefined
          ? {}
          : {
              closestApproach: {
                shipPosition:
                  timeline.arcs[timeline.arcs.length - 1]?.state.position ??
                  scenario.ship.state.position,
                targetPosition: target.state.position,
                separationMetres: 311.4,
                relativeSpeedMps: 0.02,
                assistEnabled: true,
              },
            }),
        resolve,
      });

      renderer.draw(built.scene);
      labels.update(built.labels, viewport);
      // §11.8 step 6: on layout change, not per frame. Zoom, resize and plan edits are
      // all layout changes; a scrub would not be.
      index = buildHitIndex(built.targets);

      setStats(
        `${String(built.targets.length)} targets · ${String(labels.stats.visible)} labels · ` +
          `cache ${String(cache.stats.hits)}/${String(cache.stats.hits + cache.stats.misses)}`,
      );
    };

    draw();

    const stop = observeViewport({
      target: frame,
      onChange: (next) => {
        viewport = dpr > 0 ? { ...next, devicePixelRatio: dpr } : next;
        renderer.resize(viewport);
        draw();
      },
    });

    const onPointerMove = (event: PointerEvent): void => {
      const box = canvas.getBoundingClientRect();
      const hit = hitTest(index, {
        x: event.clientX - box.left,
        y: event.clientY - box.top,
      });
      setHovered(hit === undefined ? '—' : `${hit.kind} · ${hit.id}`);
    };
    canvas.addEventListener('pointermove', onPointerMove);

    return () => {
      stop();
      labels.destroy();
      canvas.removeEventListener('pointermove', onPointerMove);
    };
  }, [zoom, grey, palette, dpr, departure, dv, selected]);

  return (
    <main class="scene-harness">
      <style>{CSS}</style>

      <div class="scene-harness__frame" ref={frameRef}>
        <canvas class="scene-harness__canvas" ref={canvasRef} />
        <div class="scene-harness__labels" ref={labelHostRef} />
      </div>

      <aside class="scene-harness__controls">
        <label>
          <span>zoom {zoom.toFixed(2)}x</span>
          <input
            type="range"
            min="0.3"
            max="12"
            step="0.01"
            value={String(zoom)}
            onInput={(e) => {
              setZoom(Number((e.target as HTMLInputElement).value));
            }}
          />
        </label>
        <label>
          <span>departure {String(departure)} s</span>
          <input
            type="range"
            min="300"
            max="4000"
            step="10"
            value={String(departure)}
            onInput={(e) => {
              setDeparture(Number((e.target as HTMLInputElement).value));
            }}
          />
        </label>
        <label>
          <span>first burn {String(dv)} m/s</span>
          <input
            type="range"
            min="10"
            max="120"
            step="1"
            value={String(dv)}
            onInput={(e) => {
              setDv(Number((e.target as HTMLInputElement).value));
            }}
          />
        </label>
        <label>
          <span>selected node {String(selected)}</span>
          <input
            type="range"
            min="0"
            max="1"
            step="1"
            value={String(selected)}
            onInput={(e) => {
              setSelected(Number((e.target as HTMLInputElement).value));
            }}
          />
        </label>
        <label>
          <span>device pixel ratio {dpr === 0 ? 'auto' : String(dpr)}</span>
          <input
            type="range"
            min="0"
            max="3"
            step="1"
            value={String(dpr)}
            onInput={(e) => {
              setDpr(Number((e.target as HTMLInputElement).value));
            }}
          />
        </label>
        <label class="scene-harness__toggle">
          <input
            type="checkbox"
            checked={grey}
            onChange={(e) => {
              setGrey((e.target as HTMLInputElement).checked);
            }}
          />
          <span>greyscale</span>
        </label>
        <label>
          <span>palette</span>
          <select
            data-testid="scene-palette"
            value={palette}
            onChange={(e) => {
              setPalette((e.target as HTMLSelectElement).value as PaletteId);
            }}
          >
            {PALETTE_IDS.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>

        <dl class="scene-harness__readout">
          <dt>hovered</dt>
          <dd data-testid="scene-hovered">{hovered}</dd>
          <dt>scene</dt>
          <dd data-testid="scene-stats">{stats}</dd>
        </dl>
      </aside>
    </main>
  );
};
