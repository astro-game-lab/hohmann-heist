import { describe, expect, it } from 'vitest';

import { PACKAGE } from './index.js';

describe('@hh/ui', () => {
  it('is wired into the workspace', () => {
    expect(PACKAGE).toBe('@hh/ui');
  });
});
