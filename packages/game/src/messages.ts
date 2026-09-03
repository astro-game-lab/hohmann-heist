/**
 * Message keys — what `@hh/game` says, without saying it in any language.
 *
 * FR-910: *"All user-facing strings MUST come from a message catalogue; none MUST be
 * constructed by concatenation."* This module is this package's half of that. Nothing
 * here is text. A rule that fails, a scenario that will not load, an objective that
 * was missed — each of them produces a {@link GameMessage}, which is a **key and its
 * parameters**, and the catalogue in `@hh/ui` turns that into a sentence.
 *
 * ## Why the split runs exactly here
 *
 * `@hh/game` must not import `@hh/ui` — dependencies point one way (§11.1), and the
 * layer that owns the rules cannot be the layer that owns the wording. So the rules
 * emit identifiers and the presentation layer resolves them. The seam is also what
 * makes the rules testable: a test asserts that an over-budget plan reports
 * `legality.l1.overBudget` with an excess of 24 m/s, which is a statement about the
 * rule. Asserting `'Over budget by 24 m/s'` would be a statement about English.
 *
 * ## Both halves of the catalogue contract are compile-time, not test-time
 *
 * {@link GameMessageParams} is an interface, so `@hh/ui`'s catalogue — a mapped type
 * over its keys — cannot compile while a key is missing from it, and cannot compile
 * with a key that is not in it. That is stronger than the test #88 asks for, and the
 * test is still there, because a compile-time guarantee that nobody can see the shape
 * of is one refactor away from being quietly relaxed.
 *
 * Parameters are **values, never fragments**. `excessMps` is a number and the
 * catalogue decides how to render it; there is no key whose parameter is a piece of a
 * sentence, because assembling one would put word order in this package and word order
 * is exactly what does not survive translation.
 *
 * ## Naming
 *
 * `area.subject.detail`, lower camel in each segment. Legality reasons carry their
 * §6.4 code in the second segment (`legality.l1.overBudget`) so the key, the product
 * definition, and the message a player sees are all obviously the same rule.
 */

/**
 * What a parameter may be.
 *
 * Numbers stay numbers all the way into the catalogue, which is where `Intl` formats
 * them for the locale. A pre-formatted string here would be a string built in this
 * package, and the whole point is that this package builds none.
 *
 * Strings are permitted for identifiers that are not translated and not formatted — a
 * `targetId` out of a scenario file, a JSON pointer into one. They are quoted by the
 * catalogue, never inflected by it.
 *
 * A list of identifiers stays a **list**, not a joined string. Joining it here would
 * hard-code English's comma-and-"or", which is exactly the kind of assembly FR-910
 * exists to prevent; the catalogue has `Intl.ListFormat` and the locale, and this
 * package has neither.
 */
export type MessageParamValue = string | number | readonly string[];

/** The parameters accompanying a key. */
export type MessageParams = Readonly<Record<string, MessageParamValue>>;

/**
 * Every key this package can emit, with the parameters it supplies with each.
 *
 * Adding a key here is a compile error in `@hh/ui` until the catalogue answers it,
 * which is the intended order of work: decide what the rule needs to say, then say it.
 */
export interface GameMessageParams {
  // ── Legality (§6.4, FR-108) ───────────────────────────────────────────────
  /** `L1` — the plan spends more than the contract's Δv budget. */
  readonly 'legality.l1.overBudget': {
    readonly usedMps: number;
    readonly budgetMps: number;
    readonly excessMps: number;
  };
  /** `L2` — the trajectory goes below the altitude floor (DEP-08). */
  readonly 'legality.l2.belowAltitudeFloor': {
    readonly floorAltitudeM: number;
    readonly metSeconds: number;
    readonly intervalCount: number;
  };
  /** `L3` — a burn, or the plan itself, extends past the deadline. */
  readonly 'legality.l3.pastDeadline': {
    readonly metSeconds: number;
    readonly deadlineSeconds: number;
    readonly overSeconds: number;
  };
  /** `L4` — an arc is open: the spacecraft escapes rather than orbits. */
  readonly 'legality.l4.escapes': {
    readonly arcIndex: number;
    readonly eccentricity: number;
    readonly metSeconds: number;
  };
  /** `L5` — two nodes closer together than the minimum spacing. */
  readonly 'legality.l5.nodesTooClose': {
    readonly firstIndex: number;
    readonly secondIndex: number;
    readonly gapSeconds: number;
    readonly minimumSeconds: number;
  };
  /** `L6` — the objective is not met anywhere in the timeline. A warning, never a block. */
  readonly 'legality.l6.objectiveNotMet': Record<string, never>;

