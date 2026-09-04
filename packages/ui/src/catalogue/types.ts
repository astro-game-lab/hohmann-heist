/**
 * The catalogue's contract — FR-910 and NFR-028.
 *
 * > *All user-facing strings MUST come from a message catalogue; none MUST be
 * > constructed by concatenation.*
 *
 * ## A message is a function, not a template string
 *
 * The obvious catalogue is `Record<string, string>` with `{placeholders}` in it. It
 * fails the last of #88's criteria — *"the message shape does not assume English word
 * order or English pluralisation rules"* — in two ways at once, and both are the kind
 * of failure that only shows up when the second language arrives.
 *
 * **Word order.** A template is a string with holes at fixed positions. Translating it
 * means moving the holes, which the format allows, right up until a language needs a
 * parameter *twice*, or needs one parameter's form to depend on another's value. German
 * and Russian both do routinely.
 *
 * **Pluralisation.** English has two plural categories. Arabic has six, Polish has four,
 * Japanese has one. A template engine that handles this grows into a small language of
 * its own — which is what ICU MessageFormat is, and it costs a runtime dependency and a
 * parser.
 *
 * A **function** `(params, fmt) => string` has neither problem. It is code, so it can
 * put its parameters wherever the language wants them, use one twice, branch on
 * `Intl.PluralRules`, and format numbers through `Intl.NumberFormat` for the locale. It
 * costs nothing at runtime — no parser, no dependency — and the compiler checks that
 * every message takes the parameters its key declares.
 *
 * What it gives up is that a message is not extractable to a `.po` file by a script. For
 * a game whose strings are keys in a typed catalogue, that trade is worth making: the
 * translator's unit is the function body, and the type says exactly what is available
 * to it.
 *
 * ## Where the keys come from
 *
 * `@hh/game` declares every key its rules can emit. This package declares the keys the
 * UI owns. The catalogue is a mapped type over the union of both, so **a key with no
 * message, or a message with no key, is a compile error** — which is a stronger
 * statement than the test #88 asks for, and the test is there as well because a
 * compile-time guarantee nobody can see is one refactor from being relaxed.
 */
import type { GameMessageParams, MessageParams } from '@hh/game';

/**
 * Locale-aware formatting, handed to every message.
 *
 * A message never calls `toFixed` or `String(n)`: those produce a period for a decimal
 * separator and no digit grouping, which is wrong in most of Europe. Everything goes
 * through `Intl`, which is in every runtime this project targets and costs no bytes.
 */
export interface MessageFormatters {
  /** A number, with the locale's separators. `options` reaches `Intl.NumberFormat`. */
  readonly number: (value: number, options?: Intl.NumberFormatOptions) => string;
  /** A number rounded to `digits` decimal places. The common case, spelled once. */
  readonly decimal: (value: number, digits: number) => string;
  /** A whole number. */
  readonly integer: (value: number) => string;
  /** The CLDR plural category for `count` in this locale — `one`, `few`, `other`, … */
  readonly plural: (count: number) => Intl.LDMLPluralRule;
  /** A list, joined the way the locale joins lists. */
  readonly list: (items: readonly string[], type?: 'conjunction' | 'disjunction') => string;
  /** Mission elapsed time as `T+HH:MM:SS`, per `@hh/astro`'s `formatMet`. */
  readonly met: (metSeconds: number) => string;
}

/** Keys the UI owns, with their parameters. Rules' keys come from `@hh/game`. */
export interface UiMessageParams {
  readonly 'app.title': Record<string, never>;
  readonly 'app.routesLabel': Record<string, never>;
  readonly 'nav.board': Record<string, never>;
  readonly 'nav.contract': { readonly index: number };
  readonly 'nav.daily': Record<string, never>;
  readonly 'nav.codex': Record<string, never>;
  readonly 'nav.settings': Record<string, never>;
  readonly 'nav.spike': Record<string, never>;

  // ── Screen headings and the not-found state (§8.2, §8.7, #117) ─────────────
  //
  // One heading key per route in §8.2's table, rather than one key taking the screen's
  // name as a parameter. A name is a fragment, and a message built from a fragment
  // decides English's word order for every language at once — `types.ts` above says why
  // that is the one thing this catalogue does not do. It also means each of #101–#109
  // inherits a heading its screen already owns.
  //
  // The four that carry a captured segment carry it as a *value*: an id, a date, a slug.
  // None of them is inflected, and quoting them is the message's decision.
  readonly 'screen.board.heading': Record<string, never>;
  readonly 'screen.contract.heading': { readonly id: string };
  readonly 'screen.daily.heading': Record<string, never>;
  readonly 'screen.dailyDate.heading': { readonly date: string };
  readonly 'screen.leaderboard.heading': { readonly date: string };
  readonly 'screen.codex.heading': { readonly slug: string };
  readonly 'screen.replay.heading': Record<string, never>;
  readonly 'screen.settings.heading': Record<string, never>;
  readonly 'screen.notFound.heading': Record<string, never>;
  readonly 'screen.notFound.body': { readonly path: string };
  readonly 'screen.notFound.backToTitle': Record<string, never>;
  /** What a route renders while the screen that owns it is still someone else's issue. */
  readonly 'screen.notBuiltYet': Record<string, never>;

