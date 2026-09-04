/**
 * The node editor's arithmetic — §8.3.5, #137, FR-410.
 *
 * Two things the overlay needs that are not rendering: how a mission-elapsed time splits
 * into the four fields §8.3.5 draws, and what the burn did to the orbit. Both are pure,
 * both are DOM-free, and both are here rather than in the component because they are the
 * parts worth testing without a browser.
 *
 * ## The epoch is four fields, not one parsed string
 *
 * §8.3.5 draws `T+ [00]:[04]:[12].[000]`. A single text input parsed with a regular
 * expression is the obvious implementation and is worse in three ways that matter:
 * a screen reader announces one field where there are four quantities; a player cannot
 * tab to the minutes; and "invalid" becomes a parse failure rather than a value out of
 * range, which makes §8.3.5's *"rejected on blur with the previous value restored, never
 * silently clamped"* hard to honour precisely — you cannot restore a previous value for a
 * field that never existed.
 *
 * So the parts are the model. {@link metParts} splits, {@link metFromParts} recombines,
 * and recombining **refuses** rather than clamps: an out-of-range part returns `null`, and
 * the component restores what was there. That refusal is the requirement, and having it
 * in a pure function is what lets `node-editor.test.ts` state it once.
 *
 * ## The result block is a delta, and that is the learning surface
 *
 * FR-410 and §8.3.5: the block shows the resulting orbit's apoapsis, periapsis and period
 * *as deltas against the pre-burn orbit*, live. §8.3.5 says why in one line — *"a player
 * watching 'periapsis −125.8' while dragging prograde **sees** the rule"* — and it is the
 * answer to the problem the M1 spike measured: a 45 m/s change moves the drawn trajectory
 * 5.455 px at LEO, so the orbit view cannot show a Δv edit's effect and the numbers have
 * to.
 *
 * {@link burnResult} therefore takes both orbits and returns both values and their
 * differences. It does not take a plan, a node index or a timeline: the caller has the
 * impulse, which already carries the state on each side of the burn, and asking for less
 * keeps this testable with two element sets and no propagation at all.
 */
import type { OrbitShape } from '@hh/astro';
import { apoapsisRadius, period, periapsisRadius, semiMajorAxis } from '@hh/astro';

/** Mission elapsed time, as §8.3.5's four fields. */
export interface MetParts {
  readonly hours: number;
  readonly minutes: number;
  readonly seconds: number;
  readonly milliseconds: number;
}

/** Upper bounds for the three wrapping fields. Hours are bounded by the horizon instead. */
const LIMITS = { minutes: 59, seconds: 59, milliseconds: 999 } as const;

/**
 * Split a mission elapsed time into fields.
 *
 * Rounds to the millisecond, which is the resolution §8.3.5's field offers. Note this is
 * *coarser* than DEP-09's 1/1024 s tick, so typing a time back in does not generally
 * reproduce the epoch it came from to the tick — the field is a control, and the node's
 * canonical value is its tick count. `createManeuverNode` quantises whatever it is given,
 * so the round trip is stable after the first pass rather than drifting on each one.
 */
export const metParts = (metSeconds: number): MetParts => {
  const totalMs = Math.max(0, Math.round(metSeconds * 1000));
  return {
    hours: Math.floor(totalMs / 3_600_000),
    minutes: Math.floor(totalMs / 60_000) % 60,
    seconds: Math.floor(totalMs / 1000) % 60,
    milliseconds: totalMs % 1000,
  };
};

/**
 * Recombine fields into a mission elapsed time, or refuse.
 *
 * `null` for anything out of range, negative, or not an integer — §8.3.5's *"rejected on
 * blur with the previous value restored, never silently clamped"*. Clamping is the
 * tempting alternative and is the thing the sentence rules out: a player who types 75
 * minutes meant something, and silently turning it into 59 produces a plan they did not
 * author and cannot see is different.
 */
export const metFromParts = (parts: MetParts): number | null => {
  const { hours, minutes, seconds, milliseconds } = parts;
  for (const value of [hours, minutes, seconds, milliseconds]) {
    if (!Number.isInteger(value) || value < 0) return null;
  }
  if (minutes > LIMITS.minutes) return null;
  if (seconds > LIMITS.seconds) return null;
  if (milliseconds > LIMITS.milliseconds) return null;
  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
};

/** One quantity before and after the burn, with the change between them. */
export interface ResultRow {
  readonly before: number;
  readonly after: number;
  readonly delta: number;
}

/** §8.3.5's result block. Altitudes in metres, period in seconds; all SI. */
export interface BurnResult {
  readonly apoapsisAltitude: ResultRow | null;
  readonly periapsisAltitude: ResultRow;
  readonly period: ResultRow | null;
}

const row = (before: number, after: number): ResultRow => ({
  before,
  after,
  delta: after - before,
});

/**
 * What the burn did to the orbit.
 *
 * `null` rows are absent quantities rather than unknown ones: an open orbit has no
 * apoapsis and no period, and reporting a negative period for a hyperbola would be worse
 * than saying nothing. A burn that *opens* the orbit therefore loses both rows, which is
 * itself the clearest possible statement of what just happened.
 */
export const burnResult = (
  before: OrbitShape,
  after: OrbitShape,
  mu: number,
  referenceRadiusM: number,
): BurnResult => {
  const closed = before.eccentricity < 1 && after.eccentricity < 1;
  return {
    apoapsisAltitude: closed
      ? row(apoapsisRadius(before) - referenceRadiusM, apoapsisRadius(after) - referenceRadiusM)
      : null,
    periapsisAltitude: row(
      periapsisRadius(before) - referenceRadiusM,
      periapsisRadius(after) - referenceRadiusM,
    ),
    period: closed
      ? row(period(semiMajorAxis(before), mu), period(semiMajorAxis(after), mu))
      : null,
  };
};

/**
 * §8.3.5's stepper increments: 1 m/s, ×0.1 with Shift, ×10 with Ctrl.
 *
 * Exported as a function of the modifiers rather than as three constants so the rule is
 * stated once and the same call answers a stepper button, an arrow key and a touch
 * control. §8.5.3's `↑`/`↓` table uses the identical modifiers, which is not a
 * coincidence — it is the same operation reached three ways.
 *
 * Shift and Ctrl together take the Shift branch: the finer step is the safer one to
 * apply when a player has asked for both, and it is what a stepper held down with a hand
 * resting on the keyboard should do.
 */
export const DELTA_V_STEP_MPS = 1;

export const deltaVStep = (modifiers: {
  readonly shift?: boolean;
  readonly ctrl?: boolean;
}): number => {
  if (modifiers.shift === true) return DELTA_V_STEP_MPS * 0.1;
  if (modifiers.ctrl === true) return DELTA_V_STEP_MPS * 10;
  return DELTA_V_STEP_MPS;
};
