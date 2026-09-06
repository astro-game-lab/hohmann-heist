/**
 * §8.5.3's keyboard map — the whole game, scoped by screen. FR-405, FR-906, NFR-016 (#141).
 *
 * > *Every action in the game is reachable by keyboard alone. The planner is fully
 * > operable without a pointer.*
 *
 * ## Why this is data, and why that mattered enough to rewrite
 *
 * This was a `switch` over `event.key` returning an action, and §8.3.12 makes every binding
 * remappable. A switch has to be *rewritten* to re-key; a table only has to be re-keyed.
 * #187 is the issue that consumes this and #124 renders it, so the map a player is shown
 * and the map that runs are now the same array rather than two things that agree today.
 *
 * {@link BINDINGS} is that array. Each row carries the keys that trigger it, the screens it
 * applies on, a stable `id` for remapping and for the help overlay, and a resolver from
 * modifiers to an action. The resolver is per row rather than a second switch: §8.5.3 gives
 * the nudges `Shift` for a tenth and `Ctrl` for a coarse step, so *which* action a key means
 * is a table lookup and *how big its step is* is arithmetic on the row that owns it.
 *
 * ## Scoped by screen, because the same key means different things
 *
 * `S` is *skip to end* during execution and nothing in the planner. `Enter` commits a plan
 * and accepts a briefing. A single flat table would have to resolve those collisions with a
 * condition somewhere, which is the switch coming back in another shape. Each row names the
 * screens it lives on and {@link actionFor} takes the screen it is being asked about.
 *
 * ## Nothing here fires while the player is typing
 *
 * The node editor is full of number inputs, and `,` `.` `1` `5` `b` are all things a player
 * types into one. {@link isTypingTarget} is the guard, and it is why handlers are installed
 * on the document rather than per-component: a binding that only worked when focus was
 * nowhere in particular would fail exactly when a keyboard user needed it.
 *
 * ## What is deliberately absent
 *
 * `C` (the Codex, #161) has a row here with `pending` set and resolves to no action. That is
 * not a key that does nothing by accident: #124 and #187 both render this table, and a
 * binding missing from it entirely would be a binding the help overlay could not show and
 * the remapper could not offer. `pending` says "this is §8.5.3's binding, its feature is not
 * built, and here is the issue" in one place instead of in a comment that nothing reads.
 *
 * `?` was the other one until #124 landed; its row now carries an action like any other,
 * which is what the marker is for — a pending row is a promise with an issue number on it,
 * not a permanent state.
 */
import { deltaVStep, type MessageKey } from '@hh/ui';

/** Which screen a binding applies on. §8.5.3's scope, made explicit. */
export type Screen = 'briefing' | 'planner' | 'execution' | 'debrief';

/** What a key press means. Resolved by the screen, never by this module. */
export type PlannerAction =
  | { readonly kind: 'addNode' }
  | { readonly kind: 'deleteNode' }
  | { readonly kind: 'editNode' }
  | { readonly kind: 'cycleNode'; readonly delta: number }
  | { readonly kind: 'nudgeEpoch'; readonly seconds: number }
  | { readonly kind: 'nudgeDeltaV'; readonly progradeMps: number; readonly radialMps: number }
  | { readonly kind: 'scrub'; readonly seconds: number }
  | { readonly kind: 'scrubTo'; readonly where: 'start' | 'deadline' }
  | { readonly kind: 'zoom'; readonly factor: number }
  | { readonly kind: 'recentre' }
  | { readonly kind: 'commit' }
  | { readonly kind: 'cancel' }
  /** FR-110's undo stack — §8.5.3's `Ctrl+Z` and `Ctrl+Shift+Z` (#138). */
  | { readonly kind: 'undo' }
  | { readonly kind: 'redo' }
  /** §8.5.2's context menu on the selected node — #136, and NFR-016's keyboard route to it. */
  | { readonly kind: 'nodeMenu' }
  /** §8.3.3's contract, shown beside the plan — #264. */
  | { readonly kind: 'toggleContract' }
  /**
   * §8.5.3's `?` — the keyboard help overlay (#124).
   *
   * Resolved on every screen and handled by the shell rather than by any of them: the
   * overlay is not a planner feature, and a screen that had to know about it would be a
   * screen that could forget. The per-screen handlers ignore it explicitly.
   */
  | { readonly kind: 'help' }
  // ── Execution, §8.3.8 ──────────────────────────────────────────────────────
  | { readonly kind: 'playPause' }
  | { readonly kind: 'skipToEnd' }
  | { readonly kind: 'setSpeedIndex'; readonly index: number }
  // ── Debrief, §8.3.9 ────────────────────────────────────────────────────────
  | { readonly kind: 'retry' };

