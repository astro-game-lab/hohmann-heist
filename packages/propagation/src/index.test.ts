import { describe, expect, it } from 'vitest';

import { PACKAGE } from './index.js';

describe('@hh/propagation', () => {
  it('is wired into the workspace', () => {
    expect(PACKAGE).toBe('@hh/propagation');
  });
});
