/**
 * Watching a canvas for size and pixel-ratio changes — §11.8, #115.
 *
 * Behind the `@hh/render/resize` subpath rather than the barrel, alongside `canvas2d.ts`
 * — though for a slightly different reason than that file, and the difference is worth
 * being precise about. `canvas2d.ts` names real DOM types and could not compile without
 * the DOM library. Everything here is structural: `ResizeHost`, `ResizeObserverLike` and
 * friends describe only the shape this module calls, so it *would* compile under the
 * no-DOM root project.
 *
 * It stays behind the subpath because `observeViewport` reaches for `globalThis.window`
 * and `globalThis.ResizeObserver` at run time when its defaults are taken. A module that
 * needs a browser to work belongs with the one that needs a browser to compile, whatever
 * the type checker can see — and the barrel's promise is that importing it never drags in
 * a browser, not merely that it type-checks without one.
 *
 * The structural types earn their keep in the tests, which drive every case in this file
 * — a resize burst, a display move, teardown — with no jsdom and no `ResizeObserver`
 * polyfill.
 *
 * ## Two signals, not one
 *
 * A viewport changes for two unrelated reasons, and code that watches only the first is
 * the common bug.
 *
 * **The element resizes.** `ResizeObserver`, because a window `resize` event misses
 * every layout change that did not come from the window — a side panel collapsing, a
 * flexbox reflow, the address bar retracting on mobile.
 *
 * **The display's pixel ratio changes.** Nothing fires a resize for this. Dragging the
 * window from a 2x laptop panel to a 1x external monitor leaves the element exactly the
 * same CSS size while every device pixel under it changes meaning, and a renderer that
 * only watches size keeps a 2x backing store on a 1x display — a canvas that is
 * quietly, permanently soft, on the setup most likely to belong to someone who cares.
 *
 * The platform's only notification for it is a `matchMedia('(resolution: Xdppx)')` query
 * that stops matching. It is a *query about the current value*, so the listener has to
 * be torn down and rebuilt around the new ratio every time it fires — which is why this
 * re-arms rather than subscribing once.
 *
 * ## rAF-batched, and why that is not merely an optimisation
 *
 * `ResizeObserver` fires once per frame per observed box during a drag, and each
 * callback here resizes a backing store — an allocation of width × height × 4 bytes that
 * also clears the canvas. Dragging a window edge would otherwise allocate and discard a
 * few megabytes a second.
 *
 * Coalescing into one `requestAnimationFrame` collapses a burst into the single value
 * that was current when the frame ran, which is also the only value that could have been
 * drawn. #115 asks for "rAF-batched or debounced"; rAF is the better of the two here
 * because it is phase-locked to the frame that will consume the result, where a debounce
 * timer is a guess about how long a human drags for.
 *
 * ## The clock this does not read
 *
 * `requestAnimationFrame` is a scheduler, not a clock: nothing here reads its timestamp
 * or `performance.now()`, and the callback's argument is deliberately ignored. NFR-008
 * bans clock reads in the simulation, and while this package is not the simulation, a
 * viewport that depended on elapsed time would make a replay's frames depend on how fast
 * the machine ran.
 */
import type { Viewport } from './renderer.js';
import { sameViewport } from './viewport.js';

/** The part of the platform this module needs, named so a test can supply it. */
export interface ResizeHost {
  /** The reported device pixel ratio. Unclamped — the cap is the renderer's (§11.8). */
  readonly devicePixelRatio: number;
  matchMedia(query: string): ResizeMediaQuery;
  requestAnimationFrame(callback: () => void): number;
  cancelAnimationFrame(handle: number): void;
}

/** The part of `MediaQueryList` this module uses. */
export interface ResizeMediaQuery {
  addEventListener(type: 'change', listener: () => void): void;
  removeEventListener(type: 'change', listener: () => void): void;
}

/** The part of an observed element this module reads. */
export interface ResizeTarget {
  getBoundingClientRect(): { readonly width: number; readonly height: number };
}

/** The part of `ResizeObserver` this module uses. */
export interface ResizeObserverLike {
  observe(target: ResizeTarget): void;
  disconnect(): void;
}

/** How to construct an observer. Injected so a test needs no `ResizeObserver` polyfill. */
export type ResizeObserverFactory = (callback: () => void) => ResizeObserverLike;

