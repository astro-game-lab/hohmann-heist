import { describe, expect, it } from 'vitest';

import type { Canvas2DContext, Canvas2DTarget } from './canvas2d.js';
import { createCanvas2DRenderer } from './canvas2d.js';
import type { Layer, Primitive, Renderer, Scene, Viewport } from './renderer.js';
import { DRAW_ORDER } from './renderer.js';

/** One recorded context call, with the style state that was live when it was made. */
interface Call {
  readonly op: string;
  readonly args: readonly unknown[];
  readonly strokeStyle: string;
  readonly fillStyle: string;
  readonly lineDash: readonly number[];
  readonly globalAlpha: number;
  readonly lineWidth: number;
}

interface Recording {
  readonly context: Canvas2DContext;
  readonly calls: readonly Call[];
  ops(): readonly string[];
}

/**
 * A recording 2-D context.
 *
 * Recording the calls rather than drawing to a jsdom canvas is deliberate: a jsdom
 * canvas without `node-canvas` is a stub, so painting to one would assert that jsdom
 * accepted the calls rather than that this renderer made the right ones. It also keeps
 * these tests in the `packages` Vitest project, which runs under Node.
 */
const createRecordingContext = (): Recording => {
  const calls: Call[] = [];
  let lineDash: readonly number[] = [];

  const state = {
    lineWidth: 1,
    lineJoin: 'miter' as CanvasLineJoin,
    lineCap: 'butt' as CanvasLineCap,
    strokeStyle: '#000' as string | CanvasGradient | CanvasPattern,
    fillStyle: '#000' as string | CanvasGradient | CanvasPattern,
    globalAlpha: 1,
  };

  /**
   * A canvas style is `string | CanvasGradient | CanvasPattern`. This renderer only ever
   * sets the string form -- colours come from the caller -- so anything else here means
   * a gradient leaked in from somewhere, and naming it beats `[object Object]`.
   */
  const styleText = (value: string | CanvasGradient | CanvasPattern): string =>
    typeof value === 'string' ? value : '[gradient-or-pattern]';

  const record = (op: string, args: readonly unknown[]): void => {
    calls.push({
      op,
      args,
      strokeStyle: styleText(state.strokeStyle),
      fillStyle: styleText(state.fillStyle),
      lineDash: [...lineDash],
      globalAlpha: state.globalAlpha,
      lineWidth: state.lineWidth,
    });
  };

  const context: Canvas2DContext = {
    get lineWidth(): number {
      return state.lineWidth;
    },
    set lineWidth(value: number) {
      state.lineWidth = value;
    },
    get lineJoin(): CanvasLineJoin {
      return state.lineJoin;
    },
    set lineJoin(value: CanvasLineJoin) {
      state.lineJoin = value;
    },
    get lineCap(): CanvasLineCap {
      return state.lineCap;
    },
    set lineCap(value: CanvasLineCap) {
      state.lineCap = value;
    },
    get strokeStyle(): string | CanvasGradient | CanvasPattern {
      return state.strokeStyle;
    },
    set strokeStyle(value: string | CanvasGradient | CanvasPattern) {
      state.strokeStyle = value;
    },
    get fillStyle(): string | CanvasGradient | CanvasPattern {
      return state.fillStyle;
    },
    set fillStyle(value: string | CanvasGradient | CanvasPattern) {
      state.fillStyle = value;
    },
    get globalAlpha(): number {
      return state.globalAlpha;
    },
    set globalAlpha(value: number) {
      state.globalAlpha = value;
    },

    save: () => {
      record('save', []);
    },
    restore: () => {
      record('restore', []);
    },
    setTransform: (
      a?: number | DOMMatrix2DInit,
      b?: number,
      c?: number,
      d?: number,
      e?: number,
      f?: number,
    ) => {
      record('setTransform', [a, b, c, d, e, f]);
    },
    clearRect: (x: number, y: number, w: number, h: number) => {
      record('clearRect', [x, y, w, h]);
    },
    fillRect: (x: number, y: number, w: number, h: number) => {
      record('fillRect', [x, y, w, h]);
    },
    beginPath: () => {
      record('beginPath', []);
    },
    moveTo: (x: number, y: number) => {
      record('moveTo', [x, y]);
    },
    lineTo: (x: number, y: number) => {
      record('lineTo', [x, y]);
    },
    closePath: () => {
      record('closePath', []);
    },
    arc: (x: number, y: number, r: number, start: number, end: number, ccw?: boolean) => {
      record('arc', [x, y, r, start, end, ccw]);
    },
    stroke: () => {
      record('stroke', []);
    },
    fill: () => {
      record('fill', []);
    },
    setLineDash: (segments: number[]) => {
      lineDash = [...segments];
      record('setLineDash', [[...segments]]);
    },
  };

  return {
    context,
    calls,
    ops: () => calls.map((call) => call.op),
  };
};

const createTarget = (): { target: Canvas2DTarget; recording: Recording } => {
  const recording = createRecordingContext();
  const target: Canvas2DTarget = {
    width: 0,
    height: 0,
    getContext: () => recording.context,
  };
  return { target, recording };
};

