/**
 * `#/settings` — §8.3.12's six groups — FR-704, FR-705, FR-703, FR-907, FR-908 (#122).
 *
 * The screen, and only the screen. What each control *does* belongs to the issue that owns
 * it — #186 stores, #187 remaps, #185 transfers, #116 paints, #173 stills — and this
 * renders §8.3.12's table against them. Without it, every one of those is a capability the
 * player cannot reach.
 *
 * ## Generated from the table, not written out
 *
 * The groups are a `.map` over `SETTINGS`, which is what makes *"all six groups with every
 * setting in the table"* true by construction: a setting added to the schema appears here,
 * and a control here for a setting that does not exist will not compile. Two settings opt
 * out (`CUSTOM_CONTROLS`) because a bitmask over §6.6's seven assists is not a slider over
 * 0–127, and the keybinding map is a map rather than a value.
 *
 * ## No Save button, and the screen says so
 *
 * Every control writes through the settings context on input, so there is no dirty state
 * and nothing to submit. §8.3.12 asks for that; #122 asks the screen to *say* it, because
 * a player who has been trained by every other settings screen they have ever used will
 * otherwise look for the button and worry when they cannot find it.
 *
 * ## Real fieldsets, real legends
 *
 * §8.8 asks that a screen reader announce which group a control belongs to. A `<fieldset>`
 * with a `<legend>` does that natively and a styled `<div>` with an `<h2>` does not — the
 * grouping would be visual only, which is exactly the failure NFR-017's audit exists to
 * catch.
 */
import type { AssistId } from '@hh/game';
import { ASSIST_IDS, decodeAssists, encodeAssists } from '@hh/game';
import type { Catalogue, MessageKey } from '@hh/ui';
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';

import type { Rebinds } from '../planner/keys.js';
import type { SaveV1 } from '../save/index.js';
import { Control } from './controls.js';
import { DataGroup } from './DataGroup.js';
import { KeybindingsGroup } from './KeybindingsGroup.js';
import {
  CUSTOM_CONTROLS,
  GROUP_LABELS,
  INERT_CONTROLS,
  SETTING_LABELS,
  SETTING_NOTES,
} from './labels.js';
import {
  SETTINGS,
  SETTING_GROUPS,
  SETTING_KEYS,
  type SettingGroup,
  type SettingKey,
  type Settings,
} from './schema.js';

export interface SettingsScreenProps {
  readonly t: Catalogue['resolve'];
  readonly settings: Settings;
  readonly rebinds: Rebinds;
  readonly save: SaveV1;
  readonly onSet: <K extends SettingKey>(key: K, value: Settings[K]) => void;
  readonly onSetRebinds: (rebinds: Rebinds) => void;
  readonly onResetAll: () => void;
  readonly onReplaceSave: (save: SaveV1) => void;
  readonly onClearSave: () => void;
}

/** The catalogue key naming each assist, matching the tray's (#140). */
const ASSIST_NAME_KEYS = {
  elements: 'planner.assists.elements',
  closest_approach: 'planner.assists.closestApproach',
  snapping: 'planner.assists.snapping',
  constraints: 'planner.assists.constraints',
  targeting_computer: 'planner.assists.targetingComputer',
  porkchop: 'planner.assists.porkchop',
  coach_marks: 'planner.assists.coachMarks',
} as const satisfies Record<AssistId, MessageKey>;

/**
 * §8.3.12's "default assist set", as seven checkboxes over one stored bitmask.
 *
 * The mask is `@hh/game`'s own encoding — the one §11.6 records in a replay code — so the
 * setting cannot disagree with the thing it seeds. Rendering it as a slider over 0–127
 * would be technically faithful and useless.
 */