export interface ObserveViewportOptions {
  /** The element whose CSS size is the viewport. */
  readonly target: ResizeTarget;
  /** Called with the new viewport, at most once per animation frame. */
  readonly onChange: (viewport: Viewport) => void;
  /** The platform. Defaults to `window`. */
  readonly host?: ResizeHost;
  /** How to build a `ResizeObserver`. Defaults to the global constructor. */
  readonly observerFactory?: ResizeObserverFactory;
}

/** Stops watching. Idempotent — calling it twice is not an error. */
export type StopObserving = () => void;

/**
 * The media query that matches exactly while the pixel ratio is `ratio`.
 *
 * Both bounds, rather than `(resolution: Xdppx)` alone: the exact-value form is not
 * reliably supported, and a pair of inequalities around the same value is. The query is
 * built from the *current* ratio and rebuilt whenever it stops matching.
 */
export const resolutionQuery = (ratio: number): string =>
  `(min-resolution: ${String(ratio)}dppx), (max-resolution: ${String(ratio)}dppx)`;

/**
 * The viewport an element currently presents.
 *
 * `getBoundingClientRect` rather than `clientWidth`: it is fractional, and a viewport
 * rounded to whole CSS pixels before the device-pixel conversion loses up to a device
 * pixel at the edge — the seam `backingStoreSize` rounds to avoid.
 */
export const viewportOf = (target: ResizeTarget, host: ResizeHost): Viewport => {
  const rect = target.getBoundingClientRect();
  return {
    width: rect.width,
    height: rect.height,
    // Reported, never clamped. `backingStoreScale` owns the cap, so that a renderer can
    // still tell a 3x phone from a 2x laptop.
    devicePixelRatio: host.devicePixelRatio,
  };
};

/**
 * Watch an element's CSS size and the display's pixel ratio, reporting the viewport.
 *
 * `onChange` fires at most once per animation frame, and only when the viewport actually
 * differs from the last one reported — a `ResizeObserver` callback for a layout change
 * that did not resize the element produces nothing, which is what keeps a renderer from
 * clearing its canvas for no reason.
 *
 * It does **not** fire for the initial value. A caller already has a viewport — it needed
 * one to construct a renderer — and firing on subscribe would make the first frame
 * arrive through a different path than every later one.
 *
 * @returns a function that stops watching and releases both listeners.
 */
export const observeViewport = (options: ObserveViewportOptions): StopObserving => {
  const host = options.host ?? (globalThis as unknown as { window: ResizeHost }).window;
  const makeObserver: ResizeObserverFactory =
    options.observerFactory ??
    ((callback) =>
      new (
        globalThis as unknown as { ResizeObserver: new (cb: () => void) => ResizeObserverLike }
      ).ResizeObserver(callback));

  let last: Viewport = viewportOf(options.target, host);
  let frame: number | undefined;
  let query: ResizeMediaQuery | undefined;
  let stopped = false;

  const publish = (): void => {
    frame = undefined;
    if (stopped) return;
    const next = viewportOf(options.target, host);
    // Both guards matter. A `ResizeObserver` fires for layout changes that leave the
    // box alone, and a ratio change fires the media listener without moving the box.
    if (sameViewport(next, last)) return;
    last = next;
    options.onChange(next);
  };

  const schedule = (): void => {
    if (stopped || frame !== undefined) return;
    // The callback's timestamp argument is deliberately not taken. See the docstring.
    frame = host.requestAnimationFrame(() => {
      publish();
    });
  };

  /**
   * (Re-)arm the pixel-ratio listener around the current ratio.
   *
   * A `matchMedia` query is a question about one value, so once it stops matching it
   * can never match again and a new one has to be built around the new ratio. Missing
   * this is the reason a "DPR change is handled" claim usually only survives the first
   * change.
   */
  const armRatioListener = (): void => {
    if (stopped) return;
    const listener = (): void => {
      query?.removeEventListener('change', listener);
      query = undefined;
      armRatioListener();
      schedule();
    };
    query = host.matchMedia(resolutionQuery(host.devicePixelRatio));
    query.addEventListener('change', listener);
    ratioListener = listener;
  };

  let ratioListener: (() => void) | undefined;

  const observer = makeObserver(schedule);
  observer.observe(options.target);
  armRatioListener();

  return () => {
    if (stopped) return;
    stopped = true;
    observer.disconnect();
    if (frame !== undefined) host.cancelAnimationFrame(frame);
    if (query !== undefined && ratioListener !== undefined) {
      query.removeEventListener('change', ratioListener);
    }
    frame = undefined;
    query = undefined;
  };
};
