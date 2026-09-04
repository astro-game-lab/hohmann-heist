/**
 * Shared fixtures for this package's tests.
 *
 * Not exported from the barrel and not reachable from any source file — it exists so
 * that eight test files do not each rebuild a timeline the same way and then drift.
 * `vitest.config.ts` excludes it from coverage for the same reason it excludes
 * `*.test.ts`: it is scaffolding, and counting it would flatter the number NFR-022's
 * gate exists to keep honest.
 */
import type { Epoch, State } from '@hh/astro';
import { MU_EARTH, epoch, rtn, stateFromElements } from '@hh/astro';
import type { MetresPerSec } from '@hh/math';
import { V, metres, metresPerSec, radians } from '@hh/math';
import type { ManeuverNode, Plan, Timeline, TimelineResult } from '@hh/sim';
import type { GameMessage, GameMessageKey, GameMessageOf } from './messages.js';
import { EMPTY_PLAN, buildTimeline, createManeuverNode, createPlan } from '@hh/sim';

/**
 * Narrow a message to one key, failing the test rather than asserting the check away.
 *
 * `GameMessage` is distributed over its keys, so narrowing on a *literal* key works
 * perfectly at a call site — `message.key === 'flightLog.burn'` gives the right
 * parameters. What TypeScript cannot do is narrow by a **generic** key, which is what a
 * shared helper needs, so the assertion below is discharged at run time and the cast
 * records exactly that. The alternative — indexing `params` with a string at every call
 * site — loses the parameter types entirely, which is the thing worth keeping.
 */
export const messageOf = <K extends GameMessageKey>(
  message: GameMessage | undefined,
  key: K,
): GameMessageOf<K> => {
  if (message === undefined) throw new Error(`expected a "${key}" message, got none`);
  if (message.key !== key) throw new Error(`expected "${key}", got "${message.key}"`);
  return message as GameMessageOf<K>;
};

/** Narrow away `undefined`, failing the test rather than asserting it away. */
export const definitely = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error('expected a value, got undefined');
  return value;
};

export const START: Epoch = epoch(0);
/** Six hours — a few revolutions at LEO, and quick. */
export const HORIZON: Epoch = epoch(6 * 3600);

/** Radius of a 400 km circular parking orbit, in metres. WGS-84 equatorial radius plus 400 km. */
export const LEO_RADIUS_M = 6_778_137;

/**
 * A circular orbit, by radius and orientation.
 *
 * `e = 0` exactly, so `p = a`, which is why this takes a radius rather than a
 * semi-latus rectum: at zero eccentricity they are the same number and the radius is
 * the one a reader can check.
 */
export const circular = (
  radiusM: number,
  inclinationRad = 0,
  raanRad = 0,
  trueAnomalyRad = 0,
): State =>
  stateFromElements(
    {
      semiLatusRectum: metres(radiusM),
      eccentricity: 0,
      inclination: radians(inclinationRad),
      raan: radians(raanRad),
      argp: radians(0),
      trueAnomaly: radians(trueAnomalyRad),
    },
    MU_EARTH,
  );

/** An elliptical orbit, by its two apsis radii. */
export const elliptical = (
  periapsisM: number,
  apoapsisM: number,
  inclinationRad = 0,
  raanRad = 0,
  argpRad = 0,
  trueAnomalyRad = 0,
): State => {
  const a = (periapsisM + apoapsisM) / 2;
  const e = (apoapsisM - periapsisM) / (apoapsisM + periapsisM);
  return stateFromElements(
    {
      semiLatusRectum: metres(a * (1 - e * e)),
      eccentricity: e,
      inclination: radians(inclinationRad),
      raan: radians(raanRad),
      argp: radians(argpRad),
      trueAnomaly: radians(trueAnomalyRad),
    },
    MU_EARTH,
  );
};

/** The default ship: 400 km circular at ISS inclination. */
export const LEO: State = circular(LEO_RADIUS_M, 0.9006, 1.1, 0.6);

/** A delta-v in RTN. */
export const dv = (radial: number, transverse: number, normal = 0) =>
  rtn(V.vec3<MetresPerSec>(metresPerSec(radial), metresPerSec(transverse), metresPerSec(normal)));

/** A node at `seconds` past the start, burning `transverse` m/s prograde by default. */
export const nodeAt = (seconds: number, transverse = 25, radial = 0, normal = 0): ManeuverNode =>
  createManeuverNode({ epoch: epoch(seconds), deltaVRtn: dv(radial, transverse, normal) });

/** A plan from bare `(seconds, transverse)` pairs. */
export const planOf = (
  ...nodes: readonly (readonly [seconds: number, transverse: number])[]
): Plan =>
  nodes.length === 0
    ? EMPTY_PLAN
    : createPlan(nodes.map(([seconds, transverse]) => nodeAt(seconds, transverse)));

/** Unwrap a timeline, failing loudly on the variants a test did not expect. */
export const built = (result: TimelineResult): Timeline => {
  if (!result.ok) {
    throw new Error(
      `expected a timeline, got ${result.reason} at node ${String(result.nodeIndex)}`,
    );
  }
  return result.timeline;
};

export interface TimelineOptions {
  readonly initialState?: State;
  readonly horizon?: Epoch;
  readonly startEpoch?: Epoch;
}

/** Build a timeline over the default LEO orbit and horizon. */
export const timelineFor = (plan: Plan, options: TimelineOptions = {}): Timeline =>
  built(
    buildTimeline({
      startEpoch: options.startEpoch ?? START,
      initialState: options.initialState ?? LEO,
      plan,
      horizon: options.horizon ?? HORIZON,
      mu: MU_EARTH,
    }),
  );

/** The raw result, for the tests that are about the failures. */
export const timelineResultFor = (plan: Plan, options: TimelineOptions = {}): TimelineResult =>
  buildTimeline({
    startEpoch: options.startEpoch ?? START,
    initialState: options.initialState ?? LEO,
    plan,
    horizon: options.horizon ?? HORIZON,
    mu: MU_EARTH,
  });
