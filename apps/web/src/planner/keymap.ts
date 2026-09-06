/**
 * Remapping §8.5.3's table — FR-705, NFR-016, §8.3.12 (#187).
 *
 * > *Keybindings MUST be fully remappable, with conflict detection and
 * > reset-to-default.*
 *
 * This is an accessibility requirement before it is a preference one. A player using one
 * hand, a non-QWERTY layout, or a switch device cannot use a fixed map, and NFR-016's
 * *"every action by keyboard alone"* is worth very little if the keys are unreachable for
 * them.
 *
 * `keys.ts` is already the table rather than a switch, which is what makes this a re-keying
 * rather than a rewrite. This module is the layer over it: what a binding responds to given
 * the player's rebinds, what collides with what, and what may not be captured.
 *
 * ## `event.key`, not `event.code` — and what that costs
 *
 * §8.5.3's map is mnemonic: `N` adds a node, `E` edits one, `F` frames the camera, `S`
 * skips to the end, `B` shows the brief. A mnemonic belongs to **the character printed on
 * the keycap**, and that is `event.key`. `event.code` is a physical position described in
 * terms of where it would be on a US QWERTY board — so on Dvorak, `KeyN` is the key
 * labelled `B`, and a player pressing the key marked `N` to add a node would not get one.
 * For a map whose whole design is "the letter stands for the word", that is the wrong
 * answer.
 *
 * The cost is real and worth stating: a binding captured on one layout is stored as the
 * character that layout produced, so switching layouts afterwards can move it to a
 * different physical key. `event.code` would have the opposite behaviour, keeping the
 * position and changing the letter. Neither is free; this one keeps the mnemonic, keeps
 * the displayed label equal to what the player actually pressed, and is the one a
 * remappable map can recover from — a player whose binding moved can rebind it, and it
 * will be stored as whatever their keyboard now produces.
 *
 * Letters are stored in whichever case arrived and matched in both, because a shifted `n`
 * is `N` and §8.5.3 does not distinguish them. {@link keysFor} is where that happens.
 *
 * ## Conflicts are per scope, because the map reuses keys on purpose
 *
 * `S` is skip-to-end during execution and nothing in the planner; `Enter` commits a plan
 * and accepts a briefing. A global uniqueness check would report false conflicts on
 * §8.5.3's own default map, which is the strongest possible sign that it is the wrong
 * check. Two bindings conflict when they share a screen, share a key, **and** have
 * modifier rules that some single key press could satisfy at once — which is why
 * `Ctrl+Shift+Z` and `Ctrl+Z` are not a conflict: no press is both shifted and unshifted.
 *
 * ## Reserved keys, and why they are the lockout guarantee
 *
 * A key-capture control is a small trap factory. {@link RESERVED_KEYS} is the minimum that
 * makes it exitable: `Escape` leaves capture, `Tab` moves off the control, and `Enter` and
 * `Space` are what activated it — a control that swallowed its own activation key could be
 * entered and never left by keyboard.
 *
 * That is also the whole answer to *"it must be impossible to bind oneself out of reaching
 * the settings screen"*, and the answer is structural rather than a special case: **the
 * settings screen is not reached by a keybinding at all.** It is a link and a URL
 * (`#/settings`), so there is no binding to lose. The reserved set protects the capture
 * control; the routing protects the screen.
 */
import { BINDINGS, keysFor, variantsOf, type Binding, type Rebinds } from './keys.js';

/**
 * What the remapper will not capture.
 *
 * Shown in the UI, because a control that silently ignores four keys is a control that
 * looks broken. See the module docstring for why these four and not more: it is the
 * minimum that keeps the capture affordance exitable by keyboard alone, and every key
 * beyond the minimum is an action a player cannot bind.
 */
export const RESERVED_KEYS: readonly string[] = Object.freeze(['Escape', 'Tab', 'Enter', ' ']);

export const isReservedKey = (key: string): boolean => RESERVED_KEYS.includes(key);

/**
 * Whether a modifier rule pair could both be satisfied by one key press.
 *
 * `Binding['ctrl']` and `Binding['shift']` are the same type, so one of them names it —
 * writing the union of both is a duplicate constituent and says nothing extra.
 */
const rulesCompatible = (a: Binding['ctrl'], b: Binding['ctrl']): boolean =>
  !((a === 'required' && b === 'forbidden') || (a === 'forbidden' && b === 'required'));

/** Whether two bindings could both fire on one press — the conflict test, minus the key. */
const couldCollide = (a: Binding, b: Binding): boolean =>
  a.screens.some((screen) => b.screens.includes(screen)) &&
  rulesCompatible(a.ctrl, b.ctrl) &&
  rulesCompatible(a.shift, b.shift);

/**
 * Which bindings a proposed key would collide with, in the scopes they share.
 *
 * Returns the bindings rather than a boolean, because the player has to be told **what**
 * they are colliding with — a conflict that said only "that key is taken" would send them
 * to read the whole map to find out by what. Nothing is ever bound silently over something
 * else; the caller offers swap or cancel.
 */
