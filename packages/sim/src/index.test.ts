import { describe, expect, it } from 'vitest';

import * as sim from './index.js';

describe('@hh/sim', () => {
  it('is wired into the workspace', () => {
    expect(sim.PACKAGE).toBe('@hh/sim');
  });

  it('exports the plan primitives through the barrel', () => {
    // The barrel is the package's only entry point, so a module that exists but is
    // not re-exported is a module nobody above `@hh/sim` can reach.
    for (const name of [
      'createManeuverNode',
      'createPlan',
      'maneuverNodeFromCounts',
      'applyImpulse',
      'canonicalJson',
      'parseReplay',
      'planFromReplay',
      'replayFromPlan',
      'toEpochTicks',
      'fromEpochTicks',
      'toDeltaVCounts',
      'fromDeltaVCounts',
    ] as const) {
      expect(typeof sim[name]).toBe('function');
    }
  });

  it('exports the timeline through the barrel', () => {
    for (const name of ['buildTimeline', 'withPlan', 'stateAt', 'arcAt', 'arcIndexAt'] as const) {
      expect(typeof sim[name]).toBe('function');
    }
    expect(typeof sim.EpochOutOfHorizonError).toBe('function');
  });

  it('exports the quanta and the plan constants', () => {
    expect(sim.EPOCH_QUANTUM_S).toBe(1 / 1024);
    expect(sim.DELTA_V_QUANTUM_MPS).toBe(1e-4);
    expect(sim.MINIMUM_NODE_SPACING_S).toBe(1);
    expect(sim.MINIMUM_NODE_SPACING_TICKS).toBe(1024);
    expect(sim.REPLAY_SCHEMA_VERSION).toBe(1);
    expect(sim.EMPTY_PLAN.nodes).toStrictEqual([]);
  });
});
