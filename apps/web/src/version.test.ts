/**
 * §14.4's build identifier.
 *
 * The interesting case is the one the test runner is in: `vitest` does not apply the
 * app's `define`, so `__HH_VERSION__` and `__HH_COMMIT__` are undeclared globals here.
 * That is exactly the environment the `typeof` guards in `version.ts` exist for, and
 * asserting it means a future refactor that drops them fails here rather than in every
 * test that happens to render a debrief.
 */
import { describe, expect, it } from 'vitest';

import { BUILD_ID, COMMIT, VERSION } from './version.js';

describe('the build identifier', () => {
  it('resolves without the build-time defines, which the test runner does not apply', () => {
    // Not a tautology: without the `typeof` guard these are ReferenceErrors, and the
    // module would fail to evaluate at import time.
    expect(typeof VERSION).toBe('string');
    expect(typeof COMMIT).toBe('string');
  });

  it('falls back to a version that is honestly not a release', () => {
    expect(VERSION).toBe('0.0.0');
  });

  it('falls back to a commit that is visibly not a SHA', () => {
    // 'unknown' rather than a plausible-looking placeholder: a wrong SHA in a bug report
    // costs more than an absent one, because it will be believed and then chased.
    expect(COMMIT).toBe('unknown');
    expect(COMMIT).not.toMatch(/^[0-9a-f]{7}$/);
  });

  it('reads as "<version> (<commit>)"', () => {
    expect(BUILD_ID).toBe(`${VERSION} (${COMMIT})`);
    expect(BUILD_ID).toBe('0.0.0 (unknown)');
  });

  it('is a single line, so it can be pasted into a report intact', () => {
    expect(BUILD_ID).not.toContain('\n');
    expect(BUILD_ID.trim()).toBe(BUILD_ID);
  });
});
