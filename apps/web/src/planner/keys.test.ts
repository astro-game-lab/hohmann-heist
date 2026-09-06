/**
 * §8.5.3's map, as a table.
 *
 * `actionFor` is pure, so NFR-016's *"fully operable without a pointer"* is checkable
 * here as twenty assertions over strings rather than as twenty simulated key events
 * against a mounted screen. The wiring — that each action reaches the right store call —
 * is `PlannerScreen.test.tsx`'s; this is that the map itself says what §8.5.3 says.
 */
import { describe, expect, it } from 'vitest';

import {
  BINDINGS,
  EPOCH_NUDGE_SECONDS,
  SCRUB_NUDGE_SECONDS,
  actionFor,
  bindingFor,
  isTypingTarget,
} from './keys.js';

const NONE = { shift: false, ctrl: false };
const SHIFT = { shift: true, ctrl: false };
const CTRL = { shift: false, ctrl: true };

describe('§8.5.3’s planner bindings', () => {
  it('maps the node keys', () => {
    expect(actionFor('planner', 'n', NONE)).toEqual({ kind: 'addNode' });
    expect(actionFor('planner', 'N', NONE)).toEqual({ kind: 'addNode' });
    expect(actionFor('planner', 'Delete', NONE)).toEqual({ kind: 'deleteNode' });
    expect(actionFor('planner', 'Backspace', NONE)).toEqual({ kind: 'deleteNode' });
    expect(actionFor('planner', 'e', NONE)).toEqual({ kind: 'editNode' });
  });

  it('cycles nodes with Tab, backwards with Shift', () => {
    expect(actionFor('planner', 'Tab', NONE)).toEqual({ kind: 'cycleNode', delta: 1 });
    expect(actionFor('planner', 'Tab', SHIFT)).toEqual({ kind: 'cycleNode', delta: -1 });
  });

  it('maps commit and cancel', () => {
    expect(actionFor('planner', 'Enter', NONE)).toEqual({ kind: 'commit' });
    expect(actionFor('planner', 'Escape', NONE)).toEqual({ kind: 'cancel' });
  });

  it('maps the camera keys', () => {
    expect(actionFor('planner', 'f', NONE)).toEqual({ kind: 'recentre' });
    expect(actionFor('planner', '+', NONE)?.kind).toBe('zoom');
    expect(actionFor('planner', '-', NONE)?.kind).toBe('zoom');
    // `=` is the unshifted `+` on most layouts, and a player pressing it means zoom in.
    expect(actionFor('planner', '=', NONE)).toEqual(actionFor('planner', '+', NONE));
  });

  it('returns null for a key it does not own', () => {
    for (const key of ['q', 'F5', 'PageUp', 'z']) {
      expect(actionFor('planner', key, NONE)).toBeNull();
    }
  });
});

describe('the epoch nudge — §8.5.3’s `,` and `.`', () => {
  it('is ∓1 s, a tenth with Shift, a minute with Ctrl', () => {
    expect(EPOCH_NUDGE_SECONDS).toBe(1);
    expect(actionFor('planner', '.', NONE)).toEqual({ kind: 'nudgeEpoch', seconds: 1 });
    expect(actionFor('planner', ',', NONE)).toEqual({ kind: 'nudgeEpoch', seconds: -1 });
    expect(actionFor('planner', '.', SHIFT)).toEqual({ kind: 'nudgeEpoch', seconds: 0.1 });
    // ×60, not ×10: a minute is the coarse step anyone thinks in for an epoch, and
    // §8.5.3's table says so. The Δv map's Ctrl is ×10, which is not an inconsistency.
    expect(actionFor('planner', '.', CTRL)).toEqual({ kind: 'nudgeEpoch', seconds: 60 });
  });
});

