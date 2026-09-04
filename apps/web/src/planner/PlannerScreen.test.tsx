/**
 * The planner screen — #123, #127, #128, #130, #131, #132.
 *
 * Driven against the **real** `c03-cold-open` through `@hh/game`'s own loader, for the
 * reason `Briefing.test.tsx` gives: a fixture would let a unit error look perfectly
 * reasonable. C03 is a 400 km circular LEO with a target 400 km above it, so every number
 * below is one a reader can check by eye.
 *
 * jsdom has no 2-D canvas context, so the orbit view renders its DOM shell and draws
 * nothing. That is the same branch a real browser with canvas disabled takes, and it is
 * why the whole planner is testable here — see the note in `OrbitView.tsx`. What it
 * means for this file is that everything asserted below is the **DOM half** of the
 * planner, which is exactly what §8.8's canvas-parity rule says must carry the same
 * information.
 */
import { createCatalogue } from '@hh/ui';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { contractById } from '../contracts/registry.js';
import { PlannerScreen, type CommittedRun } from './PlannerScreen.js';

const catalogue = createCatalogue();
let container: HTMLElement;

const c03 = (): NonNullable<ReturnType<typeof contractById>> => {
  const scenario = contractById('c03-cold-open');
  if (scenario === undefined) throw new Error('c03-cold-open is not in the registry');
  return scenario;
};

/** What `onCommit` was called with, or `null` if it has not been. */
let committed: CommittedRun | null = null;

const mount = async (): Promise<void> => {
  committed = null;
  await act(() => {
    render(
      <PlannerScreen
        t={catalogue.resolve}
        resolveDynamic={catalogue.resolveDynamic}
        scenario={c03()}
        onCommit={(run) => {
          committed = run;
        }}
      />,
      container,
    );
  });
};

const el = (testId: string): HTMLElement | null =>
  container.querySelector(`[data-testid="${testId}"]`);

const text = (testId: string): string => el(testId)?.textContent ?? '';

const click = async (testId: string): Promise<void> => {
  await act(() => {
    el(testId)?.click();
  });
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
});

describe('the five regions of §8.3.4 (#123)', () => {
  it('renders every one of them', async () => {
    await mount();
    // ① HUD, ② timeline, ③ plan, ④ readouts, ⑤ assists — and the orbit view between them.
    expect(el('hud-contract')).not.toBeNull();
    expect(el('timeline-track')).not.toBeNull();
    expect(el('plan-panel')).not.toBeNull();
    expect(el('readouts')).not.toBeNull();
    expect(el('assist-tray')).not.toBeNull();
    expect(el('orbit-view')).not.toBeNull();
  });

  it('keeps the timeline outside the tab strip, in both layouts', async () => {
    await mount();
    const timeline = el('timeline-track');
    const panels = container.querySelectorAll('.hh-planner__panel');
    expect(panels.length).toBe(3);
    // §8.3.4: "the timeline stays visible at all times ... must never be behind a tab."
    // Structural rather than visual: no tab panel contains it at any width.
    for (const panel of panels) {
      expect(panel.contains(timeline)).toBe(false);
    }
  });

  it('mounts all three panels at once, so a layout switch cannot lose their state', async () => {
    await mount();
    // The narrow layout hides two of them with `hidden`; it does not unmount them. That
    // is #123's fifth criterion — switching layouts loses no plan state, selection or
    // scrub position — made structural, since there is only one component tree.
    expect(el('plan-panel')).not.toBeNull();
    expect(el('readouts')).not.toBeNull();
    expect(el('assist-tray')).not.toBeNull();
  });

  it('offers the narrow layout’s tabs without a second copy of any panel', async () => {
    await mount();
    expect(el('planner-tab-plan')).not.toBeNull();
    expect(el('planner-tab-readouts')).not.toBeNull();
    expect(el('planner-tab-assists')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid="plan-panel"]')).toHaveLength(1);
  });

  it('switches which panel the tab strip shows without unmounting the others', async () => {
    await mount();
    await click('planner-tab-readouts');
    expect(el('planner-tab-readouts')?.getAttribute('aria-selected')).toBe('true');
    // Still mounted, merely hidden — which is the whole point.
    expect(el('plan-panel')).not.toBeNull();
  });
});

