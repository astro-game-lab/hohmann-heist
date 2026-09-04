/**
 * §8.3.4's region ⑤ — the assist tray. #133's snap toggle, and nothing else yet.
 *
 * §6.6's full assist set and the medal-eligibility indicator are **#140, in M3**. This
 * region exists in M2 only far enough to carry DEP-07's snap toggle, because #133's
 * second criterion makes the snap *disableable from the assist tray* — a toggle with
 * nowhere to live would have meant either an untestable requirement or a tray invented
 * ahead of the issue that specifies it.
 *
 * So the boundary is explicit rather than implied: one control, and the heading it sits
 * under. When #140 lands it adds controls here; it does not have to unpick anything.
 */
import { SNAP_WINDOW_SECONDS } from '@hh/game';
import type { Catalogue } from '@hh/ui';
import type { JSX } from 'preact';

export interface AssistTrayProps {
  readonly t: Catalogue['resolve'];
  readonly snapToApsis: boolean;
  readonly onToggleSnap: (enabled: boolean) => void;
}

export const AssistTray = ({ t, snapToApsis, onToggleSnap }: AssistTrayProps): JSX.Element => (
  <section class="hh-assists" data-testid="assist-tray">
    <h2 class="hh-panel__heading">{t('planner.assists.heading', {})}</h2>
    <label class="hh-assists__toggle">
      <input
        type="checkbox"
        checked={snapToApsis}
        aria-describedby="hh-assist-snap-hint"
        data-testid="assist-snap"
        onChange={(event) => {
          onToggleSnap((event.target as HTMLInputElement).checked);
        }}
      />
      <span>{t('planner.assists.snapToApsis', {})}</span>
    </label>
    <p class="hh-assists__hint" id="hh-assist-snap-hint">
      {t('planner.assists.snapToApsisHint', { windowSeconds: SNAP_WINDOW_SECONDS })}
    </p>
  </section>
);