  // ── Plans that have no timeline at all ────────────────────────────────────
  /** A burn left position and velocity parallel; there is no orbital plane to continue on. */
  readonly 'legality.plan.rectilinear': { readonly nodeIndex: number };
  /** Propagation did not converge, so no trajectory can be shown. */
  readonly 'legality.plan.nonConvergent': { readonly nodeIndex: number };

  // ── Scenario loading (FR-202) ─────────────────────────────────────────────
  /** The bytes are not JSON. */
  readonly 'scenario.error.malformedJson': { readonly detail: string };
  /** The document declares a `version` this build does not implement. */
  readonly 'scenario.error.unsupportedVersion': {
    readonly version: number;
    readonly supported: number;
  };
  /** A required property is absent. */
  readonly 'scenario.error.required': { readonly path: string; readonly property: string };
  /** A property the schema does not define — a typo, not something to ignore (G6). */
  readonly 'scenario.error.unknownProperty': { readonly path: string; readonly property: string };
  /** A value of the wrong type. */
  readonly 'scenario.error.type': { readonly path: string; readonly expected: string };
  /** A number outside its permitted range. */
  readonly 'scenario.error.range': { readonly path: string; readonly limit: number };
  /** A value outside a closed set. `allowed` is a list of identifiers, not prose. */
  readonly 'scenario.error.notAllowed': {
    readonly path: string;
    readonly allowed: readonly string[];
  };
  /** A string that does not match its pattern. */
  readonly 'scenario.error.pattern': { readonly path: string; readonly pattern: string };
  /** An array with the wrong number of entries. */
  readonly 'scenario.error.itemCount': { readonly path: string; readonly limit: number };
  /** A string of the wrong length. Characters, not entries — a separate key because the wording differs. */
  readonly 'scenario.error.stringLength': { readonly path: string; readonly limit: number };
  /** Entries that must differ do not. */
  readonly 'scenario.error.duplicate': { readonly path: string };
  /** Anything else the schema rejected. The keyword is an identifier, not prose. */
  readonly 'scenario.error.invalidField': { readonly path: string; readonly keyword: string };

  // ── Scenario semantics the schema cannot express (FR-202) ─────────────────
  /** The objective names a target that is not in `targets`. */
  readonly 'scenario.error.unknownTarget': { readonly path: string; readonly targetId: string };
  /** Two targets share an `id`. */
  readonly 'scenario.error.duplicateTargetId': { readonly path: string; readonly targetId: string };
  /** A deadline the planning horizon cannot reach. */
  readonly 'scenario.error.deadlineBeyondHorizon': {
    readonly deadlineSeconds: number;
    readonly horizonSeconds: number;
  };
  /** An altitude floor above the ship's own starting altitude: unplayable from the first frame. */
  readonly 'scenario.error.startsBelowFloor': {
    readonly startAltitudeM: number;
    readonly floorAltitudeM: number;
  };
  /** The same constraint kind appears twice. */
  readonly 'scenario.error.duplicateConstraint': { readonly path: string; readonly kind: string };
  /**
   * A scenario asked for a tolerance looser than the departure table's.
   *
   * §7.5 states the loosest tolerance the game will ever apply, and the player is told
   * it in the briefing. A contract may be harder than that; it may not be more
   * forgiving than what they were promised.
   */
  readonly 'scenario.error.toleranceTooLoose': {
    readonly path: string;
    readonly requested: number;
    readonly limit: number;
  };
}

/** Every key this package can emit. */
export type GameMessageKey = keyof GameMessageParams;

/**
 * A key together with its parameters, narrowed so that `key` determines `params`.
 *
 * Distributed over the union rather than written as `{ key: GameMessageKey; params:
 * MessageParams }`, so that narrowing on `key` narrows the parameters with it — a
 * `switch` in a debrief renderer gets the right shape in each branch without a cast.
 */
export type GameMessage = {
  readonly [K in GameMessageKey]: { readonly key: K; readonly params: GameMessageParams[K] };
}[GameMessageKey];

/** A {@link GameMessage} for one specific key. Useful where a field's key is fixed. */
export interface GameMessageOf<K extends GameMessageKey> {
  readonly key: K;
  readonly params: GameMessageParams[K];
}

/**
 * Build a message.
 *
 * Frozen, because a message travels into a UI layer that has no business editing it,
 * and because an evaluator returning a shared mutable object is a bug waiting for a
 * second caller.
 */
export const gameMessage = <K extends GameMessageKey>(
  key: K,
  params: GameMessageParams[K],
): GameMessageOf<K> => {
  const message: GameMessageOf<K> = { key, params };
  return Object.freeze(message);
};

/** The parameterless message, spelled once so `L6` and its kin do not each invent it. */
export const NO_PARAMS: Record<string, never> = Object.freeze({});
