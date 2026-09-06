/**
 * §8.3.12's settings, as a spec table — FR-704, FR-701, §11.7 (#186).
 *
 * > *All settings in §8.3.12 MUST persist and apply immediately without reload.*
 *
 * Before this, `SaveV1.settings` was `Record<string, SettingValue>` — a deliberate hole in
 * an otherwise strictly validated document, left for this issue. A stringly-typed bag
 * collects typos that survive a round trip: `"reduceMotion": "yes"` is a legal value of
 * that type, stores cleanly, exports cleanly, and means nothing to the consumer that
 * reads it.
 *
 * ## Why a table and not an interface
 *
 * The obvious shape is an interface with one field per setting and a `DEFAULTS` object
 * beside it. It types the values and nothing else, and this file has four jobs rather
 * than one:
 *
 * - **Validate.** An unknown key is dropped and an out-of-range value falls back to its
 *   default, and *neither makes the save unreadable* — a bad setting must never cost a
 *   player their progress. That needs a domain per key at runtime, not just at compile
 *   time.
 * - **Render.** #122's screen is a `.map` over {@link SETTINGS} rather than twenty-four
 *   hand-written controls, which is what makes "every setting in §8.3.12 is represented"
 *   true by construction. A group that gains a setting gains a control for free, and one
 *   that gains a control it has no storage for does not compile.
 * - **Store sparsely.** See below.
 * - **Reset.** Per setting and for the whole screen, to the *code* default rather than to
 *   whatever happened to be stored.
 *
 * So each row carries its key, its group, its kind, its domain, its default, and the
 * catalogue keys that name it. {@link Settings} is derived from the table, so the type and
 * the runtime domain cannot disagree — there is one declaration.
 *
 * ## A default is not a stored value
 *
 * An unset setting stores **nothing** and reads its default. Two consequences, both
 * deliberate and both easy to lose by storing the resolved record instead:
 *
 * - Changing a default in a later build reaches every player who never touched that
 *   setting. Storing defaults on first run would freeze today's choices into every save
 *   ever written, and the only way to change one afterwards would be a migration.
 * - An export does not pin defaults into the file. A save exported by a player who
 *   changed one setting contains one entry, which is diffable and legible — §11.7 offers
 *   this file as the thing the player carries, and a player may open it.
 *
 * {@link withSetting} is what maintains that: assigning a value equal to the default
 * *removes* the key rather than writing it.
 *
 * ## Migration
 *
 * Settings live in the same versioned document as the rest of the save, so **adding** a
 * setting later is a default appearing on an existing version and needs no migration.
 * **Changing the meaning** of an existing key does — a key whose domain changes, or whose
 * values are reinterpreted, has to be renamed or migrated, because a stored value written
 * against the old meaning is indistinguishable from one written against the new. Rename
 * it; a new key with a new default is free and a migration is not.
 */
import { ASSIST_IDS, decodeAssists, defaultAssistState, encodeAssists } from '@hh/game';
import { DEFAULT_PALETTE_ID, PALETTE_IDS } from '@hh/ui';

import { DEFAULT_MOTION_PREFERENCE } from '../motion.js';

/** §8.3.12's six groups, in the order the screen shows them. */
export const SETTING_GROUPS = [
  'display',
  'accessibility',
  'gameplay',
  'audio',
  'input',
  'data',
] as const;

export type SettingGroup = (typeof SETTING_GROUPS)[number];

/**
 * What one setting is.
 *
 * A discriminated union rather than one shape with optional `values`/`min`/`max`, so a
 * control cannot ask an enum for its maximum and a validator cannot check a boolean
 * against a range. `#122` switches on `kind` exactly once, to pick a control.
 */
export type SettingSpec =
  | {
      readonly kind: 'enum';
      readonly group: SettingGroup;
      /** The permitted values, in the order the control offers them. */
      readonly values: readonly string[];
      readonly default: string;
    }
  | {
      readonly kind: 'boolean';
      readonly group: SettingGroup;
      readonly default: boolean;
    }
  | {
      readonly kind: 'number';
      readonly group: SettingGroup;
      readonly min: number;
      readonly max: number;
      /** The control's granularity. Also what a stored value is rounded to. */
      readonly step: number;
      readonly default: number;
    }
  | {
      readonly kind: 'text';
      readonly group: SettingGroup;
      readonly maxLength: number;
      readonly default: string;
    };

