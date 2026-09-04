import { describe, expect, it, vi } from 'vitest';

import type { Viewport } from './renderer.js';
import type { ResizeHost, ResizeMediaQuery, ResizeObserverLike, ResizeTarget } from './resize.js';
import { observeViewport, resolutionQuery, viewportOf } from './resize.js';

/**
 * A scriptable platform.
 *
 * The point of injecting the host is that this file needs no jsdom, no
 * `ResizeObserver` polyfill and no real display. Every one of #115's cases — a resize
 * burst, a display move, teardown — is a sequence of calls, and a fake lets the test
 * *make* that sequence happen rather than hoping the environment produces it.
 */
const harness = (initial: { width: number; height: number; dpr: number }) => {
  let width = initial.width;
  let height = initial.height;
  let dpr = initial.dpr;

  const frames: (() => void)[] = [];
  const queries: { query: string; listeners: (() => void)[] }[] = [];
  let observerCallback: (() => void) | undefined;
  let observed: ResizeTarget | undefined;
  let disconnected = false;
  let cancelled = 0;

  const target: ResizeTarget = {
    getBoundingClientRect: () => ({ width, height }),
  };

  const host: ResizeHost = {
    get devicePixelRatio() {
      return dpr;
    },
    matchMedia: (query: string): ResizeMediaQuery => {
      const entry = { query, listeners: [] as (() => void)[] };
      queries.push(entry);
      return {
        addEventListener: (_type, listener) => entry.listeners.push(listener),
        removeEventListener: (_type, listener) => {
          const i = entry.listeners.indexOf(listener);
          if (i >= 0) entry.listeners.splice(i, 1);
        },
      };
    },
    requestAnimationFrame: (callback: () => void): number => {
      frames.push(callback);
      return frames.length;
    },
    cancelAnimationFrame: () => {
      cancelled++;
    },
  };

  const observerFactory = (callback: () => void): ResizeObserverLike => {
    observerCallback = callback;
    return {
      observe: (t) => {
        observed = t;
      },
      disconnect: () => {
        disconnected = true;
      },
    };
  };

  return {
    target,
    host,
    observerFactory,
    /** Fire the `ResizeObserver` callback, as the platform would on a layout change. */
    fireResize: () => observerCallback?.(),
    /** Run every scheduled animation frame. */
    runFrames: () => {
      const pending = frames.splice(0, frames.length);
      for (const frame of pending) frame();
    },
    pendingFrames: () => frames.length,
    /** Change the element's CSS size. */
    setSize: (w: number, h: number) => {
      width = w;
      height = h;
    },
    /** Move to a display with a different pixel ratio, then fire the media listener. */
    moveDisplay: (nextDpr: number) => {
      dpr = nextDpr;
      const live = queries[queries.length - 1];
      for (const listener of [...(live?.listeners ?? [])]) listener();
    },
    queries: () => queries.map((q) => q.query),
    liveListenerCount: () => queries.reduce((n, q) => n + q.listeners.length, 0),
    isDisconnected: () => disconnected,
    cancelledFrames: () => cancelled,
    isObserving: () => observed === target,
  };
};

describe('resolutionQuery', () => {
  it('brackets the ratio from both sides', () => {
    // The exact-value `(resolution: Xdppx)` form is not reliably supported; a pair of
    // inequalities around the same value is.
    expect(resolutionQuery(2)).toBe('(min-resolution: 2dppx), (max-resolution: 2dppx)');
  });
});

describe('viewportOf', () => {
  it('takes the fractional CSS size and the unclamped ratio', () => {
    const h = harness({ width: 1439.6, height: 600.4, dpr: 3 });
    expect(viewportOf(h.target, h.host)).toEqual({
      width: 1439.6,
      height: 600.4,
      // Reported, not capped. `backingStoreScale` owns the cap, so a renderer can still
      // tell a 3x phone from a 2x laptop.
      devicePixelRatio: 3,
    });
  });
});

