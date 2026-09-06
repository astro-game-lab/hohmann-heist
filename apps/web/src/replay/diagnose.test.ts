/**
 * §8.7's two replay failures, told apart — #125.
 *
 * Codes are built through `@hh/sim`'s own `replayFromPlan` and `canonicalJson` rather than
 * hand-written JSON, so a valid code here is one the game would actually produce. The
 * malformed cases are then *derived from that*, which is what makes them realistic: a
 * truncated code and a code from a newer schema are both a real code with one thing
 * changed, not a string invented to fail.
 */
import { epoch } from '@hh/astro';
import {
  REPLAY_SCHEMA_VERSION,
  canonicalJson,
  createPlan,
  maneuverNodeFromCounts,
  replayFromPlan,
} from '@hh/sim';
import { describe, expect, it } from 'vitest';

import { diagnoseReplay } from './diagnose.js';

/** A real two-burn code, built exactly the way `ContractScreen` writes one. */
const validCode = (): string =>
  canonicalJson(
    replayFromPlan(
      createPlan([
        maneuverNodeFromCounts(1024 * 600, [0, 950_000, 0]),
        maneuverNodeFromCounts(1024 * 3400, [0, 520_000, 0]),
      ]),
      {
        scenarioId: 'c03-cold-open',
        startEpoch: epoch(0),
        engineMajor: 1,
        assists: 0,
        // Tenths of a metre per second and whole seconds — §11.6's scoring grid.
        claim: { dv: 1470, t: 3400 },
      },
    ),
  );

describe('diagnoseReplay', () => {
  it('accepts a code the game itself produced', () => {
    expect(diagnoseReplay(validCode()).kind).toBe('ok');
  });

  it('never throws, whatever it is handed', () => {
    for (const input of ['', 'not json', '{', '[]', 'null', '{"v":"one"}']) {
      expect(() => diagnoseReplay(input), input).not.toThrow();
    }
  });

  describe('an invalid code', () => {
    it('reports "invalid" for text that is not JSON', () => {
      expect(diagnoseReplay('AAAA-not-a-code').kind).toBe('invalid');
    });

    it('reports "invalid" for a code truncated in transit', () => {
      const truncated = validCode().slice(0, -12);
      expect(diagnoseReplay(truncated).kind).toBe('invalid');
    });

    it('reports "invalid" for a code missing a required field', () => {
      const parsed = JSON.parse(validCode()) as Record<string, unknown>;
      delete parsed['c'];
      expect(diagnoseReplay(JSON.stringify(parsed)).kind).toBe('invalid');
    });
  });

  describe('a code from a newer schema', () => {
    /**
     * The distinction this module exists for. A newer code is intact — re-copying it would
     * send the player round a loop with no exit — so it must not be reported as malformed.
     */
    it('names both versions rather than calling the code broken', () => {
      const parsed = JSON.parse(validCode()) as Record<string, unknown>;
      parsed['v'] = REPLAY_SCHEMA_VERSION + 1;

      const diagnosis = diagnoseReplay(JSON.stringify(parsed));
      expect(diagnosis.kind).toBe('futureVersion');
      if (diagnosis.kind !== 'futureVersion') return;
      expect(diagnosis.found).toBe(REPLAY_SCHEMA_VERSION + 1);
      expect(diagnosis.supported).toBe(REPLAY_SCHEMA_VERSION);
    });

    /**
     * Version is checked *before* validity, and this is the case that proves why: a newer
     * schema may carry fields this build has never heard of, and `parseReplay` rejects
     * unrecognised keys before it looks at the version.
     */
    it('is diagnosed as newer even when it carries unknown fields', () => {
      const parsed = JSON.parse(validCode()) as Record<string, unknown>;
      parsed['v'] = REPLAY_SCHEMA_VERSION + 3;
      parsed['somethingFromTheFuture'] = { nested: true };

      expect(diagnoseReplay(JSON.stringify(parsed)).kind).toBe('futureVersion');
    });

    /** An *older* schema is not this state. It is a code this build may yet be able to read. */
    it('does not treat an older version as newer', () => {
      const parsed = JSON.parse(validCode()) as Record<string, unknown>;
      parsed['v'] = REPLAY_SCHEMA_VERSION - 1;
      expect(diagnoseReplay(JSON.stringify(parsed)).kind).not.toBe('futureVersion');
    });
  });
});