export interface Modifiers {
  readonly shift: boolean;
  readonly ctrl: boolean;
}

/**
 * §8.5.3's epoch nudge: ∓1 s, ×0.1 with Shift, ×60 with Ctrl.
 *
 * The Ctrl factor is 60 rather than the Δv map's 10, and that is §8.5.3's own table rather
 * than an inconsistency: a minute is the useful coarse step for an epoch, and ten seconds
 * is not a unit anybody thinks in.
 */
export const EPOCH_NUDGE_SECONDS = 1;

const epochNudge = (modifiers: Modifiers): number => {
  if (modifiers.shift) return EPOCH_NUDGE_SECONDS * 0.1;
  if (modifiers.ctrl) return EPOCH_NUDGE_SECONDS * 60;
  return EPOCH_NUDGE_SECONDS;
};

/** §8.5.3's scrub step: ∓1 min, with the same modifiers as the epoch nudge. */
export const SCRUB_NUDGE_SECONDS = 60;

const scrubNudge = (modifiers: Modifiers): number => {
  if (modifiers.shift) return SCRUB_NUDGE_SECONDS * 0.1;
  if (modifiers.ctrl) return SCRUB_NUDGE_SECONDS * 60;
  return SCRUB_NUDGE_SECONDS;
};

/** One notch of `+`/`-`. Matches the wheel's feel without matching its resolution. */
const KEY_ZOOM_FACTOR = 1.25;

/** Whether a modifier is required, forbidden, or does not decide the match. */
type ModifierRule = 'required' | 'forbidden' | 'any';

export interface Binding {
  /**
   * A stable identity, independent of which key is bound to it.
   *
   * What #187 stores a remapping against and what #124 lists. A key can change; this
   * cannot, which is the whole point of the id existing separately from `keys`.
   */
  readonly id: string;
  /** Every `event.key` that triggers it. Letters appear in both cases — `Shift+Z` is `Z`. */
  readonly keys: readonly string[];
  readonly ctrl?: ModifierRule;
  readonly shift?: ModifierRule;
  readonly screens: readonly Screen[];
  /** The catalogue key describing this binding, for #124's overlay. */
  readonly descriptionKey: MessageKey;
  /**
   * §8.5.3's binding exists; its feature does not yet. The issue number that provides it.
   *
   * A number rather than `'#124'`, because NFR-018's lint rule reads a `#`-prefixed
   * three-digit string as a hex colour — correctly, in general. The number is also the more
   * precise value: it is an issue reference, and the `#` is presentation.
   */
  readonly pending?: number;
  /** Modifiers to an action. Absent exactly when {@link Binding.pending} is set. */
  readonly toAction?: (modifiers: Modifiers) => PlannerAction;
}

const PLANNER: readonly Screen[] = ['planner'];
const EXECUTION: readonly Screen[] = ['execution'];
const EVERYWHERE: readonly Screen[] = ['briefing', 'planner', 'execution', 'debrief'];

/**
 * §8.5.3's table, as data. **The map a player is shown and the map that runs.**
 *
 * Order matters in exactly one way: {@link bindingFor} takes the first row that matches, so
 * a row with a modifier rule must precede a looser row for the same key. `Ctrl+Shift+Z`
 * before `Ctrl+Z` is the only case today, and `keys.test.ts` asserts the property rather
 * than this instance of it.
 */
