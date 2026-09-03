import type { MetresPerSec } from '@hh/math';
import { epoch, rtn } from '@hh/astro';
import { metresPerSec, V } from '@hh/math';
import { describe, expect, it } from 'vitest';

import { createManeuverNode, createPlan, EMPTY_PLAN } from './plan.js';
import type { ReplayContext, ReplayV1 } from './replay.js';
import {
  canonicalJson,
  parseReplay,
  planFromReplay,
  replayFromPlan,
  REPLAY_SCHEMA_VERSION,
} from './replay.js';

/** FR-607: a share URL must be at most 512 characters for a plan of up to 8 nodes. */
const SHARE_URL_BUDGET_CHARS = 512;

/** Unpadded base64url length for a byte count. Four characters per three bytes. */
const base64urlLength = (bytes: number): number => Math.ceil((bytes * 4) / 3);

/** A 2026 scenario start: 2026-09-01-ish, in TAI seconds past J2000. */
const START = epoch(841_536_000);

const context: ReplayContext = {
  scenarioId: 'c05-tailgate',
  engineMajor: 1,
  startEpoch: START,
  assists: 0b0011011,
  claim: { dv: 724, t: 43_784 },
};

/**
 * Narrow away `undefined`, failing the test rather than asserting it away.
 *
 * `noUncheckedIndexedAccess` is on and the lint config forbids both `!` and the widening
 * cast, which is correct for source and merely noisy in a test that has just built the
 * array it is indexing.
 */
const definitely = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error('expected a value, got undefined');
  return value;
};

const dv = (radial: number, transverse: number, normal: number) =>
  rtn(V.vec3<MetresPerSec>(metresPerSec(radial), metresPerSec(transverse), metresPerSec(normal)));

const node = (metSeconds: number, radial: number, transverse: number, normal: number) =>
  createManeuverNode({
    epoch: epoch(START + metSeconds),
    deltaVRtn: dv(radial, transverse, normal),
  });

const plan = createPlan([node(0, 0, 12.5, 0), node(2700, -0.4, -3.25, 0.05)]);

describe('replayFromPlan', () => {
  it('writes node epochs relative to the scenario start', () => {
    const replay = replayFromPlan(plan, context);

    expect(definitely(replay.n[0])[0]).toBe(0);
    expect(definitely(replay.n[1])[0]).toBe(2700 * 1024);
  });

  it('writes the node tuple in §11.6 order — transverse first, as "pr"', () => {
    // The one place the RTN axis order is deliberately not preserved. DEP-10 calls the
    // transverse axis "prograde"; §11.6 puts it first.
    const replay = replayFromPlan(createPlan([node(0, 1, 2, 3)]), context);

    expect(replay.n[0]).toStrictEqual([0, 20000, 10000, 30000]);
  });

  it('carries the envelope through without interpreting it', () => {
    const replay = replayFromPlan(plan, context);

    expect(replay.v).toBe(REPLAY_SCHEMA_VERSION);
    expect(replay.s).toBe('c05-tailgate');
    expect(replay.e).toBe(1);
    expect(replay.a).toBe(0b0011011);
    expect(replay.c).toStrictEqual({ dv: 724, t: 43_784 });
  });

  it('rejects a non-integer assist mask or claim', () => {
    expect(() => replayFromPlan(plan, { ...context, assists: 1.5 })).toThrow(/safe integer/);
    expect(() => replayFromPlan(plan, { ...context, claim: { dv: 724.5, t: 1 } })).toThrow(
      /safe integer/,
    );
  });
});

describe('planFromReplay', () => {
  it('restores absolute epochs and RTN axis order', () => {
    const restored = planFromReplay(replayFromPlan(plan, context), START);

    expect(restored.nodes.map((n) => n.epochTicks)).toStrictEqual(
      plan.nodes.map((n) => n.epochTicks),
    );
    expect(restored.nodes.map((n) => n.deltaVCounts)).toStrictEqual(
      plan.nodes.map((n) => n.deltaVCounts),
    );
  });

  it('round-trips a plan exactly, counts and derived values alike', () => {
    const restored = planFromReplay(replayFromPlan(plan, context), START);

    for (const [i, original] of plan.nodes.entries()) {
      expect(definitely(restored.nodes[i]).epoch).toBe(original.epoch);
      expect(definitely(restored.nodes[i]).deltaVRtn.x).toBe(original.deltaVRtn.x);
      expect(definitely(restored.nodes[i]).deltaVRtn.y).toBe(original.deltaVRtn.y);
      expect(definitely(restored.nodes[i]).deltaVRtn.z).toBe(original.deltaVRtn.z);
    }
  });

  it('applies FR-101 to a decoded replay rather than trusting it', () => {
    const hostile: ReplayV1 = {
      ...replayFromPlan(plan, context),
      n: [
        [0, 0, 0, 0],
        [512, 0, 0, 0],
      ],
    };

    expect(() => planFromReplay(hostile, START)).toThrow(/at least 1 s apart/);
  });

  it('rejects a decoded node whose counts are not integers', () => {
    const hostile = { ...replayFromPlan(plan, context), n: [[0.5, 0, 0, 0] as const] };

    expect(() => planFromReplay(hostile, START)).toThrow(/safe integer/);
  });
});

