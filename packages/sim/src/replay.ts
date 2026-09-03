/**
 * Canonical JSON serialisation of a plan — §11.6.
 *
 * A replay code is an identity, not just a transport format. §11.6 asks that the same
 * run always produce the same bytes so the code can be a deduplication and cache key,
 * and §11.11 has the server decode one, regenerate the scenario, re-evaluate the plan
 * and compare. Both of those rest on the encoding being a *function* of the run, with
 * nothing incidental leaking in.
 *
 * Three things could leak in, and each is closed here rather than left to convention:
 *
 * - **Key order.** `JSON.stringify` emits an object's own enumerable keys in
 *   insertion order, so the bytes would depend on the order a literal happened to be
 *   written in — invisible to review and trivially changed by a refactor. The writer
 *   below emits sorted keys explicitly. It is more code than a `stringify` call and
 *   that is the point: the ordering is stated, not inherited.
 * - **Whitespace.** None, anywhere.
 * - **Number formatting.** Every number in the format is an integer, checked on the
 *   way out and on the way back in. `0.1 + 0.2` never has to serialise, so the
 *   shortest-round-trip float formatting rules never come into play.
 *
 * ## `epochQ` is mission-elapsed, not absolute
 *
 * §11.6's own claim field, `c: {dv: 724, t: 43784}`, is plainly mission-elapsed time —
 * 43 784 s is 12.2 h, not an offset from J2000. Node epochs follow it. A plan holds
 * absolute epochs (FR-101 and `Epoch`'s type), so serialisation is told the
 * scenario's start epoch and writes the difference.
 *
 * The subtraction is on tick counts, so it is exact integer arithmetic and the origin
 * cancels perfectly on the way back. Encoding absolute ticks instead would have cost
 * about four extra digits on every node — a 2026 epoch is 8.6e11 ticks — for a
 * self-containment the format does not actually gain, since `s` is already required
 * to re-evaluate the plan at all.
 *
 * ## What this module refuses to understand
 *
 * `a` is an assist bitmask and `c` is a claimed result. Both are game-layer concepts —
 * §11.2 keeps objectives, tolerances and medals out of `@hh/sim` — so they travel
 * through here as opaque integers. This module knows their names and that they must
 * be integers. It does not know which bit is node snapping or what a `dv` of 724
 * would earn, and it must not learn.
 *
 * ## Versions
 *
 * `v` is the schema version and is rejected unless it is exactly
 * {@link REPLAY_SCHEMA_VERSION}: a future shape cannot be parsed optimistically,
 * because the failure mode is a plausible wrong trajectory rather than an error.
 *
 * `e` is the **engine** major version and is deliberately *not* rejected. §11.6 says
 * an older engine's replay is played on a pinned evaluation path where feasible, and
 * the viewer says so explicitly where it is not. Refusing to parse it here would take
 * that decision away from the layer entitled to make it, so `e` is carried as data.
 */
import type { Epoch } from '@hh/astro';

import type { DeltaVCounts, Plan } from './plan.js';
import { createPlan, maneuverNodeFromCounts } from './plan.js';
import { toEpochTicks } from './quantise.js';

/** The schema version this module reads and writes. */
export const REPLAY_SCHEMA_VERSION = 1;

/**
 * One serialised node: `[epochQ, prQ, raQ, noQ]`, per §11.6.
 *
 * Note the axis order. §11.6 writes the **transverse** component first and names it
 * `pr` for "prograde" — the player-facing word, which is DEP-10's naming departure and
 * not a second frame. Internally the order is RTN: radial, transverse, normal. The
 * reordering happens here and only here.
 */
export type ReplayNode = readonly [epochQ: number, prQ: number, raQ: number, noQ: number];

/** The claimed result, quantised to 0.1 m/s and 1 s. Opaque to this layer. */
export interface ReplayClaim {
  /** Claimed delta-v used, in tenths of a metre per second. */
  readonly dv: number;
  /** Claimed mission elapsed time, in whole seconds. */
  readonly t: number;
}

