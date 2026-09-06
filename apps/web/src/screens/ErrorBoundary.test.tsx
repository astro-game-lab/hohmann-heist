/**
 * The error boundary — #125.
 *
 * Two things to prove, and the second is the one that makes the boundary acceptable at
 * all: that a throw becomes a rendered state with a way out, and that the error is **not
 * swallowed** — it still reaches the platform in development, where somebody is watching.
 */
import { createCatalogue } from '@hh/ui';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorBoundary } from './ErrorBoundary.js';

const catalogue = createCatalogue();
let container: HTMLElement;

const Boom = ({ message }: { readonly message: string }): never => {
  throw new Error(message);
};

// No text: NFR-028's rule refuses literal JSX text even in a test fixture, and this
// element exists to be *found*, not read.
const Fine = (): preact.JSX.Element => <p data-testid="fine" />;

const el = (testId: string): HTMLElement | null =>
  container.querySelector(`[data-testid="${testId}"]`);

/**
 * Render, tolerating the throw the boundary is here to catch.
 *
 * `preact/test-utils`' `act` re-raises whatever was thrown during the render it flushed,
 * *after* the boundary has already handled it and rendered its fallback. Letting that
 * escape would make every case below report an unhandled error to the runner while still
 * passing, which is noise that turns into a red CI run.
 *
 * Swallowing it here is safe and is not the assertion being weakened: what these tests
 * check is what the boundary *rendered*, and the separate development-mode case below
 * proves the error is not swallowed by the boundary itself.
 */
const mount = async (node: preact.JSX.Element): Promise<void> => {
  try {
    await act(() => {
      render(node, container);
    });
  } catch {
    // Handled by the boundary; see above.
  }
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);

  /**
   * Pin the production branch by default.
   *
   * Vitest runs with `import.meta.env.DEV` true, so without this **every** case below
   * would take the development path and schedule a real re-throw — which lands on the
   * runner a tick later as an uncaught exception and fails the run. That is the boundary
   * working exactly as designed, and it is why the development behaviour gets its own
   * case, with fake timers, where the throw can be caught and asserted on.
   */
  vi.stubEnv('DEV', false);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  render(null, container);
  container.remove();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('the error boundary', () => {
  it('renders its children when nothing throws', async () => {
    await mount(
      <ErrorBoundary t={catalogue.resolve} resetKey="/board">
        <Fine />
      </ErrorBoundary>,
    );
    expect(el('fine')).not.toBeNull();
    expect(el('error-boundary')).toBeNull();
  });

  it('renders a recoverable state instead of an empty document', async () => {
    await mount(
      <ErrorBoundary t={catalogue.resolve} resetKey="/board">
        <Boom message="the planner exploded" />
      </ErrorBoundary>,
    );

    const state = el('error-boundary');
    expect(state).not.toBeNull();
    // Named, so a bug report can quote it.
    expect(el('error-boundary-detail')?.textContent).toContain('the planner exploded');
  });

  /** NFR-014: no state blocks play. There is always a route out, and it is a real link. */
  it('offers a route back', async () => {
    await mount(
      <ErrorBoundary t={catalogue.resolve} resetKey="/contract/c01-shakedown">
        <Boom message="nope" />
      </ErrorBoundary>,
    );

    const link = container.querySelector('.hh-state__action');
    expect(link?.tagName).toBe('A');
    expect(link?.getAttribute('href')).toBe('#/board');
  });

  it('does not trap focus', async () => {
    await mount(
      <ErrorBoundary t={catalogue.resolve} resetKey="/board">
        <Boom message="nope" />
      </ErrorBoundary>,
    );

    const state = el('error-boundary');
    expect(state?.getAttribute('aria-modal')).toBeNull();
    expect(document.activeElement).not.toBe(state);
  });

  /**
   * The criterion that makes the boundary honest: *"re-throws in development so the error
   * is still visible."*
   *
   * Asynchronously, from a timeout, so it lands on `window.onerror` with its stack rather
   * than being re-swallowed by Preact. Driven with fake timers, because otherwise the
   * throw would escape into the test runner after this test had finished.
   */
  it('re-throws in development rather than swallowing the error', async () => {
    vi.stubEnv('DEV', true);
    vi.useFakeTimers();

    await mount(
      <ErrorBoundary t={catalogue.resolve} resetKey="/board">
        <Boom message="still visible" />
      </ErrorBoundary>,
    );

    expect(el('error-boundary')).not.toBeNull();
    expect(() => {
      vi.runOnlyPendingTimers();
    }).toThrow('still visible');
  });

  /**
   * Navigating away clears it. Without this a boundary that caught once would keep showing
   * the failure over every screen the player moved to afterwards, which is a worse failure
   * than the one it caught.
   */
  it('clears when the route changes', async () => {
    await mount(
      <ErrorBoundary t={catalogue.resolve} resetKey="/board">
        <Boom message="nope" />
      </ErrorBoundary>,
    );
    expect(el('error-boundary')).not.toBeNull();

    await mount(
      <ErrorBoundary t={catalogue.resolve} resetKey="/settings">
        <Fine />
      </ErrorBoundary>,
    );
    expect(el('error-boundary')).toBeNull();
    expect(el('fine')).not.toBeNull();
  });
});
