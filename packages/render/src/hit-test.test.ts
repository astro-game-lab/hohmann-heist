import { describe, expect, it } from 'vitest';

import type { Viewport } from './renderer.js';
import { cssToDevice } from './viewport.js';
import type { PathHitTarget, PointHitTarget } from './hit-test.js';
import {
  HIT_PRIORITY,
  MIN_HIT_TARGET_PX,
  buildHitIndex,
  distanceToTarget,
  hitRadius,
  hitTest,
  hitTestAll,
} from './hit-test.js';

// `exactOptionalPropertyTypes` is on, so an absent visual size means omitting the
// property rather than passing `undefined` for it — which is the distinction the flag
// exists to keep, and matches how a caller building a scene would spread it in.
const point = (
  kind: PointHitTarget['kind'],
  id: string,
  x: number,
  y: number,
  visualRadius?: number,
): PointHitTarget => ({
  shape: 'point',
  kind,
  id,
  at: { x, y },
  ...(visualRadius === undefined ? {} : { visualRadius }),
});

const path = (
  id: string,
  points: readonly [number, number][],
  visualWidth?: number,
): PathHitTarget => ({
  shape: 'path',
  kind: 'trajectory',
  id,
  points: points.map(([x, y]) => ({ x, y })),
  ...(visualWidth === undefined ? {} : { visualWidth }),
});

describe('hitRadius', () => {
  it('is half of §8.5.2’s 32 px target for anything drawn smaller', () => {
    expect(MIN_HIT_TARGET_PX).toBe(32);
    // The point of the requirement: a 3 px node marker is still a 32 px target.
    expect(hitRadius(point('node', 'n', 0, 0, 3))).toBe(16);
    expect(hitRadius(point('node', 'n', 0, 0))).toBe(16);
  });

  it('grows to the visual size when the mark is drawn larger than the minimum', () => {
    // A target smaller than the thing it represents is its own kind of wrong.
    expect(hitRadius(point('marker', 'm', 0, 0, 40))).toBe(40);
    expect(hitRadius(path('t', [[0, 0]], 100))).toBe(50);
  });
});