  // ── The orbit scene's labels (§9.3, D8, #113) ─────────────────────────────
  //
  // Every string the planner draws over the canvas resolves through here. `@hh/render`
  // emits the key and the raw numbers; the sentence, the unit and the rounding are this
  // layer's, because all three are locale work.
  //
  // The handle axes are DEP-10: the geometry is the *transverse* basis vector, and only
  // this label calls it "prograde". §7.5 files that as a naming departure, and keeping the
  // word here rather than in the renderer is what keeps it one.
  readonly 'planner.handle.prograde': Record<string, never>;
  readonly 'planner.handle.radial': Record<string, never>;
  /** An apsis tick's altitude above the reference radius. Metres in, kilometres out. */
  readonly 'planner.apsis.periapsis': { readonly altitudeMetres: number };
  readonly 'planner.apsis.apoapsis': { readonly altitudeMetres: number };
  /** §9.3: the tie line is "labelled with distance and Δv_rel". */
  readonly 'planner.closestApproach': {
    readonly separationMetres: number;
    readonly relativeSpeedMps: number;
  };

  // ── Contract content (§8.3.3, FR-902, D14) ────────────────────────────────
  //
  // A contract's brief and its coach marks are catalogue keys, never literal prose in
  // the scenario file, so contract *text* is translated and reviewed separately from
  // contract *logic* (§11.5). The scenario names the key; this is where the sentence
  // lives, and `tools/content/content.test.ts` fails a contract whose key is not here.
  readonly 'brief.c03': Record<string, never>;
  /**
   * A contract's client (§8.3.3), named by `clientKey` in the scenario.
   *
   * A key rather than a string for the same reason `briefKey` is one — "withheld" is
   * prose — and shared rather than one per contract, because most of them are withheld
   * and a key nobody has to invent is a key nobody gets wrong.
   */
  readonly 'client.withheld': Record<string, never>;
  readonly 'mark.c03.departureWindow': Record<string, never>;

  // ── The briefing (§8.3.3, #120) ────────────────────────────────────────────
  //
  // Every number the briefing shows arrives here in **SI** and leaves in display units.
  // That split is the whole reason these are messages rather than values formatted in the
  // component: metres in, kilometres out, is a locale decision as much as a unit one —
  // the separator, the grouping and the abbreviation's position all change with the
  // language, and none of them is the screen's business.
  //
  // §8.3.3 also asks that "every value has a tooltip with the SI value". The `briefing.si.*`
  // keys are that tooltip. They exist as their own keys rather than as a second return from
  // each display key because the tooltip is not a different rendering of the same sentence:
  // it is the raw quantity, unrounded, which is what makes it worth showing at all.
  readonly 'briefing.heading': { readonly index: number; readonly title: string };
  readonly 'briefing.backToBoard': Record<string, never>;
  /**
   * Label *and* its colon.
   *
   * The punctuation is part of the message rather than markup between two of them:
   * fr-FR writes "client :" with a non-breaking space before the colon, and a JSX
   * `{': '}` would decide that for every language — which is also why NFR-028's rule
   * refuses one.
   */
  readonly 'briefing.clientLabel': Record<string, never>;
  readonly 'briefing.feeLabel': Record<string, never>;
  /** §6.10's credits. Flavour with a number attached; no rule reads it. */
  readonly 'briefing.fee': { readonly kilocredits: number };

  readonly 'briefing.objectiveLabel': Record<string, never>;
  readonly 'briefing.dvBudgetLabel': Record<string, never>;
  readonly 'briefing.deadlineLabel': Record<string, never>;
  readonly 'briefing.parLabel': Record<string, never>;
  readonly 'briefing.setupLabel': Record<string, never>;
  readonly 'briefing.shipLabel': Record<string, never>;
  readonly 'briefing.constraintsLabel': Record<string, never>;

  readonly 'briefing.dvBudget': { readonly budgetMps: number };
  readonly 'briefing.deadline': { readonly seconds: number };
  /** D12: always shown, never hidden until it is beaten. */
  readonly 'briefing.par': {
    readonly dvMps: number;
    readonly timeSeconds: number;
    readonly burns: number;
  };

