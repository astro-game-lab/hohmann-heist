/**
 * One control per setting kind, generated from the spec table — §8.3.12, §8.8 (#122).
 *
 * Four renderers rather than twenty-one hand-written controls. The table says what each
 * setting is; these say what each *kind* looks like. A setting added to `SETTINGS` gets a
 * control for free, and — the half that matters more — it gets the same keyboard
 * behaviour, the same accessible name, and the same reset affordance as every other one,
 * rather than whatever its author remembered.
 *
 * ## Radios, not a `<select>`, for the enums
 *
 * §8.8 asks for a logical tab order and a screen reader that announces which group a
 * control belongs to. A radio group inside a `<fieldset>` does both natively: arrow keys
 * move within the group, Tab leaves it, and the legend is announced with each option. A
 * `<select>` would be one tab stop and fewer keystrokes, and would hide the available
 * choices behind an interaction — which for the palette control is the one thing a player
 * with a colour-vision difference should not have to do to compare them.
 *
 * ## Every control is a change, immediately
 *
 * `onInput` rather than `onChange`, and no local state anywhere in this file. The value
 * rendered is the value in the settings context; typing into the handle field or dragging
 * the scale slider writes through and comes back as a re-render. There is no dirty state
 * to reconcile because there is no second copy — which is what makes §8.3.12's *"no Save
 * button"* structural rather than a promise.
 */
import type { Catalogue, MessageKey } from '@hh/ui';
import type { JSX } from 'preact';

import { OPTION_LABELS, SETTING_LABELS, SETTING_NOTES, VALUE_LABELS } from './labels.js';
import { SETTINGS, type SettingKey, type SettingSpec, type Settings } from './schema.js';

export interface ControlProps<K extends SettingKey> {
  readonly t: Catalogue['resolve'];
  readonly settingKey: K;
  readonly value: Settings[K];
  readonly onChange: (value: Settings[K]) => void;
  /** Shown but not operable — see `INERT_CONTROLS`. */
  readonly disabled?: boolean;
}

/** The catalogue key naming a setting, and the note under it if it has one. */
const labelOf = (key: SettingKey): MessageKey => SETTING_LABELS[key];
const noteOf = (key: SettingKey): MessageKey | undefined => SETTING_NOTES[key];

/**
 * The note under a control, or nothing.
 *
 * `aria-describedby` rather than a bare paragraph: a note explaining that the theme
 * control does not work yet is not decoration, and a screen-reader user who reached the
 * control without it would be the one person the note was written for.
 */
const Note = ({
  t,
  settingKey,
}: {
  readonly t: Catalogue['resolve'];
  readonly settingKey: SettingKey;
}): JSX.Element | null => {
  const note = noteOf(settingKey);
  return note === undefined ? null : (
    <p class="hh-setting__note" id={`${settingKey}-note`}>
      {t(note, {})}
    </p>
  );
};

const describedBy = (key: SettingKey): string | undefined =>
  noteOf(key) === undefined ? undefined : `${key}-note`;