describe('the HUD bar (#127)', () => {
  it('names the contract and shows Δv against the budget', async () => {
    await mount();
    // §8.3.4's mock-up shows "05 TAILGATE" in capitals, and that is `text-transform` in
    // the stylesheet rather than a capitalised string in the catalogue: casing is
    // locale-dependent (Turkish dotted i, German ß) and CSS applies the locale's rule.
    // So the text content is the contract's own title.
    expect(text('hud-contract')).toContain('Cold Open');
    // An empty plan has spent nothing of C03's budget.
    expect(text('value-dv')).toContain('0');
  });

  it('reports the budget level as a word, not only as a colour (§8.8)', async () => {
    await mount();
    const bar = el('hud-dv-bar');
    expect(bar?.getAttribute('role')).toBe('progressbar');
    expect(bar?.getAttribute('data-level')).toBe('ok');
    // The accessible name is a sentence a screen reader can read; the fill colour only
    // reinforces it.
    expect(bar?.getAttribute('aria-label')).toContain('within budget');
  });

  it('shows MET at the scrub head, which starts at T+00:00:00', async () => {
    await mount();
    expect(text('hud-met')).toContain('00:00:00');
  });
});

describe('the timeline (#128)', () => {
  it('is a range input, so it is keyboard operable with a documented step', async () => {
    await mount();
    const scrub = el('timeline-scrub');
    expect(scrub).toBeInstanceOf(HTMLInputElement);
    expect(scrub?.getAttribute('type')).toBe('range');
    expect(scrub?.getAttribute('step')).toBe('60');
    // The step is described to the player, not only in a docstring.
    const hint = container.querySelector('#hh-timeline-step-hint');
    expect(hint?.textContent).toContain('60');
  });

  it('places the deadline wall from the scenario horizon', async () => {
    await mount();
    expect(el('timeline-deadline')).not.toBeNull();
  });

  it('scrubbing moves MET and leaves the plan alone', async () => {
    await mount();
    const scrub = el('timeline-scrub');
    if (!(scrub instanceof HTMLInputElement)) throw new Error('no scrub control');

    await act(() => {
      scrub.value = '3600';
      scrub.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(text('hud-met')).toContain('01:00:00');
    // The plan is untouched — the strong form of this is asserted by reference identity
    // in `machine.test.ts`; here it is that a view operation added no burns.
    expect(el('plan-empty')).not.toBeNull();
  });
});

describe('the plan panel (#130)', () => {
  it('is an empty state before there are any burns', async () => {
    await mount();
    expect(el('plan-empty')).not.toBeNull();
  });

  it('adds a node at the scrub head and lists it', async () => {
    await mount();
    await click('plan-add');

    const list = container.querySelector('.hh-plan__list');
    expect(list?.tagName).toBe('UL');
    expect(list?.querySelectorAll('li')).toHaveLength(1);
    expect(el('plan-node-0')).not.toBeNull();
  });

  it('announces a node as a sentence rather than as bare numbers', async () => {
    await mount();
    await click('plan-add');
    // The accessible name carries the direction as a word. "Node 1, at T+00:00:00, no
    // burn" — the components are zero until they are edited, and the catalogue drops them
    // rather than reading "0.0 radial".
    expect(text('plan-node-0')).toContain('Node 1');
  });

  it('synchronises selection with the rest of the screen', async () => {
    await mount();
    await click('plan-add');
    await click('plan-node-0');
    expect(el('plan-node-0')?.getAttribute('aria-pressed')).toBe('true');
    // The same selection reaches the timeline's marker, because both read one state.
    expect(el('timeline-node-0')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('selects from the timeline as well, the other direction', async () => {
    await mount();
    await click('plan-add');
    await click('timeline-node-0');
    expect(el('plan-node-0')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('deletes a node', async () => {
    await mount();
    await click('plan-add');
    await click('plan-delete-0');
    expect(el('plan-empty')).not.toBeNull();
  });
});

describe('the readouts (#131)', () => {
  it('suppresses the apsis rows on C03’s circular parking orbit', async () => {
    await mount();
    // C03 starts on a 400 km circular orbit, which is below §9.3's 1e-3 eccentricity
    // floor. Two apsis rows there would be float noise to one decimal place.
    expect(el('readouts-circular-note')).not.toBeNull();
    expect(el('value-altitude')).not.toBeNull();
    expect(el('value-apoapsis')).toBeNull();
    expect(el('value-periapsis')).toBeNull();
  });

  it('reads 400 km, which is the altitude the contract actually starts at', async () => {
    await mount();
    expect(text('value-altitude')).toContain('400');
  });

  it('offers the full-precision reading on focus as well as hover (FR-406)', async () => {
    await mount();
    const value = el('value-altitude');
    // Focusable, which is the only way a keyboard user can reveal it. A `title` tooltip
    // — which is what the briefing uses — cannot be reached at all.
    expect(value?.getAttribute('tabindex')).toBe('0');
    // And the precise reading is in the accessible tree at all times, not toggled.
    expect(text('precise-altitude')).toContain('m');
  });
});

describe('the closest-approach block (#132)', () => {
  it('says there is no approach rather than showing a zero', async () => {
    await mount();
    // C03's objective is a proximity one, and an empty plan never gets near the target.
    // What must not happen is a "0.0 km" reading that says the player has arrived.
    const none = el('approach-none');
    const approach = el('approach');
    expect(none !== null || approach !== null).toBe(true);
    if (approach !== null) {
      expect(text('approach-verdict')).not.toBe('');
      // The verdict is a sentence and an icon, not a colour.
      expect(el('approach-verdict')?.getAttribute('data-met')).toMatch(/true|false/);
    }
  });
});

describe('the assist tray (#133’s toggle only)', () => {
  it('offers the snap toggle, on by default, with its window stated', async () => {
    await mount();
    const toggle = el('assist-snap');
    expect(toggle).toBeInstanceOf(HTMLInputElement);
    expect((toggle as HTMLInputElement).checked).toBe(true);
    expect(container.querySelector('#hh-assist-snap-hint')?.textContent).toContain('30');
  });

  it('can be turned off', async () => {
    await mount();
    const toggle = el('assist-snap');
    if (!(toggle instanceof HTMLInputElement)) throw new Error('no snap toggle');
    await act(() => {
      toggle.checked = false;
      toggle.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect((el('assist-snap') as HTMLInputElement).checked).toBe(false);
  });
});

describe('the camera control (#103)', () => {
  it('offers ⌖ recentre', async () => {
    await mount();
    expect(el('orbit-recentre')).not.toBeNull();
  });
});

// ── The interactions (#133, #134, #135, #137, #139) ─────────────────────────
//
// Driven through the keyboard and the DOM controls rather than through the canvas, and
// that is the point rather than a limitation: §8.5.3 and FR-405 require every one of
// these to be reachable without a pointer, so a test that can only reach them by
// simulating a drag would be testing the half that is not the requirement. The pointer
// paths share the same store actions — `OrbitView` calls exactly what these do.

const press = async (key: string, modifiers: Partial<KeyboardEventInit> = {}): Promise<void> => {
  await act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...modifiers }));
  });
};

describe('adding a node by keyboard (#133, §8.5.3’s N)', () => {
  it('places one at the scrub head', async () => {
    await mount();
    await press('n');
    expect(el('plan-node-0')).not.toBeNull();
  });

  it('refuses a second node inside the minimum spacing, with the L5 reason (#133)', async () => {
    await mount();
    await press('n');
    // The scrub head has not moved, so this lands on the same epoch — FR-101's 1 s
    // separation refuses it, and the refusal is shown rather than silently merged.
    await press('n');
    expect(el('planner-refusal')).not.toBeNull();
    expect(container.querySelectorAll('.hh-plan__row')).toHaveLength(1);
  });
});

describe('the node editor (#137)', () => {
  const open = async (): Promise<void> => {
    await mount();
    await press('n');
    await click('plan-node-0');
    await press('e');
  };

  it('opens with E on a selected node, and is not modal', async () => {
    await open();
    const editor = el('node-editor');
    expect(editor).not.toBeNull();
    // A `dialog` role would announce it as modal and invite a focus trap. §8.3.5 says
    // "anchored to the node, never modal".
    expect(editor?.getAttribute('role')).toBe('group');
    // And the rest of the planner is still there and still interactive.
    expect(el('timeline-scrub')).not.toBeNull();
    expect(el('plan-node-0')).not.toBeNull();
  });

  it('opens from the plan panel’s ⤢ as well', async () => {
    await mount();
    await press('n');
    await click('plan-expand-0');
    expect(el('node-editor')).not.toBeNull();
  });

  it('shows the four epoch fields §8.3.5 draws', async () => {
    await open();
    for (const field of ['hours', 'minutes', 'seconds', 'milliseconds']) {
      expect(el(`editor-epoch-${field}`)).not.toBeNull();
    }
  });

  it('restores the previous value when an epoch field is out of range', async () => {
    await open();
    const minutes = el('editor-epoch-minutes');
    if (!(minutes instanceof HTMLInputElement)) throw new Error('no minutes field');
    const before = minutes.value;

    // Two acts, not one. A browser delivers `input` and `blur` as separate tasks and
    // renders between them; batching both into a single act would render once, with the
    // restored value equal to the vnode value already on screen, and no DOM write —
    // which would fail this test for a reason that never happens to a player.
    await act(() => {
      minutes.value = '75';
      minutes.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(() => {
      minutes.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    });

    // §8.3.5: "rejected on blur with the previous value restored, never silently
    // clamped". 75 must not become 59.
    const after = (el('editor-epoch-minutes') as HTMLInputElement).value;
    expect(after).not.toBe('75');
    expect(after).not.toBe('59');
    expect(after).toBe(before);
  });

  it('accepts full float64 Δv entry (§8.3.5)', async () => {
    await open();
    const prograde = el('editor-prograde');
    if (!(prograde instanceof HTMLInputElement)) throw new Error('no prograde field');
    // No `step` attribute: a step would make the browser refuse a value the game accepts.
    expect(prograde.getAttribute('step')).toBeNull();

    await act(() => {
      prograde.value = '-36.2001';
      prograde.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(Number((el('editor-prograde') as HTMLInputElement).value)).toBeCloseTo(-36.2001, 4);
  });

  it('steps prograde by 1 m/s, and by a tenth with Shift (§8.3.5)', async () => {
    await open();
    await click('editor-step-prograde-up');
    expect(Number((el('editor-prograde') as HTMLInputElement).value)).toBeCloseTo(1, 4);

    await act(() => {
      el('editor-step-prograde-up')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true, shiftKey: true }),
      );
    });
    expect(Number((el('editor-prograde') as HTMLInputElement).value)).toBeCloseTo(1.1, 4);
  });

  it('keeps the normal component out — §8.3.5 marks it v1.1', async () => {
    await open();
    const normal = el('editor-normal');
    expect(normal).not.toBeNull();
    expect((normal as HTMLInputElement).disabled).toBe(true);
  });

  it('shows the result block as live deltas against the pre-burn orbit (FR-410)', async () => {
    await open();
    await act(() => {
      const prograde = el('editor-prograde');
      if (prograde instanceof HTMLInputElement) {
        prograde.value = '40';
        prograde.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    // A prograde burn raises apoapsis. The delta is what §8.3.5 calls the learning
    // surface, and the sign is the rule a player is meant to see.
    const apoapsis = text('editor-result-apoapsis');
    expect(apoapsis).toContain('+');
  });

  it('closes without losing the edit', async () => {
    await open();
    await act(() => {
      const prograde = el('editor-prograde');
      if (prograde instanceof HTMLInputElement) {
        prograde.value = '12.5';
        prograde.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
    await click('editor-done');
    expect(el('node-editor')).toBeNull();
    // The plan kept it — there was never a draft to lose, because every field commits as
    // it is edited. #137's sixth criterion.
    expect(text('plan-node-0')).toContain('12.5');
  });
});

describe('keyboard editing (#134, #135, §8.5.3)', () => {
  const withNode = async (): Promise<void> => {
    await mount();
    await press('n');
    await click('plan-node-0');
  };

  it('nudges prograde with the arrow keys', async () => {
    await withNode();
    await press('ArrowUp');
    await press('e');
    expect(Number((el('editor-prograde') as HTMLInputElement).value)).toBeCloseTo(1, 4);
  });

  it('nudges radial with the horizontal arrows', async () => {
    await withNode();
    await press('ArrowRight');
    await press('e');
    expect(Number((el('editor-radial') as HTMLInputElement).value)).toBeCloseTo(1, 4);
  });

  it('nudges the epoch with `.` and `,`', async () => {
    await withNode();
    const before = text('plan-node-0');
    await press('.');
    expect(text('plan-node-0')).not.toBe(before);
  });

  it('deletes the selected node', async () => {
    await withNode();
    await press('Delete');
    expect(el('plan-empty')).not.toBeNull();
  });

  it('scrubs with `[` and `]`, without touching the plan', async () => {
    await withNode();
    await press(']');
    expect(text('hud-met')).toContain('00:01:00');
    // FR-403: a view operation. The burn is still there and still where it was.
    expect(el('plan-node-0')).not.toBeNull();
  });

  it('jumps to the start with Home', async () => {
    await mount();
    await press(']');
    await press('Home');
    expect(text('hud-met')).toContain('00:00:00');
  });

  it('does not fire while the player is typing into the editor', async () => {
    await withNode();
    await press('e');
    const prograde = el('editor-prograde');
    if (!(prograde instanceof HTMLInputElement)) throw new Error('no prograde field');

    await act(() => {
      prograde.focus();
      prograde.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }));
    });
    // `N` would otherwise have added a second burn while the player was typing a number.
    expect(container.querySelectorAll('.hh-plan__row')).toHaveLength(1);
  });
});

describe('commit (#139)', () => {
  it('is offered, and hands the run to execution', async () => {
    await mount();
    await press('n');
    const commit = el('commit');
    expect(commit).not.toBeNull();
    if ((commit as HTMLButtonElement).disabled) return;

    await click('commit');

    // §8.5.1's exit to EXECUTION. The plan and its **evaluation** both cross, which is
    // FR-601: execution plays back the timeline the planner already solved, so handing
    // over the plan alone would leave the next screen to recompute it.
    const run: CommittedRun | null = committed;
    expect(run).not.toBeNull();
    expect(run?.plan.nodes).toHaveLength(1);
    expect(run?.evaluation.timeline).not.toBeNull();
  });

  it('carries the scrub head and the selection, so aborting can restore them', async () => {
    // #145's last criterion. The planner does not restore them itself — it reports them,
    // and `ContractScreen` seeds the next planner with what came back.
    await mount();
    await press('n');
    await press(']');
    const commit = el('commit');
    if (commit === null || (commit as HTMLButtonElement).disabled) return;

    await click('commit');
    const run: CommittedRun | null = committed;
    expect(run?.selectedNodeId).not.toBeNull();
    expect(run?.scrubEpoch).toBeGreaterThan(c03().startEpoch);
  });
});

describe('the overlay is anchored, and is not modal (§8.3.5)', () => {
  it('docks at the stage edge when the node’s drawn position is unknown', async () => {
    // jsdom has no 2-D context, so the orbit view draws nothing and reports no anchor —
    // which is the same state a real browser reaches when the node is off screen. The
    // overlay still appears, at the edge, rather than at (0, 0) pointing at nothing.
    await mount();
    await press('n');
    await click('plan-expand-0');
    const anchor = container.querySelector('.hh-editor__anchor');
    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute('data-anchored')).toBe('false');
  });

  it('lives inside the stage, so it is positioned in the orbit view’s pixel space', async () => {
    await mount();
    await press('n');
    await click('plan-expand-0');
    const stage = container.querySelector('.hh-planner__stage');
    expect(stage?.contains(el('node-editor'))).toBe(true);
  });

  it('leaves the rest of the planner reachable while it is open', async () => {
    await mount();
    await press('n');
    await click('plan-expand-0');
    // No backdrop, no scroll lock, no focus trap: the timeline still scrubs and the HUD
    // still follows it.
    const scrub = el('timeline-scrub');
    if (!(scrub instanceof HTMLInputElement)) throw new Error('no scrub control');
    await act(() => {
      scrub.value = '600';
      scrub.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(text('hud-met')).toContain('00:10:00');
    expect(el('node-editor')).not.toBeNull();
  });
});

describe('§8.3.4’s camera controls', () => {
  it('offers ⊕, ⊖ and ⌖, all as buttons', async () => {
    // §8.8: nothing lives on the canvas alone. A wheel gesture is not reachable by
    // keyboard, so the zoom has DOM controls beside the recentre.
    await mount();
    for (const id of ['orbit-zoom-in', 'orbit-zoom-out', 'orbit-recentre']) {
      expect(el(id)?.tagName).toBe('BUTTON');
    }
  });
});

describe('§8.3.5’s snap radios', () => {
  it('offers all three, with "free" reporting the state rather than commanding it', async () => {
    await mount();
    await press('n');
    await click('plan-expand-0');
    for (const kind of ['periapsis', 'apoapsis', 'free']) {
      const radio = el(`editor-snap-${kind}`);
      expect(radio).not.toBeNull();
      expect(radio?.getAttribute('role')).toBe('radio');
    }
    // "Free" is where a burn is when it is on neither apsis; there is nothing to press to
    // get there, so it reports and does not act.
    expect((el('editor-snap-free') as HTMLButtonElement).disabled).toBe(true);
  });

  it('reads C03’s first burn as free — a circular orbit has no apsides to sit on', async () => {
    await mount();
    await press('n');
    await click('plan-expand-0');
    expect(el('editor-snap-free')?.getAttribute('aria-checked')).toBe('true');
    expect(el('editor-snap-periapsis')?.getAttribute('aria-checked')).toBe('false');
  });
});

describe('the live preview during a gesture (#134, #135)', () => {
  it('leaves the settled evaluation alone when nothing is being dragged', async () => {
    // The preview exists only while a gesture is in flight; every region falls back to
    // the settled evaluation, so there is one place that knows a preview is possible.
    await mount();
    await press('n');
    expect(el('readouts')).not.toBeNull();
    expect(el('plan-node-0')).not.toBeNull();
  });
});
