/**
 * One settings context, so "applies immediately" is a re-render — FR-704 (#186).
 *
 * > *All settings in §8.3.12 MUST persist and apply immediately without reload.*
 *
 * The tempting shape is a broadcast: something publishes "the palette changed" and every
 * interested component subscribes. That is how a setting comes to apply in four places
 * out of five — the fifth forgot to subscribe, and nothing says so, because a missing
 * subscription looks exactly like a component that does not care.
 *
 * A context inverts it. A consumer reads the value it needs; changing the value
 * re-renders every reader by construction, and a component that reads a setting *cannot*
 * fail to be one. "Apply immediately" is then not a mechanism anybody has to maintain —
 * it is what rendering already does.
 *
 * ## Why the provider does not own the save
 *
 * `app.tsx` owns the save, because the save is more than settings and because the write
 * outcome is what #184's notice renders. This takes the stored block and a callback, so
 * that the one place a `localStorage` write happens stays the one place — and so that a
 * test can drive the whole settings screen with a plain object and no storage at all.
 *
 * ## The default value is real settings, not `undefined`
 *
 * A context with no provider hands back resolved defaults and setters that do nothing. A
 * component rendered on its own in a test therefore behaves exactly as it does for a
 * player who has changed nothing, rather than throwing or reading `undefined` — which is
 * what makes it reasonable for a deeply nested readout to call {@link useSetting} without
 * every test that renders it having to wrap it.
 */
import { createContext, type ComponentChildren, type JSX } from 'preact';
import { useContext, useMemo } from 'preact/hooks';

import {
  emptySettings,
  resolveSettings,
  withKeybindings,
  withSetting,
  withoutSetting,
  type SettingKey,
  type Settings,
  type StoredSettings,
} from './schema.js';

export interface SettingsApi {
  /** Every setting, resolved. There is no "unset" on this side of the context. */
  readonly settings: Settings;
  /** What is actually stored — sparse. What the Data group exports and resets. */
  readonly stored: StoredSettings;
  readonly set: <K extends SettingKey>(key: K, value: Settings[K]) => void;
  /** Back to the code default, which is not the same as back to what was stored. */
  readonly reset: (key: SettingKey) => void;
  readonly resetAll: () => void;
  /** #187's sparse rebind map, replaced whole. */
  readonly setKeybindings: (keybindings: Readonly<Record<string, string>>) => void;
}

const noop = (): void => undefined;

const DEFAULTS: SettingsApi = Object.freeze({
  settings: resolveSettings(emptySettings()),
  stored: emptySettings(),
  set: noop,
  reset: noop,
  resetAll: noop,
  setKeybindings: noop,
});

const SettingsContext = createContext<SettingsApi>(DEFAULTS);

export interface SettingsProviderProps {
  readonly stored: StoredSettings;
  /** Called with the whole new stored block. The caller persists it. */
  readonly onChange: (stored: StoredSettings) => void;
  readonly children?: ComponentChildren;
}

export const SettingsProvider = ({
  stored,
  onChange,
  children,
}: SettingsProviderProps): JSX.Element => {
  // Memoised on the stored block rather than rebuilt every render: the value is a
  // dependency of every consumer's effects, and a fresh object each time would re-run the
  // effect that repaints the palette on every render of anything above it.
  const api = useMemo<SettingsApi>(
    () => ({
      settings: resolveSettings(stored),
      stored,
      set: (key, value) => {
        onChange(withSetting(stored, key, value));
      },
      reset: (key) => {
        onChange(withoutSetting(stored, key));
      },
      // Reset-all drops the rebinds too. §8.3.12 has one Input group and one reset for
      // it; a "reset everything except your keyboard" would be a surprise, and #187's
      // per-map reset is the narrower tool for someone who wants only that.
      resetAll: () => {
        onChange(emptySettings());
      },
      setKeybindings: (keybindings) => {
        onChange(withKeybindings(stored, keybindings));
      },
    }),
    [stored, onChange],
  );

  return <SettingsContext.Provider value={api}>{children}</SettingsContext.Provider>;
};

/** The whole settings API. What the settings screen and the Data group use. */
export const useSettings = (): SettingsApi => useContext(SettingsContext);

/**
 * One setting's value.
 *
 * The common read, spelled so a consumer names exactly what it depends on. A component
 * reading `useSetting('display.units')` is documented by its own call, which is the
 * property that makes #186's *"no component reads `localStorage` or `matchMedia` directly
 * for a setting that exists here"* checkable by grep.
 */
export const useSetting = <K extends SettingKey>(key: K): Settings[K] =>
  useContext(SettingsContext).settings[key];