export const BINDINGS: readonly Binding[] = [
  // Redo before undo: both claim `z` with Ctrl, and the more specific rule has to win.
  {
    id: 'redo',
    keys: ['z', 'Z'],
    ctrl: 'required',
    shift: 'required',
    screens: PLANNER,
    descriptionKey: 'keys.redo',
    toAction: () => ({ kind: 'redo' }),
  },
  {
    id: 'undo',
    keys: ['z', 'Z'],
    ctrl: 'required',
    shift: 'forbidden',
    screens: PLANNER,
    descriptionKey: 'keys.undo',
    toAction: () => ({ kind: 'undo' }),
  },

  // ── The planner (§8.3.4, §8.5.2) ───────────────────────────────────────────────────
  {
    id: 'addNode',
    keys: ['n', 'N'],
    ctrl: 'forbidden',
    screens: PLANNER,
    descriptionKey: 'keys.addNode',
    toAction: () => ({ kind: 'addNode' }),
  },
  {
    id: 'deleteNode',
    keys: ['Delete', 'Backspace'],
    screens: PLANNER,
    descriptionKey: 'keys.deleteNode',
    toAction: () => ({ kind: 'deleteNode' }),
  },
  {
    id: 'editNode',
    keys: ['e', 'E'],
    ctrl: 'forbidden',
    screens: PLANNER,
    descriptionKey: 'keys.editNode',
    toAction: () => ({ kind: 'editNode' }),
  },
  {
    id: 'cycleNode',
    keys: ['Tab'],
    screens: PLANNER,
    descriptionKey: 'keys.cycleNode',
    toAction: (modifiers) => ({ kind: 'cycleNode', delta: modifiers.shift ? -1 : 1 }),
  },
  {
    id: 'nudgeEpochBack',
    keys: [','],
    screens: PLANNER,
    descriptionKey: 'keys.nudgeEpoch',
    toAction: (modifiers) => ({ kind: 'nudgeEpoch', seconds: -epochNudge(modifiers) }),
  },
  {
    id: 'nudgeEpochForward',
    keys: ['.'],
    screens: PLANNER,
    descriptionKey: 'keys.nudgeEpoch',
    toAction: (modifiers) => ({ kind: 'nudgeEpoch', seconds: epochNudge(modifiers) }),
  },
  // `↑`/`↓` prograde, `←`/`→` radial — the keyboard equivalent #135 asks for, and the same
  // step rule the node editor's steppers use.
  {
    id: 'progradeUp',
    keys: ['ArrowUp'],
    screens: PLANNER,
    descriptionKey: 'keys.prograde',
    toAction: (modifiers) => ({
      kind: 'nudgeDeltaV',
      progradeMps: deltaVStep(modifiers),
      radialMps: 0,
    }),
  },
  {
    id: 'progradeDown',
    keys: ['ArrowDown'],
    screens: PLANNER,
    descriptionKey: 'keys.prograde',
    toAction: (modifiers) => ({
      kind: 'nudgeDeltaV',
      progradeMps: -deltaVStep(modifiers),
      radialMps: 0,
    }),
  },
  {
    id: 'radialOut',
    keys: ['ArrowRight'],
    screens: PLANNER,
    descriptionKey: 'keys.radial',
    toAction: (modifiers) => ({
      kind: 'nudgeDeltaV',
      progradeMps: 0,
      radialMps: deltaVStep(modifiers),
    }),
  },
  {
    id: 'radialIn',
    keys: ['ArrowLeft'],
    screens: PLANNER,
    descriptionKey: 'keys.radial',
    toAction: (modifiers) => ({
      kind: 'nudgeDeltaV',
      progradeMps: 0,
      radialMps: -deltaVStep(modifiers),
    }),
  },
  {
    id: 'scrubBack',
    keys: ['['],
    screens: PLANNER,
    descriptionKey: 'keys.scrub',
    toAction: (modifiers) => ({ kind: 'scrub', seconds: -scrubNudge(modifiers) }),
  },
  {
    id: 'scrubForward',
    keys: [']'],
    screens: PLANNER,
    descriptionKey: 'keys.scrub',
    toAction: (modifiers) => ({ kind: 'scrub', seconds: scrubNudge(modifiers) }),
  },
  {
    id: 'scrubToStart',
    keys: ['Home'],
    screens: PLANNER,
    descriptionKey: 'keys.scrubToStart',
    toAction: () => ({ kind: 'scrubTo', where: 'start' }),
  },
  {
    id: 'scrubToDeadline',
    keys: ['End'],
    screens: PLANNER,
    descriptionKey: 'keys.scrubToDeadline',
    toAction: () => ({ kind: 'scrubTo', where: 'deadline' }),
  },
  {
    id: 'zoomIn',
    keys: ['+', '='],
    screens: PLANNER,
    descriptionKey: 'keys.zoom',
    toAction: () => ({ kind: 'zoom', factor: KEY_ZOOM_FACTOR }),
  },
  {
    id: 'zoomOut',
    keys: ['-'],
    screens: PLANNER,
    descriptionKey: 'keys.zoom',
    toAction: () => ({ kind: 'zoom', factor: 1 / KEY_ZOOM_FACTOR }),
  },
  {
    id: 'recentre',
    keys: ['f', 'F'],
    ctrl: 'forbidden',
    screens: PLANNER,
    descriptionKey: 'keys.recentre',
    toAction: () => ({ kind: 'recentre' }),
  },
  {
    id: 'toggleContract',
    keys: ['b', 'B'],
    ctrl: 'forbidden',
    screens: PLANNER,
    descriptionKey: 'keys.toggleContract',
    toAction: () => ({ kind: 'toggleContract' }),
  },
  // §8.5.2's context menu, by keyboard. `ContextMenu` is the dedicated key where a keyboard
  // has one; `Shift+F10` is the binding every desktop platform also accepts and is the one a
  // laptop without the dedicated key can actually press. Both, because §8.8's canvas-parity
  // rule makes this the only keyboard route to "snap to apoapsis" outside the node editor.
  {
    id: 'nodeMenuKey',
    keys: ['ContextMenu'],
    screens: PLANNER,
    descriptionKey: 'keys.nodeMenu',
    toAction: () => ({ kind: 'nodeMenu' }),
  },
  {
    id: 'nodeMenuF10',
    keys: ['F10'],
    shift: 'required',
    screens: PLANNER,
    descriptionKey: 'keys.nodeMenu',
    toAction: () => ({ kind: 'nodeMenu' }),
  },

  // ── Execution (§8.3.8) ─────────────────────────────────────────────────────────────
  {
    id: 'playPause',
    keys: [' ', 'Spacebar'],
    ctrl: 'forbidden',
    screens: EXECUTION,
    descriptionKey: 'keys.playPause',
    toAction: () => ({ kind: 'playPause' }),
  },
  {
    id: 'skipToEnd',
    keys: ['s', 'S'],
    ctrl: 'forbidden',
    screens: EXECUTION,
    descriptionKey: 'keys.skipToEnd',
    toAction: () => ({ kind: 'skipToEnd' }),
  },
  {
    id: 'playbackSpeed',
    keys: ['1', '2', '3', '4', '5'],
    ctrl: 'forbidden',
    screens: EXECUTION,
    descriptionKey: 'keys.playbackSpeed',
    // Five digits share one row rather than getting five near-identical ones: #124 would
    // list five lines saying the same thing and #187 would offer five things to remap. The
    // digit becomes an index in {@link actionFor}, which is the one place a binding's action
    // depends on the key rather than on the modifiers.
    toAction: () => ({ kind: 'setSpeedIndex', index: 0 }),
  },

  // ── Debrief (§8.3.9) ───────────────────────────────────────────────────────────────
  {
    id: 'retry',
    keys: ['r', 'R'],
    ctrl: 'forbidden',
    screens: ['debrief'],
    descriptionKey: 'keys.retry',
    toAction: () => ({ kind: 'retry' }),
  },

  // ── Across screens ─────────────────────────────────────────────────────────────────
  {
    id: 'confirm',
    keys: ['Enter'],
    ctrl: 'forbidden',
    // Shift too, and that is a fix rather than a tightening for its own sake. §8.5.3 lists
    // `Enter`, not `Shift+Enter`; before #187 the briefing rejected every modifier in its
    // own handler while the planner consulted this row, so the two screens disagreed about
    // what `Shift+Enter` meant. Stating it here makes them agree, and leaves `Shift+Enter`
    // to whatever the browser or a future binding wants it for.
    shift: 'forbidden',
    // §8.5.3's one "Commit / confirm" row. The briefing's ACCEPT is the same binding on a
    // different screen, and `Briefing.tsx` resolves it — which is why the row names both.
    screens: ['briefing', 'planner'],
    descriptionKey: 'keys.confirm',
    toAction: () => ({ kind: 'commit' }),
  },
  {
    id: 'cancel',
    keys: ['Escape'],
    screens: EVERYWHERE,
    descriptionKey: 'keys.cancel',
    toAction: () => ({ kind: 'cancel' }),
  },
  {
    id: 'help',
    keys: ['?'],
    screens: EVERYWHERE,
    descriptionKey: 'keys.help',
    toAction: () => ({ kind: 'help' }),
  },
  {
    id: 'codex',
    keys: ['c', 'C'],
    ctrl: 'forbidden',
    screens: EVERYWHERE,
    descriptionKey: 'keys.codex',
    pending: 161,
  },
];

