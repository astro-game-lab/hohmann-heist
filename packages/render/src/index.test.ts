import { describe, expect, it } from 'vitest';

import { PACKAGE } from './index.js';

describe('@hh/render', () => {
  it('is wired into the workspace', () => {
    expect(PACKAGE).toBe('@hh/render');
  });
});
