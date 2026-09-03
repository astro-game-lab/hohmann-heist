/**
 * The scenario loader — FR-201 and FR-202.
 *
 * > *Scenarios MUST be declarative JSON conforming to a published schema, loaded at
 * > runtime, **with no scenario logic in TypeScript**.*
 *
 * That last clause is the design constraint, and it is worth being precise about what
 * it forbids. This module **interprets** data: it converts units at the boundary,
 * resolves a target identifier to a target, and checks the things a JSON Schema cannot
 * express. It contains no knowledge of any particular contract — no `if (id ===
 * 'c05-tailgate')`, no table of per-contract exceptions — and it never will, because
 * the moment it does, contracts stop being data and G6's contributor on-ramp closes.
 *
 * ## Four gates, in order, and the order is the point
 *
 * 1. **Parse.** Malformed or truncated JSON produces one clear error, not an exception.
 * 2. **Version.** Checked before the schema, so a v2 document is told it is a v2
 *    document rather than being handed nineteen complaints about fields v1 has never
 *    heard of. §11.5: *"the loader refuses unknown major versions with a clear
 *    message"*.
 * 3. **Schema.** Every field-level error at once (`allErrors`), each with a JSON
 *    pointer and a catalogue key. Unknown properties are rejected rather than ignored:
 *    a typo in a contributed scenario has to be an error, because silence would mean
 *    the contributor's intent quietly did nothing (G6).
 * 4. **Semantics.** The things a schema genuinely cannot check — an objective naming a
 *    target that is not there, a deadline past the horizon, two constraints of the same
 *    kind, a start below the floor, a tolerance looser than the departure table
 *    permits. Same error shape, same specificity.
 *
 * Each gate reports *all* of its own failures and then stops. Running the semantic
 * checks on a document that failed the schema would mean reading fields that may not
 * exist or may be the wrong type, so the gate boundary is also a safety boundary.
 *
 * ## Units are converted here, exactly once
 *
 * The file speaks `a_m` and `i_rad`; the simulation speaks semi-latus rectum and
 * branded `Radians`. `p = a(1 − e²)` happens on this line and nowhere else, which is
 * the org's SI-at-the-boundary rule applied to a file format. The schema requires
 * `0 ≤ e < 1` for every state and goal, so the conversion is total: no open orbit
 * reaches it, and `a` is never infinite.
 *
 * ## What "no scenario logic" leaves for the caller
 *
 * The result carries a `rules` object that is exactly `evaluateLegality`'s input, and
 * an `objective` already resolved to the shape the evaluators want. Assembling those
 * from the raw document is interpretation, so it belongs here; deciding what to do with
 * them is gameplay, so it does not.
 */
import type { Epoch, OrbitShape, State } from '@hh/astro';
import { MU_EARTH, R_EARTH_EQ, addSeconds, epoch, stateFromElements } from '@hh/astro';
import { V, metres, metresPerSec, radians, seconds } from '@hh/math';

import type { LegalityRules } from '../legality.js';
import { gameMessage } from '../messages.js';
import type { OrbitTolerance, ProximityKind, ProximityTolerance } from '../objectives/index.js';
import {
  ALTITUDE_FLOOR_M,
  INTERCEPT_MAX_RANGE_M,
  REACH_ORBIT_TOLERANCE,
  RENDEZVOUS_MAX_RANGE_M,
  RENDEZVOUS_MAX_REL_SPEED_MPS,
  SOFT_RENDEZVOUS_MAX_REL_SPEED_MPS,
} from '../objectives/index.js';
import type { ScenarioError } from './errors.js';
import { toScenarioErrors } from './errors.js';
import type { OrbitGoal, Scenario, StateSpec } from './types.generated.js';
import validate from './validate.generated.js';

/** The only schema version this build implements. */
export const SCENARIO_VERSION = 1;

/** A target, resolved to a state. */
export interface LoadedTarget {
  readonly id: string;
  readonly label: string;
  readonly state: State;
}

/** The objective, in the shape the evaluators take. */
export type LoadedObjective =
  | { readonly kind: 'reach_orbit'; readonly goal: OrbitShape; readonly tolerance: OrbitTolerance }
  | {
      readonly kind: ProximityKind;
      readonly targetId: string;
      readonly tolerance: ProximityTolerance;
    };

