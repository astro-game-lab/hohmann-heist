/**
 * The pointer gesture, driven for real — #263, #134, #135, §8.5.2.
 *
 * ## Why this file is the deliverable
 *
 * Dragging a node did nothing in `v0.1.0`, deployed, and nothing in the repository could
 * have caught it. #134 and #135 closed on `pick.ts` unit tests and on the keyboard paths,
 * both of which reach the store directly and never touch the effect that owns the
 * listeners — so the one gesture §8.5.2 leads with was covered by nothing at all.
 *
 * What makes a test able to catch it is **the re-render**. The bug is not that the
 * handlers are wrong; it is that `onPointerDown` calls `onSelectNode`, the selection is in
 * the listener effect's dependency array, and the effect therefore re-runs between
 * `pointerdown` and the first `pointermove` — taking the closure that held the gesture with
 * it. A test that rendered `OrbitView` with fixed props would never re-run the effect and
 * would pass against the broken code.
 *
 * So {@link Harness} is not scaffolding. It is the reproduction: a parent that owns
 * `selectedNodeId` and sets it from `onSelectNode`, which is exactly what
 * `PlannerScreen.tsx` does. Remove it and the test stops being able to fail.
 *
 * `test-canvas.ts` is the other half — jsdom has no 2-D context, so without it the effect
 * takes its canvas-parity bail-out and installs no listeners. Its docstring says why that
 * matters more than it looks.
 */
import { type Epoch } from '@hh/astro';
import { addNode, type LoadedScenario } from '@hh/game';
import { EMPTY_PLAN, buildTimeline, type Plan, type Timeline } from '@hh/sim';
import { createCatalogue, type HandleAxis } from '@hh/ui';
import type { ScreenPoint } from '@hh/render';
import { render } from 'preact';
import { useState } from 'preact/hooks';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { contractById } from '../contracts/registry.js';
import { OrbitView } from './OrbitView.js';
import { nodeIdOf } from './store.js';
import { installCanvasHarness, pointerEvent, type RemoveCanvasHarness } from './test-canvas.js';

const catalogue = createCatalogue();
let container: HTMLElement;
let removeHarness: RemoveCanvasHarness;

const c03 = (): LoadedScenario => {
  const scenario = contractById('c03-cold-open');
  if (scenario === undefined) throw new Error('c03-cold-open is not in the registry');
  return scenario;
};

/** A plan with one burn, half an hour in — comfortably inside C03's window. */
const onePlan = (scenario: LoadedScenario): Plan => {
  const edit = addNode(EMPTY_PLAN, (scenario.startEpoch + 1800) as Epoch);
  if (!edit.ok) throw new Error(`the fixture plan was refused: ${edit.reason.code}`);
  return edit.plan;
};

const timelineFor = (scenario: LoadedScenario, plan: Plan): Timeline => {
  const result = buildTimeline({
    startEpoch: scenario.startEpoch,
    initialState: scenario.ship.state,
    plan,
    horizon: scenario.horizon,
    mu: scenario.mu,
  });
  if (!result.ok) throw new Error('the fixture plan produced no timeline');
  return result.timeline;
};

/** Every callback the orbit view can reach, as spies. */
const spies = () => ({
  onSelectNode: vi.fn<(nodeId: string) => void>(),
  onDeselect: vi.fn(),
  onPlaceNode: vi.fn<(epoch: Epoch) => void>(),
  onOpenEditor: vi.fn<(nodeId: string) => void>(),
  onBeginEpochDrag: vi.fn<(nodeId: string) => void>(),
  onBeginDeltaVDrag: vi.fn<(nodeId: string, axis: HandleAxis) => void>(),
  onDragEpochTo: vi.fn<(epoch: Epoch) => void>(),
  onDragDeltaVTo: vi.fn<(progradeMps: number, radialMps: number) => void>(),
  onReleaseDrag: vi.fn(),
  onCancelDrag: vi.fn(),
});

