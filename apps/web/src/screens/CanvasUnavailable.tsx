/**
 * §8.7's canvas-unavailable row — #125, shared with #126.
 *
 * > *WebGL/canvas unavailable: static message with the browser-support matrix (§11.15).*
 *
 * This is the case where the **app boots and the renderer cannot** — canvas disabled by a
 * policy or an extension, a hardened browser, a context the platform refused. #126's
 * pre-boot page is the other half: there, the app never started, so it cannot be this
 * component and has to be inline script in `index.html`. Same row of §8.7's table, two
 * implementations, and the split is not avoidable — a message rendered by the bundle
 * cannot report that the bundle would not run.
 *
 * What they share is the matrix, and it is stated in both places rather than imported into
 * one: §11.15's table is four short strings, and the pre-boot copy cannot reach the
 * catalogue at all (see `index.html`). Duplication of four sentences is the price of the
 * page working in the situation it exists for.
 *
 * ## It is a notice, not a screen
 *
 * NFR-014, and §8.8's canvas-parity rule underneath it: *every* piece of information the
 * orbit view draws has a DOM equivalent, so a player with no canvas can still read the
 * plan panel, the readouts and the timeline, and can still play. Replacing the screen with
 * an apology would take away a game that works.
 */
import type { Catalogue } from '@hh/ui';
import type { JSX } from 'preact';

export interface CanvasUnavailableProps {
  readonly t: Catalogue['resolve'];
}

export const CanvasUnavailable = ({ t }: CanvasUnavailableProps): JSX.Element => (
  <section class="hh-state hh-state--canvas" role="status" data-testid="canvas-unavailable">
    <h2 class="hh-state__heading">{t('state.canvas.heading', {})}</h2>
    <p class="hh-state__body">{t('state.canvas.body', {})}</p>
    <ul class="hh-state__matrix">
      <li>{t('state.canvas.tier1', {})}</li>
      <li>{t('state.canvas.tier2', {})}</li>
    </ul>
  </section>
);
