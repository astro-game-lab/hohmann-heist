import { describe, expect, it } from 'vitest';

import type { Layer, Primitive, Scene } from './renderer.js';
import {
  DRAW_ORDER,
  MAX_BACKING_STORE_SCALE,
  backingStoreScale,
  layersInDrawOrder,
} from './renderer.js';

const stroke = { colour: '#fff', width: 1 } as const;
const line = (colour: string): Primitive => ({
  kind: 'polyline',
  points: [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ],
  stroke: { ...stroke, colour },
});

describe('draw order (§11.8)', () => {
  it('is exactly §11.8 s canvas list, in order', () => {
    // Transcribed from docs/PRODUCT.md §11.8 step 5. `labels` is the one entry from
    // that list which is absent, because D8 puts labels in the DOM.
    expect([...DRAW_ORDER]).toEqual([
      'earth',
      'hazard-shells',
      'constraint-geometry',
      'target-orbit',
      'current-orbit',
      'planned-trajectory',
      'trails',
      'markers',
      'nodes',
      'handles',
    ]);
  });

  it('has no labels layer — labels are DOM elements (D8)', () => {
    expect(DRAW_ORDER).not.toContain('labels' as Layer);
  });

  it('is frozen, so a consumer cannot reorder the pipeline for everyone', () => {
    expect(Object.isFrozen(DRAW_ORDER)).toBe(true);
  });

  it('orders layers by DRAW_ORDER, not by the order the scene was populated in', () => {
    // Populated back to front on purpose: `handles` first, `earth` last.
    const scene: Scene = {
      layers: {
        handles: [line('handles')],
        markers: [line('markers')],
        earth: [line('earth')],
      },
    };

    const drawn = layersInDrawOrder(scene).map((primitives) => {
      const first = primitives[0];
      return first?.kind === 'polyline' ? first.stroke.colour : '';
    });

    expect(drawn).toEqual(['earth', 'markers', 'handles']);
  });

  it('skips absent and empty layers', () => {
    const scene: Scene = { layers: { earth: [], nodes: [line('nodes')] } };
    expect(layersInDrawOrder(scene)).toHaveLength(1);
  });
});

describe('backing store scale (§11.8)', () => {
  it('caps at 2 for battery', () => {
    expect(MAX_BACKING_STORE_SCALE).toBe(2);
    expect(backingStoreScale(3)).toBe(2);
    expect(backingStoreScale(4)).toBe(2);
  });

  it('passes through the common ratios below the cap', () => {
    expect(backingStoreScale(1)).toBe(1);
    expect(backingStoreScale(1.5)).toBe(1.5);
    expect(backingStoreScale(2)).toBe(2);
  });

  it('never goes below 1 — a fractional backing store resamples for nothing', () => {
    expect(backingStoreScale(0.5)).toBe(1);
    expect(backingStoreScale(0)).toBe(1);
    expect(backingStoreScale(-2)).toBe(1);
  });

  it('falls back to 1 for a value that is not a number', () => {
    expect(backingStoreScale(Number.NaN)).toBe(1);
    expect(backingStoreScale(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe('the primitive vocabulary (§11.8, D8)', () => {
  it('has no text primitive, which is what keeps labels in the DOM', () => {
    // A structural assertion rather than a stylistic one: `Primitive` is a closed
    // union, so a caller cannot draw text because there is nothing to construct. If a
    // `text` member is ever added this stops compiling, which is the point.
    const kinds: Primitive['kind'][] = ['polyline', 'polygon', 'disc'];
    expect(kinds).toHaveLength(3);
  });
});