describe('the Δv nudges — §8.5.3’s arrows', () => {
  it('puts prograde on the vertical axis and radial on the horizontal', () => {
    expect(actionFor('planner', 'ArrowUp', NONE)).toEqual({
      kind: 'nudgeDeltaV',
      progradeMps: 1,
      radialMps: 0,
    });
    expect(actionFor('planner', 'ArrowDown', NONE)).toEqual({
      kind: 'nudgeDeltaV',
      progradeMps: -1,
      radialMps: 0,
    });
    expect(actionFor('planner', 'ArrowRight', NONE)).toEqual({
      kind: 'nudgeDeltaV',
      progradeMps: 0,
      radialMps: 1,
    });
    expect(actionFor('planner', 'ArrowLeft', NONE)).toEqual({
      kind: 'nudgeDeltaV',
      progradeMps: 0,
      radialMps: -1,
    });
  });

  it('uses the same step rule as §8.3.5’s steppers', () => {
    // One statement of the rule, reached two ways — `deltaVStep` in `@hh/ui`.
    expect(actionFor('planner', 'ArrowUp', SHIFT)?.kind).toBe('nudgeDeltaV');
    expect(actionFor('planner', 'ArrowUp', SHIFT)).toMatchObject({ progradeMps: 0.1 });
    expect(actionFor('planner', 'ArrowUp', CTRL)).toMatchObject({ progradeMps: 10 });
  });
});

describe('the scrub keys — §8.5.3’s `[`, `]`, Home and End', () => {
  it('is ∓1 min with the same modifiers', () => {
    expect(SCRUB_NUDGE_SECONDS).toBe(60);
    expect(actionFor('planner', ']', NONE)).toEqual({ kind: 'scrub', seconds: 60 });
    expect(actionFor('planner', '[', NONE)).toEqual({ kind: 'scrub', seconds: -60 });
    expect(actionFor('planner', ']', SHIFT)).toEqual({ kind: 'scrub', seconds: 6 });
  });

  it('jumps to the start and the deadline', () => {
    expect(actionFor('planner', 'Home', NONE)).toEqual({ kind: 'scrubTo', where: 'start' });
    expect(actionFor('planner', 'End', NONE)).toEqual({ kind: 'scrubTo', where: 'deadline' });
  });
});

