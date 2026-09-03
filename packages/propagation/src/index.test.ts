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

  it('exposes the five FR-008 event finders', () => {
    expect(typeof propagation.findApsisCrossings).toBe('function');
    expect(typeof propagation.findCloseApproaches).toBe('function');
    expect(typeof propagation.findClosestApproach).toBe('function');
    expect(typeof propagation.findShellIntervals).toBe('function');
    expect(typeof propagation.findShellCrossings).toBe('function');
    expect(typeof propagation.findVisibilityIntervals).toBe('function');
    expect(typeof propagation.findUmbraIntervals).toBe('function');
  });

  it('exposes the thresholds a consumer must not restate', () => {
    // §9.3 suppresses apsis markers below this eccentricity. The renderer imports it
    // rather than writing 1e-3 again, so the finder and the marker cannot disagree
    // about whether an apsis exists -- which is what #60 asks for.
    expect(propagation.APSIS_ECCENTRICITY_FLOOR).toBe(1e-3);
    expect(propagation.DEFAULT_TOLERANCE_SECONDS).toBe(1e-6);
  });

  it('does not expose the numerical oracle (FR-009)', () => {
    // The layering rule is what enforces this; the test is here so that the *reason*
    // the barrel looks incomplete is recorded next to the barrel. Anything that
    // needs the oracle imports `@hh/propagation/oracle` and is a test.
    expect(Object.keys(propagation)).not.toContain('integrate');
    expect(Object.keys(propagation)).not.toContain('TABLEAU');
  });
});