/** A contract, ready to evaluate against. */
export interface LoadedScenario {
  /** The validated document, unchanged. The briefing and the Codex read fields this type does not surface. */
  readonly document: Scenario;
  readonly id: string;
  readonly startEpoch: Epoch;
  /** End of the planning horizon, as an epoch. */
  readonly horizon: Epoch;
  readonly horizonSeconds: number;
  /** Gravitational parameter of the central body. Earth is the only one in v1.0. */
  readonly mu: number;
  readonly ship: { readonly state: State; readonly dvBudgetMps: number };
  readonly targets: readonly LoadedTarget[];
  readonly objective: LoadedObjective;
  /** Exactly `evaluateLegality`'s input, assembled from the constraints array. */
  readonly rules: LegalityRules;
}

export type LoadResult =
  | { readonly ok: true; readonly scenario: LoadedScenario }
  | { readonly ok: false; readonly errors: readonly ScenarioError[] };

const failure = (errors: readonly ScenarioError[]): LoadResult => ({ ok: false, errors });

/** `p = a(1 − e²)`. Total for `0 ≤ e < 1`, which the schema guarantees. */
const orbitShapeOf = (spec: StateSpec | OrbitGoal, trueAnomalyRad: number): OrbitShape => ({
  semiLatusRectum: metres(spec.a_m * (1 - spec.e * spec.e)),
  eccentricity: spec.e,
  inclination: radians(spec.i_rad),
  raan: radians(spec.raan_rad),
  argp: radians(spec.argp_rad),
  trueAnomaly: radians(trueAnomalyRad),
});

const stateOf = (spec: StateSpec, mu: number): State =>
  stateFromElements(orbitShapeOf(spec, spec.nu_rad), mu);

/**
 * A tolerance override, refused when it is looser than the departure table's.
 *
 * §7.5 states the loosest tolerance the game will ever apply, and §6.4 requires it to
 * be shown to the player in the briefing. A contract may be *harder* than the table —
 * `soft_rendezvous` is exactly that, and the schema lets a designer go further — but it
 * may not be more forgiving than what the player was promised, because then the table
 * is no longer the truth and the briefing is no longer accurate.
 */
const boundedTolerance = (
  requested: number | undefined,
  limit: number,
  path: string,
  errors: ScenarioError[],
): number => {
  if (requested === undefined) return limit;
  if (requested > limit) {
    errors.push({
      path,
      message: gameMessage('scenario.error.toleranceTooLoose', { path, requested, limit }),
    });
    return limit;
  }
  return requested;
};

