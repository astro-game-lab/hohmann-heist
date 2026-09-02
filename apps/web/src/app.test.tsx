import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { App } from './app.js';

let container: HTMLElement;

// `act` flushes Preact's effects and pending state updates, which otherwise run
// after paint and would leave the assertions racing the renderer. It returns a
// thenable even for a synchronous callback, so it is awaited rather than dropped.
const mount = async (): Promise<void> => {
  await act(() => {
    render(<App />, container);
  });
};

const text = (testId: string): string =>
  container.querySelector(`[data-testid="${testId}"]`)?.textContent ?? '';

beforeEach(() => {
  window.location.hash = '';
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
});

describe('App', () => {
  it('renders and resolves the current route', async () => {
    window.location.hash = '#/board';
    await mount();
    expect(text('route-name')).toBe('board');
    expect(text('route-path')).toBe('/board');
  });

  it('exposes route parameters', async () => {
    window.location.hash = '#/contract/5';
    await mount();
    expect(text('route-name')).toBe('contract');
    expect(JSON.parse(text('route-params'))).toEqual({ id: '5' });
  });

  it('follows a hash change without a reload', async () => {
    window.location.hash = '#/';
    await mount();
    expect(text('route-name')).toBe('title');

    await act(() => {
      window.location.hash = '#/settings';
      window.dispatchEvent(new Event('hashchange'));
    });
    expect(text('route-name')).toBe('settings');
  });

  // The point of this: it proves @hh/astro resolves, bundles, and computes
  // correctly in a browser environment, not only under Node.
  it('computes a real value through the simulation packages', async () => {
    await mount();
    // Circular speed at geostationary radius, ~3074.66 m/s.
    const speed = Number.parseFloat(text('geo-speed'));
    expect(speed).toBeGreaterThan(3074);
    expect(speed).toBeLessThan(3075);
  });

  it('formats a mission clock through @hh/astro', async () => {
    await mount();
    expect(text('met')).toBe('T+12:09:44');
  });

  it('renders navigation links as hash hrefs', async () => {
    await mount();
    const hrefs = [...container.querySelectorAll('nav a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('#/board');
    expect(hrefs.every((h) => h?.startsWith('#/'))).toBe(true);
  });
});