const VIEWPORT: Viewport = { width: 800, height: 600, devicePixelRatio: 2 };

const line = (colour: string): Primitive => ({
  kind: 'polyline',
  points: [
    { x: 0, y: 0 },
    { x: 10, y: 10 },
  ],
  stroke: { colour, width: 2 },
});

describe('backing store (§11.8)', () => {
  it('is sized at devicePixelRatio in device pixels', () => {
    const { target } = createTarget();
    createCanvas2DRenderer(target, VIEWPORT);
    expect(target.width).toBe(1600);
    expect(target.height).toBe(1200);
  });

  it('caps at 2 on a 3x display', () => {
    const { target } = createTarget();
    const renderer = createCanvas2DRenderer(target, {
      width: 400,
      height: 300,
      devicePixelRatio: 3,
    });
    expect(renderer.backingStoreScale).toBe(2);
    expect(target.width).toBe(800);
    expect(target.height).toBe(600);
  });

  it('rounds rather than truncates, so the last column is not lost', () => {
    const { target } = createTarget();
    createCanvas2DRenderer(target, { width: 1439.6, height: 100, devicePixelRatio: 2 });
    expect(target.width).toBe(2879);
  });

  it('resizes, and a resize to the same viewport does not touch the backing store', () => {
    const { target } = createTarget();
    const renderer = createCanvas2DRenderer(target, VIEWPORT);

    renderer.resize({ width: 400, height: 300, devicePixelRatio: 1 });
    expect(target.width).toBe(400);
    expect(renderer.viewport.width).toBe(400);

    // Assigning canvas.width clears the canvas even when the value is unchanged, so a
    // no-op resize has to write nothing at all.
    target.width = -1;
    renderer.resize({ width: 400, height: 300, devicePixelRatio: 1 });
    expect(target.width).toBe(-1);
  });

  it('throws when the canvas yields no 2-D context', () => {
    const target: Canvas2DTarget = { width: 0, height: 0, getContext: () => null };
    expect(() => createCanvas2DRenderer(target, VIEWPORT)).toThrow(TypeError);
  });
});

