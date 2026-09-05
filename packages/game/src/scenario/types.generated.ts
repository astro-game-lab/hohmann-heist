/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Generated from scenario-1.schema.json by tools/schema/generate.mjs.
 * Run `pnpm schema:write` after changing the schema; `pnpm schema:check` gates it in CI.
 */

export type Objective =
  | {
      kind: 'reach_orbit';
      goal: OrbitGoal;
      /**
       * Optional override of DEP-13's default. May tighten it, never loosen it — the table states the loosest tolerance the game will ever apply.
       */
      tolerance?: {
        radius_m: number;
        angle_rad: number;
      };
    }
  | {
      kind: 'intercept';
      targetId: string;
      /**
       * Optional override of DEP-04's 1 000 m. May tighten it, never loosen it.
       */
      maxRange_m?: number;
    }
  | {
      kind: 'rendezvous';
      targetId: string;
      /**
       * Optional override of DEP-03's 100 m. May tighten it, never loosen it.
       */
      maxRange_m?: number;
      /**
       * Optional override of DEP-03's 0.5 m/s. May tighten it, never loosen it.
       */
      maxRelSpeed_mps?: number;
    }
  | {
      kind: 'soft_rendezvous';
      targetId: string;
      /**
       * Optional override of DEP-03's 100 m. May tighten it, never loosen it.
       */
      maxRange_m?: number;
      /**
       * Optional override of DEP-03's 0.1 m/s soft limit. May tighten it, never loosen it.
       */
      maxRelSpeed_mps?: number;
    }
  | {
      kind: 'station';
      /**
       * Where the slot is, as a signed offset from the ship's longitude at the start of the plan. Positive is east. Relative rather than absolute because the sidereal angle at J2000 is not modelled (§7.4, DEP-14), and because §6.8 states contract 07's slot as '3.0 degrees east' of where the ship begins.
       */
      slotOffset_rad: number;
      /**
       * Optional override of DEP-14's ±0.05°. May tighten it, never loosen it.
       */
      maxOffset_rad?: number;
      /**
       * Optional override of DEP-14's 0.01°/day, in SI. May tighten it, never loosen it.
       */
      maxDrift_radPerSec?: number;
    };
export type Constraint =
  | {
      kind: 'altitude_floor';
      /**
       * Altitude above the reference radius. DEP-08's 100 km unless a contract says otherwise.
       */
      min_m: number;
    }
  | {
      kind: 'deadline';
      /**
       * Cap on mission elapsed time.
       */
      seconds: number;
    };
export type Assist =
  | 'closest_approach'
  | 'elements'
  | 'snapping'
  | 'constraints'
  | 'targeting_computer'
  | 'porkchop'
  | 'coach_marks';
/**
 * A message-catalogue key: dotted segments, lower camel. Resolved by @hh/ui, never rendered raw.
 */
export type CatalogueKey = string;

/**
 * A Hohmann Heist contract, version 1. Declarative data only: the loader interprets this and nothing else (FR-201). All quantities are SI and carry their unit in the field name.
 */
export interface Scenario {
  /**
   * Optional pointer back to this schema, so an editor can validate on save.
   */
  $schema?: string;
  /**
   * Stable identifier, kebab-case. Appears in URLs and save data, so it never changes once shipped.
   */
  id: string;
  /**
   * Schema version. Required so that a future v2 is distinguishable from v1 rather than inferred from which fields happen to be present.
   */
  version: 1;
  act: number;
  index: number;
  title: string;
  /**
   * Message-catalogue key for the briefing text (D14, FR-910). Never literal prose: contract text is translated and reviewed separately from contract logic.
   */
  briefKey: string;
  /**
   * Message-catalogue key for the client's name, shown in the briefing (§8.3.3). A key rather than a string for the same reason briefKey is one: "withheld" is prose. Omitted when the contract names no client.
   */
  clientKey?: string;
  /**
   * The contract's fee in kilocredits (§6.10). Credits do nothing but rank a career total; the fee is flavour with a number attached, which is why it is not a game rule and nothing evaluates it. Omitted when the contract pays nothing.
   */
  fee_kcr?: number;
  epoch: {
    /**
     * Time scale. TAI only: UTC is not uniform and leap seconds make it wrong for propagation (§7.2).
     */
    scale: 'TAI';
    /**
     * Start epoch, TAI seconds past J2000.
     */
    j2000Seconds: number;
  };
  /**
   * Planning horizon: the deadline plus a margin (§6.3). Prediction is not drawn past it.
   */
  horizonSeconds: number;
  ship: {
    state: StateSpec;
    /**
     * Cap on the sum of burn magnitudes. A scalar tank, not propellant (DEP-02).
     */
    dvBudget_mps: number;
  };
  /**
   * Objects the ship can be asked to reach. Massless and non-maneuvering (DEP-11).
   */
  targets?: Target[];
  objective: Objective;
  constraints?: Constraint[];
  par: Par;
  unlocks?: string[];
  assistsAllowed?: Assist[];
  /**
   * Catalogue keys for contextual hints. At most three, and only in C01–C04 (FR-902).
   */
  coachMarks?: CatalogueKey[];
}
/**
 * An initial state, as classical elements. Semi-major axis rather than semi-latus rectum because this is the author-facing boundary and `a` is what a contract designer reasons in; the loader converts.
 */
export interface StateSpec {
  kind: 'elements';
  /**
   * Semi-major axis, metres.
   */
  a_m: number;
  /**
   * Eccentricity. Closed orbits only: an open initial orbit has an infinite semi-major axis and is not a contract.
   */
  e: number;
  i_rad: number;
  raan_rad: number;
  argp_rad: number;
  nu_rad: number;
}
export interface Target {
  id: string;
  /**
   * Display name. A call sign rather than translated prose — it is the object's name, not a sentence about it.
   */
  label: string;
  state: StateSpec;
}
/**
 * The orbit a `reach_orbit` objective asks for. No true anomaly: where on the orbit the ship is does not matter, only which orbit it is on.
 */
export interface OrbitGoal {
  a_m: number;
  e: number;
  i_rad: number;
  raan_rad: number;
  argp_rad: number;
}
/**
 * The best known solution, not a proven optimum (DEP-12). §11.5: a par without a reproducible derivation is not mergeable.
 */
export interface Par {
  dv_mps: number;
  time_s: number;
  burns: number;
  /**
   * How this par was found, in prose, naming the solver script. Reviewed by a human; the length floor only stops it being empty.
   */
  derivation: string;
  /**
   * A replay code that achieves the objective at this cost. Replayed and asserted by the content tests (§7.6 Tier 4, §13.4).
   */
  referenceReplay: string;
}
