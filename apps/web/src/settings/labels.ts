/**
 * What each setting is called, and what each of its values is called — §8.3.12 (#122).
 *
 * Separate from `schema.ts` because the two answer to different things. The spec table is
 * the *storage* contract: what may be stored, what the default is, what validates. This is
 * the *presentation* contract: what a player reads. Keeping them apart means the screen
 * can be relabelled without touching what a save holds, and a setting can be added to the
 * schema — as audio was, for a consumer that does not exist yet — without the label table
 * pretending it is renderable.
 *
 * ## Why the maps are exhaustive by type
 *
 * `satisfies Record<SettingKey, MessageKey>` is what makes this checkable: a setting added
 * to `SETTINGS` with no label here is a compile error, and a label for a setting that does
 * not exist is one too. Without it, #122's *"every setting in the table"* would be a claim
 * somebody has to re-verify by reading two files side by side.
 *
 * The option maps are keyed by the setting's own value union for the same reason —
 * §8.3.12 gains a fourth theme and the compiler asks what it is called.
 */
import type { MessageKey } from '@hh/ui';

import type { SettingKey, SettingGroup } from './schema.js';

/** The heading for each of §8.3.12's six groups. */
export const GROUP_LABELS = {
  display: 'settings.group.display',
  accessibility: 'settings.group.accessibility',
  gameplay: 'settings.group.gameplay',
  audio: 'settings.group.audio',
  input: 'settings.group.input',
  data: 'settings.group.data',
} as const satisfies Record<SettingGroup, MessageKey>;

/** One label per setting. */
export const SETTING_LABELS = {
  'display.units': 'settings.units.label',
  'display.angles': 'settings.angles.label',
  'display.timeFormat': 'settings.timeFormat.label',
  'display.theme': 'settings.theme.label',
  'display.uiScale': 'settings.uiScale.label',
  'accessibility.palette': 'settings.palette.label',
  'accessibility.reduceMotion': 'settings.reduceMotion.label',
  'accessibility.backgroundAnimation': 'settings.backgroundAnimation.label',
  'accessibility.lineWeights': 'settings.lineWeights.label',
  'accessibility.verbosity': 'settings.verbosity.label',
  'gameplay.assists': 'settings.assists.label',
  'gameplay.confirmCommit': 'settings.confirmCommit.label',
  'gameplay.autoSkipAfter': 'settings.autoSkipAfter.label',
  'audio.master': 'settings.audioMaster.label',
  'audio.effects': 'settings.audioEffects.label',
  'audio.ambience': 'settings.audioAmbience.label',
  'audio.muted': 'settings.audioMuted.label',
  'input.pointerSensitivity': 'settings.pointerSensitivity.label',
  'input.invertScrollZoom': 'settings.invertScrollZoom.label',
  'data.handle': 'settings.handle.label',
} as const satisfies Record<SettingKey, MessageKey>;

/**
 * The honest note a group or a control carries when it is stored and inert.
 *
 * §8.3.12's own requirement, via #122: a group with no consumer is *"either shown with an
 * honest note or deferred"* and **never shown as working when it is not**. Three of them
 * qualify at M3 and each says why in its own words rather than sharing a generic "coming
 * soon", because the reasons differ and a player deciding whether to bother has to know
 * which one applies.
 */
export const SETTING_NOTES: Partial<Record<SettingKey, MessageKey>> = {
  'display.theme': 'settings.theme.note',
  'gameplay.assists': 'settings.assists.hint',
  'data.handle': 'settings.handle.note',
};

/** What each value of each enum setting is called. */
export const OPTION_LABELS = {
  'display.units': { metric: 'settings.units.metric', si: 'settings.units.si' },
  'display.angles': {
    degrees: 'settings.angles.degrees',
    radians: 'settings.angles.radians',
  },
  'display.timeFormat': {
    met: 'settings.timeFormat.met',
    tai: 'settings.timeFormat.tai',
  },
  'display.theme': {
    dark: 'settings.theme.dark',
    light: 'settings.theme.light',
    system: 'settings.theme.system',
  },
  'accessibility.palette': {
    default: 'settings.palette.default',
    deuteranopia: 'settings.palette.deuteranopia',
    protanopia: 'settings.palette.protanopia',
    tritanopia: 'settings.palette.tritanopia',
    'high-contrast': 'settings.palette.highContrast',
  },
  'accessibility.reduceMotion': {
    system: 'settings.reduceMotion.system',
    on: 'settings.reduceMotion.on',
    off: 'settings.reduceMotion.off',
  },
  'accessibility.verbosity': {
    terse: 'settings.verbosity.terse',
    verbose: 'settings.verbosity.verbose',
  },
} as const satisfies Readonly<Record<string, Readonly<Record<string, MessageKey>>>>;

/**
 * How a number setting's current value reads.
 *
 * A percentage for most of them, because most of them *are* percentages; the auto-skip
 * count is a number of attempts and says so, including the `0` case, which reads "Never"
 * rather than "0 attempts". That branch lives in the message rather than here — the
 * catalogue is where a language decides how a count is phrased.
 */
export const VALUE_LABELS = {
  'display.uiScale': 'settings.uiScale.value',
  'gameplay.autoSkipAfter': 'settings.autoSkipAfter.value',
  'audio.master': 'settings.percent.value',
  'audio.effects': 'settings.percent.value',
  'audio.ambience': 'settings.percent.value',
  'input.pointerSensitivity': 'settings.percent.value',
} as const satisfies Readonly<Record<string, MessageKey>>;

/**
 * Settings whose control is not generated from the table.
 *
 * Two, and both for a reason the generic renderers could not absorb. The assist set is a
 * bitmask over §6.6's seven assists and renders as seven checkboxes, not one slider over
 * 0–127. Keybindings are a map rather than a value and have a group section of their own.
 *
 * Named here rather than checked inline in the screen, so the exception is one list a
 * reader can find rather than a condition inside a `.map`.
 */
export const CUSTOM_CONTROLS: readonly SettingKey[] = ['gameplay.assists'];

/**
 * Settings whose control is shown but cannot be operated yet.
 *
 * The theme, whose light and system values need palettes §9.2 does not have. Disabled
 * rather than hidden, with {@link SETTING_NOTES} saying why: hiding it would make §8.3.12
 * silently incomplete, and enabling it would be a control that does nothing.
 */
export const INERT_CONTROLS: readonly SettingKey[] = ['display.theme'];
