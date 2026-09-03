/**
 * The M1 spike page — #238.
 *
 * Throwaway, and structured so that throwing it away is one `rm -r`: everything it owns
 * lives under `apps/web/src/spike/`, and the only hooks into the rest of the app are one
 * route name and one `import`.
 *
 * ## What it is for
 *
 * `@hh/render` and `@hh/sim` have never run in a browser. Every performance figure in
 * `docs/PHYSICS.md` was measured under Node, and that document says plainly that
 * rasterisation and compositing "are not measured and cannot be from here", so
 * "passing does not mean §11.9's frame rows are met". This page is where that stops
 * being true, and its output is the evidence D5 is decided on.
 *
 * ## The loop, and why it is written this way
 *
 * State lives in refs and mutable locals inside one effect, not in `useState`. That is
 * not a shortcut — it is the measurement. Routing 60 plan updates a second through
 * Preact's scheduler would put the framework in the middle of the number this page
 * exists to produce, and D9 is not being decided here. The component re-renders about
 * five times a second, only to repaint the readout, and the readout is DOM text rather
 * than canvas because §D8 says so.
 *
 * ## Auto mode
 *
 * `#/spike?auto=600` runs a synthetic drag for 600 frames and parks the result on
 * `window.__spikeResults`. A human dragging a mouse cannot produce a repeatable
 * measurement, and Playwright driving a real pointer measures Playwright's event
 * dispatch as much as the frame. The synthetic drag moves the pointer a fixed distance
 * per frame, so every frame does the full re-evaluate-and-redraw path with no two
 * frames alike — which is the worst case the cache can be asked for.
 *
 * `#/spike?auto=600&drag=0` runs the same loop without touching the plan, which is
 * §11.9's *idle* row: every conic served from the tessellation cache, nothing
 * re-evaluated. Both rows exist under Node in `tools/bench/frame.bench.test.ts`, so
 * measuring both here is what makes the two sets of numbers comparable line for line.
 */
import type { EciVector } from '@hh/astro';
import type { Metres } from '@hh/math';
import type { ScreenPoint } from '@hh/render';
import { createTessellationCache, worldToScreen } from '@hh/render';
import { createCanvas2DRenderer } from '@hh/render/canvas2d';
import type { Plan, Timeline } from '@hh/sim';
import { withPlan } from '@hh/sim';
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

import type { DragState } from './drag.js';
import { IDLE, beginDrag, currentCounts, planForDrag, screenNodesOf } from './drag.js';
import type { FrameStats } from './metrics.js';
import { FRAME_BUDGET_MS, createFrameRecorder } from './metrics.js';
import { BASE_COUNTS, DRAGGED_NODE, VIEWPORT, cameraFor, planOf, timelineOf } from './scenario.js';
import { buildScene, createProjectionBuffer } from './scene.js';

/** How often the readout repaints. Not the frame rate — the frame loop is independent. */
const READOUT_INTERVAL_MS = 200;

/** Pixels the synthetic pointer travels per frame in auto mode. */
const AUTO_PIXELS_PER_FRAME = 1.5;

/** Frames the synthetic drag runs for when `?auto` carries no number. */
const AUTO_DEFAULT_FRAMES = 600;

/** What auto mode leaves on `window` for a driver to read. */
export interface SpikeResults {
  readonly frames: number;
  /** Which §11.9 row this run measured. */
  readonly mode: 'dragging' | 'idle';
  readonly devicePixelRatio: number;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly vertices: number;
  readonly stats: FrameStats;
  readonly budgetMs: number;
}

declare global {
  var __spikeResults: SpikeResults | undefined;
}

const paramsFromHash = (hash: string): URLSearchParams => {
  const query = hash.indexOf('?');
  return new URLSearchParams(query === -1 ? '' : hash.slice(query + 1));
};

/** Frames requested by `?auto=N` in the hash, or `0` when auto mode is off. */
const autoFramesFromHash = (hash: string): number => {
  const value = paramsFromHash(hash).get('auto');
  if (value === null) return 0;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return AUTO_DEFAULT_FRAMES;
  return Math.max(1, parsed);
};

/** Whether auto mode drags. `?drag=0` measures §11.9's idle row instead. */
const autoDragsFromHash = (hash: string): boolean => paramsFromHash(hash).get('drag') !== '0';

const ms = (value: number): string => value.toFixed(3);