describe('drawing a frame', () => {
  it('scales the transform by the backing store ratio, so primitives are CSS pixels', () => {
    const { target, recording } = createTarget();
    const renderer = createCanvas2DRenderer(target, VIEWPORT);
    renderer.draw({ layers: {} });

    const transform = recording.calls.find((call) => call.op === 'setTransform');
    expect(transform?.args.slice(0, 6)).toEqual([2, 0, 0, 2, 0, 0]);
  });

  it('clears in CSS pixels and brackets the frame in save/restore', () => {
    const { target, recording } = createTarget();
    createCanvas2DRenderer(target, VIEWPORT).draw({ layers: {} });

    const ops = recording.ops();
    expect(ops[0]).toBe('save');
    expect(ops.at(-1)).toBe('restore');
    expect(recording.calls.find((call) => call.op === 'clearRect')?.args).toEqual([0, 0, 800, 600]);
  });

  it('paints a background only when the scene asks for one', () => {
    const { target, recording } = createTarget();
    const renderer = createCanvas2DRenderer(target, VIEWPORT);

    renderer.draw({ layers: {} });
    expect(recording.ops()).not.toContain('fillRect');

    renderer.draw({ layers: {}, background: { colour: '#101418' } });
    expect(recording.calls.find((call) => call.op === 'fillRect')?.fillStyle).toBe('#101418');
  });

  it('draws layers in DRAW_ORDER regardless of how the scene was built', () => {
    const { target, recording } = createTarget();
    const renderer = createCanvas2DRenderer(target, VIEWPORT);

    // Reverse order, so anything that iterated the scene's own keys would fail.
    const layers: Partial<Record<Layer, Primitive[]>> = {};
    for (const layer of [...DRAW_ORDER].reverse()) layers[layer] = [line(layer)];
    renderer.draw({ layers });

    const strokedColours = recording.calls
      .filter((call) => call.op === 'stroke')
      .map((call) => call.strokeStyle);
    expect(strokedColours).toEqual([...DRAW_ORDER]);
  });

  it('resets the dash between primitives, so a dashed orbit does not infect the next one', () => {
    const { target, recording } = createTarget();
    const renderer = createCanvas2DRenderer(target, VIEWPORT);

    renderer.draw({
      layers: {
        'target-orbit': [
          {
            kind: 'polyline',
            points: [
              { x: 0, y: 0 },
              { x: 5, y: 5 },
            ],
            stroke: { colour: '#0f0', width: 1, dash: [6, 4] },
          },
        ],
        'current-orbit': [line('#f00')],
      },
    });

    const strokes = recording.calls.filter((call) => call.op === 'stroke');
    expect(strokes[0]?.lineDash).toEqual([6, 4]);
    expect(strokes[1]?.lineDash).toEqual([]);
  });

  it('applies alpha per primitive and restores full opacity for the next', () => {
    const { target, recording } = createTarget();
    createCanvas2DRenderer(target, VIEWPORT).draw({
      layers: {
        trails: [
          {
            kind: 'polyline',
            points: [
              { x: 0, y: 0 },
              { x: 1, y: 1 },
            ],
            stroke: { colour: '#fff', width: 1, alpha: 0.25 },
          },
        ],
        markers: [line('#fff')],
      },
    });

    const strokes = recording.calls.filter((call) => call.op === 'stroke');
    expect(strokes[0]?.globalAlpha).toBe(0.25);
    expect(strokes[1]?.globalAlpha).toBe(1);
  });

  it('closes a closed polyline and leaves an open one open', () => {
    const { target, recording } = createTarget();
    const renderer = createCanvas2DRenderer(target, VIEWPORT);
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
    ];

    renderer.draw({
      layers: {
        'current-orbit': [{ kind: 'polyline', points, stroke: { colour: '#fff', width: 1 } }],
      },
    });
    expect(recording.ops()).not.toContain('closePath');

    const second = createTarget();
    createCanvas2DRenderer(second.target, VIEWPORT).draw({
      layers: {
        'current-orbit': [
          { kind: 'polyline', points, closed: true, stroke: { colour: '#fff', width: 1 } },
        ],
      },
    });
    expect(second.recording.ops()).toContain('closePath');
  });

  it('draws a disc as an arc, filled, and outlines it only when asked', () => {
    const { target, recording } = createTarget();
    createCanvas2DRenderer(target, VIEWPORT).draw({
      layers: {
        earth: [
          {
            kind: 'disc',
            centre: { x: 400, y: 300 },
            radius: 120,
            fill: { colour: '#2a4' },
            stroke: { colour: '#5c8', width: 1.5 },
          },
        ],
      },
    });

    const arc = recording.calls.find((call) => call.op === 'arc');
    expect(arc?.args.slice(0, 3)).toEqual([400, 300, 120]);
    expect(recording.ops()).toContain('fill');
    expect(recording.ops()).toContain('stroke');
  });

  it('fills a polygon and closes it without being asked', () => {
    const { target, recording } = createTarget();
    createCanvas2DRenderer(target, VIEWPORT).draw({
      layers: {
        'hazard-shells': [
          {
            kind: 'polygon',
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 10 },
            ],
            fill: { colour: '#a22', alpha: 0.2 },
          },
        ],
      },
    });

    expect(recording.ops()).toContain('closePath');
    expect(recording.calls.find((call) => call.op === 'fill')?.fillStyle).toBe('#a22');
  });

  it('skips degenerate primitives rather than leaving a stray dot', () => {
    const { target, recording } = createTarget();
    createCanvas2DRenderer(target, VIEWPORT).draw({
      layers: {
        nodes: [
          { kind: 'polyline', points: [{ x: 1, y: 1 }], stroke: { colour: '#fff', width: 1 } },
          { kind: 'polyline', points: [], stroke: { colour: '#fff', width: 1 } },
          {
            kind: 'polygon',
            points: [
              { x: 0, y: 0 },
              { x: 1, y: 1 },
            ],
            fill: { colour: '#fff' },
          },
          {
            kind: 'disc',
            centre: { x: 0, y: 0 },
            radius: 0,
            fill: { colour: '#fff' },
          },
        ],
      },
    });

    expect(recording.ops()).not.toContain('stroke');
    expect(recording.ops()).not.toContain('fill');
  });
});

describe('the Renderer seam (D7)', () => {
  /**
   * A consumer, written against the interface alone. If a second implementation needed
   * a change here, D7's "requires no consumer changes" would not hold.
   */
  const drawPlanner = (renderer: Renderer, orbit: readonly { x: number; y: number }[]): void => {
    renderer.resize({ ...renderer.viewport, width: renderer.viewport.width });
    renderer.draw({
      layers: {
        'current-orbit': [
          { kind: 'polyline', points: orbit, stroke: { colour: '#6cf', width: 2 } },
        ],
      },
    });
  };

  /** A trivial second implementation: it counts primitives and draws nothing. */
  const createCountingRenderer = (viewport: Viewport): Renderer & { count: number } => {
    let current = viewport;
    return {
      count: 0,
      get viewport(): Viewport {
        return current;
      },
      resize(next: Viewport): void {
        current = next;
      },
      draw(scene: Scene): void {
        for (const layer of DRAW_ORDER) this.count += scene.layers[layer]?.length ?? 0;
      },
    };
  };

  it('drives a Canvas2D renderer and a test double through the same consumer', () => {
    const orbit = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ];

    const { target, recording } = createTarget();
    drawPlanner(createCanvas2DRenderer(target, VIEWPORT), orbit);
    expect(recording.ops()).toContain('stroke');

    const double = createCountingRenderer(VIEWPORT);
    drawPlanner(double, orbit);
    expect(double.count).toBe(1);
  });

  it('accepts anything shaped like a canvas, including an offscreen one', () => {
    // `Canvas2DTarget` is structural, so a real HTMLCanvasElement, an OffscreenCanvas
    // and this object are all valid targets without the renderer knowing which it has.
    const { target } = createTarget();
    expect(() => createCanvas2DRenderer(target, VIEWPORT)).not.toThrow();
  });
});
