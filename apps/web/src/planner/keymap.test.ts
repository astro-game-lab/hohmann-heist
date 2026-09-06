/**
 * #187's gate.
 *
 * The two assertions worth reading first are the ones a naive implementation gets wrong in
 * opposite directions: a **global** uniqueness check reports conflicts on §8.5.3's own
 * default map, and a check that ignored modifiers reports `Ctrl+Shift+Z` as colliding with
 * `Ctrl+Z`. Both are covered by name below, and the default map being conflict-free is
 * asserted as a property of the whole table rather than of the rows that happen to exist
 * today.
 */
import { describe, expect, it } from 'vitest';

import { BINDINGS, actionFor, keysFor, isRebound, variantsOf, type Rebinds } from './keys.js';
import {
  KEY_LABEL_KEYS,
  RESERVED_KEYS,
  conflictsFor,
  isReservedKey,
  labelFor,
  withRebind,
  withSwap,
  withoutRebind,
} from './keymap.js';

const bindingById = (id: string) => {
  const binding = BINDINGS.find((candidate) => candidate.id === id);
  if (binding === undefined) throw new Error(`no binding ${id}`);
  return binding;
};

describe('the rebindable set', () => {
  /**
   * #187: *"a test asserts the rebindable set equals the map's action set, so an action
   * added later cannot silently be unbindable."*
   *
   * Every row in `BINDINGS` is rebindable, including the `pending` ones — that is the
   * point of them being in the table at all. If a row were ever excluded, this is what
   * would say so.
   */
  it('is every row in §8.5.3s table, pending rows included', () => {
    const rebindable = BINDINGS.filter((binding) => keysFor(binding, {}).length > 0);
    expect(rebindable.map((binding) => binding.id)).toStrictEqual(
      BINDINGS.map((binding) => binding.id),
    );
    // This used to end by asserting that at least one row *was* pending, so that the
    // "pending rows included" clause could not pass vacuously. #161 closed the last one,
    // so that guard now asserts the absence of a state nothing is in. The clause it was
    // guarding is unconditional — every row, whatever its state — and a pending row added
    // later is covered by it without the guard being restored.
    expect(rebindable.length).toBe(BINDINGS.length);
  });

  it('gives every binding a distinct id, since a rebind is stored against it', () => {
    const ids = BINDINGS.map((binding) => binding.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('conflict detection', () => {
  /**
   * The check that would fail if it were global.
   *
   * `S` is skip-to-end during execution and nothing in the planner; `Enter` commits in the
   * planner and accepts in the briefing. §8.5.3 reuses keys across scopes deliberately, so
   * a map that reported these would be reporting its own defaults.
   */
  it('accepts a legitimate cross-scope reuse', () => {
    // `recentre` is planner-only. Giving it `s`, which execution uses for skip-to-end, is
    // not a conflict: no screen has both.
    expect(conflictsFor('recentre', 's', {})).toStrictEqual([]);
    // And the reverse.
    expect(conflictsFor('skipToEnd', 'f', {})).toStrictEqual([]);
  });

  it('reports a same-scope collision, and names what it collided with', () => {
    // `addNode` and `editNode` are both planner bindings.
    const conflicts = conflictsFor('addNode', 'e', {});
    expect(conflicts.map((binding) => binding.id)).toStrictEqual(['editNode']);
  });

  it('matches a letter in either case', () => {
    expect(conflictsFor('addNode', 'E', {}).map((b) => b.id)).toStrictEqual(['editNode']);
  });

  it('does not report bindings no single press could satisfy at once', () => {
    // `Ctrl+Shift+Z` and `Ctrl+Z` share a key and a screen, and are not a conflict: one
    // requires Shift and the other forbids it.
    expect(conflictsFor('redo', 'z', {})).toStrictEqual([]);
    expect(conflictsFor('undo', 'z', {})).toStrictEqual([]);
  });

  it('reports a collision against a key the other binding was itself rebound to', () => {
    // The conflict set has to be computed against the *current* map, not the defaults —
    // otherwise a player who moved one binding could stack a second one on top of it.
    const rebinds: Rebinds = { editNode: 'q' };
    expect(conflictsFor('addNode', 'q', rebinds).map((b) => b.id)).toStrictEqual(['editNode']);
    // And `e`, which `editNode` has vacated, is now free.
    expect(conflictsFor('addNode', 'e', rebinds)).toStrictEqual([]);
  });

  /**
   * The whole default map, checked against itself.
   *
   * A property rather than a list, so a row added later is covered without anyone
   * remembering to extend this test — which is the same reason `keys.test.ts` asserts the
   * ordering rule rather than the one instance of it that exists today.
   */
  it('finds no conflict anywhere in the default map', () => {
    for (const binding of BINDINGS) {
      for (const key of binding.keys) {
        const conflicts = conflictsFor(binding.id, key, {});
        expect(
          conflicts.map((other) => other.id),
          `${binding.id} on "${key}"`,
        ).toStrictEqual([]);
      }
    }
  });

  it('answers nothing for a binding id it does not have', () => {
    expect(conflictsFor('noSuchBinding', 'k', {})).toStrictEqual([]);
  });
});

describe('binding, resetting and swapping', () => {
  it('takes effect through the same resolver the handler runs', () => {
    expect(actionFor('planner', 'n', { shift: false, ctrl: false })).toMatchObject({
      kind: 'addNode',
    });
    const rebinds = withRebind({}, 'addNode', 'k');
    expect(actionFor('planner', 'k', { shift: false, ctrl: false }, rebinds)).toMatchObject({
      kind: 'addNode',
    });
    // And the default key stops working, because a rebind replaces the row's key set.
    expect(actionFor('planner', 'n', { shift: false, ctrl: false }, rebinds)).toBeNull();
  });

  it('matches a rebound letter in both cases', () => {
    const rebinds = withRebind({}, 'addNode', 'k');
    expect(actionFor('planner', 'K', { shift: true, ctrl: false }, rebinds)).toMatchObject({
      kind: 'addNode',
    });
  });

  it('resets to the code default rather than to what was stored', () => {
    const rebinds = withRebind(withRebind({}, 'addNode', 'k'), 'editNode', 'j');
    const reset = withoutRebind(rebinds, 'addNode');
    expect(reset).toStrictEqual({ editNode: 'j' });
    expect(keysFor(bindingById('addNode'), reset)).toStrictEqual(['n', 'N']);
    expect(isRebound(bindingById('addNode'), reset)).toBe(false);
    expect(isRebound(bindingById('editNode'), reset)).toBe(true);
  });

  it('stores only what differs from the default — one rebind, one entry', () => {
    expect(Object.keys(withRebind({}, 'addNode', 'k'))).toStrictEqual(['addNode']);
    expect(withoutRebind(withRebind({}, 'addNode', 'k'), 'addNode')).toStrictEqual({});
  });

  it('swaps rather than leaving the other action unbound', () => {
    const swapped = withSwap({}, 'addNode', 'e', 'editNode');
    expect(swapped).toStrictEqual({ addNode: 'e', editNode: 'n' });

    // Both still resolve, which is the property the swap exists for.
    expect(actionFor('planner', 'e', { shift: false, ctrl: false }, swapped)).toMatchObject({
      kind: 'addNode',
    });
    expect(actionFor('planner', 'n', { shift: false, ctrl: false }, swapped)).toMatchObject({
      kind: 'editNode',
    });
  });
});

describe('the reserved keys', () => {
  it('are the four that keep the capture control exitable, and no more', () => {
    expect([...RESERVED_KEYS]).toStrictEqual(['Escape', 'Tab', 'Enter', ' ']);
    for (const key of RESERVED_KEYS) expect(isReservedKey(key)).toBe(true);
    expect(isReservedKey('k')).toBe(false);
    expect(isReservedKey('F1')).toBe(false);
  });

  /**
   * The lockout guarantee, stated as a test.
   *
   * Reaching Settings is a link and a URL, never a binding — so there is no binding whose
   * loss could strand a player. This asserts the half that lives in code: nothing in
   * §8.5.3's table claims to open Settings.
   */
  it('leaves no binding that opening Settings depends on', () => {
    expect(BINDINGS.some((binding) => binding.id.toLowerCase().includes('settings'))).toBe(false);
  });
});

describe('labels', () => {
  it('shows one key for a letter row and every key for a genuine multi-key row', () => {
    // Upper case: what §8.5.3 prints, and what is on the keycap.
    expect(labelFor(bindingById('addNode'), {}).parts).toStrictEqual([{ glyph: 'N' }]);
    expect(labelFor(bindingById('deleteNode'), {}).parts).toStrictEqual([
      { messageKey: 'keys.label.delete' },
      { messageKey: 'keys.label.backspace' },
    ]);
  });

  it('carries the modifiers a row requires, and not the ones it merely tolerates', () => {
    expect(labelFor(bindingById('redo'), {})).toMatchObject({ ctrl: true, shift: true });
    expect(labelFor(bindingById('undo'), {})).toMatchObject({ ctrl: true, shift: false });
    // `addNode` forbids Ctrl; forbidding is not requiring, and the label must not show it.
    expect(labelFor(bindingById('addNode'), {})).toMatchObject({ ctrl: false, shift: false });
  });

  it('shows what the player pressed after a rebind, not the default', () => {
    const label = labelFor(bindingById('addNode'), withRebind({}, 'addNode', 'k'));
    expect(label.parts).toStrictEqual([{ glyph: 'K' }]);
  });

  it('shows one key where the table lists two spellings of the same one', () => {
    // `playPause` is `[' ', 'Spacebar']` — one key, and the second is the legacy name
    // older engines send. Both resolve to the same label, and the row must not read
    // "Space Space". Found by looking at the built page.
    expect(labelFor(bindingById('playPause'), {}).parts).toStrictEqual([
      { messageKey: 'keys.label.space' },
    ]);
    // A row that genuinely names several keys still shows all of them.
    expect(labelFor(bindingById('playbackSpeed'), {}).parts).toStrictEqual([
      { glyph: '1' },
      { glyph: '2' },
      { glyph: '3' },
      { glyph: '4' },
      { glyph: '5' },
    ]);
  });

  it('leaves a punctuation key exactly as it is', () => {
    expect(labelFor(bindingById('nudgeEpochBack'), {}).parts).toStrictEqual([{ glyph: ',' }]);
    expect(labelFor(bindingById('zoomIn'), {}).parts).toStrictEqual([
      { glyph: '+' },
      { glyph: '=' },
    ]);
  });

  it('names every key in the default map that has no printable glyph', () => {
    // A function key is a legend, not a word: `F10` reads as `F10` on every keyboard, so
    // it renders as itself like `,` does. Everything else multi-character is a word and
    // needs a catalogue entry — see `KEY_LABEL_KEYS`.
    const isFunctionKey = (key: string): boolean => /^F\d{1,2}$/.test(key);

    for (const binding of BINDINGS) {
      for (const key of binding.keys) {
        if (key.length === 1 || isFunctionKey(key)) continue;
        expect(KEY_LABEL_KEYS[key], `${binding.id} uses "${key}"`).toBeDefined();
      }
    }
  });
});

describe('key variants', () => {
  it('pairs a letter with its other case and leaves everything else alone', () => {
    expect(variantsOf('n')).toStrictEqual(['n', 'N']);
    expect(variantsOf('N')).toStrictEqual(['n', 'N']);
    expect(variantsOf(',')).toStrictEqual([',']);
    expect(variantsOf('ArrowUp')).toStrictEqual(['ArrowUp']);
    expect(variantsOf(' ')).toStrictEqual([' ']);
  });
});