export const SpikePage = (): JSX.Element => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [stats, setStats] = useState<FrameStats | undefined>(undefined);
  const [vertices, setVertices] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return undefined;

    const viewport = { ...VIEWPORT, devicePixelRatio: window.devicePixelRatio };
    const camera = cameraFor(viewport);
    const renderer = createCanvas2DRenderer(canvas, viewport);
    const cache = createTessellationCache();
    const buffer = createProjectionBuffer();
    const recorder = createFrameRecorder();

    let plan: Plan = planOf(BASE_COUNTS);
    let timeline: Timeline = timelineOf(plan);
    let drag: DragState = IDLE;
    let pointerY = 0;
    let planDirty = false;
    let lastVertices = 0;
    let previousFrameStart: number | undefined;
    let lastReadout = 0;

    const autoFrames = autoFramesFromHash(window.location.hash);
    const autoDrags = autoDragsFromHash(window.location.hash);
    let autoRemaining = autoFrames;
    let autoDirection = 1;

    const project = (position: EciVector<Metres>): ScreenPoint => worldToScreen(camera, position);

    if (autoFrames > 0 && autoDrags) {
      // Grab the node where it actually is, so the synthetic drag exercises the same
      // path a real one does rather than a special case.
      const nodes = screenNodesOf(timeline, project);
      const target = nodes.find((n) => n.nodeIndex === DRAGGED_NODE);
      if (target !== undefined) {
        pointerY = target.y;
        drag = beginDrag(nodes, plan, target.x, target.y);
      }
    }

    let handle = 0;

    const frame = (): void => {
      const frameStart = performance.now();
      const interval =
        previousFrameStart === undefined ? undefined : frameStart - previousFrameStart;
      previousFrameStart = frameStart;

      if (autoRemaining > 0 && autoDrags) {
        // Reverse before the clamp bites, so every frame is a real change of plan and
        // none of them is the no-op `planForDrag` returns at the ends of the range.
        const counts = currentCounts(plan);
        if (counts >= 500_000) autoDirection = -1;
        if (counts <= 50_000) autoDirection = 1;
        pointerY -= AUTO_PIXELS_PER_FRAME * autoDirection;
        planDirty = true;
      }

      const simStart = performance.now();
      if (planDirty) {
        planDirty = false;
        const next = planForDrag(drag, plan, pointerY);
        if (next !== undefined) {
          const result = withPlan(timeline, next);
          if (result.ok) {
            plan = next;
            timeline = result.timeline;
          }
        }
      }
      const simEnd = performance.now();

      const built = buildScene({
        timeline,
        camera,
        cache,
        buffer,
        draggedNode: drag.kind === 'dragging' ? drag.nodeIndex : -1,
      });
      const geometryEnd = performance.now();

      renderer.draw(built.scene);
      const drawEnd = performance.now();

      lastVertices = built.vertices;
      recorder.record({
        sim: simEnd - simStart,
        geometry: geometryEnd - simEnd,
        draw: drawEnd - geometryEnd,
        total: drawEnd - frameStart,
        interval,
      });

      if (frameStart - lastReadout > READOUT_INTERVAL_MS) {
        lastReadout = frameStart;
        setStats(recorder.stats());
        setVertices(lastVertices);
      }

      if (autoRemaining > 0) {
        autoRemaining--;
        if (autoRemaining === 0) {
          const finished = recorder.stats();
          globalThis.__spikeResults = {
            frames: autoFrames,
            mode: autoDrags ? 'dragging' : 'idle',
            devicePixelRatio: viewport.devicePixelRatio,
            viewport: { width: viewport.width, height: viewport.height },
            vertices: lastVertices,
            stats: finished,
            budgetMs: FRAME_BUDGET_MS,
          };
          setStats(finished);
          setVertices(lastVertices);
          setDone(true);
          drag = IDLE;
          setDragging(false);
          return;
        }
      }

      handle = window.requestAnimationFrame(frame);
    };

    const onPointerDown = (event: PointerEvent): void => {
      if (autoFrames > 0) return;
      const rect = canvas.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      drag = beginDrag(screenNodesOf(timeline, project), plan, x, y);
      if (drag.kind === 'dragging') {
        pointerY = y;
        canvas.setPointerCapture(event.pointerId);
        setDragging(true);
      }
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (drag.kind !== 'dragging') return;
      pointerY = event.clientY - canvas.getBoundingClientRect().top;
      // The plan is not rebuilt here. Pointer events outrun frames, and re-evaluating
      // per event would measure the event rate instead of the frame — and would do work
      // whose result is overwritten before anything draws it.
      planDirty = true;
    };

    const onPointerUp = (event: PointerEvent): void => {
      if (drag.kind !== 'dragging') return;
      drag = IDLE;
      setDragging(false);
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);

    handle = window.requestAnimationFrame(frame);

    return (): void => {
      window.cancelAnimationFrame(handle);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
    };
  }, []);

  return (
    <main>
      <h1>M1 spike — orbit render and node drag</h1>
      <p>
        Throwaway page for{' '}
        <a href="https://github.com/astro-game-lab/hohmann-heist/issues/238">#238</a>. Drag the
        highlighted node to change the last burn. Append <code>?auto=600</code> to the hash to run a
        synthetic drag and publish the result on <code>window.__spikeResults</code>.
      </p>

      <canvas
        ref={canvasRef}
        width={VIEWPORT.width}
        height={VIEWPORT.height}
        style={{
          width: `${String(VIEWPORT.width)}px`,
          height: `${String(VIEWPORT.height)}px`,
          maxWidth: '100%',
          touchAction: 'none',
        }}
        data-testid="spike-canvas"
      />

      <section aria-labelledby="frame-heading">
        <h2 id="frame-heading">Frame time</h2>
        <p data-testid="spike-state">
          {done ? 'auto run complete' : dragging ? 'dragging' : 'idle'} · {vertices} vertices ·
          budget {ms(FRAME_BUDGET_MS)} ms
        </p>
        {stats === undefined ? (
          <p>Measuring…</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th scope="col">Quantity</th>
                <th scope="col">Median</th>
                <th scope="col">p95</th>
                <th scope="col">Worst</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ['re-evaluate (sim)', stats.sim],
                  ['geometry + scene', stats.geometry],
                  ['draw', stats.draw],
                  ['whole callback', stats.total],
                  ['frame interval', stats.interval],
                ] as const
              ).map(([label, stat]) => (
                <tr key={label}>
                  <th scope="row">{label}</th>
                  <td data-testid={`stat-${label}`}>{ms(stat.median)}</td>
                  <td>{ms(stat.p95)}</td>
                  <td>{ms(stat.worst)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {stats !== undefined && (
          <p data-testid="spike-dropped">
            dropped frames: {stats.droppedFrames} of {stats.interval.samples} (
            {(stats.droppedFraction * 100).toFixed(1)}%)
          </p>
        )}
      </section>
    </main>
  );
};