/**
 * §8.3.12's table, as data.
 *
 * Keys are `group.name`, which is redundant with the `group` field and worth it: a key is
 * what appears in an exported save, and `"palette": "deuteranopia"` in a flat namespace
 * would eventually collide with something. The prefix also makes the file readable to the
 * player who opens it, which §11.7 invites them to do.
 *
 * Every setting in §8.3.12 is here, **including those whose consumer lands in another
 * issue** — audio is stored and inert until M4, the handle has nowhere to submit until
 * M7, and pointer sensitivity has no reader yet. That is the correct direction to be
 * wrong in: a stored value with no consumer costs one line, where a group that appears in
 * a later release and cannot restore what the player already chose costs their setting.
 */
export const SETTINGS = {
  // ── Display ────────────────────────────────────────────────────────────────
  /** §8.3.12: metric km/m·s⁻¹ **default**, or SI-only for P2. */
  'display.units': {
    kind: 'enum',
    group: 'display',
    values: ['metric', 'si'],
    default: 'metric',
  },
  'display.angles': {
    kind: 'enum',
    group: 'display',
    values: ['degrees', 'radians'],
    default: 'degrees',
  },
  /**
   * How an absolute epoch reads. Mission elapsed time is the game's own clock and is
   * always `T+HH:MM:SS`; this is the *other* column, and `tai` is spelled out rather than
   * called "UTC" because the simulation has no leap seconds and labelling TAI as UTC
   * would be a lie the rest of the codebase is careful not to tell.
   */
  'display.timeFormat': {
    kind: 'enum',
    group: 'display',
    values: ['met', 'tai'],
    default: 'met',
  },
  /**
   * §8.3.12's dark **default** / light / system.
   *
   * **Stored, published, and inert at M3** — the control is shown with an honest note,
   * the same treatment Audio gets. §9.2's five palettes are all dark: a light theme is not
   * a switch, it is five more palettes and the §8.8 contrast matrix that validates them,
   * which is `@hh/ui`'s work and not this issue's. `settings/document.ts` already publishes
   * `data-theme`, so the day those palettes land the stylesheet is already wired and a
   * player who chose `light` today gets it then rather than finding their choice was
   * discarded.
   */
  'display.theme': {
    kind: 'enum',
    group: 'display',
    values: ['dark', 'light', 'system'],
    default: 'dark',
  },
  /** §8.3.12's 90–150%. Stored as a percentage because that is what the control shows. */
  'display.uiScale': {
    kind: 'number',
    group: 'display',
    min: 90,
    max: 150,
    step: 5,
    default: 100,
  },

  // ── Accessibility ──────────────────────────────────────────────────────────
  'accessibility.palette': {
    kind: 'enum',
    group: 'accessibility',
    values: PALETTE_IDS,
    default: DEFAULT_PALETTE_ID,
  },
  /**
   * Three states, not two — `motion.ts` has the argument in full. A player must be able
   * to say **on** despite a system that does not ask for it, and **off** despite one that
   * does, and a boolean can only express the second.
   */
  'accessibility.reduceMotion': {
    kind: 'enum',
    group: 'accessibility',
    values: ['system', 'on', 'off'],
    default: DEFAULT_MOTION_PREFERENCE,
  },
  'accessibility.backgroundAnimation': {
    kind: 'boolean',
    group: 'accessibility',
    default: true,
  },
  'accessibility.lineWeights': {
    kind: 'boolean',
    group: 'accessibility',
    default: false,
  },
  'accessibility.verbosity': {
    kind: 'enum',
    group: 'accessibility',
    values: ['terse', 'verbose'],
    default: 'terse',
  },

  // ── Gameplay ───────────────────────────────────────────────────────────────
  /**
   * §8.3.12's "default assist set", stored as §11.6's bitmask.
   *
   * A number rather than seven booleans, because `@hh/game` already owns the encoding and
   * its bit order is frozen — `encodeAssists`/`decodeAssists` are what a replay code uses,
   * so reusing them means the setting cannot disagree with the thing it seeds. The domain
   * check is `decodeAssists` returning a state rather than a range: a mask with bits this
   * build does not know is refused, exactly as it is in a replay.
   */
  'gameplay.assists': {
    kind: 'number',
    group: 'gameplay',
    min: 0,
    max: (1 << ASSIST_IDS.length) - 1,
    step: 1,
    default: encodeAssists(defaultAssistState()),
  },
  // `gameplay.coachMarks` was here, and it was a second flag for a switch that already
  // existed. #159 says it plainly: coach marks are *"a setting (§8.3.12's Gameplay group)
  // and an assist (§6.6), which are the same flag seen twice; they must not become two"* —
  // and they had. `gameplay.assists` bit 6 is the `coach_marks` assist, it is what the
  // planner's tray toggles, it is what the planner reads, and §8.3.12's assist-set control
  // already renders it as one of its seven checkboxes.
  //
  // The bit wins rather than the boolean because §11.6 freezes the mask's order: a replay
  // code records it, so it cannot move. Removing a key from this table costs no migration —
  // settings are sparse and `parseStoredSettings` drops what it does not recognise — so a
  // save written by an earlier build simply forgets a value that never had a second reader.
  'gameplay.confirmCommit': {
    kind: 'boolean',
    group: 'gameplay',
    default: false,
  },
  /**
   * §8.3.12's "auto-skip playback after N attempts". `0` is never, which is the default:
   * skipping a run the player has not asked to skip removes the thing execution is for.
   */
  'gameplay.autoSkipAfter': {
    kind: 'number',
    group: 'gameplay',
    min: 0,
    max: 20,
    step: 1,
    default: 0,
  },

  // ── Audio ──────────────────────────────────────────────────────────────────
  //
  // Stored and inert until M4. §8.3.12 asks for "a modest level" and for muted on first
  // load until the player interacts, which is the browser autoplay policy rather than a
  // preference — so the levels default to something audible and `audio.muted` defaults to
  // true. When playback lands, unmuting is a first-interaction concern and these numbers
  // are already whatever the player chose.
  'audio.master': { kind: 'number', group: 'audio', min: 0, max: 100, step: 5, default: 70 },
  'audio.effects': { kind: 'number', group: 'audio', min: 0, max: 100, step: 5, default: 70 },
  'audio.ambience': { kind: 'number', group: 'audio', min: 0, max: 100, step: 5, default: 40 },
  'audio.muted': { kind: 'boolean', group: 'audio', default: true },

  // ── Input ──────────────────────────────────────────────────────────────────
  //
  // The keybinding map is not here: it is a sparse map rather than a scalar, and it lives
  // beside the settings in `StoredSettings` under its own key. See `planner/keymap.ts`.
  'input.pointerSensitivity': {
    kind: 'number',
    group: 'input',
    min: 25,
    max: 200,
    step: 5,
    default: 100,
  },
  'input.invertScrollZoom': { kind: 'boolean', group: 'input', default: false },

  // ── Data ───────────────────────────────────────────────────────────────────
  /**
   * The leaderboard handle (FR-801), which is M7.
   *
   * Present, stored, and honestly labelled — §8.3.12 lists it and #122 permits either
   * that or a stated deferral. Stored wins: there is nothing to submit to yet, and a
   * player who picks a handle now should still have it when there is.
   */
  'data.handle': { kind: 'text', group: 'data', maxLength: 24, default: '' },
} as const satisfies Readonly<Record<string, SettingSpec>>;