/**
 * A player's rebinds: binding id → the one key that now triggers it (#187).
 *
 * **Sparse.** Only bindings that differ from the default appear, so a changed default
 * reaches a player who never rebound that action — the same rule the rest of the settings
 * follow, and the reason an exported save of a player who rebound one key contains one
 * entry.
 *
 * One key, where a default row may name several (`Delete` and `Backspace`, `1`–`5`). A
 * rebind replaces the row's whole key set: a player who binds "delete node" to `x` means
 * `x`, not `x` as well as `Backspace`. Reset brings the full default set back.
 *
 * The type and its resolution live here rather than in `keymap.ts` because *what this
 * table responds to* is this module's question — `keymap.ts` owns how a player changes it,
 * and one-way imports keep the two from becoming a cycle.
 */
export type Rebinds = Readonly<Record<string, string>>;

/**
 * A letter in both cases, anything else as itself.
 *
 * `event.key` for a shifted `n` is `N`, and §8.5.3 treats them as one binding — the
 * default rows already list `['n', 'N']` for that reason. A rebind stores one of them and
 * has to match both, or half of every letter binding would stop working the moment Caps
 * Lock was on.
 */
export const variantsOf = (key: string): readonly string[] => {
  if (key.length !== 1) return [key];
  const lower = key.toLowerCase();
  const upper = key.toUpperCase();
  return lower === upper ? [key] : [lower, upper];
};