type Spies = ReturnType<typeof spies>;

/**
 * `PlannerScreen`'s selection ownership, in miniature — the reproduction. See the
 * docstring.
 *
 * `onSelectNode` sets state here, so a press on a node marker re-renders the parent and
 * hands `OrbitView` a new `selectedNodeId` before the first `pointermove` arrives. That is
 * the exact sequence #263 dies on.
 */
const Harness = ({
  scenario,
  timeline,
  handlers,
  onAnchor,
  anchorNodeId,
  dragging,
}: {
  readonly scenario: LoadedScenario;
  readonly timeline: Timeline;
  readonly handlers: Spies;
  readonly onAnchor: (at: ScreenPoint | null) => void;
  readonly anchorNodeId: string | null;
  readonly dragging: { readonly progradeMps: number; readonly radialMps: number } | null;
}) => {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const node = timeline.plan.nodes[0];
  const dragPreview =
    dragging === null || node === undefined
      ? null
      : {
          nodeId: nodeIdOf(node),
          kind: 'deltaV' as const,
          index: 0,
          progradeMps: dragging.progradeMps,
          radialMps: dragging.radialMps,
        };

  return (
    <OrbitView
      t={catalogue.resolve}
      resolveDynamic={catalogue.resolveDynamic}
      scenario={scenario}
      timeline={timeline}
      scrubEpoch={scenario.startEpoch}
      selectedNodeId={selectedNodeId}
      onSelectNode={(id) => {
        handlers.onSelectNode(id);
        setSelectedNodeId(id);
      }}
      onDeselect={handlers.onDeselect}
      onPlaceNode={handlers.onPlaceNode}
      onOpenEditor={handlers.onOpenEditor}
      onBeginEpochDrag={handlers.onBeginEpochDrag}
      onBeginDeltaVDrag={handlers.onBeginDeltaVDrag}
      onDragEpochTo={handlers.onDragEpochTo}
      onDragDeltaVTo={handlers.onDragDeltaVTo}
      onReleaseDrag={handlers.onReleaseDrag}
      onCancelDrag={handlers.onCancelDrag}
      dragging={dragPreview}
      anchorNodeId={anchorNodeId}
      onAnchor={onAnchor}
    />
  );
};

const canvasOf = (): HTMLCanvasElement => {
  const canvas = container.querySelector('canvas');
  if (canvas === null) throw new Error('the orbit view rendered no canvas');
  return canvas;
};

const dispatch = async (type: string, x: number, y: number): Promise<void> => {
  await act(() => {
    canvasOf().dispatchEvent(pointerEvent(type, x, y));
  });
};

/**
 * Mount, and report where the node is drawn.
 *
 * The position comes from the component's own `onAnchor` — §8.3.5's "anchored to the
 * node", which is a statement about where the node is on screen and is the only thing
 * that knows it. Deriving it in the test instead would mean a second copy of the camera.
 */
const mountAt = async (
  scenario: LoadedScenario,
  timeline: Timeline,
  handlers: Spies,
  dragging: { readonly progradeMps: number; readonly radialMps: number } | null = null,
): Promise<ScreenPoint> => {
  const node = timeline.plan.nodes[0];
  if (node === undefined) throw new Error('the fixture plan has no node');
  // A box rather than a `let`, because the assignment happens inside a callback the
  // compiler cannot see running — narrowing a `let` here would collapse it to `null`.
  const reported: { at: ScreenPoint | null } = { at: null };

  await act(() => {
    render(
      <Harness
        scenario={scenario}
        timeline={timeline}
        handlers={handlers}
        anchorNodeId={nodeIdOf(node)}
        onAnchor={(at) => {
          if (at !== null) reported.at = at;
        }}
        dragging={dragging}
      />,
      container,
    );
  });

  if (reported.at === null) {
    throw new Error('the orbit view never reported where the node is drawn');
  }
  return reported.at;
};

beforeEach(() => {
  removeHarness = installCanvasHarness();
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
  removeHarness();
});