/** Every setting's key. */
export type SettingKey = keyof typeof SETTINGS;

export const SETTING_KEYS = Object.keys(SETTINGS) as readonly SettingKey[];

/**
 * The value a setting holds, derived from its row.
 *
 * This is what makes the table the single declaration: `Settings['display.theme']` is
 * `'dark' | 'light' | 'system'` because the row says so, and adding a fourth theme to the
 * row is what makes the compiler ask the consumers about it.
 */
export type Settings = {
  readonly [K in SettingKey]: (typeof SETTINGS)[K] extends { readonly values: infer V }
    ? V extends readonly (infer T)[]
      ? T
      : never
    : (typeof SETTINGS)[K] extends { readonly kind: 'boolean' }
      ? boolean
      : (typeof SETTINGS)[K] extends { readonly kind: 'number' }
        ? number
        : string;
};

/** A stored settings value, before it has been resolved against its domain. */
export type SettingValue = string | number | boolean;

/**
 * What the save actually holds: only what differs from a default, plus the rebinds.
 *
 * `keybindings` sits beside the scalar settings rather than inside them because it is a
 * map, not a value — #187 stores `binding id → key` and only for bindings the player
 * changed. Same sparseness rule, same reason: a changed default binding should reach a
 * player who never rebound that action.
 */
export interface StoredSettings extends Partial<Settings> {
  readonly keybindings?: Readonly<Record<string, string>>;
}

/** Nothing chosen. What a first-time player has, and what "reset all" restores. */
export const emptySettings = (): StoredSettings => ({});

/** A setting's declared default, as the value it resolves to. */
export const defaultOf = <K extends SettingKey>(key: K): Settings[K] =>
  SETTINGS[key].default as Settings[K];

/**
 * Whether a value is inside a setting's domain.
 *
 * Total over the kinds, and deliberately strict about numbers: `NaN`, `Infinity` and a
 * value off the step grid are all out of domain. A UI scale of 103% would render, but it
 * is not a value any control here can produce, so it arrived from a hand-edited file and
 * the honest answer is to fall back to the default rather than to honour it.
 */
