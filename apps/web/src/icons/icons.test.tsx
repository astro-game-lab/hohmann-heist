/**
 * The icon set, and the rule it exists under — #176, NFR-019, §8.8.
 *
 * The interesting assertion is the last one. §8.8 says no information is carried by one
 * channel alone, and the way an icon set breaks that rule is not by being drawn badly —
 * it is by ending up as the *only* content of a control, so that a screen-reader user
 * hears "button" and nothing else. That is invisible in review, because the person
 * reviewing can see the glyph.
 */
import { render } from 'preact';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ICON_NAMES, ICON_VIEWBOX, Icon } from './index.js';

let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
});

afterEach(() => {
  render(null, host);
  host.remove();
});

describe('the icon set (§9.6)', () => {
  it('stays inside §9.6’s twenty', () => {
    expect(ICON_NAMES.length).toBeLessThanOrEqual(20);
    expect(ICON_NAMES.length).toBeGreaterThan(0);
  });

  it.each(ICON_NAMES)('%s draws on the shared grid, in currentColor', (name) => {
    render(<Icon name={name} />, host);
    const svg = host.querySelector('svg');

    expect(svg?.getAttribute('viewBox')).toBe(ICON_VIEWBOX);
    // No baked colour: the palette reaches a glyph through `currentColor` in the
    // stylesheet, which is what makes one set serve all five palettes (#116).
    expect(host.innerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}|fill="(?!none)/);
    expect(svg?.querySelectorAll('path').length).toBeGreaterThan(0);
  });

  it('is a decoration by default, and an image only when asked', () => {
    render(<Icon name="retry" />, host);
    expect(host.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(host.querySelector('svg')?.getAttribute('role')).toBeNull();

    render(<Icon name="retry" label="Retry" />, host);
    expect(host.querySelector('svg')?.getAttribute('role')).toBe('img');
    expect(host.querySelector('svg')?.getAttribute('aria-label')).toBe('Retry');
    expect(host.querySelector('svg')?.getAttribute('aria-hidden')).toBeNull();
  });

  it('is never focusable, so a decoration cannot become a tab stop', () => {
    render(<Icon name="close" />, host);
    expect(host.querySelector('svg')?.getAttribute('focusable')).toBe('false');
  });

  // The rule the set exists under, checked the way it actually fails.
  it('is never the only thing a control says (NFR-019, §8.8)', () => {
    const accessibleName = (el: Element): string =>
      (el.getAttribute('aria-label') ?? el.textContent).trim() ||
      (el.querySelector('[aria-label]')?.getAttribute('aria-label') ?? '').trim();

    // An icon-only control with a name is fine.
    render(
      <button type="button">
        <Icon name="close" label="Close editor" />
      </button>,
      host,
    );
    expect(accessibleName(host.querySelector('button') as Element)).toBe('Close editor');

    // An icon beside text is fine: the glyph is hidden and the text speaks. The label is
    // a variable because NFR-028's rule refuses a literal in JSX — including here, which
    // is the rule working rather than getting in the way.
    const retry = 'Retry';
    render(
      <button type="button">
        <Icon name="retry" />
        {retry}
      </button>,
      host,
    );
    expect(accessibleName(host.querySelector('button') as Element)).toBe('Retry');

    // A hidden icon alone is the failure, and it is what the app must never contain.
    render(
      <button type="button">
        <Icon name="retry" />
      </button>,
      host,
    );
    expect(accessibleName(host.querySelector('button') as Element)).toBe('');
  });
});