/** An enum, as a radio group inside its own fieldset. */
export const EnumControl = <K extends SettingKey>({
  t,
  settingKey,
  value,
  onChange,
  disabled,
}: ControlProps<K>): JSX.Element => {
  const spec: SettingSpec = SETTINGS[settingKey];
  const options = spec.kind === 'enum' ? spec.values : [];
  const labels = (OPTION_LABELS as Readonly<Record<string, Readonly<Record<string, MessageKey>>>>)[
    settingKey
  ];

  return (
    <fieldset class="hh-setting hh-setting--enum" data-testid={`setting-${settingKey}`}>
      <legend>{t(labelOf(settingKey), {})}</legend>
      <Note t={t} settingKey={settingKey} />
      <div class="hh-setting__options" aria-describedby={describedBy(settingKey)}>
        {options.map((option) => (
          <label key={option} class="hh-setting__option">
            <input
              type="radio"
              name={settingKey}
              value={option}
              checked={value === option}
              disabled={disabled ?? false}
              onInput={() => {
                onChange(option as Settings[K]);
              }}
            />
            <span>{labels?.[option] === undefined ? option : t(labels[option], {})}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
};

/** A boolean, as a checkbox with its label. */
export const BooleanControl = <K extends SettingKey>({
  t,
  settingKey,
  value,
  onChange,
  disabled,
}: ControlProps<K>): JSX.Element => (
  <div class="hh-setting hh-setting--boolean" data-testid={`setting-${settingKey}`}>
    <label class="hh-setting__label">
      <input
        type="checkbox"
        checked={value === true}
        disabled={disabled ?? false}
        aria-describedby={describedBy(settingKey)}
        onInput={(event) => {
          onChange(event.currentTarget.checked as Settings[K]);
        }}
      />
      <span>{t(labelOf(settingKey), {})}</span>
    </label>
    <Note t={t} settingKey={settingKey} />
  </div>
);

/**
 * A number, as a range with its value beside it.
 *
 * The value is rendered as text as well as being the slider's position, because a slider
 * alone tells a sighted player roughly where they are and tells a screen-reader user
 * whatever the browser decides to announce. `aria-valuetext` carries the same formatted
 * string, so "125%" is announced rather than "125".
 */
export const NumberControl = <K extends SettingKey>({
  t,
  settingKey,
  value,
  onChange,
  disabled,
}: ControlProps<K>): JSX.Element => {
  const spec: SettingSpec = SETTINGS[settingKey];
  const numeric = spec.kind === 'number' ? spec : undefined;
  const valueKey = (VALUE_LABELS as Readonly<Record<string, MessageKey>>)[settingKey];
  const shown =
    valueKey === undefined
      ? String(value)
      : t(valueKey, { percent: Number(value), count: Number(value) });

  return (
    <div class="hh-setting hh-setting--number" data-testid={`setting-${settingKey}`}>
      <label class="hh-setting__label">
        <span>{t(labelOf(settingKey), {})}</span>
        <input
          type="range"
          min={numeric?.min ?? 0}
          max={numeric?.max ?? 100}
          step={numeric?.step ?? 1}
          value={Number(value)}
          disabled={disabled ?? false}
          aria-valuetext={shown}
          aria-describedby={describedBy(settingKey)}
          onInput={(event) => {
            onChange(Number(event.currentTarget.value) as Settings[K]);
          }}
        />
      </label>
      <output class="hh-setting__value" data-testid={`value-${settingKey}`}>
        {shown}
      </output>
      <Note t={t} settingKey={settingKey} />
    </div>
  );
};

/** Text, as a bounded input. */
export const TextControl = <K extends SettingKey>({
  t,
  settingKey,
  value,
  onChange,
  disabled,
}: ControlProps<K>): JSX.Element => {
  const spec: SettingSpec = SETTINGS[settingKey];
  return (
    <div class="hh-setting hh-setting--text" data-testid={`setting-${settingKey}`}>
      <label class="hh-setting__label">
        <span>{t(labelOf(settingKey), {})}</span>
        <input
          type="text"
          value={String(value)}
          maxLength={spec.kind === 'text' ? spec.maxLength : undefined}
          disabled={disabled ?? false}
          aria-describedby={describedBy(settingKey)}
          onInput={(event) => {
            onChange(event.currentTarget.value as Settings[K]);
          }}
        />
      </label>
      <Note t={t} settingKey={settingKey} />
    </div>
  );
};

/** The right control for a setting's kind. */
export const Control = <K extends SettingKey>(props: ControlProps<K>): JSX.Element => {
  const spec: SettingSpec = SETTINGS[props.settingKey];
  switch (spec.kind) {
    case 'enum':
      return <EnumControl {...props} />;
    case 'boolean':
      return <BooleanControl {...props} />;
    case 'number':
      return <NumberControl {...props} />;
    case 'text':
      return <TextControl {...props} />;
  }
};
