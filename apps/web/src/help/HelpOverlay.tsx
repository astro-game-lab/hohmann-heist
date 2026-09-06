/**
 * §8.5.3's map, on `?` — the keyboard help overlay — §8.8, NFR-016, NFR-017 (#124).
 *
 * The game has twenty-four bindings and NFR-016 makes them the only guaranteed way to do
 * everything. A map nobody can see is a map nobody uses.
 *
 * ## It renders the live keymap, and that is the whole design
 *
 * Not a hand-written table: `BINDINGS` is the array the handler runs, and once #187 made
 * bindings remappable a printed cheat sheet would be wrong the moment a player rebound
 * anything. The overlay reads the same array through the same `keysFor` the resolver uses,
 * so it cannot drift from what the keys do — a binding shown here is a binding that fires,
 * and a binding that fires is shown here.
 *
 * That is also why it is ordered rather than filtered. Every scope is listed, with the
 * **current** screen's first, so a player in the planner reads the bindings they can use
 * before the ones they cannot. Hiding the others would be a different lie: `S` does
 * nothing in the planner, and a player who tried it deserves to find out why.
 *
 * ## A dialog, and it behaves like one
 *
 * Focus moves in on open, is trapped while open, `Esc` closes it, and focus returns to
 * whatever opened it — §8.8's rule, which #169 will test this overlay against. All four
 * come from `useOverlay`, shared with the settings overlay rather than written twice.
 *
 * ## It never pauses or mutates anything
 *
 * Opening it during planning does not touch the plan; opening it during execution neither
 * pauses playback nor advances it. That is not enforced here — it is enforced by the two
 * screen handlers returning on the `help` action *before* their `preventDefault`, so
 * nothing in either screen ever acts on the key.
 *
 * ## Remapping is not here
 *
 * §8.3.12 puts remapping in Settings, and two places to rebind is one too many. A link is
 * enough.
 */
import type { Catalogue } from '@hh/ui';
import type { JSX } from 'preact';

import { useOverlay } from '../a11y/overlay.js';
import { BINDINGS, keysFor, type Binding, type Rebinds, type Screen } from '../planner/keys.js';
import { KeyLabel } from '../settings/KeybindingsGroup.js';

export interface HelpOverlayProps {
  readonly t: Catalogue['resolve'];
  readonly rebinds: Rebinds;
  /** The scope showing, or null outside a contract — see `planner/scope.ts`. */
  readonly scope: Screen | null;
  readonly onClose: () => void;
}

/** §8.5.3's scopes, in the order the map is read when none is current. */
const SCOPES: readonly Screen[] = ['planner', 'execution', 'briefing', 'debrief'];

const SCOPE_LABELS = {
  briefing: 'settings.bindings.scope.briefing',
  planner: 'settings.bindings.scope.planner',
  execution: 'settings.bindings.scope.execution',
  debrief: 'settings.bindings.scope.debrief',
} as const;

type Section = Screen | 'everywhere';

/**
 * Which section a binding is listed under.
 *
 * A binding on every screen is listed once under "Everywhere" rather than four times — the
 * map has twenty-four rows, and repeating `Esc` in each section would make it read as four
 * different bindings that happen to share a key.
 */
const sectionOf = (binding: Binding): Section =>
  binding.screens.length === SCOPES.length ? 'everywhere' : (binding.screens[0] ?? 'planner');

/**
 * The sections, current scope first.
 *
 * "Everywhere" stays last wherever it is: those bindings are true on the current screen
 * too, and a player looking for what they can do *here* wants the screen's own list at the
 * top. Putting the universal ones first would bury it.
 */
export const sectionOrder = (scope: Screen | null): readonly Section[] => {
  const scoped = scope === null ? SCOPES : [scope, ...SCOPES.filter((other) => other !== scope)];
  return [...scoped, 'everywhere'];
};

export const HelpOverlay = ({ t, rebinds, scope, onClose }: HelpOverlayProps): JSX.Element => {
  const ref = useOverlay<HTMLDivElement>({ modal: true, onClose });

  return (
    <div class="hh-help" data-testid="help-overlay">
      <div
        class="hh-help__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hh-help-heading"
        ref={ref}
      >
        <header class="hh-help__header">
          <h2 id="hh-help-heading">{t('help.heading', {})}</h2>
          <button type="button" data-testid="help-close" onClick={onClose}>
            {t('help.close', {})}
          </button>
        </header>

        {sectionOrder(scope).map((section) => {
          const bindings = BINDINGS.filter((binding) => sectionOf(binding) === section);
          if (bindings.length === 0) return null;

          return (
            <section key={section} class="hh-help__scope" data-testid={`help-scope-${section}`}>
              <h3>
                {t(
                  section === 'everywhere'
                    ? 'settings.bindings.scope.everywhere'
                    : SCOPE_LABELS[section],
                  {},
                )}
              </h3>
              {/*
                A description list, not a table: this is a list of action/key pairs, which
                is what `<dl>` means, and a screen reader reads the pairing without the
                row-and-column navigation a table would announce for two columns.
              */}
              <dl class="hh-help__list">
                {bindings.map((binding) => (
                  <div key={binding.id} class="hh-help__row" data-testid={`help-${binding.id}`}>
                    <dt>{t(binding.descriptionKey, {})}</dt>
                    <dd>
                      {keysFor(binding, rebinds).length === 0 ? (
                        t('settings.bindings.unbound', {})
                      ) : (
                        <KeyLabel t={t} binding={binding} rebinds={rebinds} />
                      )}
                      {binding.pending === undefined ? null : (
                        <span class="hh-help__pending">{t('settings.bindings.pending', {})}</span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          );
        })}

        <a class="hh-help__remap" href="#/settings" data-testid="help-remap">
          {t('help.remap', {})}
        </a>
      </div>
    </div>
  );
};
