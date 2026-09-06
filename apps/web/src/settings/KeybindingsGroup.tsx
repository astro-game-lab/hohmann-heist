/**
 * §8.3.12's Input group — the remapper — FR-705, NFR-016 (#187).
 *
 * `keymap.ts` decides what a rebind means, what collides with what, and what may not be
 * captured. This is the affordance over it, and almost all of its difficulty is in one
 * place: **a key-capture control is where a keyboard trap gets built by accident.**
 *
 * ## How this one cannot trap
 *
 * Three things, and none of them is "we were careful":
 *
 * - **Capture is a mode on a button, not a modal.** Pressing the button arms it; the next
 *   key press disarms it either way. There is no state in which the control is waiting and
 *   the player has no way to stop waiting.
 * - **The reserved keys are never captured.** `Escape` cancels, `Tab` moves on, and
 *   `Enter`/`Space` are what armed the control — a control that swallowed its own
 *   activation key could be entered and never left. They are listed in the group's own
 *   text, because a control that silently ignores four keys looks broken.
 * - **Nothing here calls `preventDefault` on `Tab`.** A player who tabs out has left, and
 *   the capture disarms behind them.
 *
 * The separate question — *"it must be impossible to bind oneself out of reaching the
 * settings screen"* — is answered structurally and is not this component's doing: Settings
 * is reached by a link and a URL, never by a binding, so there is no binding to lose.
 *
 * ## A conflict is a question, not a refusal
 *
 * §8.5.3 reuses keys across scopes deliberately, so a same-scope collision is a real
 * choice rather than an error: the player may well have meant to move both. The conflict
 * names the action it collided with — "that key already does X" — and offers swap or
 * cancel. Nothing is ever bound silently over something else.
 */
import type { Catalogue, MessageKey } from '@hh/ui';
import type { JSX } from 'preact';
import { useState } from 'preact/hooks';

import { BINDINGS, isRebound, type Binding, type Rebinds, type Screen } from '../planner/keys.js';
import {
  KEY_LABEL_KEYS,
  conflictsFor,
  isReservedKey,
  labelFor,
  withRebind,
  withSwap,
  withoutRebind,
} from '../planner/keymap.js';

export interface KeybindingsGroupProps {
  readonly t: Catalogue['resolve'];
  readonly rebinds: Rebinds;
  readonly onChange: (rebinds: Rebinds) => void;
}

/** §8.5.3's scopes, in the order the map is read. */
const SCOPES: readonly Screen[] = ['planner', 'execution', 'briefing', 'debrief'];

const SCOPE_LABELS = {
  briefing: 'settings.bindings.scope.briefing',
  planner: 'settings.bindings.scope.planner',
  execution: 'settings.bindings.scope.execution',
  debrief: 'settings.bindings.scope.debrief',
} as const satisfies Record<Screen, MessageKey>;

/**
 * Which section a binding is listed under.
 *
 * A binding on every screen is listed once under "Everywhere" rather than four times: the
 * map has twenty-four rows and repeating `Esc` in each section would make it read as four
 * different bindings that happen to share a key, which is the opposite of what the
 * scoping means.
 */
const sectionOf = (binding: Binding): Screen | 'everywhere' =>
  binding.screens.length === SCOPES.length ? 'everywhere' : (binding.screens[0] ?? 'planner');

/** The key label, rendered as `<kbd>` per part. */
export const KeyLabel = ({
  t,
  binding,
  rebinds,
}: {
  readonly t: Catalogue['resolve'];
  readonly binding: Binding;
  readonly rebinds: Rebinds;
}): JSX.Element => {
  const label = labelFor(binding, rebinds);
  return (
    <span class="hh-keys">
      {label.ctrl ? <kbd>{t('keys.label.ctrl', {})}</kbd> : null}
      {label.shift ? <kbd>{t('keys.label.shift', {})}</kbd> : null}
      {label.parts.map((part, index) => (
        // Index-keyed because the parts are positional and have no identity of their own —
        // two rows of the same binding can legitimately show the same glyph.
        <kbd key={index}>{part.messageKey === undefined ? part.glyph : t(part.messageKey, {})}</kbd>
      ))}
    </span>
  );
};

/** What the component is waiting for, if anything. */
interface Capture {
  readonly bindingId: string;
  /** A key that collided, held until the player answers swap-or-cancel. */
  readonly pending?: { readonly key: string; readonly conflict: Binding };
  /** Set when the last press was a reserved key. */
  readonly rejected?: boolean;
}