/** A replay, schema version 1 (§11.6). */
export interface ReplayV1 {
  /** Replay schema version. Always {@link REPLAY_SCHEMA_VERSION}. */
  readonly v: number;
  /** Scenario id or daily key, e.g. `"c05-tailgate"` or `"d:2026-09-01"`. */
  readonly s: string;
  /** Engine major version (§14.4). Carried, not interpreted. */
  readonly e: number;
  /** Quantised nodes. */
  readonly n: readonly ReplayNode[];
  /** Assist bitmask at the time of the run. Carried, not interpreted. */
  readonly a: number;
  /** Claimed result. Carried, not interpreted. */
  readonly c: ReplayClaim;
}

/** Everything a replay needs that a plan does not carry. */
export interface ReplayContext {
  /** Scenario id or daily key. */
  readonly scenarioId: string;
  /** Engine major version (§14.4). */
  readonly engineMajor: number;
  /** The scenario's start epoch — the origin node epochs are written relative to. */
  readonly startEpoch: Epoch;
  /** Assist bitmask. */
  readonly assists: number;
  /** Claimed result. */
  readonly claim: ReplayClaim;
}

/** Render an unexpected value for an error message, without assuming it is printable. */
const show = (value: unknown): string =>
  typeof value === 'string' ? JSON.stringify(value) : String(value);

const requireInteger = (value: unknown, what: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new RangeError(
      `${what} must be a safe integer, got ${show(value)}. ` +
        'Canonical JSON is integers only (§11.6).',
    );
  }
  return value;
};

/** Build a replay from a plan. Node epochs become ticks relative to `startEpoch`. */
export const replayFromPlan = (plan: Plan, context: ReplayContext): ReplayV1 => {
  const originTicks = toEpochTicks(context.startEpoch);
  return {
    v: REPLAY_SCHEMA_VERSION,
    s: context.scenarioId,
    e: requireInteger(context.engineMajor, 'engine major version'),
    n: plan.nodes.map((node): ReplayNode => {
      const [radial, transverse, normal] = node.deltaVCounts;
      return [node.epochTicks - originTicks, transverse, radial, normal];
    }),
    a: requireInteger(context.assists, 'assist bitmask'),
    c: {
      dv: requireInteger(context.claim.dv, 'claimed delta-v'),
      t: requireInteger(context.claim.t, 'claimed elapsed time'),
    },
  };
};

/**
 * Rebuild a plan from a replay, restoring absolute epochs from `startEpoch`.
 *
 * The counts are used as they stand — they are already quantised, and re-quantising
 * them would be FR-105's "re-applied downstream" mistake — but they are validated,
 * and the resulting plan goes through {@link createPlan}, so a replay whose nodes are
 * out of order or too close together is rejected here rather than becoming an
 * unreproducible trajectory.
 *
 * @throws RangeError when a count is not a safe integer, or when the nodes violate
 * FR-101.
 */
export const planFromReplay = (replay: ReplayV1, startEpoch: Epoch): Plan => {
  const originTicks = toEpochTicks(startEpoch);
  return createPlan(
    replay.n.map(([epochQ, prQ, raQ, noQ]) => {
      const counts: DeltaVCounts = [raQ, prQ, noQ];
      return maneuverNodeFromCounts(originTicks + epochQ, counts);
    }),
  );
};

/** Serialise an integer, having checked that it is one. */
const int = (value: number, what: string): string => String(requireInteger(value, what));

/**
 * Canonical JSON for a replay: keys sorted, no whitespace, integers only (§11.6).
 *
 * The string field goes through `JSON.stringify`, which is the one place a hand-rolled
 * writer would be worse: ECMAScript specifies the escaping completely, including the
 * `\uXXXX` form for lone surrogates, so it is already deterministic across runtimes
 * and re-deriving it here could only introduce a difference.
 *
 * @throws RangeError when any numeric field is not a safe integer.
 */