  // One key per objective kind, and each says the whole sentence. Assembling "Intercept"
  // + a target + "within 1.0 km" from three parameters would fix English's word order for
  // every language at once, which is the failure `types.ts` opens by describing.
  readonly 'briefing.objective.reachOrbit': {
    readonly periapsisAltitudeMetres: number;
    readonly apoapsisAltitudeMetres: number;
  };
  readonly 'briefing.objective.intercept': {
    readonly target: string;
    readonly rangeMetres: number;
  };
  readonly 'briefing.objective.rendezvous': {
    readonly target: string;
    readonly rangeMetres: number;
    readonly relativeSpeedMps: number;
  };
  readonly 'briefing.objective.softRendezvous': {
    readonly target: string;
    readonly rangeMetres: number;
    readonly relativeSpeedMps: number;
  };

  // The setup rows. Four keys rather than two plus a phase fragment, for the same reason.
  readonly 'briefing.setup.circular': { readonly altitudeMetres: number };
  readonly 'briefing.setup.circularPhased': {
    readonly altitudeMetres: number;
    readonly trueAnomalyRad: number;
  };
  readonly 'briefing.setup.ellipse': {
    readonly periapsisAltitudeMetres: number;
    readonly apoapsisAltitudeMetres: number;
  };
  readonly 'briefing.setup.ellipsePhased': {
    readonly periapsisAltitudeMetres: number;
    readonly apoapsisAltitudeMetres: number;
    readonly trueAnomalyRad: number;
  };

  // §6.5's constraints, one line each. Only the two the scenario schema carries today have
  // a key; the other six arrive with the rules that evaluate them.
  readonly 'briefing.constraint.altitudeFloor': { readonly floorAltitudeM: number };

  // The footer, and §8.3.3's four states.
  readonly 'briefing.recordNone': Record<string, never>;
  readonly 'briefing.record': {
    readonly bestDvMps: number;
    readonly medal: string;
    readonly attempts: number;
  };
  readonly 'briefing.attempts': { readonly attempts: number };
  readonly 'briefing.dailyVariant': { readonly date: string };
  readonly 'briefing.leaderboardLink': Record<string, never>;
  /** §6.8's unlock rule, stated. The rule is not evaluated here — see the screen. */
  readonly 'briefing.locked': { readonly act: number };
  readonly 'briefing.accept': Record<string, never>;
  readonly 'briefing.unknownContract': { readonly id: string };

  /**
   * §8.3.3's tooltips: the quantity as it is actually held, unrounded.
   *
   * One key per unit that appears in the numbers block, and no more. The objective and
   * setup lines are *sentences* rather than values — "Intercept KESTREL-2 within 1.0 km"
   * has no single SI quantity behind it — so they carry no tooltip, and a `briefing.si.*`
   * key with nothing to attach to would be a key that rots.
   */
  readonly 'briefing.si.metresPerSecond': { readonly metresPerSecond: number };
  readonly 'briefing.si.seconds': { readonly seconds: number };

  // ── Save problems (§11.7, #183) ────────────────────────────────────────────
  //
  // The save module returns a code and its numbers; this is where it becomes something a
  // player can act on. Each says what happened *and* that their progress is still there,
  // because the one thing every one of these means is "nothing has been overwritten".
  readonly 'save.problem.unreadable': Record<string, never>;
  readonly 'save.problem.futureVersion': { readonly found: number; readonly supported: number };
  readonly 'save.problem.unknownVersion': { readonly found: number; readonly supported: number };
}

/** Every key in the catalogue: the rules' and the UI's. */
export type AllMessageParams = GameMessageParams & UiMessageParams;

/** Every key. */
export type MessageKey = keyof AllMessageParams;

/** One message: a function of its parameters and the locale's formatters. */
export type MessageFor<P> = (params: P, fmt: MessageFormatters) => string;

/**
 * A complete set of messages for one locale.
 *
 * A mapped type over {@link MessageKey}, which is what makes coverage a compile-time
 * property in both directions: a missing key fails to satisfy the type, and an extra one
 * is an excess property.
 */
export type Messages = {
  readonly [K in MessageKey]: MessageFor<AllMessageParams[K]>;
};

/**
 * What to do about a key that is not in the catalogue.
 *
 * Only reachable for a **dynamic** key — a `briefKey` out of a scenario file, a coach
 * mark — because every statically-known key is checked by the compiler. Which is
 * exactly where it matters: scenario data is the part contributors write (G6).
 */
export type MissingKeyPolicy =
  /** Development: throw, loudly, at the point of use. */
  | 'throw'
  /** Production: render a stable, visible marker. Never a blank string. */
  | 'fallback';

/** Parameters for a key that is not known at compile time. */
export type DynamicParams = MessageParams;
