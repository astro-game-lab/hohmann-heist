/**
 * What jsdom is missing before a pointer gesture can be driven against the orbit view.
 *
 * ## Why this file has to exist
 *
 * #263 is a bug in the pointer handlers, and its acceptance criterion is a test that
 * *"dispatches a real pointer sequence against the canvas"*. There was no such test in
 * the repository, and this module is the reason: under jsdom `getContext('2d')` returns
 * `null`, so `OrbitView`'s effect takes its canvas-parity bail-out (see the comment at
 * the top of that effect) and installs **no listeners at all**. A pointer test written
 * without this would dispatch its events into a canvas nothing was listening to and pass
 * whatever the code did — which is precisely the failure mode #134 and #135 closed under.
 *
 * So the shim is not a convenience. It is what makes the test capable of failing.
 *
 * ## What is faked, and what is deliberately not
 *
 * Five things, each because the platform genuinely lacks it under jsdom, and each kept
 * to exactly the surface the code under test calls:
 *
 * - **A 2-D context.** A recording double, not a drawing one. `canvas2d.ts` is already
 *   tested against a recording double under Node — that is the arrangement `vitest.config.ts`
 *   describes and this follows it rather than inventing a second one. Nothing here
 *   asserts on what was drawn; the context exists so the renderer can run.
 * - **A bounding box.** jsdom reports every element as 0×0 at the origin, which would
 *   give the camera a degenerate viewport and put every hit test at the same point.
 *   {@link VIEWPORT} is the size the harness reports instead, anchored at the origin so
 *   `clientX/clientY` and canvas-local coordinates coincide and a test can name a
 *   position in one system.
 * - **`ResizeObserver`.** `observeViewport` reaches for the global constructor when no
 *   factory is injected, and `OrbitView` does not inject one. The stub observes nothing:
 *   the viewport never changes during these tests, and a stub that fired would be
 *   inventing an event the test did not ask for.
 * - **`matchMedia`.** `observeViewport` re-arms a `(resolution: Xdppx)` query to notice a
 *   display change, and `useReducedMotion` asks for `prefers-reduced-motion`. The stub
 *   answers `false` to everything and never fires: the tests here run at one pixel ratio
 *   with motion unreduced, and both modules already have their *own* tests driving the
 *   other branches through an injected host — which is why neither needs this to lie.
 * - **Pointer capture and `PointerEvent`.** jsdom implements neither. The capture methods
 *   are no-ops over a set, which is the whole of what the handlers use them for, and
 *   `PointerEvent` is `MouseEvent` plus the two fields the handlers read.
 *
 * **`requestAnimationFrame` is not faked.** jsdom has one, it is what the framing ease
 * runs on, and replacing it with a synchronous stub would make the ease complete inside
 * the dispatch that started it — which is not how a real frame behaves and would hide
 * exactly the re-entrancy this file exists to test around.
 */

/** The box every element reports. Anchored at the origin — see the docstring. */
export const VIEWPORT = { width: 800, height: 600 } as const;

/** Undo everything {@link installCanvasHarness} put on the global. */
export type RemoveCanvasHarness = () => void;

/** The 2-D context surface `canvas2d.ts` actually calls. Nothing more. */
const recordingContext = (): CanvasRenderingContext2D => {
  const noop = (): void => undefined;
  const context = {
    canvas: null as unknown as HTMLCanvasElement,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    globalAlpha: 1,
    save: noop,
    restore: noop,
    scale: noop,
    setTransform: noop,
    clearRect: noop,
    fillRect: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    arc: noop,
    fill: noop,
    stroke: noop,
    setLineDash: noop,
  };
  return context as unknown as CanvasRenderingContext2D;
};

/**
 * Give jsdom the four things the orbit view needs, and return the undo.
 *
 * Call in `beforeEach` and call the result in `afterEach`. Everything is restored to the
 * descriptor it replaced rather than deleted, so a suite that runs beside one which does
 * *not* want a canvas — `PlannerScreen.test.tsx` asserts the DOM half precisely because
 * the canvas draws nothing there — is unaffected by this file having been imported.
 */
export const installCanvasHarness = (): RemoveCanvasHarness => {
  const undo: (() => void)[] = [];

  const replace = (target: object, key: PropertyKey, value: unknown): void => {
    const original = Object.getOwnPropertyDescriptor(target, key);
    Object.defineProperty(target, key, { value, configurable: true, writable: true });
    undo.push(() => {
      if (original === undefined) {
        Reflect.deleteProperty(target, key);
      } else {
        Object.defineProperty(target, key, original);
      }
    });
  };

  // ── A 2-D context ────────────────────────────────────────────────────────
  const contexts = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();
  replace(
    HTMLCanvasElement.prototype,
    'getContext',
    function (this: HTMLCanvasElement, kind: string): CanvasRenderingContext2D | null {
      if (kind !== '2d') return null;
      let context = contexts.get(this);
      if (context === undefined) {
        context = recordingContext();
        contexts.set(this, context);
      }
      return context;
    },
  );

  // ── A bounding box ───────────────────────────────────────────────────────
  const { width, height } = VIEWPORT;
  replace(Element.prototype, 'getBoundingClientRect', function (): DOMRect {
    const box = {
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      width,
      height,
      toJSON: () => ({}),
    };
    return box;
  });

  // ── ResizeObserver ───────────────────────────────────────────────────────
  class StubResizeObserver {
    observe(): void {
      // Nothing. The viewport does not change during these tests — see the docstring.
    }
    unobserve(): void {
      /* symmetry with observe */
    }
    disconnect(): void {
      /* symmetry with observe */
    }
  }
  replace(globalThis, 'ResizeObserver', StubResizeObserver);

  // ── matchMedia ───────────────────────────────────────────────────────────
  replace(globalThis, 'matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }));

  // ── Pointer capture ──────────────────────────────────────────────────────
  const captured = new WeakMap<Element, Set<number>>();
  const idsFor = (element: Element): Set<number> => {
    let ids = captured.get(element);
    if (ids === undefined) {
      ids = new Set<number>();
      captured.set(element, ids);
    }
    return ids;
  };
  replace(Element.prototype, 'setPointerCapture', function (this: Element, id: number): void {
    idsFor(this).add(id);
  });
  replace(Element.prototype, 'releasePointerCapture', function (this: Element, id: number): void {
    idsFor(this).delete(id);
  });
  replace(Element.prototype, 'hasPointerCapture', function (this: Element, id: number): boolean {
    return idsFor(this).has(id);
  });

  // ── PointerEvent ─────────────────────────────────────────────────────────
  //
  // Extends jsdom's `MouseEvent`, so `clientX`/`clientY`/`button` and the whole event
  // plumbing are the platform's rather than this file's. Only `pointerId` and
  // `pointerType` are added, which is all the handlers read.
  if (!('PointerEvent' in globalThis)) {
    class StubPointerEvent extends MouseEvent {
      readonly pointerId: number;
      readonly pointerType: string;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
        this.pointerType = init.pointerType ?? 'mouse';
      }
    }
    replace(globalThis, 'PointerEvent', StubPointerEvent);
  }

  return () => {
    for (const restore of undo.reverse()) restore();
  };
};

/** A pointer event at a client position. `pointerId` is fixed: one finger, one gesture. */
export const pointerEvent = (type: string, x: number, y: number): PointerEvent =>
  new PointerEvent(type, {
    clientX: x,
    clientY: y,
    pointerId: 1,
    pointerType: 'mouse',
    bubbles: true,
    cancelable: true,
  });
