import { describe, expect, it } from 'vitest';

import * as propagation from './index.js';

describe('@hh/propagation', () => {
  it('is wired into the workspace', () => {
    expect(propagation.PACKAGE).toBe('@hh/propagation');
  });

  it('exposes the analytic propagator and the arc', () => {
    expect(typeof propagation.propagate).toBe('function');
    expect(typeof propagation.createArc).toBe('function');
    expect(typeof propagation.stateAt).toBe('function');
  });

  it('does not expose the numerical oracle (FR-009)', () => {
    // The layering rule is what enforces this; the test is here so that the *reason*
    // the barrel looks incomplete is recorded next to the barrel. Anything that
    // needs the oracle imports `@hh/propagation/oracle` and is a test.
    expect(Object.keys(propagation)).not.toContain('integrate');
    expect(Object.keys(propagation)).not.toContain('TABLEAU');
  });
});