export const KeybindingsGroup = ({ t, rebinds, onChange }: KeybindingsGroupProps): JSX.Element => {
  const [capture, setCapture] = useState<Capture | null>(null);

  const onKeyDown = (event: KeyboardEvent, bindingId: string): void => {
    // Escape leaves capture without binding anything — and must reach the browser as an
    // ordinary Escape if capture is not armed, so the surrounding screen can act on it.
    if (event.key === 'Escape') {
      event.preventDefault();
      setCapture(null);
      return;
    }
    // Tab is how a keyboard user leaves the control. Deliberately not intercepted.
    if (event.key === 'Tab') {
      setCapture(null);
      return;
    }
    if (isReservedKey(event.key)) {
      event.preventDefault();
      setCapture({ bindingId, rejected: true });
      return;
    }

    event.preventDefault();
    const conflicts = conflictsFor(bindingId, event.key, rebinds);
    const conflict = conflicts[0];
    if (conflict === undefined) {
      onChange(withRebind(rebinds, bindingId, event.key));
      setCapture(null);
      return;
    }
    setCapture({ bindingId, pending: { key: event.key, conflict } });
  };

  const rows = (section: Screen | 'everywhere'): readonly Binding[] =>
    BINDINGS.filter((binding) => sectionOf(binding) === section);

  const sections: readonly (Screen | 'everywhere')[] = [...SCOPES, 'everywhere'];

  return (
    <>
      {/*
        The Input group holds pointer sensitivity and invert-scroll-zoom as well as the
        map, so the map gets a heading of its own rather than running on from them. `h3`
        because the group's legend is the level above and each scope's heading is below.
      */}
      <h3 class="hh-bindings__heading">{t('settings.bindings.label', {})}</h3>
      <p class="hh-setting__note">{t('settings.bindings.reserved', {})}</p>

      {sections.map((section) => {
        const bindings = rows(section);
        if (bindings.length === 0) return null;
        return (
          <section key={section} class="hh-bindings__scope">
            <h3>
              {t(
                section === 'everywhere'
                  ? 'settings.bindings.scope.everywhere'
                  : SCOPE_LABELS[section],
                {},
              )}
            </h3>
            <ul class="hh-bindings">
              {bindings.map((binding) => {
                const capturing = capture?.bindingId === binding.id;
                const pending = capturing ? capture.pending : undefined;
                const action = t(binding.descriptionKey, {});

                return (
                  <li key={binding.id} class="hh-binding" data-testid={`binding-${binding.id}`}>
                    <span class="hh-binding__action">
                      {action}
                      {binding.pending === undefined ? null : (
                        <span class="hh-binding__pending">
                          {t('settings.bindings.pending', {})}
                        </span>
                      )}
                    </span>

                    <KeyLabel t={t} binding={binding} rebinds={rebinds} />

                    <button
                      type="button"
                      class="hh-binding__capture"
                      aria-label={t('settings.bindings.change', { action })}
                      aria-pressed={capturing}
                      data-testid={`capture-${binding.id}`}
                      onClick={() => {
                        setCapture(capturing ? null : { bindingId: binding.id });
                      }}
                      onKeyDown={(event) => {
                        // Only while armed. Otherwise Enter and Space must reach the
                        // button and activate it, which is how capture starts.
                        if (capturing) onKeyDown(event, binding.id);
                      }}
                    >
                      {t(
                        capturing ? 'settings.bindings.capturing' : 'settings.bindings.changeShort',
                        {},
                      )}
                    </button>

                    {isRebound(binding, rebinds) ? (
                      <button
                        type="button"
                        class="hh-binding__reset"
                        aria-label={t('settings.bindings.resetOne', { action })}
                        data-testid={`reset-${binding.id}`}
                        onClick={() => {
                          onChange(withoutRebind(rebinds, binding.id));
                        }}
                      >
                        {t('settings.reset', {})}
                      </button>
                    ) : null}

                    {capturing && capture.rejected === true ? (
                      <p class="hh-binding__message" role="status">
                        {t('settings.bindings.rejected', {})}
                      </p>
                    ) : null}

                    {pending === undefined ? null : (
                      <div class="hh-binding__conflict" role="status">
                        <p>
                          {t('settings.bindings.conflict', {
                            action: t(pending.conflict.descriptionKey, {}),
                          })}
                        </p>
                        <button
                          type="button"
                          data-testid={`swap-${binding.id}`}
                          onClick={() => {
                            onChange(
                              withSwap(rebinds, binding.id, pending.key, pending.conflict.id),
                            );
                            setCapture(null);
                          }}
                        >
                          {t('settings.bindings.swap', {})}
                        </button>
                        <button
                          type="button"
                          data-testid={`cancel-${binding.id}`}
                          onClick={() => {
                            setCapture(null);
                          }}
                        >
                          {t('settings.bindings.cancel', {})}
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      <button
        type="button"
        class="hh-bindings__reset-all"
        data-testid="reset-all-bindings"
        onClick={() => {
          onChange({});
        }}
      >
        {t('settings.bindings.resetAll', {})}
      </button>
    </>
  );
};

/** Re-exported so the help overlay renders the same `<kbd>` markup this group does. */
export { KEY_LABEL_KEYS };