describe('canonicalJson (§11.6)', () => {
  it('sorts keys, emits no whitespace, and writes integers only', () => {
    const json = canonicalJson(replayFromPlan(plan, context));

    expect(json).toBe(
      '{"a":27,"c":{"dv":724,"t":43784},"e":1,' +
        '"n":[[0,125000,0,0],[2764800,-32500,-4000,500]],' +
        '"s":"c05-tailgate","v":1}',
    );
    expect(json).not.toMatch(/\s/);
    expect(json).not.toMatch(/\d\.\d|[eE][+-]\d/);
  });

  it('produces the same bytes for the same run, so the code is a stable identity', () => {
    expect(canonicalJson(replayFromPlan(plan, context))).toBe(
      canonicalJson(replayFromPlan(plan, context)),
    );
  });

  it('does not inherit key order from the object it is handed', () => {
    // The failure this writer exists to prevent: an object built in a different order
    // must still serialise identically.
    const forward = replayFromPlan(plan, context);
    const shuffled: ReplayV1 = {
      c: forward.c,
      v: forward.v,
      n: forward.n,
      a: forward.a,
      s: forward.s,
      e: forward.e,
    };

    expect(JSON.stringify(shuffled)).not.toBe(JSON.stringify(forward));
    expect(canonicalJson(shuffled)).toBe(canonicalJson(forward));
  });

  it('serialises the empty plan', () => {
    expect(canonicalJson(replayFromPlan(EMPTY_PLAN, context))).toContain('"n":[]');
  });

  it('escapes the scenario id per ECMAScript, which is already deterministic', () => {
    const json = canonicalJson(replayFromPlan(EMPTY_PLAN, { ...context, scenarioId: 'a"b\\c' }));

    expect(json).toContain('"s":"a\\"b\\\\c"');
    expect(parseReplay(json).s).toBe('a"b\\c');
  });

  it('refuses to write a non-integer', () => {
    const bad = { ...replayFromPlan(plan, context), a: 0.5 };

    expect(() => canonicalJson(bad)).toThrow(/integers only/);
  });
});

describe('round-trip', () => {
  it('serialise -> parse -> serialise is byte-identical', () => {
    const json = canonicalJson(replayFromPlan(plan, context));

    expect(canonicalJson(parseReplay(json))).toBe(json);
  });

  it('survives a full plan -> replay -> JSON -> replay -> plan cycle', () => {
    const json = canonicalJson(replayFromPlan(plan, context));
    const restored = planFromReplay(parseReplay(json), START);

    expect(canonicalJson(replayFromPlan(restored, context))).toBe(json);
  });
});