/** Whether a binding has been rebound away from its default keys. */
export const isRebound = (binding: Binding, rebinds: Rebinds): boolean =>
  rebinds[binding.id] !== undefined;

/**
 * The keys a binding responds to right now.
 *
 * The single source both the handler and #124's overlay read, which is what makes *"the
 * map a player is shown and the map that runs"* survive remapping. A rebind naming a
 * binding id this build does not have is simply never asked for.
 */
export const keysFor = (binding: Binding, rebinds: Rebinds): readonly string[] => {
  const rebound = rebinds[binding.id];
  return rebound === undefined ? binding.keys : variantsOf(rebound);
};

/**
 * Whether a key press belongs to whatever the player is typing into.
 *
 * Everything editable, plus `contenteditable`, plus anything that has opted out with
 * `role="textbox"`. Checked structurally rather than by tag name alone so a future component
 * cannot quietly escape it.
 */
export const isTypingTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  // The property *and* the attribute. `isContentEditable` is the correct read in a browser
  // because it inherits, but it is unimplemented in jsdom — where it is always false — so
  // relying on it alone would leave this untested in the one place the planner's tests run.
  // The attribute check is not a workaround for that: it also catches the element that
  // declares it, which is the case worth being sure of.
  if (target.isContentEditable) return true;
  const editable = target.getAttribute('contenteditable');
  if (editable !== null && editable !== 'false') return true;
  if (target.getAttribute('role') === 'textbox') return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
};

const satisfied = (rule: ModifierRule | undefined, held: boolean): boolean => {
  if (rule === 'required') return held;
  if (rule === 'forbidden') return !held;
  return true;
};

/**
 * The binding a key press matches on a screen, or `null`. A pending row still matches.
 *
 * `rebinds` is the player's map (#187), defaulting to empty so a caller that has no reason
 * to care — a test of the default table, the guardrail suite — reads exactly as before.
 * Which keys a row answers to is `keysFor`'s question, not this one's: this module owns
 * the scoping and the modifiers, and `keymap.ts` owns what a rebind means.
 */
export const bindingFor = (
  screen: Screen,
  key: string,
  modifiers: Modifiers,
  rebinds: Rebinds = {},
): Binding | null =>
  BINDINGS.find(
    (binding) =>
      binding.screens.includes(screen) &&
      keysFor(binding, rebinds).includes(key) &&
      satisfied(binding.ctrl, modifiers.ctrl) &&
      satisfied(binding.shift, modifiers.shift),
  ) ?? null;

/**
 * Resolve a key press on a screen to an action, or `null`.
 *
 * Pure, so `keys.test.ts` drives the whole map with plain strings and no DOM at all — which
 * is what makes NFR-016's "fully operable without a pointer" checkable as a table rather
 * than as twenty simulated key events.
 *
 * A **pending** binding resolves to `null`: §8.5.3 lists the key, this table records it, and
 * the feature behind it does not exist yet. That is deliberately indistinguishable from an
 * unbound key at the call site — a screen must not have to know which bindings are waiting
 * on an issue — while staying visible to #124 and #187 through {@link BINDINGS}.
 */
export const actionFor = (
  screen: Screen,
  key: string,
  modifiers: Modifiers,
  rebinds: Rebinds = {},
): PlannerAction | null => {
  const binding = bindingFor(screen, key, modifiers, rebinds);
  if (binding?.toAction === undefined) return null;
  if (binding.id === 'playbackSpeed') {
    const index = Number.parseInt(key, 10) - 1;
    return Number.isNaN(index) ? null : { kind: 'setSpeedIndex', index };
  }
  return binding.toAction(modifiers);
};