describe('#263 — the gesture survives the re-render it causes', () => {
  it('drags a node: down, move, up reaches the store', async () => {
    const scenario = c03();
    const timeline = timelineFor(scenario, onePlan(scenario));
    const handlers = spies();
    const at = await mountAt(scenario, timeline, handlers);
    const node = timeline.plan.nodes[0];
    if (node === undefined) throw new Error('no node');

    // Press on the marker. This selects, which re-renders the parent — the whole point.
    await dispatch('pointerdown', at.x, at.y);
    expect(handlers.onSelectNode).toHaveBeenCalledWith(nodeIdOf(node));

    // Past `DRAG_THRESHOLD_PX`, so the press becomes a drag rather than a click.
    await dispatch('pointermove', at.x + 40, at.y + 10);

    // Against the code as it stands both of these are zero: the effect re-ran on the
    // selection change and the new closure's `pressed` is `null`, so the move returns
    // immediately and the drag is never begun.
    expect(handlers.onBeginEpochDrag).toHaveBeenCalledWith(nodeIdOf(node));
    expect(handlers.onDragEpochTo).toHaveBeenCalled();

    await dispatch('pointerup', at.x + 40, at.y + 10);
    expect(handlers.onReleaseDrag).toHaveBeenCalledTimes(1);
  });

  it('keeps following the pointer across several moves, not only the first', async () => {
    const scenario = c03();
    const timeline = timelineFor(scenario, onePlan(scenario));
    const handlers = spies();
    const at = await mountAt(scenario, timeline, handlers);

    await dispatch('pointerdown', at.x, at.y);
    await dispatch('pointermove', at.x + 30, at.y);
    await dispatch('pointermove', at.x + 60, at.y);
    await dispatch('pointermove', at.x + 90, at.y);

    // #263's third criterion: the store updating on every move must not tear the gesture
    // down. Three moves, three epochs — a gesture that died after the first would report
    // one and then stop.
    expect(handlers.onDragEpochTo.mock.calls.length).toBeGreaterThanOrEqual(3);
    await dispatch('pointerup', at.x + 90, at.y);
    expect(handlers.onReleaseDrag).toHaveBeenCalledTimes(1);
  });

  it('drags a Δv handle, so #135 cannot regress silently either', async () => {
    const scenario = c03();
    const timeline = timelineFor(scenario, onePlan(scenario));
    const handlers = spies();
    // The handles are drawn on the *selected* node, so the gesture starts the same way a
    // player's does: the node is pressed once to select it, then a handle is pulled.
    const at = await mountAt(scenario, timeline, handlers, { progradeMps: 0, radialMps: 0 });
    await dispatch('pointerdown', at.x, at.y);
    await dispatch('pointerup', at.x, at.y);

    // `HANDLE_ARM_PX` out along the prograde arm. Which screen direction that is depends
    // on the camera, so the press walks the ring around the marker and takes whichever
    // point reports a handle — the same thing a player does by looking.
    const found = await (async (): Promise<HandleAxis | null> => {
      for (let degrees = 0; degrees < 360; degrees += 15) {
        const radians = (degrees * Math.PI) / 180;
        const x = at.x + Math.cos(radians) * 28;
        const y = at.y + Math.sin(radians) * 28;
        await dispatch('pointerdown', x, y);
        await dispatch('pointermove', x + 20, y + 20);
        const call = handlers.onBeginDeltaVDrag.mock.calls[0];
        if (call !== undefined) {
          await dispatch('pointerup', x + 20, y + 20);
          return call[1];
        }
        await dispatch('pointerup', x, y);
      }
      return null;
    })();

    expect(found).not.toBeNull();
    expect(handlers.onDragDeltaVTo).toHaveBeenCalled();
  });

  it('cancels on Escape mid-drag and leaves the plan alone', async () => {
    const scenario = c03();
    const timeline = timelineFor(scenario, onePlan(scenario));
    const handlers = spies();
    const at = await mountAt(scenario, timeline, handlers);

    await dispatch('pointerdown', at.x, at.y);
    await dispatch('pointermove', at.x + 40, at.y);
    await act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(handlers.onCancelDrag).toHaveBeenCalledTimes(1);
    // A cancelled gesture is not also a release: `releaseDragging` would commit the drag
    // to the plan, which is the opposite of what Escape means (#134).
    expect(handlers.onReleaseDrag).not.toHaveBeenCalled();
  });

  it('leaves a camera pan and the click-to-place path unaffected', async () => {
    const scenario = c03();
    const timeline = timelineFor(scenario, onePlan(scenario));
    const handlers = spies();
    await mountAt(scenario, timeline, handlers);

    // Empty space: a press that moves is a pan, and a pan touches no node.
    await dispatch('pointerdown', 5, 5);
    await dispatch('pointermove', 60, 60);
    await dispatch('pointerup', 60, 60);

    expect(handlers.onSelectNode).not.toHaveBeenCalled();
    expect(handlers.onBeginEpochDrag).not.toHaveBeenCalled();
    expect(handlers.onReleaseDrag).not.toHaveBeenCalled();
    // A pan is not a click, so it must not deselect either — #263's last criterion asks
    // for the camera path to be unchanged, and a stray deselect is how that breaks.
    expect(handlers.onDeselect).not.toHaveBeenCalled();
  });

  it('installs the pointer handlers once, and not again during a drag', async () => {
    const scenario = c03();
    const timeline = timelineFor(scenario, onePlan(scenario));
    const handlers = spies();

    // Counted on the prototype, so the count covers whichever canvas the view mounts, and
    // delegating to the real implementation so the listeners are genuinely installed —
    // a mock that only recorded would leave nothing to drag.
    //
    // The reference is taken precisely in order to re-invoke it with an explicit `this`,
    // which is the one case the unbound-method rule exists to catch and the one case it
    // is wrong about.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const realAdd = EventTarget.prototype.addEventListener;
    const installs: string[] = [];
    const spy = vi
      .spyOn(HTMLCanvasElement.prototype, 'addEventListener')
      .mockImplementation(function (
        this: HTMLCanvasElement,
        type: string,
        listener: EventListenerOrEventListenerObject | null,
        options?: boolean | AddEventListenerOptions,
      ): void {
        installs.push(type);
        realAdd.call(this, type, listener, options);
      });

    try {
      const at = await mountAt(scenario, timeline, handlers);
      const afterMount = installs.filter((type) => type === 'pointerdown').length;

      await dispatch('pointerdown', at.x, at.y);
      await dispatch('pointermove', at.x + 30, at.y);
      await dispatch('pointermove', at.x + 60, at.y);
      await dispatch('pointermove', at.x + 90, at.y);
      await dispatch('pointerup', at.x + 90, at.y);

      // #263's eighth criterion, as a number rather than a claim.
      //
      // **Once at mount, zero times during the gesture.** The listener effect depends on
      // the scenario, the palette and the motion preference and on nothing else — not the
      // selection the press changes, not the drag payload every move updates, not the
      // scrub head. Before the fix this was one full re-install per pointer event, which
      // is what destroyed the gesture and what was also paying NFR-011's frame budget.
      expect(afterMount).toBe(1);
      expect(installs.filter((type) => type === 'pointerdown').length).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('still treats a press that did not move as a click', async () => {
    const scenario = c03();
    const timeline = timelineFor(scenario, onePlan(scenario));
    const handlers = spies();
    await mountAt(scenario, timeline, handlers);

    // Empty space, no movement: §8.5.2's "click empty space: deselect".
    await dispatch('pointerdown', 5, 5);
    await dispatch('pointerup', 5, 5);
    expect(handlers.onDeselect).toHaveBeenCalledTimes(1);
    expect(handlers.onBeginEpochDrag).not.toHaveBeenCalled();
  });
});