describe('distanceToTarget', () => {
  it('measures to a point', () => {
    expect(distanceToTarget(point('node', 'n', 10, 10), { x: 13, y: 14 })).toBeCloseTo(5, 12);
  });

  it('measures to the nearest segment of a path, not to its vertices', () => {
    // The midpoint of a long segment is nowhere near either endpoint; a
    // vertex-only test would report a miss for a click sitting on the line.
    const t = path('t', [
      [0, 0],
      [100, 0],
    ]);
    expect(distanceToTarget(t, { x: 50, y: 3 })).toBeCloseTo(3, 12);
  });

  it('clamps the projection to the segment', () => {
    // An unclamped projection measures to the infinite line, which reports a hit on a
    // trajectory the click was nowhere near — 200 px past the end of it, here.
    const t = path('t', [
      [0, 0],
      [100, 0],
    ]);
    expect(distanceToTarget(t, { x: 300, y: 0 })).toBeCloseTo(200, 12);
  });

  it('handles a degenerate path of one point, and one of zero', () => {
    expect(distanceToTarget(path('t', [[10, 10]]), { x: 10, y: 13 })).toBeCloseTo(3, 12);
    expect(distanceToTarget(path('t', []), { x: 0, y: 0 })).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('hitTest', () => {
  it('returns nothing for empty space', () => {
    const index = buildHitIndex([point('node', 'n', 0, 0)]);
    expect(hitTest(index, { x: 500, y: 500 })).toBeUndefined();
  });

  it('hits anywhere inside the 32 px target of a marker drawn much smaller', () => {
    const index = buildHitIndex([point('node', 'n1', 100, 100, 3)]);
    // 15 px away: outside the 3 px mark, inside the 16 px radius.
    expect(hitTest(index, { x: 115, y: 100 })?.id).toBe('n1');
    // 17 px away: outside it.
    expect(hitTest(index, { x: 117, y: 100 })).toBeUndefined();
  });

  it('prefers a handle to the node it sits on, even when the node is nearer', () => {
    // This is the case the priority order exists for. A handle cross is drawn through
    // the node diamond, so the two targets always overlap; resolving by distance alone
    // would select the node whenever the player grabbed the handle near its root.
    const node = point('node', 'node-1', 100, 100);
    const handle = point('handle', 'handle-prograde', 110, 100);
    const index = buildHitIndex([node, handle]);

    const hit = hitTest(index, { x: 103, y: 100 });
    expect(hit?.kind).toBe('handle');
    expect(hit?.id).toBe('handle-prograde');
    // The node really was closer; kind still won.
    expect(distanceToTarget(node, { x: 103, y: 100 })).toBeLessThan(
      distanceToTarget(handle, { x: 103, y: 100 }),
    );
  });

  it('prefers a node to the trajectory it sits on', () => {
    const index = buildHitIndex([
      path('planned', [
        [0, 100],
        [200, 100],
      ]),
      point('node', 'node-1', 100, 100),
    ]);
    expect(hitTest(index, { x: 100, y: 100 })?.kind).toBe('node');
  });

  it('prefers a marker to the trajectory, and a node to a marker', () => {
    // The whole documented chain: handle > node > marker > trajectory.
    expect(HIT_PRIORITY).toEqual(['handle', 'node', 'marker', 'trajectory']);

    const withMarker = buildHitIndex([
      path('planned', [
        [0, 100],
        [200, 100],
      ]),
      point('marker', 'ship', 100, 100),
    ]);
    expect(hitTest(withMarker, { x: 100, y: 100 })?.kind).toBe('marker');

    const withNode = buildHitIndex([
      point('marker', 'ship', 100, 100),
      point('node', 'node-1', 104, 100),
    ]);
    expect(hitTest(withNode, { x: 100, y: 100 })?.kind).toBe('node');
  });

  it('breaks a tie within one kind by distance', () => {
    const index = buildHitIndex([point('node', 'far', 110, 100), point('node', 'near', 102, 100)]);
    expect(hitTest(index, { x: 100, y: 100 })?.id).toBe('near');
  });

  it('breaks an exact distance tie by input order, so the result never varies', () => {
    // NFR-009: nothing may depend on an iteration order that could differ between runs.
    // Two nodes equidistant on either side of the point is the case that would expose it.
    const index = buildHitIndex([
      point('node', 'first', 95, 100),
      point('node', 'second', 105, 100),
    ]);
    for (let i = 0; i < 10; i++) {
      expect(hitTest(index, { x: 100, y: 100 })?.id).toBe('first');
    }
  });

  it('keeps two nodes a few pixels apart separately selectable', () => {
    // §9.3 and #110: markers must stay usable when two nodes are close in screen space.
    // Their 32 px targets overlap heavily; the nearer one still wins.
    const index = buildHitIndex([point('node', 'a', 100, 100), point('node', 'b', 106, 100)]);
    expect(hitTest(index, { x: 99, y: 100 })?.id).toBe('a');
    expect(hitTest(index, { x: 107, y: 100 })?.id).toBe('b');
  });

  it('reports the distance and the index of what it hit', () => {
    const index = buildHitIndex([point('node', 'n0', 0, 0), point('node', 'n1', 100, 100)]);
    const hit = hitTest(index, { x: 103, y: 104 });
    expect(hit).toEqual({ kind: 'node', id: 'n1', distance: 5, target: 1 });
  });
});

describe('the 32 px target is CSS pixels, not device pixels', () => {
  // #114 is explicit about this, and it is the criterion most likely to be got wrong:
  // a constant that quietly meant device pixels would give a 16 CSS px target on every
  // 2x display — half the accessible minimum, on the machines most players use.
  const index = buildHitIndex([point('node', 'n', 100, 100, 3)]);
  const viewportAt = (devicePixelRatio: number): Viewport => ({
    width: 800,
    height: 600,
    devicePixelRatio,
  });

  it('behaves identically at 1x, 2x and 3x', () => {
    // The pointer position and the target are both CSS pixels, so the ratio simply does
    // not enter this module. The test pins that it stays that way.
    for (const dpr of [1, 2, 3]) {
      void viewportAt(dpr);
      expect(hitTest(index, { x: 115, y: 100 })?.id).toBe('n');
      expect(hitTest(index, { x: 117, y: 100 })).toBeUndefined();
    }
  });

  it('is 64 device pixels wide on a 2x display', () => {
    // The same target expressed in the other unit, through the one place that converts.
    expect(cssToDevice(MIN_HIT_TARGET_PX, viewportAt(2))).toBe(64);
    expect(cssToDevice(MIN_HIT_TARGET_PX, viewportAt(1))).toBe(32);
    // Capped at 2, so a 3x display gets the same backing store and the same conversion.
    expect(cssToDevice(MIN_HIT_TARGET_PX, viewportAt(3))).toBe(64);
  });
});

describe('hitTestAll', () => {
  it('returns the whole stack, most specific first', () => {
    // The context menu and the keyboard "cycle what is here" both want the stack, not
    // just the winner.
    const index = buildHitIndex([
      path('planned', [
        [0, 100],
        [200, 100],
      ]),
      point('node', 'node-1', 100, 100),
      point('handle', 'handle-prograde', 104, 100),
    ]);

    const hits = hitTestAll(index, { x: 100, y: 100 });
    expect(hits.map((h) => h.kind)).toEqual(['handle', 'node', 'trajectory']);
    // The first entry is always what a click would have selected.
    expect(hits[0]?.id).toBe(hitTest(index, { x: 100, y: 100 })?.id);
  });

  it('is empty for empty space', () => {
    const index = buildHitIndex([point('node', 'n', 0, 0)]);
    expect(hitTestAll(index, { x: 500, y: 500 })).toEqual([]);
  });
});

describe('the index', () => {
  it('keeps the targets in the order they were given, for keyboard traversal', () => {
    // Keyboard focus walks this list rather than hit-testing, which is why it is an
    // ordered list and not a map (FR-405).
    const targets = [
      point('node', 'a', 0, 0),
      point('node', 'b', 10, 0),
      point('node', 'c', 20, 0),
    ];
    expect(buildHitIndex(targets).targets.map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('rejects a far-away point without measuring geometry', () => {
    // Bounds are expanded by the hit radius at build time so a miss costs four
    // comparisons — the reason a 512-vertex trajectory is affordable per pointer move.
    const long: [number, number][] = [];
    for (let i = 0; i < 512; i++) long.push([i, Math.sin(i / 10) * 50 + 300]);
    const index = buildHitIndex([path('planned', long)]);

    expect(hitTest(index, { x: -1000, y: -1000 })).toBeUndefined();
    expect(hitTest(index, { x: 100, y: Math.sin(10) * 50 + 300 })?.id).toBe('planned');
  });
});
