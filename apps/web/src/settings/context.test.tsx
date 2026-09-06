/**
 * #186's *"applies immediately, with no reload"*, and the one place it could be faked.
 *
 * A test that called `set` and then read the store back would pass for a context that
 * never re-rendered anything — which is the failure mode this file exists to catch, and
 * the reason the assertions are all made on *rendered output* rather than on the API.
 */
import { render, type JSX } from 'preact';
import { useState } from 'preact/hooks';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsProvider, useSetting, useSettings } from './context.js';
import { applyDocumentSettings, UI_SCALE_PROPERTY } from './document.js';
import { emptySettings, resolveSettings, type StoredSettings } from './schema.js';

let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
});

afterEach(() => {
  render(null, container);
  container.remove();
});

/** A consumer that reads one setting and nothing else. */
const Theme = (): JSX.Element => <span data-testid="theme">{useSetting('display.theme')}</span>;

/** A second, unrelated consumer — so "every reader" means more than one. */
const Scale = (): JSX.Element => (
  <span data-testid="scale">{String(useSetting('display.uiScale'))}</span>
);

const Controls = (): JSX.Element => {
  const { set, reset, resetAll } = useSettings();
  return (
    <>
      <button
        data-testid="light"
        onClick={() => {
          set('display.theme', 'light');
        }}
      />
      <button
        data-testid="bigger"
        onClick={() => {
          set('display.uiScale', 125);
        }}
      />
      <button
        data-testid="reset-theme"
        onClick={() => {
          reset('display.theme');
        }}
      />
      <button
        data-testid="reset-all"
        onClick={() => {
          resetAll();
        }}
      />
    </>
  );
};

/**
 * The provider with the caller's half wired up, as `app.tsx` wires it.
 *
 * The stored block lives *above* the provider, because that is the arrangement under
 * test: the provider computes and publishes, and something else persists. A harness that
 * let the provider hold its own state would be testing a component that does not exist.
 */
const Harness = ({ onChange }: { onChange?: (s: StoredSettings) => void }): JSX.Element => {
  const [stored, setStored] = useState<StoredSettings>(emptySettings());
  return (
    <SettingsProvider
      stored={stored}
      onChange={(next) => {
        setStored(next);
        onChange?.(next);
      }}
    >
      <Theme />
      <Scale />
      <Controls />
    </SettingsProvider>
  );
};

const text = (id: string): string =>
  container.querySelector(`[data-testid="${id}"]`)?.textContent ?? '';
const click = async (id: string): Promise<void> => {
  await act(() => {
    container.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`)?.click();
  });
};

describe('the settings context', () => {
  it('re-renders every reader when a setting changes — no reload, no broadcast', async () => {
    await act(() => {
      render(<Harness />, container);
    });
    expect(text('theme')).toBe('dark');
    expect(text('scale')).toBe('100');

    await click('light');
    expect(text('theme')).toBe('light');
    // The other consumer is untouched and did not have to subscribe to anything.
    expect(text('scale')).toBe('100');

    await click('bigger');
    expect(text('scale')).toBe('125');
    expect(text('theme')).toBe('light');
  });

  it('hands the caller a sparse block to persist — only what was changed', async () => {
    const onChange = vi.fn();
    await act(() => {
      render(<Harness onChange={onChange} />, container);
    });

    await click('light');
    expect(onChange).toHaveBeenLastCalledWith({ 'display.theme': 'light' });

    await click('bigger');
    expect(onChange).toHaveBeenLastCalledWith({
      'display.theme': 'light',
      'display.uiScale': 125,
    });

    await click('reset-theme');
    expect(onChange).toHaveBeenLastCalledWith({ 'display.uiScale': 125 });

    await click('reset-all');
    expect(onChange).toHaveBeenLastCalledWith({});
  });

  it('gives a consumer rendered outside a provider the defaults, not undefined', async () => {
    await act(() => {
      render(<Theme />, container);
    });
    expect(text('theme')).toBe('dark');
  });
});

describe('the document-level settings', () => {
  const root = (): HTMLElement => {
    const element = document.createElement('div');
    document.body.append(element);
    return element;
  };

  it('publishes the palette, the theme, the scale and the line weights', () => {
    const element = root();
    applyDocumentSettings(
      element,
      resolveSettings({
        'accessibility.palette': 'tritanopia',
        'display.theme': 'light',
        'display.uiScale': 125,
        'accessibility.lineWeights': true,
      }),
    );

    expect(element.dataset['palette']).toBe('tritanopia');
    expect(element.dataset['theme']).toBe('light');
    expect(element.style.getPropertyValue(UI_SCALE_PROPERTY)).toBe('1.25');
    expect(element.dataset['lineWeights']).toBe('');
    expect(element.style.getPropertyValue('--bg')).not.toBe('');
    element.remove();
  });

  it('sets no theme attribute for "system", so the stylesheet answers the query', () => {
    const element = root();
    applyDocumentSettings(element, resolveSettings({ 'display.theme': 'system' }));
    expect(element.dataset['theme']).toBeUndefined();
    element.remove();
  });

  it('clears what it previously set, so a change back is a change', () => {
    const element = root();
    applyDocumentSettings(
      element,
      resolveSettings({ 'display.theme': 'light', 'accessibility.lineWeights': true }),
    );
    applyDocumentSettings(element, resolveSettings(emptySettings()));

    // Back to the default, which is `dark` rather than `system` (§8.3.12) — so the
    // attribute is *set* to dark rather than removed. Only `system` removes it.
    expect(element.dataset['theme']).toBe('dark');
    expect(element.dataset['lineWeights']).toBeUndefined();
    expect(element.style.getPropertyValue(UI_SCALE_PROPERTY)).toBe('1');
    element.remove();
  });
});
