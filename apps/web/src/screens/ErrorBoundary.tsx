/**
 * The state §8.7 does not list and every application needs — #125.
 *
 * An unhandled throw inside a screen should be a *rendered state* naming what failed and
 * offering a route back, not an empty document. Preact unmounts the whole tree when a
 * render throws with nothing above it to catch, so without this the failure mode of any
 * bug in any screen is a white page — indistinguishable, to the player, from the game
 * being gone.
 *
 * ## It does not swallow the error
 *
 * #125's criterion, and the reason a boundary is usually a bad idea: a component that
 * turns every exception into a friendly message also turns every exception into something
 * nobody debugs. So in development the error is **re-thrown** — asynchronously, from a
 * timeout, so it reaches `window.onerror` and Vite's overlay with its stack intact while
 * this still renders the fallback. Throwing synchronously from `componentDidCatch` would
 * only re-enter Preact's own error handling and lose it.
 *
 * In production it is reported to the console and rendered. There is no telemetry here and
 * NFR-025 is why — nothing is transmitted anywhere.
 *
 * ## The route back is a route, not a reload
 *
 * `#/board` rather than `location.reload()`: the save is already written, the board is
 * the screen that is most likely to still work, and a reload would re-run whatever failed
 * if the cause was the URL. NFR-014 — no state here blocks play.
 *
 * ## Why a class
 *
 * `componentDidCatch` and `getDerivedStateFromError` have no hook equivalent in Preact.
 * This is the one class component in the application, and it is why.
 */
import type { Catalogue } from '@hh/ui';
import { Component, type ComponentChildren, type JSX } from 'preact';

import { hrefFor } from '../router.js';

export interface ErrorBoundaryProps {
  readonly t: Catalogue['resolve'];
  /**
   * Changes when the screen does, so a boundary that has caught once does not keep
   * showing the failure after the player has navigated somewhere that works.
   */
  readonly resetKey: string;
  readonly children?: ComponentChildren;
}

interface ErrorBoundaryState {
  readonly error: Error | null;
  /** The `resetKey` the current error belongs to. */
  readonly caughtAt: string | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null, caughtAt: null };

  static override getDerivedStateFromProps(
    props: ErrorBoundaryProps,
    state: ErrorBoundaryState,
  ): Partial<ErrorBoundaryState> | null {
    // Navigating away clears the failure. Comparing against the key the error was caught
    // under, rather than storing a boolean, means a screen that throws *again* on the same
    // route still shows the state instead of flickering between the two.
    if (state.error !== null && state.caughtAt !== props.resetKey) {
      return { error: null, caughtAt: null };
    }
    return null;
  }

  override componentDidCatch(error: Error): void {
    this.setState({ error, caughtAt: this.props.resetKey });

    if (import.meta.env.DEV) {
      // Out of Preact's error handling, into the platform's, with the stack intact.
      setTimeout(() => {
        throw error;
      });
      return;
    }

    console.error(error);
  }

  override render(): JSX.Element {
    const { t, resetKey, children } = this.props;
    const { error } = this.state;

    if (error === null) return <>{children}</>;

    return (
      <section class="hh-state hh-state--error" role="alert" data-testid="error-boundary">
        <h2 class="hh-state__heading">{t('state.error.heading', {})}</h2>
        <p class="hh-state__body">{t('state.error.body', {})}</p>
        {/*
          The message, not the stack. A stack on screen is noise to a player and is already
          in the console for anyone who would read it — and `message` is the half that
          makes a bug report searchable.
        */}
        <p class="hh-state__detail" data-testid="error-boundary-detail">
          {t('state.error.detail', { message: error.message })}
        </p>
        <a class="hh-state__action" href={hrefFor('/board')} key={resetKey}>
          {t('state.error.back', {})}
        </a>
      </section>
    );
  }
}
