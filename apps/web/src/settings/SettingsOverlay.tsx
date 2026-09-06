/**
 * Settings, rendered over the screen the player came from — §8.2, §8.3.12 (#122).
 *
 * > *Returning from settings goes back to where the player was, not to the board — a
 * > player adjusting the palette mid-plan must not lose their plan.*
 *
 * That sentence is the whole reason this component exists, and it is in direct tension
 * with how the app routes. `app.tsx` renders `<Screen key={route.path}>`, so a route change
 * unmounts one screen and mounts the next — which is what makes a screen's local state
 * belong to the contract it was opened for, and is exactly right for every other route.
 * Navigating to `#/settings` under that rule would unmount the planner and take the
 * uncommitted plan with it.
 *
 * So `#/settings` stays a real §8.2 route, and the screen underneath **stays mounted**:
 * `app.tsx` keeps rendering the previous route's `Screen`, under its own key, and puts this
 * over the top. Nothing about the planner is unmounted, re-keyed, or re-rendered from
 * scratch, so "with its state intact" is not a thing anybody had to remember to preserve.
 *
 * On a **cold load** at `#/settings` there is nothing underneath — no previous route — and
 * the screen renders as an ordinary full screen instead. Both are the same component with
 * the same controls; only the frame differs.
 *
 * ## Closing goes back, rather than to a fixed route
 *
 * `history.back()` and not `navigate('/board')`: the player arrived from somewhere, the
 * browser knows where, and a fixed destination would be wrong for whichever screen it was
 * not. It also makes the browser's own Back button and this one do the same thing, which
 * is the property a player will assume without being told.
 */
import type { Catalogue } from '@hh/ui';
import type { JSX } from 'preact';

import { useOverlay } from '../a11y/overlay.js';
import { SettingsScreen, type SettingsScreenProps } from './SettingsScreen.js';

export interface SettingsOverlayProps extends SettingsScreenProps {
  readonly t: Catalogue['resolve'];
  readonly onClose: () => void;
}

export const SettingsOverlay = ({ onClose, ...props }: SettingsOverlayProps): JSX.Element => {
  const ref = useOverlay<HTMLDivElement>({ modal: true, onClose });

  return (
    <div class="hh-settings-overlay" data-testid="settings-overlay">
      <div
        class="hh-settings-overlay__panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="hh-settings-heading"
        ref={ref}
      >
        <header class="hh-settings-overlay__header">
          <h2 id="hh-settings-heading">{props.t('screen.settings.heading', {})}</h2>
          <button type="button" data-testid="settings-close" onClick={onClose}>
            {props.t('settings.back', {})}
          </button>
        </header>
        <SettingsScreen {...props} />
      </div>
    </div>
  );
};