/** Semantic checks, and the conversion that depends on them passing. */
const interpret = (document: Scenario): LoadResult => {
  const errors: ScenarioError[] = [];
  const mu = MU_EARTH;

  const startEpoch = epoch(document.epoch.j2000Seconds);
  const horizonSeconds = document.horizonSeconds;

  // ── Targets ────────────────────────────────────────────────────────────────
  const rawTargets = document.targets ?? [];
  const seen = new Set<string>();
  rawTargets.forEach((target, index) => {
    const path = `/targets/${String(index)}/id`;
    if (seen.has(target.id)) {
      errors.push({
        path,
        message: gameMessage('scenario.error.duplicateTargetId', { path, targetId: target.id }),
      });
    }
    seen.add(target.id);
  });
  const targets: readonly LoadedTarget[] = rawTargets.map((target) => ({
    id: target.id,
    label: target.label,
    state: stateOf(target.state, mu),
  }));

  // ── Constraints ────────────────────────────────────────────────────────────
  const rawConstraints = document.constraints ?? [];
  const byKind = new Map<string, number>();
  rawConstraints.forEach((constraint, index) => {
    const path = `/constraints/${String(index)}`;
    if (byKind.has(constraint.kind)) {
      errors.push({
        path,
        message: gameMessage('scenario.error.duplicateConstraint', {
          path,
          kind: constraint.kind,
        }),
      });
      return;
    }
    byKind.set(constraint.kind, index);
  });

  const deadline = rawConstraints.find((constraint) => constraint.kind === 'deadline');
  const floor = rawConstraints.find((constraint) => constraint.kind === 'altitude_floor');

  // A contract with no explicit deadline is bounded by its own horizon, which is what
  // §6.3 says the horizon *is* — the deadline plus a margin. Defaulting to it keeps
  // `rules` total without inventing a number.
  const deadlineSeconds = deadline?.kind === 'deadline' ? deadline.seconds : horizonSeconds;
  const floorAltitudeM = floor?.kind === 'altitude_floor' ? floor.min_m : ALTITUDE_FLOOR_M;

  if (deadlineSeconds > horizonSeconds) {
    const path = '/constraints';
    errors.push({
      path,
      message: gameMessage('scenario.error.deadlineBeyondHorizon', {
        deadlineSeconds,
        horizonSeconds,
      }),
    });
  }

  // ── Ship ───────────────────────────────────────────────────────────────────
  const shipState = stateOf(document.ship.state, mu);
  const startAltitudeM = V.norm(shipState.position) - R_EARTH_EQ;
  if (startAltitudeM < floorAltitudeM) {
    errors.push({
      path: '/ship/state',
      message: gameMessage('scenario.error.startsBelowFloor', {
        startAltitudeM,
        floorAltitudeM,
      }),
    });
  }

  // ── Objective ──────────────────────────────────────────────────────────────
  const objective = ((): LoadedObjective => {
    const raw = document.objective;
    if (raw.kind === 'reach_orbit') {
      return {
        kind: 'reach_orbit',
        goal: orbitShapeOf(raw.goal, 0),
        tolerance: {
          radiusM: metres(
            boundedTolerance(
              raw.tolerance?.radius_m,
              REACH_ORBIT_TOLERANCE.radiusM,
              '/objective/tolerance/radius_m',
              errors,
            ),
          ),
          angleRad: radians(
            boundedTolerance(
              raw.tolerance?.angle_rad,
              REACH_ORBIT_TOLERANCE.angleRad,
              '/objective/tolerance/angle_rad',
              errors,
            ),
          ),
        },
      };
    }

    if (!seen.has(raw.targetId)) {
      const path = '/objective/targetId';
      errors.push({
        path,
        message: gameMessage('scenario.error.unknownTarget', { path, targetId: raw.targetId }),
      });
    }

    const rangeLimit = raw.kind === 'intercept' ? INTERCEPT_MAX_RANGE_M : RENDEZVOUS_MAX_RANGE_M;
    const maxRangeM = metres(
      boundedTolerance(raw.maxRange_m, rangeLimit, '/objective/maxRange_m', errors),
    );

    if (raw.kind === 'intercept') {
      return {
        kind: 'intercept',
        targetId: raw.targetId,
        tolerance: { maxRangeM, maxRelativeSpeedMps: null },
      };
    }

    const speedLimit =
      raw.kind === 'rendezvous' ? RENDEZVOUS_MAX_REL_SPEED_MPS : SOFT_RENDEZVOUS_MAX_REL_SPEED_MPS;
    return {
      kind: raw.kind,
      targetId: raw.targetId,
      tolerance: {
        maxRangeM,
        maxRelativeSpeedMps: metresPerSec(
          boundedTolerance(raw.maxRelSpeed_mps, speedLimit, '/objective/maxRelSpeed_mps', errors),
        ),
      },
    };
  })();

  if (errors.length > 0) return failure(errors);

  return {
    ok: true,
    scenario: {
      document,
      id: document.id,
      startEpoch,
      horizon: addSeconds(startEpoch, seconds(horizonSeconds)),
      horizonSeconds,
      mu,
      ship: { state: shipState, dvBudgetMps: document.ship.dvBudget_mps },
      targets,
      objective,
      rules: {
        budgetMps: document.ship.dvBudget_mps,
        deadlineSeconds,
        floorAltitudeM,
      },
    },
  };
};

/** The `version` field, if the document has one that is a number. */
const declaredVersion = (document: unknown): number | null => {
  if (typeof document !== 'object' || document === null) return null;
  const value = (document as Record<string, unknown>)['version'];
  return typeof value === 'number' ? value : null;
};

/**
 * Validate and interpret an already-parsed document.
 *
 * Separate from {@link loadScenario} because a scenario can arrive as an object rather
 * than as text — bundled with the app, generated for the daily challenge (FR-205), or
 * handed in by a test — and re-serialising it just to parse it again would be silly.
 */
export const parseScenario = (document: unknown): LoadResult => {
  const version = declaredVersion(document);
  if (version !== null && version !== SCENARIO_VERSION) {
    const path = '/version';
    return failure([
      {
        path,
        message: gameMessage('scenario.error.unsupportedVersion', {
          version,
          supported: SCENARIO_VERSION,
        }),
      },
    ]);
  }

  if (!validate(document)) {
    return failure(toScenarioErrors(validate.errors ?? []));
  }

  return interpret(document);
};

/**
 * Load a scenario from JSON text.
 *
 * Malformed input is a **result**, not an exception: this is called on files a
 * contributor is editing and on a URL parameter a player can paste (FR-208), and
 * neither is a caller error.
 */
export const loadScenario = (text: string): LoadResult => {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return failure([
      { path: '/', message: gameMessage('scenario.error.malformedJson', { detail }) },
    ]);
  }
  return parseScenario(document);
};
