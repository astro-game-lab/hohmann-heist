/**
 * Copying the replay code (§8.3.9's SHARE).
 *
 * Both failure paths are the point. `navigator.clipboard` is absent over plain HTTP and
 * in some embedded views, and the write rejects on a browser that has it when the
 * document does not have focus — and neither may reach the player as a thrown error,
 * because the code is on screen and can be copied by hand.
 *
 * The host is a parameter, so both branches are driven with a plain object rather than
 * by depending on what jsdom happens to provide.
 */
import { describe, expect, it, vi } from 'vitest';

import { copyReplay } from './share.js';

describe('copyReplay', () => {
  it('reports a successful copy', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    await expect(copyReplay('{"v":1}', { clipboard: { writeText } })).resolves.toBe('copied');
    expect(writeText).toHaveBeenCalledWith('{"v":1}');
  });

  it('reports failure when the platform has no clipboard at all', async () => {
    await expect(copyReplay('{"v":1}', {})).resolves.toBe('failed');
  });

  it('reports failure when the write is refused, rather than throwing', async () => {
    const clipboard = {
      writeText: (): Promise<void> => Promise.reject(new Error('document is not focused')),
    };
    await expect(copyReplay('{"v":1}', { clipboard })).resolves.toBe('failed');
  });
});