const AssistSetControl = ({
  t,
  mask,
  onChange,
}: {
  readonly t: Catalogue['resolve'];
  readonly mask: number;
  readonly onChange: (mask: number) => void;
}): JSX.Element => {
  // A mask this build cannot read falls back to no assists rather than throwing. It cannot
  // arrive from a control here; it can arrive from a hand-edited file, and `inDomain`
  // already refuses it on the way in, so this is belt to that brace.
  const state = decodeAssists(mask) ?? decodeAssists(0);

  return (
    <fieldset class="hh-setting hh-setting--assists" data-testid="setting-gameplay.assists">
      <legend>{t(SETTING_LABELS['gameplay.assists'], {})}</legend>
      <p class="hh-setting__note">
        {t(SETTING_NOTES['gameplay.assists'] ?? 'settings.assists.hint', {})}
      </p>
      {ASSIST_IDS.map((id) => (
        <label key={id} class="hh-setting__option">
          <input
            type="checkbox"
            checked={state?.[id] === true}
            data-testid={`assist-${id}`}
            onInput={(event) => {
              if (state === undefined) return;
              onChange(encodeAssists({ ...state, [id]: event.currentTarget.checked }));
            }}
          />
          <span>{t(ASSIST_NAME_KEYS[id], {})}</span>
        </label>
      ))}
    </fieldset>
  );
};

/** The settings a group renders through the generic controls. */
const genericKeys = (group: SettingGroup): readonly SettingKey[] =>
  SETTING_KEYS.filter((key) => SETTINGS[key].group === group && !CUSTOM_CONTROLS.includes(key));

export const SettingsScreen = ({
  t,
  settings,
  rebinds,
  save,
  onSet,
  onSetRebinds,
  onResetAll,
  onReplaceSave,
  onClearSave,
}: SettingsScreenProps): JSX.Element => {
  // Reset-all asks first. It destroys no progress — and it does discard a full remap,
  // which for a player who reached this screen because a fixed map was unusable is the
  // most expensive thing on it. The confirmation says which of those two is true, because
  // "reset all settings" beside a Data group that clears saves reads more alarming than it
  // is.
  const [confirmingReset, setConfirmingReset] = useState(false);

  return (
    <div class="hh-settings" data-testid="settings">
      <p class="hh-settings__immediate">{t('settings.immediate', {})}</p>

      {SETTING_GROUPS.map((group) => (
        <fieldset key={group} class="hh-settings__group" data-testid={`settings-group-${group}`}>
          <legend>{t(GROUP_LABELS[group], {})}</legend>

          {group === 'audio' ? (
            <p class="hh-setting__note">{t('settings.audio.note', {})}</p>
          ) : null}

          {genericKeys(group).map((key) => (
            <Control
              key={key}
              t={t}
              settingKey={key}
              value={settings[key]}
              disabled={INERT_CONTROLS.includes(key)}
              onChange={(value) => {
                onSet(key, value);
              }}
            />
          ))}

          {group === 'gameplay' ? (
            <AssistSetControl
              t={t}
              mask={settings['gameplay.assists']}
              onChange={(mask) => {
                onSet('gameplay.assists', mask);
              }}
            />
          ) : null}

          {group === 'input' ? (
            <KeybindingsGroup t={t} rebinds={rebinds} onChange={onSetRebinds} />
          ) : null}

          {group === 'data' ? (
            <DataGroup t={t} save={save} onReplace={onReplaceSave} onClear={onClearSave} />
          ) : null}
        </fieldset>
      ))}

      {confirmingReset ? (
        <div class="hh-settings__reset-all" role="status" data-testid="reset-all-confirm">
          <p>{t('settings.resetAll.confirm', {})}</p>
          <button
            type="button"
            data-testid="reset-all-proceed"
            onClick={() => {
              onResetAll();
              setConfirmingReset(false);
            }}
          >
            {t('settings.resetAll', {})}
          </button>
          <button
            type="button"
            data-testid="reset-all-cancel"
            onClick={() => {
              setConfirmingReset(false);
            }}
          >
            {t('settings.confirm.cancel', {})}
          </button>
        </div>
      ) : (
        <button
          type="button"
          class="hh-settings__reset-all"
          data-testid="reset-all-settings"
          onClick={() => {
            setConfirmingReset(true);
          }}
        >
          {t('settings.resetAll', {})}
        </button>
      )}
    </div>
  );
};
