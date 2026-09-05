/**
 * The departures registry — §7.5 and NFR-005, as data rather than prose.
 *
 * `docs/PHYSICS.md` carries a table of every place the game knowingly departs from the
 * physics. A table in a document is a promise; this is the part a machine can check.
 *
 * ## What this catches that `dependency-cruiser` cannot
 *
 * The layering rule stops `@hh/sim` importing `@hh/game`. It says nothing about a
 * gameplay tolerance written *directly into* `@hh/astro` — no illegal import is needed
 * to hard-code 100 m in a rendezvous check in the wrong package, and no import graph
 * can tell that constant apart from a physical one. NFR-005 names the gap; this closes
 * the half of it that is checkable, by asserting that every departure the project
 * admits to has a home, and that the home is `@hh/game` or above.
 *
 * The other half — a departure that exists in code and is in no table — is not
 * checkable by any means we have, and saying so is more useful than implying otherwise.
 * What the registry buys against it is that adding a row is cheap and forgetting one is
 * visible: the table, the registry and the code all sit in the same pull request.
 *
 * ## Two rows sit in the core, and the type makes you say why
 *
 * `docs/PHYSICS.md` already marks DEP-09 and DEP-11 as core rows — a determinism
 * mechanism and a modelling assumption, neither a simplification for fun. A registry
 * that could not express that would either have to lie about where they live or drop
 * them, and a table that omits the awkward rows is worse than no table.
 *
 * So {@link CoreDeparture} exists, and it **requires** a `coreReason`. The exception is
 * available and it costs a sentence, which is the right price: it is not possible to
 * put a departure in the core by accident, and it is not possible to put one there
 * quietly.
 *
 * **DEP-01 is the third such row, and this registry is what forced the question.**
 * `docs/PRODUCT.md` §7.5 places impulsive burns in `@hh/game/maneuver`. They are in
 * `packages/sim/src/maneuver.ts`, and they cannot move: FR-102 specifies the timeline
 * as "alternating Keplerian arcs and impulses", so the impulsive model is not a
 * simplification layered over the dynamics — it *is* how the product defines the
 * dynamics, and `@hh/sim` cannot import the layer above it to ask what a burn means.
 * The honest reconciliation is the one already applied to DEP-11: a core row with the
 * reason stated. §7.5 and `docs/PHYSICS.md` were corrected in the same change that
 * added this file.
 *
 * ## Status, and why `planned` rows are carried
 *
 * Six of the thirteen departures have no code yet. Carrying them as `planned` is what
 * lets the cross-check against `docs/PHYSICS.md` be an **equality** of identifier sets
 * rather than a containment — and containment is not a gate, because the whole failure
 * mode is a row that exists on one side only.
 */

/** Identifier as it appears in §7.5 and in `docs/PHYSICS.md`. */
export type DepartureId = `DEP-${string}`;

/**
 * Whether the departure has code behind it yet.
 *
 * `active` means the departure is in effect in shipped code. `planned` means it is
 * declared and agreed and nothing implements it. There is deliberately no third value
 * for "partially": a departure that is half-implemented is `planned` until the thing it
 * promises the player is true.
 */
export type DepartureStatus = 'active' | 'planned';

/** Whether §7.5 undertakes to show this departure to the player. */
export type DepartureVisibility = 'player-visible' | 'internal';

interface DepartureBase {
  readonly id: DepartureId;
  /** One line, matching the intent of the table's "Departure" column. Not player-facing text. */
  readonly summary: string;
  /**
   * Module the departure lives in, or `null` when it is realised by absence.
   *
   * DEP-11 is the null case: "targets are massless" is implemented by there being no
   * code anywhere that computes a target's attraction. Naming a module for it would
   * invent a file to satisfy a schema.
   */
  readonly module: string | null;
  readonly status: DepartureStatus;
  readonly visibility: DepartureVisibility;
}

/** A departure living in `@hh/game` or above, which is where §7.5 says they all belong. */
export interface AboveCoreDeparture extends DepartureBase {
  readonly layer: 'above-core';
}

/** A departure that sits inside the simulation core, and the reason it is allowed to. */
export interface CoreDeparture extends DepartureBase {
  readonly layer: 'core';
  /**
   * Why this row is not a simplification for fun, and so why the core is the right
   * place for it. Reproduced in `docs/PHYSICS.md`'s note beside the row.
   */
  readonly coreReason: string;
}

export type Departure = AboveCoreDeparture | CoreDeparture;

/** Package prefixes that count as "`@hh/game` or above" for §7.5's rule. */
export const ABOVE_CORE_PREFIXES: readonly string[] = Object.freeze([
  '@hh/game',
  '@hh/render',
  '@hh/ui',
  'apps/web',
]);

/** Package prefixes that are the simulation core, and so need a stated reason. */
export const CORE_PREFIXES: readonly string[] = Object.freeze([
  '@hh/math',
  '@hh/astro',
  '@hh/propagation',
  '@hh/sim',
]);

/**
 * Every departure in §7.5, in identifier order.
 *
 * Order is fixed and iteration over it is ordered, so anything rendering this — the
 * briefing, the Codex — produces the same list every time (NFR-009).
 */