describe('observeViewport', () => {
  it('observes the target and does not fire for the initial value', () => {
    const h = harness({ width: 800, height: 600, dpr: 2 });
    const onChange = vi.fn();
    observeViewport({ ...h, onChange });

    expect(h.isObserving()).toBe(true);
    // A caller already has a viewport — it needed one to build a renderer.
    expect(onChange).not.toHaveBeenCalled();
  });

  it('reports a resize once the frame runs', () => {
    const h = harness({ width: 800, height: 600, dpr: 2 });
    const onChange = vi.fn<(v: Viewport) => void>();
    observeViewport({ ...h, onChange });

    h.setSize(1024, 768);
    h.fireResize();
    expect(onChange).not.toHaveBeenCalled();

    h.runFrames();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ width: 1024, height: 768, devicePixelRatio: 2 });
  });

  it('coalesces a burst of resize callbacks into one frame', () => {
    // `ResizeObserver` fires once per frame per box while a window edge is dragged, and
    // each callback would otherwise resize a backing store — an allocation of
    // width x height x 4 bytes that also clears the canvas.
    const h = harness({ width: 800, height: 600, dpr: 2 });
    const onChange = vi.fn<(v: Viewport) => void>();
    observeViewport({ ...h, onChange });

    for (let i = 1; i <= 20; i++) {
      h.setSize(800 + i, 600);
      h.fireResize();
    }
    expect(h.pendingFrames()).toBe(1);

    h.runFrames();
    expect(onChange).toHaveBeenCalledTimes(1);
    // The value delivered is the one current when the frame ran, which is the only one
    // that could have been drawn.
    expect(onChange).toHaveBeenCalledWith({ width: 820, height: 600, devicePixelRatio: 2 });
  });

  it('stays silent when a layout change did not move the box', () => {
    const h = harness({ width: 800, height: 600, dpr: 2 });
    const onChange = vi.fn();
    observeViewport({ ...h, onChange });

    h.fireResize();
    h.runFrames();
    // Resizing a canvas clears it, so reporting a no-op change would flash the scene
    // away on any unrelated reflow.
    expect(onChange).not.toHaveBeenCalled();
  });

  it('reports a display move that changes the ratio but not the CSS size', () => {
    // The case a size-only watcher misses entirely: the element keeps its CSS size and
    // every device pixel under it changes meaning. Left unhandled, the canvas stays
    // permanently soft on the external monitor.
    const h = harness({ width: 800, height: 600, dpr: 2 });
    const onChange = vi.fn<(v: Viewport) => void>();
    observeViewport({ ...h, onChange });

    h.moveDisplay(1);
    h.runFrames();

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith({ width: 800, height: 600, devicePixelRatio: 1 });
  });

  it('re-arms the ratio listener, so a second display move is caught too', () => {
    // A `matchMedia` query asks about one value: once it stops matching it can never
    // match again. Subscribing once is why "DPR changes are handled" usually survives
    // exactly one change.
    const h = harness({ width: 800, height: 600, dpr: 2 });
    const onChange = vi.fn<(v: Viewport) => void>();
    observeViewport({ ...h, onChange });

    h.moveDisplay(1);
    h.runFrames();
    h.moveDisplay(3);
    h.runFrames();

    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith({ width: 800, height: 600, devicePixelRatio: 3 });
    // A fresh query per ratio, each built around the value current at the time.
    expect(h.queries()).toEqual([resolutionQuery(2), resolutionQuery(1), resolutionQuery(3)]);
    // Exactly one listener is live: the old ones are removed as they are replaced.
    expect(h.liveListenerCount()).toBe(1);
  });

  it('releases the observer, the frame and the listener when stopped', () => {
    const h = harness({ width: 800, height: 600, dpr: 2 });
    const onChange = vi.fn();
    const stop = observeViewport({ ...h, onChange });

    h.setSize(900, 600);
    h.fireResize();
    stop();

    expect(h.isDisconnected()).toBe(true);
    expect(h.cancelledFrames()).toBe(1);
    expect(h.liveListenerCount()).toBe(0);

    // A frame already queued must not deliver after teardown.
    h.runFrames();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('is safe to stop twice', () => {
    const h = harness({ width: 800, height: 600, dpr: 2 });
    const stop = observeViewport({ ...h, onChange: vi.fn() });
    stop();
    expect(() => {
      stop();
    }).not.toThrow();
    expect(h.cancelledFrames()).toBe(0);
  });
});