export const inDomain = (key: SettingKey, value: unknown): boolean => {
  const spec: SettingSpec = SETTINGS[key];
  switch (spec.kind) {
    case 'enum':
      return typeof value === 'string' && spec.values.includes(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return false;
      if (value < spec.min || value > spec.max) return false;
      // The assist mask is a bitmask rather than a quantity, and its "step" is 1 by
      // arithmetic rather than by design; `decodeAssists` is the real domain and it
      // rejects a mask carrying bits this build does not know.
      if (key === 'gameplay.assists') return decodeAssists(value) !== undefined;
      const offset = value - spec.min;
      return Math.abs(offset / spec.step - Math.round(offset / spec.step)) < 1e-9;
    }
    case 'text':
      return typeof value === 'string' && value.length <= spec.maxLength;
  }
};

const isSettingKey = (key: string): key is SettingKey =>
  Object.prototype.hasOwnProperty.call(SETTINGS, key);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Read a stored settings object — **never fails**.
 *
 * FR-701's whole point is that a save is the player's progress, and a settings block is
 * the least important thing in it. An unknown key is dropped, a value outside its domain
 * is dropped so the default applies, and a `settings` that is not an object at all is
 * dropped entirely. None of those makes the save unreadable, which is the property
 * `schema.test.ts` states three times because it is the one worth being sure of: a typo
 * in a hand-edited settings block must not cost somebody their medals.
 *
 * Rebuilt key by key rather than spread, for the same reason `parseContract` is: a
 * document carrying extra properties must not smuggle them into the save and back out
 * through an export.
 */
export const parseStoredSettings = (value: unknown): StoredSettings => {
  if (!isRecord(value)) return {};

  const out: Record<string, SettingValue> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!isSettingKey(key)) continue;
    if (!inDomain(key, raw)) continue;
    out[key] = raw as SettingValue;
  }

  const keybindings = parseKeybindings(value['keybindings']);
  if (Object.keys(keybindings).length > 0) out['keybindings'] = keybindings as never;
  return out;
};

/**
 * The rebind map, filtered to entries this build can act on.
 *
 * Only shape is checked here — that a key is a string and a value is a non-empty string.
 * Whether the binding id exists and whether the key conflicts with another are
 * `planner/keymap.ts`'s questions, and they need the binding table this module must not
 * depend on. A rebind naming an action that no longer exists is inert rather than
 * invalid: it stays in the file, costs nothing, and would come back if the action did.
 */
const parseKeybindings = (value: unknown): Readonly<Record<string, string>> => {
  if (!isRecord(value)) return {};
  const out: Record<string, string> = {};
  for (const [id, key] of Object.entries(value)) {
    if (typeof key !== 'string' || key.length === 0) continue;
    out[id] = key;
  }
  return out;
};

/**
 * Stored settings, resolved to a total record.
 *
 * What every consumer reads. There is no "unset" below this line — a component asking for
 * `settings['display.units']` gets a value, always, and never has to know whether it came
 * from the player or from the table.
 */
export const resolveSettings = (stored: StoredSettings): Settings => {
  const out: Record<string, SettingValue> = {};
  for (const key of SETTING_KEYS) {
    const value = (stored as Record<string, unknown>)[key];
    out[key] = (inDomain(key, value) ? value : SETTINGS[key].default) as SettingValue;
  }
  return out as Settings;
};

/**
 * Set one setting, sparsely.
 *
 * A value equal to the default **removes** the key — see "A default is not a stored
 * value" above. An out-of-domain value is refused rather than clamped: every caller is a
 * control built from the same table, so a value outside the domain is a bug rather than a
 * player's input, and clamping would hide it.
 */
export const withSetting = <K extends SettingKey>(
  stored: StoredSettings,
  key: K,
  value: Settings[K],
): StoredSettings => {
  if (!inDomain(key, value)) return stored;
  const next = without(stored, key);
  if (value === SETTINGS[key].default) return next;
  return { ...next, [key]: value };
};

/**
 * A copy without one key.
 *
 * Spelled as a rebuild rather than as `const { [key]: _drop, ...rest }`, which is the
 * idiom this would otherwise use: the discarded binding is an unused variable, and the
 * lint rule that says so is right in general — a name bound to nothing is usually a
 * mistake. Widening the rule for one idiom would cost more than writing the loop.
 */
const without = (stored: StoredSettings, key: string): StoredSettings => {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(stored)) {
    if (name !== key) out[name] = value;
  }
  return out;
};

/** Reset one setting to its code default. */
export const withoutSetting = (stored: StoredSettings, key: SettingKey): StoredSettings =>
  without(stored, key);

/** Replace the rebind map, dropping it entirely when nothing differs from the default. */
export const withKeybindings = (
  stored: StoredSettings,
  keybindings: Readonly<Record<string, string>>,
): StoredSettings => {
  const rest = without(stored, 'keybindings');
  return Object.keys(keybindings).length === 0 ? rest : { ...rest, keybindings };
};