export const conflictsFor = (
  bindingId: string,
  key: string,
  rebinds: Rebinds,
): readonly Binding[] => {
  const subject = BINDINGS.find((binding) => binding.id === bindingId);
  if (subject === undefined) return [];
  const wanted = new Set(variantsOf(key));

  return BINDINGS.filter(
    (other) =>
      other.id !== bindingId &&
      couldCollide(subject, other) &&
      keysFor(other, rebinds).some((candidate) => wanted.has(candidate)),
  );
};

/** Bind a key, leaving whatever it collided with alone. The caller has already asked. */
export const withRebind = (rebinds: Rebinds, bindingId: string, key: string): Rebinds => ({
  ...rebinds,
  [bindingId]: key,
});

/**
 * Reset one binding to its **code** default, not to whatever was stored.
 *
 * Removing the entry is what does that, and it is the same sparseness rule as the rest of
 * the settings: the default is not a value, it is the absence of one.
 */
export const withoutRebind = (rebinds: Rebinds, bindingId: string): Rebinds => {
  const out: Record<string, string> = {};
  for (const [id, key] of Object.entries(rebinds)) {
    if (id !== bindingId) out[id] = key;
  }
  return out;
};

/**
 * Give this binding the key, and give the conflicting one the key this had.
 *
 * A true swap rather than "bind mine and unbind theirs", because leaving an action unbound
 * is the outcome a player is least likely to have meant and the one they would notice
 * last. Where this binding was at its default and has several keys, the other takes the
 * first — a single binding cannot hold a set, and the first is the one §8.5.3 lists.
 */
export const withSwap = (
  rebinds: Rebinds,
  bindingId: string,
  key: string,
  conflictId: string,
): Rebinds => {
  const subject = BINDINGS.find((binding) => binding.id === bindingId);
  const surrendered = subject === undefined ? undefined : keysFor(subject, rebinds)[0];
  const next = withRebind(rebinds, bindingId, key);
  return surrendered === undefined ? next : withRebind(next, conflictId, surrendered);
};

/**
 * The catalogue key naming a key that has no printable glyph.
 *
 * Printable characters are rendered as themselves and are deliberately **not** catalogue
 * entries: `,` is `,` in every locale, and a message catalogue that had to carry an entry
 * per glyph would be a table of a hundred identity functions. What does need naming is the
 * keys whose label is a *word* — `Escape`, `Space`, the arrows — because a word is
 * translatable and because `' '` rendered as itself is an empty box.
 *
 * The function keys sit on the printable side of that line despite being multi-character:
 * `F10` is a legend rather than a word, it is `F10` on every keyboard this game runs on,
 * and translating it would produce a label that does not match the key. `keymap.test.ts`
 * states the rule as *"every non-printable key has a name"* with the function keys
 * exempted, so a row that acquires a genuinely nameless key is still caught.
 */
export const KEY_LABEL_KEYS: Readonly<Record<string, string>> = Object.freeze({
  ' ': 'keys.label.space',
  Spacebar: 'keys.label.space',
  Escape: 'keys.label.escape',
  Enter: 'keys.label.enter',
  Tab: 'keys.label.tab',
  Delete: 'keys.label.delete',
  Backspace: 'keys.label.backspace',
  Home: 'keys.label.home',
  End: 'keys.label.end',
  ArrowUp: 'keys.label.arrowUp',
  ArrowDown: 'keys.label.arrowDown',
  ArrowLeft: 'keys.label.arrowLeft',
  ArrowRight: 'keys.label.arrowRight',
  ContextMenu: 'keys.label.contextMenu',
});

/**
 * How a binding's keys read to a player, as parts to be joined by the renderer.
 *
 * Modifiers first, in §8.5.3's own order, then the key. Returned as a structure rather
 * than a string because the renderer puts each part in its own `<kbd>` and because
 * building `"Ctrl+Shift+Z"` here would be the string concatenation FR-910 forbids.
 */
export interface KeyLabel {
  readonly ctrl: boolean;
  readonly shift: boolean;
  /** A catalogue key when the key has a name, otherwise the glyph itself. */
  readonly parts: readonly { readonly messageKey?: string; readonly glyph?: string }[];
}

export const labelFor = (binding: Binding, rebinds: Rebinds): KeyLabel => {
  const keys = keysFor(binding, rebinds);
  // Letter rows list both cases and mean one key, so the label shows one. Everything
  // else — `Delete`/`Backspace`, `1`–`5` — genuinely is several keys and shows them all.
  const distinct = keys.filter(
    (key, index) => keys.findIndex((other) => other.toLowerCase() === key.toLowerCase()) === index,
  );

  return {
    ctrl: binding.ctrl === 'required',
    shift: binding.shift === 'required',
    parts: distinct.map((key) => {
      const messageKey = KEY_LABEL_KEYS[key];
      return messageKey === undefined ? { glyph: key } : { messageKey };
    }),
  };
};