export const DEPARTURES: readonly Departure[] = Object.freeze([
  {
    id: 'DEP-01',
    summary: 'Impulsive burns — zero duration, no gravity losses',
    module: '@hh/sim/maneuver',
    layer: 'core',
    coreReason:
      'FR-102 defines a timeline as alternating Keplerian arcs and impulses, so the ' +
      'impulsive model is the dynamical model rather than a simplification laid over ' +
      'one. There is no finite-burn integrator for it to be a simplification of, and ' +
      '`@hh/sim` cannot import the layer above it to ask what a burn means.',
    status: 'active',
    visibility: 'player-visible',
  },
  {
    id: 'DEP-02',
    summary: 'Δv as a scalar tank; no mass, Isp or rocket equation',
    module: '@hh/game/constraints/budget',
    layer: 'above-core',
    status: 'active',
    visibility: 'player-visible',
  },
  {
    id: 'DEP-03',
    summary: 'Rendezvous tolerance 100 m and 0.5 m/s',
    module: '@hh/game/objectives/tolerances',
    layer: 'above-core',
    status: 'active',
    visibility: 'player-visible',
  },
  {
    id: 'DEP-04',
    summary: 'Intercept tolerance 1 000 m',
    module: '@hh/game/objectives/tolerances',
    layer: 'above-core',
    status: 'active',
    visibility: 'player-visible',
  },
  {
    id: 'DEP-05',
    summary: 'Time acceleration during execution, up to 100 000×',
    module: '@hh/ui/execution/playback',
    layer: 'above-core',
    status: 'active',
    visibility: 'player-visible',
  },
  {
    id: 'DEP-06',
    summary: 'Fixed Sun direction for the duration of a contract',
    module: null,
    layer: 'above-core',
    status: 'planned',
    visibility: 'player-visible',
  },
  {
    id: 'DEP-07',
    // Narrowed to the apsis half, deliberately. Node-crossing snapping has no caller in
    // v1.0 — every contract is equatorial-equivalent, so the line of nodes is undefined —
    // and `status: 'active'` for a rule half of which does nothing would be exactly the
    // "partially" this type refuses to have a value for. `snap.ts` says the same thing.
    summary: 'Node snapping to the nearest apsis within 30 s',
    module: '@hh/game/snap',
    layer: 'above-core',
    status: 'active',
    visibility: 'internal',
  },
  {
    id: 'DEP-08',
    summary: 'Altitude floor at 100 km is an instant fail',
    module: '@hh/game/constraints/altitude-floor',
    layer: 'above-core',
    status: 'active',
    visibility: 'player-visible',
  },
  {
    id: 'DEP-09',
    summary: 'Node epochs quantised to 1/1024 s; Δv components to 1e-4 m/s',
    module: '@hh/sim/quantise',
    layer: 'core',
    coreReason:
      'A determinism mechanism, not a cheat: §11.4 lists quantised input as how ' +
      'replay codes and cross-platform verification are made to agree. It has to act ' +
      'on the plan at the point the plan is built, which is in the core.',
    status: 'active',
    visibility: 'internal',
  },
  {
    id: 'DEP-10',
    summary: 'The transverse axis is labelled "prograde"',
    module: null,
    layer: 'above-core',
    status: 'planned',
    visibility: 'player-visible',
  },
  {
    id: 'DEP-11',
    summary: 'Targets are massless and do not perturb the ship',
    module: null,
    layer: 'core',
    coreReason:
      'A modelling assumption with a magnitude attached, not a simplification for ' +
      'fun: a 5 t satellite pulls about 3e-9 m s^-2 at 100 m, which is standard ' +
      'practice to neglect. Realised by absence — nothing computes it — so there is ' +
      'no module to name.',
    status: 'active',
    visibility: 'player-visible',
  },
  {
    id: 'DEP-12',
    summary: 'Par values are the best known, not the proven optimum',
    module: '@hh/game/outcome',
    layer: 'above-core',
    status: 'active',
    visibility: 'player-visible',
  },
  {
    id: 'DEP-13',
    summary:
      'reach_orbit tolerance — 10 km on periapsis and apoapsis radius, 0.1° on inclination, RAAN and argument of periapsis',
    module: '@hh/game/objectives/tolerances',
    layer: 'above-core',
    status: 'active',
    visibility: 'player-visible',
  },
  {
    id: 'DEP-14',
    summary:
      'station tolerance — mean longitude within ±0.05° of a slot, secular drift within 0.01°/day',
    module: '@hh/game/objectives/tolerances',
    layer: 'above-core',
    status: 'active',
    visibility: 'player-visible',
  },
] satisfies readonly Departure[]);

/** Look one up. `undefined` for an identifier that is not in §7.5. */
export const departureById = (id: string): Departure | undefined =>
  DEPARTURES.find((departure) => departure.id === id);

/** The rows §7.5 undertakes to show the player — what the briefing and Codex render. */
export const playerVisibleDepartures = (): readonly Departure[] =>
  DEPARTURES.filter((departure) => departure.visibility === 'player-visible');

/**
 * Whether a module path satisfies §7.5's "in `@hh/game` or above".
 *
 * A prefix test rather than an exact match, because the table names a module and the
 * rule is about the package it sits in.
 */
export const isAboveCore = (module: string): boolean =>
  ABOVE_CORE_PREFIXES.some((prefix) => module === prefix || module.startsWith(`${prefix}/`));

/** Whether a module path is in the simulation core. */
export const isCore = (module: string): boolean =>
  CORE_PREFIXES.some((prefix) => module === prefix || module.startsWith(`${prefix}/`));