describe('parseReplay', () => {
  it('rejects a future schema version rather than parsing it optimistically', () => {
    const json = canonicalJson({ ...replayFromPlan(plan, context), v: 2 });

    expect(() => parseReplay(json)).toThrow(RangeError);
    expect(() => parseReplay(json)).toThrow(/unsupported replay schema version 2/);
  });

  it('rejects an older schema version too', () => {
    expect(() => parseReplay(canonicalJson({ ...replayFromPlan(plan, context), v: 0 }))).toThrow(
      /unsupported replay schema version 0/,
    );
  });

  it('carries an unknown engine major rather than rejecting it (§11.6, §14.4)', () => {
    // Deliberately not symmetrical with `v`. An older engine's replay is played on a
    // pinned path, which is a decision for the layer above this one.
    const json = canonicalJson({ ...replayFromPlan(plan, context), e: 7 });

    expect(parseReplay(json).e).toBe(7);
  });

  it('rejects an unrecognised key rather than dropping it', () => {
    expect(() =>
      parseReplay('{"a":0,"c":{"dv":0,"t":0},"e":1,"n":[],"s":"x","v":1,"z":1}'),
    ).toThrow(/exactly the keys/);
  });

  it('rejects a missing key', () => {
    expect(() => parseReplay('{"a":0,"c":{"dv":0,"t":0},"e":1,"n":[],"s":"x"}')).toThrow(
      /exactly the keys/,
    );
  });

  it('rejects a claim with the wrong shape', () => {
    expect(() => parseReplay('{"a":0,"c":{"dv":0},"e":1,"n":[],"s":"x","v":1}')).toThrow(
      /exactly the keys/,
    );
    expect(() => parseReplay('{"a":0,"c":5,"e":1,"n":[],"s":"x","v":1}')).toThrow(
      /claimed result must be an object/,
    );
  });

  it('rejects a node that is not four integers', () => {
    expect(() =>
      parseReplay('{"a":0,"c":{"dv":0,"t":0},"e":1,"n":[[0,0,0]],"s":"x","v":1}'),
    ).toThrow(/four integers/);
    expect(() =>
      parseReplay('{"a":0,"c":{"dv":0,"t":0},"e":1,"n":[[0,0,0,0.5]],"s":"x","v":1}'),
    ).toThrow(/safe integer/);
  });

  it('rejects a non-array node list and a non-object replay', () => {
    expect(() => parseReplay('{"a":0,"c":{"dv":0,"t":0},"e":1,"n":5,"s":"x","v":1}')).toThrow(
      /nodes must be an array/,
    );
    expect(() => parseReplay('[]')).toThrow(/must be a JSON object/);
    expect(() => parseReplay('5')).toThrow(/must be a JSON object/);
  });

  it('rejects a non-string scenario id', () => {
    expect(() => parseReplay('{"a":0,"c":{"dv":0,"t":0},"e":1,"n":[],"s":5,"v":1}')).toThrow(
      /scenario id must be a string/,
    );
  });

  it('lets JSON.parse report malformed text itself', () => {
    expect(() => parseReplay('{')).toThrow(SyntaxError);
  });

  it('names an empty object rather than reporting no keys at all', () => {
    expect(() => parseReplay('{}')).toThrow(/got \(none\)/);
  });

  it('quotes a string found where an integer belongs, so the type is legible', () => {
    // '"1"' and '1' read identically in an error message otherwise, which is exactly
    // the confusion worth spending a branch on.
    expect(() => parseReplay('{"a":"1","c":{"dv":0,"t":0},"e":1,"n":[],"s":"x","v":1}')).toThrow(
      /got "1"/,
    );
  });
});

describe('size budget (FR-607)', () => {
  // Eight nodes, ~12 h apart-ish, with realistic delta-v magnitudes. This is the
  // worst realistic case FR-607 names.
  const eightNodes = createPlan(
    Array.from({ length: 8 }, (_, i) => node(i * 5400 + 137.5, -0.4 - i, 123.75 + i * 40, 0.05)),
  );

  it('keeps an 8-node share code inside 512 characters with no compression at all', () => {
    const json = canonicalJson(replayFromPlan(eightNodes, context));

    // The honest form of the check. §11.6 pipes the JSON through deflate before
    // base64url, but a budget that only holds *because* the compressor did well is a
    // budget that can fail on an incompressible plan. Asserting the uncompressed
    // path makes FR-607 hold unconditionally, and deflate becomes headroom rather
    // than a load-bearing assumption.
    expect(json).toMatch(/^[\x20-\x7e]*$/);
    expect(base64urlLength(json.length)).toBeLessThan(SHARE_URL_BUDGET_CHARS);
  });

  it('records the measured size, so a schema change that inflates it fails loudly', () => {
    const json = canonicalJson(replayFromPlan(eightNodes, context));

    // Measured at 306 bytes -> 408 base64url characters, 104 inside FR-607's 512.
    // §11.6's "~120 bytes of JSON" is optimistic by a factor of about 2.5 for eight
    // nodes at realistic epochs and delta-vs -- a 123.75 m/s burn is 1 237 500 counts,
    // seven digits, and there are three of those plus an epoch per node. The document
    // has been corrected to this measurement. The ceiling is the measurement plus room
    // for a longer scenario key, not a round number.
    expect(json.length).toBeLessThanOrEqual(320);
    expect(json.length).toBeGreaterThan(250);
  });
});
