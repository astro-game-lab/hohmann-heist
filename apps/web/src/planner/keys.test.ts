/**
 * §8.5.3's map, as a table.
 *
 * `actionFor` is pure, so NFR-016's *"fully operable without a pointer"* is checkable
 * here as twenty assertions over strings rather than as twenty simulated key events
 * against a mounted screen. The wiring — that each action reaches the right store call —
 * is `PlannerScreen.test.tsx`'s; this is that the map itself says what §8.5.3 says.
 */
import { describe, expect, it } from 'vitest';

import { EPOCH_NUDGE_SECONDS, SCRUB_NUDGE_SECONDS, actionFor, isTypingTarget } from './keys.js';

const NONE = { shift: false, ctrl: false };
const SHIFT = { shift: true, ctrl: false };
const CTRL = { shift: false, ctrl: true };

describe('§8.5.3’s planner bindings', () => {
  it('maps the node keys', () => {
    expect(actionFor('n', NONE)).toEqual({ kind: 'addNode' });
    expect(actionFor('N', NONE)).toEqual({ kind: 'addNode' });
    expect(actionFor('Delete', NONE)).toEqual({ kind: 'deleteNode' });
    expect(actionFor('Backspace', NONE)).toEqual({ kind: 'deleteNode' });
    expect(actionFor('e', NONE)).toEqual({ kind: 'editNode' });
  });

  it('cycles nodes with Tab, backwards with Shift', () => {
    expect(actionFor('Tab', NONE)).toEqual({ kind: 'cycleNode', delta: 1 });
    expect(actionFor('Tab', SHIFT)).toEqual({ kind: 'cycleNode', delta: -1 });
  });

  it('maps commit and cancel', () => {
    expect(actionFor('Enter', NONE)).toEqual({ kind: 'commit' });
    expect(actionFor('Escape', NONE)).toEqual({ kind: 'cancel' });
  });

  it('maps the camera keys', () => {
    expect(actionFor('f', NONE)).toEqual({ kind: 'recentre' });
    expect(actionFor('+', NONE)?.kind).toBe('zoom');
    expect(actionFor('-', NONE)?.kind).toBe('zoom');
    // `=` is the unshifted `+` on most layouts, and a player pressing it means zoom in.
    expect(actionFor('=', NONE)).toEqual(actionFor('+', NONE));
  });

  it('returns null for a key it does not own', () => {
    for (const key of ['q', 'F5', 'PageUp', 'z']) {
      expect(actionFor(key, NONE)).toBeNull();
    }
  });
});

describe('the epoch nudge — §8.5.3’s `,` and `.`', () => {
  it('is ∓1 s, a tenth with Shift, a minute with Ctrl', () => {
    expect(EPOCH_NUDGE_SECONDS).toBe(1);
    expect(actionFor('.', NONE)).toEqual({ kind: 'nudgeEpoch', seconds: 1 });
    expect(actionFor(',', NONE)).toEqual({ kind: 'nudgeEpoch', seconds: -1 });
    expect(actionFor('.', SHIFT)).toEqual({ kind: 'nudgeEpoch', seconds: 0.1 });
    // ×60, not ×10: a minute is the coarse step anyone thinks in for an epoch, and
    // §8.5.3's table says so. The Δv map's Ctrl is ×10, which is not an inconsistency.
    expect(actionFor('.', CTRL)).toEqual({ kind: 'nudgeEpoch', seconds: 60 });
  });
});

describe('the Δv nudges — §8.5.3’s arrows', () => {
  it('puts prograde on the vertical axis and radial on the horizontal', () => {
    expect(actionFor('ArrowUp', NONE)).toEqual({
      kind: 'nudgeDeltaV',
      progradeMps: 1,
      radialMps: 0,
    });
    expect(actionFor('ArrowDown', NONE)).toEqual({
      kind: 'nudgeDeltaV',
      progradeMps: -1,
      radialMps: 0,
    });
    expect(actionFor('ArrowRight', NONE)).toEqual({
      kind: 'nudgeDeltaV',
      progradeMps: 0,
      radialMps: 1,
    });
    expect(actionFor('ArrowLeft', NONE)).toEqual({
      kind: 'nudgeDeltaV',
      progradeMps: 0,
      radialMps: -1,
    });
  });

  it('uses the same step rule as §8.3.5’s steppers', () => {
    // One statement of the rule, reached two ways — `deltaVStep` in `@hh/ui`.
    expect(actionFor('ArrowUp', SHIFT)?.kind).toBe('nudgeDeltaV');
    expect(actionFor('ArrowUp', SHIFT)).toMatchObject({ progradeMps: 0.1 });
    expect(actionFor('ArrowUp', CTRL)).toMatchObject({ progradeMps: 10 });
  });
});

describe('the scrub keys — §8.5.3’s `[`, `]`, Home and End', () => {
  it('is ∓1 min with the same modifiers', () => {
    expect(SCRUB_NUDGE_SECONDS).toBe(60);
    expect(actionFor(']', NONE)).toEqual({ kind: 'scrub', seconds: 60 });
    expect(actionFor('[', NONE)).toEqual({ kind: 'scrub', seconds: -60 });
    expect(actionFor(']', SHIFT)).toEqual({ kind: 'scrub', seconds: 6 });
  });

  it('jumps to the start and the deadline', () => {
    expect(actionFor('Home', NONE)).toEqual({ kind: 'scrubTo', where: 'start' });
    expect(actionFor('End', NONE)).toEqual({ kind: 'scrubTo', where: 'deadline' });
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