describe('bindings do not fire into a field', () => {
  const element = (html: string): HTMLElement => {
    const host = document.createElement('div');
    host.innerHTML = html;
    const child = host.firstElementChild;
    if (!(child instanceof HTMLElement)) throw new Error('expected an element');
    return child;
  };

  it('recognises the editable controls', () => {
    // `,` `.` and `N` are all things a player types into the node editor's number fields.
    for (const html of [
      '<input type="number" />',
      '<textarea></textarea>',
      '<select></select>',
      '<div contenteditable="true"></div>',
      '<div role="textbox"></div>',
    ]) {
      expect(isTypingTarget(element(html))).toBe(true);
    }
  });

  it('leaves everything else alone', () => {
    for (const html of ['<button></button>', '<div></div>', '<canvas></canvas>']) {
      expect(isTypingTarget(element(html))).toBe(false);
    }
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('the map is data, scoped by screen (#141)', () => {
  it('gives every binding a stable id, and no two the same', () => {
    const ids = BINDINGS.map((binding) => binding.id);
    // The id is what #187 stores a remapping against and what #124 lists. Two rows sharing
    // one would make a remapping ambiguous and an overlay entry duplicated.
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every binding at least one key and one screen', () => {
    for (const binding of BINDINGS) {
      expect(binding.keys.length, binding.id).toBeGreaterThan(0);
      expect(binding.screens.length, binding.id).toBeGreaterThan(0);
    }
  });

  it('gives every binding a description for the overlay to render', () => {
    // #124's last criterion: *"the map rendered by the help overlay is the same data the
    // handler runs"*. A row with no description could not be rendered, so the overlay would
    // have to invent one — which is the drift the shared table exists to prevent.
    for (const binding of BINDINGS) {
      expect(binding.descriptionKey, binding.id).toMatch(/^keys\./);
    }
  });

  it('either resolves to an action or names the issue that will make it', () => {
    for (const binding of BINDINGS) {
      // Exactly one of the two. A row with neither is a key that does nothing and says
      // nothing about why; a row with both would claim to be waiting on an issue while
      // already working.
      const resolves = binding.toAction !== undefined;
      const waiting = binding.pending !== undefined;
      expect(resolves !== waiting, binding.id).toBe(true);
      if (waiting) expect(binding.pending, binding.id).toBeGreaterThan(0);
    }
  });

  it('orders a more specific modifier rule before a looser one on the same key', () => {
    // The property, not the instance: `bindingFor` takes the first match, so a row whose
    // rules are a strict superset of an earlier row's could never be reached.
    for (let i = 0; i < BINDINGS.length; i++) {
      for (let j = i + 1; j < BINDINGS.length; j++) {
        const earlier = BINDINGS[i];
        const later = BINDINGS[j];
        if (earlier === undefined || later === undefined) continue;
        const sharesKey = earlier.keys.some((key) => later.keys.includes(key));
        const sharesScreen = earlier.screens.some((screen) => later.screens.includes(screen));
        if (!sharesKey || !sharesScreen) continue;
        // They collide, so the earlier row must be at least as specific: it cannot leave a
        // modifier unconstrained that the later one constrains.
        const looser =
          (earlier.ctrl === undefined && later.ctrl !== undefined) ||
          (earlier.shift === undefined && later.shift !== undefined);
        expect(looser, `${earlier.id} shadows ${later.id}`).toBe(false);
      }
    }
  });
});

describe('scoping (#141)', () => {
  it('gives S to execution and nothing to the planner', () => {
    // The reason the map is scoped at all: one key, two meanings, and a flat table would
    // need a condition somewhere to resolve it.
    expect(actionFor('execution', 's', NONE)).toEqual({ kind: 'skipToEnd' });
    expect(actionFor('planner', 's', NONE)).toBeNull();
  });

  it('gives the planner’s editing keys to no other screen', () => {
    for (const key of ['n', 'Delete', 'e', ',', '.', '[', ']']) {
      expect(actionFor('execution', key, NONE), key).toBeNull();
      expect(actionFor('debrief', key, NONE), key).toBeNull();
    }
  });

  it('gives Escape to every screen, because every screen can be left', () => {
    for (const screen of ['briefing', 'planner', 'execution', 'debrief'] as const) {
      expect(actionFor(screen, 'Escape', NONE), screen).toEqual({ kind: 'cancel' });
    }
  });

  it('maps 1–5 to a speed index during execution only', () => {
    expect(actionFor('execution', '1', NONE)).toEqual({ kind: 'setSpeedIndex', index: 0 });
    expect(actionFor('execution', '5', NONE)).toEqual({ kind: 'setSpeedIndex', index: 4 });
    expect(actionFor('planner', '1', NONE)).toBeNull();
  });

  it('gives R to the debrief', () => {
    expect(actionFor('debrief', 'r', NONE)).toEqual({ kind: 'retry' });
    expect(actionFor('planner', 'r', NONE)).toBeNull();
  });
});

describe('bindings whose features are not built (#141)', () => {
  it('resolves C to nothing, while still listing it', () => {
    // §8.5.3 lists it. It resolves to `null` — indistinguishable from unbound at the call
    // site, so no screen has to know which bindings are waiting on an issue — and remains
    // in `BINDINGS` so #124 can show it and #187 can offer it.
    expect(actionFor('planner', 'c', NONE)).toBeNull();
    expect(bindingFor('planner', 'c', NONE)?.pending).toBe(161);
  });

  it('stops being pending when its feature lands, which is what the marker is for', () => {
    // `?` was pending on #124 until the overlay existed. Its row now carries an action
    // like any other: a pending marker is a promise with an issue number on it, not a
    // permanent state, and this is the assertion that would fail if a row were left
    // marked after its issue closed.
    expect(bindingFor('planner', '?', NONE)?.pending).toBeUndefined();
    expect(actionFor('planner', '?', NONE)).toEqual({ kind: 'help' });
    // On every screen, because §8.5.3 scopes it everywhere.
    for (const screen of ['briefing', 'planner', 'execution', 'debrief'] as const) {
      expect(actionFor(screen, '?', NONE), screen).toEqual({ kind: 'help' });
    }
  });
});