export const canonicalJson = (replay: ReplayV1): string => {
  const nodes = replay.n
    .map(
      ([epochQ, prQ, raQ, noQ]) =>
        `[${int(epochQ, 'node epoch')},${int(prQ, 'node prograde delta-v')},` +
        `${int(raQ, 'node radial delta-v')},${int(noQ, 'node normal delta-v')}]`,
    )
    .join(',');

  // Keys in sorted order: a, c, e, n, s, v. Stated, not inherited from a literal.
  return (
    `{"a":${int(replay.a, 'assist bitmask')},` +
    `"c":{"dv":${int(replay.c.dv, 'claimed delta-v')},"t":${int(replay.c.t, 'claimed elapsed time')}},` +
    `"e":${int(replay.e, 'engine major version')},` +
    `"n":[${nodes}],` +
    `"s":${JSON.stringify(replay.s)},` +
    `"v":${int(replay.v, 'schema version')}}`
  );
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const requireExactKeys = (
  value: Record<string, unknown>,
  expected: string[],
  what: string,
): void => {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, i) => key !== wanted[i])) {
    throw new RangeError(
      `${what} must have exactly the keys ${wanted.join(', ')}, got ${actual.join(', ') || '(none)'}. ` +
        'An unrecognised key means a schema this build does not implement (§11.6).',
    );
  }
};

/**
 * Parse canonical JSON into a replay, validating it completely.
 *
 * Strict on every axis that could otherwise produce a plausible wrong answer: the
 * schema version must be exactly {@link REPLAY_SCHEMA_VERSION}, every number must be
 * a safe integer, every node must have four components, and unrecognised keys are
 * rejected rather than dropped. A replay is a claim someone else's leaderboard entry
 * rests on; silently ignoring the part of it this build does not understand is the
 * one behaviour that cannot be right.
 *
 * @throws RangeError on any malformed or unsupported replay.
 * @throws SyntaxError when the input is not JSON at all — from `JSON.parse`, unwrapped,
 * because it already says exactly where the text went wrong.
 */
export const parseReplay = (json: string): ReplayV1 => {
  const parsed: unknown = JSON.parse(json);
  if (!isRecord(parsed)) {
    throw new RangeError(`a replay must be a JSON object, got ${typeof parsed}`);
  }
  requireExactKeys(parsed, ['a', 'c', 'e', 'n', 's', 'v'], 'a replay');

  const version = requireInteger(parsed['v'], 'schema version');
  if (version !== REPLAY_SCHEMA_VERSION) {
    throw new RangeError(
      `unsupported replay schema version ${String(version)}; this build reads version ` +
        `${String(REPLAY_SCHEMA_VERSION)} only. A replay from a newer schema is refused rather ` +
        'than parsed optimistically, because the failure would otherwise be a wrong trajectory ' +
        'rather than an error (§11.6).',
    );
  }

  const scenarioId = parsed['s'];
  if (typeof scenarioId !== 'string') {
    throw new RangeError(`scenario id must be a string, got ${typeof scenarioId}`);
  }

  const claim = parsed['c'];
  if (!isRecord(claim)) {
    throw new RangeError(`claimed result must be an object, got ${typeof claim}`);
  }
  requireExactKeys(claim, ['dv', 't'], 'a claimed result');

  const nodes = parsed['n'];
  if (!Array.isArray(nodes)) {
    throw new RangeError('replay nodes must be an array');
  }

  return {
    v: version,
    s: scenarioId,
    e: requireInteger(parsed['e'], 'engine major version'),
    n: nodes.map((entry: unknown, index): ReplayNode => {
      if (!Array.isArray(entry) || entry.length !== 4) {
        throw new RangeError(
          `replay node ${String(index)} must be [epochQ, prQ, raQ, noQ], four integers`,
        );
      }
      return [
        requireInteger(entry[0], `node ${String(index)} epoch`),
        requireInteger(entry[1], `node ${String(index)} prograde delta-v`),
        requireInteger(entry[2], `node ${String(index)} radial delta-v`),
        requireInteger(entry[3], `node ${String(index)} normal delta-v`),
      ];
    }),
    a: requireInteger(parsed['a'], 'assist bitmask'),
    c: {
      dv: requireInteger(claim['dv'], 'claimed delta-v'),
      t: requireInteger(claim['t'], 'claimed elapsed time'),
    },
  };
};
