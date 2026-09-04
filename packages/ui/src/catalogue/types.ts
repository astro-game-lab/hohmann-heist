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

  // ── The planner (§8.3.4, §8.3.5, #123, #127–#132, #137, #139) ──────────────
  //
  // §8.3.4's five regions, and every string in them. Three habits are worth naming
  // because the planner is where they first cost something:
  //
  // **Every number arrives in SI.** `altitudeMetres`, not kilometres; `seconds`, not
  // minutes. The panel reads metres out of `@hh/ui`'s `orbitReadout` and hands them
  // straight here, so the conversion happens exactly once, in the layer that also owns
  // the separator and the grouping. A component that divided by 1000 before calling a
  // message would have made "274,2 km" impossible in fr-FR while looking perfectly
  // correct in review.
  //
  // **The accessible name is its own key, not the visible one reused.** A plan-panel row
  // reads "1 · T+00:04:12 · −36.2" on screen, which is a table and not a sentence; a
  // screen reader needs "Node 1, at T plus 4 minutes 12 seconds, prograde 36.2 metres per
  // second retrograde". #130's last criterion asks for exactly this — "announced
  // meaningfully rather than as bare numbers" — and it cannot be met by adding an
  // `aria-label` built from the same fragments.
  //
  // **Status is text before it is colour.** §8.3.4's fifth principle and §8.8 both say
  // nothing may be carried by colour alone, so the Δv bar's three levels and the
  // approach block's met/unmet each have a key. The colour reinforces the word; it never
  // replaces it.
  readonly 'planner.region.orbitView': Record<string, never>;
  readonly 'planner.region.hud': Record<string, never>;

  // ① HUD bar (#127)
  readonly 'planner.hud.back': Record<string, never>;
  readonly 'planner.hud.contract': { readonly index: number; readonly title: string };
  readonly 'planner.hud.dvLabel': Record<string, never>;
  /** "72.4 / 250 m/s" — §8.3.4's own rendering. */
  readonly 'planner.hud.dv': { readonly usedMps: number; readonly budgetMps: number };
  /**
   * The Δv bar's accessible name, and the non-colour channel for its three levels.
   *
   * `fraction` rather than a level string, so the message decides the wording *and* the
   * thresholds' phrasing together. §8.3.4 puts amber at 90% and red above 100%, and
   * `BUDGET_WARNING_FRACTION` in `@hh/game` is where the 0.9 itself lives.
   */
  readonly 'planner.hud.dvBar': {
    readonly fraction: number;
    readonly usedMps: number;
    readonly budgetMps: number;
  };
  readonly 'planner.hud.metLabel': Record<string, never>;
  readonly 'planner.hud.met': { readonly metSeconds: number };
  readonly 'planner.hud.settings': Record<string, never>;
  readonly 'planner.hud.help': Record<string, never>;

  // ② Timeline (#128)
  readonly 'planner.timeline.label': Record<string, never>;
  /** The slider's accessible value: where the scrub head is. */
  readonly 'planner.timeline.scrubAt': { readonly metSeconds: number };
  /** §8.5.3 asks for a documented step; this is where it is documented to the player. */
  readonly 'planner.timeline.stepHint': { readonly stepSeconds: number };
  readonly 'planner.timeline.deadline': { readonly metSeconds: number };
  readonly 'planner.timeline.node': { readonly index: number; readonly metSeconds: number };
  readonly 'planner.timeline.objectiveMet': { readonly metSeconds: number };
  /**
   * A shaded constraint band (§6.5).
   *
   * One key per constraint kind would be four keys saying the same shape; the kind
   * arrives as a *number* — the index into a list this message owns — rather than as a
   * string fragment, so the sentence stays the message's to write. See `en.ts`.
   */
  readonly 'planner.timeline.band': {
    readonly kind: number;
    readonly startMetSeconds: number;
    readonly endMetSeconds: number;
  };

  // ③ Plan panel (#130)
  readonly 'planner.plan.heading': Record<string, never>;
  readonly 'planner.plan.empty': Record<string, never>;
  readonly 'planner.plan.listLabel': { readonly count: number };
  /** The row's visible epoch. */
  readonly 'planner.plan.nodeEpoch': { readonly index: number; readonly metSeconds: number };
  /** The row's accessible name. See the note above on why it is not the visible one. */
  readonly 'planner.plan.nodeLabel': {
    readonly index: number;
    readonly metSeconds: number;
    readonly progradeMps: number;
    readonly radialMps: number;
  };
  readonly 'planner.plan.prograde': { readonly mps: number };
  readonly 'planner.plan.radial': { readonly mps: number };
  readonly 'planner.plan.delete': { readonly index: number };
  readonly 'planner.plan.expand': { readonly index: number };
  readonly 'planner.plan.addNode': Record<string, never>;

  // ④ Readouts (#131)
  readonly 'planner.readouts.heading': Record<string, never>;
  // Row labels are their own keys, separate from the values beside them. A label is a
  // noun and a value is a quantity; sharing a key would mean one of the two decided the
  // other's wording, and `planner.apsis.apoapsis` — which already carries an altitude —
  // is a canvas annotation rather than a table heading.
  readonly 'planner.readouts.apoapsisLabel': Record<string, never>;
  readonly 'planner.readouts.periapsisLabel': Record<string, never>;
  readonly 'planner.readouts.altitudeLabel': Record<string, never>;
  readonly 'planner.readouts.periodLabel': Record<string, never>;
  readonly 'planner.readouts.eccentricityLabel': Record<string, never>;
  readonly 'planner.readouts.apoapsis': { readonly altitudeMetres: number };
  readonly 'planner.readouts.periapsis': { readonly altitudeMetres: number };
  /** The single row a near-circular orbit shows instead of the pair (§9.3's suppression). */
  readonly 'planner.readouts.altitude': { readonly altitudeMetres: number };
  readonly 'planner.readouts.period': { readonly seconds: number };
  readonly 'planner.readouts.eccentricity': { readonly eccentricity: number };
  /** Why the apsis rows are absent. Without it the suppression looks like a broken panel. */
  readonly 'planner.readouts.circularNote': Record<string, never>;
  /** Likewise for an open orbit, which is `L4` and has no period. */
  readonly 'planner.readouts.openNote': Record<string, never>;

  // ④ Closest approach (#132)
  readonly 'planner.approach.heading': Record<string, never>;
  readonly 'planner.approach.rangeLabel': Record<string, never>;
  readonly 'planner.approach.relativeSpeedLabel': Record<string, never>;
  readonly 'planner.approach.atLabel': Record<string, never>;
  readonly 'planner.approach.range': { readonly rangeMetres: number };
  readonly 'planner.approach.relativeSpeed': { readonly mps: number };
  readonly 'planner.approach.at': { readonly metSeconds: number };
  /** The met/unmet channel that is not colour (FR-407, §8.8). */
  readonly 'planner.approach.met': { readonly maxRangeMetres: number };
  readonly 'planner.approach.notMet': { readonly maxRangeMetres: number };
  readonly 'planner.approach.none': Record<string, never>;

  // ⑤ Assist tray (#133's snap toggle only; #140 brings the rest in M3)
  readonly 'planner.assists.heading': Record<string, never>;
  readonly 'planner.assists.snapToApsis': Record<string, never>;
  readonly 'planner.assists.snapToApsisHint': { readonly windowSeconds: number };

  // Narrow layout (#123): the tab strip the three side panels collapse into.
  readonly 'planner.tab.plan': { readonly count: number };
  readonly 'planner.tab.readouts': Record<string, never>;
  readonly 'planner.tab.assists': Record<string, never>;
  readonly 'planner.tabsLabel': Record<string, never>;

  // ── The node editor overlay (§8.3.5, #137) ────────────────────────────────
  //
  // The result block's rows are **deltas**, and each delta key handles its own
  // "unchanged" case rather than the component testing for zero. That is `types.ts`'s
  // rule about branching inside the message: whether a change is worth reporting is a
  // rounding decision, and rounding belongs with the formatting.
  readonly 'planner.editor.heading': { readonly index: number };
  readonly 'planner.editor.close': Record<string, never>;

  readonly 'planner.editor.epochLabel': Record<string, never>;
  readonly 'planner.editor.hours': Record<string, never>;
  readonly 'planner.editor.minutes': Record<string, never>;
  readonly 'planner.editor.seconds': Record<string, never>;
  readonly 'planner.editor.milliseconds': Record<string, never>;
  readonly 'planner.editor.epochSlider': Record<string, never>;

  readonly 'planner.editor.snapLabel': Record<string, never>;
  readonly 'planner.editor.snapPeriapsis': Record<string, never>;
  readonly 'planner.editor.snapApoapsis': Record<string, never>;
  readonly 'planner.editor.snapFree': Record<string, never>;

  readonly 'planner.editor.deltaVLabel': Record<string, never>;
  readonly 'planner.editor.prograde': Record<string, never>;
  readonly 'planner.editor.radial': Record<string, never>;
  readonly 'planner.editor.normal': Record<string, never>;
  /** §8.3.5 marks the normal component v1.1. The field is shown, disabled, and says so. */
  readonly 'planner.editor.normalNote': Record<string, never>;
  readonly 'planner.editor.magnitudeLabel': Record<string, never>;
  readonly 'planner.editor.magnitude': { readonly mps: number };
  /** The steppers' accessible names. `sign` is −1 or +1; the message picks the wording. */
  readonly 'planner.editor.step': { readonly sign: number; readonly axis: number };
  readonly 'planner.editor.stepHint': { readonly stepMps: number };

  readonly 'planner.editor.resultHeading': Record<string, never>;
  /** "(−125.8)", or "(unchanged)" when the change rounds away. See the note above. */
  readonly 'planner.editor.deltaAltitude': { readonly deltaMetres: number };
  readonly 'planner.editor.deltaPeriod': { readonly deltaSeconds: number };
  /** What the result block says when the burn opens the orbit and there is no apoapsis. */
  readonly 'planner.editor.resultOpen': Record<string, never>;

  readonly 'planner.editor.delete': Record<string, never>;
  readonly 'planner.editor.done': Record<string, never>;

  // Commit (#139). The reasons themselves are `@hh/game`'s keys, not this layer's.
  readonly 'planner.commit': Record<string, never>;

  // Camera (#103)
  readonly 'planner.camera.recentre': Record<string, never>;
  readonly 'planner.camera.zoomIn': Record<string, never>;
  readonly 'planner.camera.zoomOut': Record<string, never>;

  /**
   * FR-406's full-precision reveal, on hover **or** focus.
   *
   * Three keys — one per unit — rather than one taking a formatted string, because a
   * number that has already been turned into text has had its locale decided. `float64`
   * in the name is the promise: this is the value as held, not a longer rounding of it.
   */
  readonly 'planner.si.metres': { readonly metres: number };
  readonly 'planner.si.metresPerSecond': { readonly metresPerSecond: number };
  readonly 'planner.si.seconds': { readonly seconds: number };

  // ── Save problems (§11.7, #183) ────────────────────────────────────────────
  //
  // The save module returns a code and its numbers; this is where it becomes something a
  // player can act on. Each says what happened *and* that their progress is still there,
  // because the one thing every one of these means is "nothing has been overwritten".
  readonly 'save.problem.unreadable': Record<string, never>;
  readonly 'save.problem.futureVersion': { readonly found: number; readonly supported: number };
  readonly 'save.problem.unknownVersion': { readonly found: number; readonly supported: number };

  // ── Execution (§8.3.8, #144, #145, #146) ──────────────────────────────────
  readonly 'execution.region.orbitView': Record<string, never>;
  readonly 'execution.region.hud': Record<string, never>;

  /** The playback rate, as the HUD shows it. DEP-05's *"current rate is visible"*. */
  readonly 'execution.speed.label': Record<string, never>;
  readonly 'execution.speed.option': { readonly multiplier: number };
  readonly 'execution.speed.current': { readonly multiplier: number };

  readonly 'execution.control.pause': Record<string, never>;
  readonly 'execution.control.resume': Record<string, never>;
  readonly 'execution.control.skip': Record<string, never>;
  readonly 'execution.control.abort': Record<string, never>;
  /**
   * Why pausing does not offer an edit (§8.3.8).
   *
   * Shown beside Abort when the run is paused. Without it the absence of an edit control
   * reads as an oversight; with it, it reads as the promise it is.
   */
  readonly 'execution.paused.notice': Record<string, never>;

  readonly 'execution.progress.label': Record<string, never>;
  readonly 'execution.progress.at': { readonly metSeconds: number; readonly ofSeconds: number };

  /** §8.3.8's burn cue: the Δv flashed on the HUD as a burn fires. */
  readonly 'execution.burn.flash': { readonly index: number; readonly deltaVMps: number };

  readonly 'execution.log.heading': Record<string, never>;
  readonly 'execution.log.label': { readonly count: number };
  readonly 'execution.log.empty': Record<string, never>;
  /** The live region's coalesced line when a step crossed more than it could speak. */
  readonly 'execution.announce.summary': { readonly count: number };
  readonly 'execution.announce.label': Record<string, never>;

  // ── Debrief (§8.3.9, FR-304, FR-305, FR-307, #121) ────────────────────────
  readonly 'debrief.heading.success': { readonly index: number; readonly title: string };
  readonly 'debrief.heading.failure': { readonly index: number; readonly title: string };
  /** §6.7's medals. A key per medal would be four keys saying the same shape. */
  readonly 'debrief.medal': { readonly medal: string };
  readonly 'debrief.medal.none': Record<string, never>;

  readonly 'debrief.table.label': Record<string, never>;
  readonly 'debrief.column.quantity': Record<string, never>;
  readonly 'debrief.column.you': Record<string, never>;
  readonly 'debrief.column.par': Record<string, never>;
  readonly 'debrief.column.best': Record<string, never>;
  readonly 'debrief.column.delta': Record<string, never>;

  readonly 'debrief.row.deltaV': Record<string, never>;
  readonly 'debrief.row.time': Record<string, never>;
  readonly 'debrief.row.burns': Record<string, never>;

  readonly 'debrief.value.deltaV': { readonly mps: number };
  readonly 'debrief.value.time': { readonly seconds: number };
  readonly 'debrief.value.burns': { readonly count: number };
  readonly 'debrief.value.delta': { readonly fraction: number };
  /** A quantity that does not exist — a personal best on a first completion. */
  readonly 'debrief.value.absent': Record<string, never>;

  readonly 'debrief.closest': {
    readonly achievedM: number;
    readonly neededM: number;
    readonly metSeconds: number;
  };

  readonly 'debrief.whatHappened': Record<string, never>;
  /**
   * FR-307's fallback, said out loud.
   *
   * The debrief showing bare numbers and *nothing else* would read as a screen that
   * failed to load. This says the numbers are the answer: the game does not know why,
   * and will not guess.
   */
  readonly 'debrief.noDiagnosis': Record<string, never>;

  readonly 'debrief.missed': Record<string, never>;
  /** §8.3.9's failure block is labelled rows, so each row has a label as well as a value. */
  readonly 'debrief.miss.label.closest': Record<string, never>;
  readonly 'debrief.miss.label.needed': Record<string, never>;
  readonly 'debrief.miss.label.deltaV': Record<string, never>;
  readonly 'debrief.miss.closest': { readonly rangeM: number; readonly metSeconds: number };
  readonly 'debrief.miss.needed': { readonly rangeM: number };
  readonly 'debrief.miss.deltaV': { readonly usedMps: number; readonly budgetMps: number };

  /** D12, FR-305: the player beat our optimum, so our optimum is the thing to fix. */
  readonly 'debrief.beatPar': { readonly byMps: number };
  readonly 'debrief.beatPar.report': Record<string, never>;

  readonly 'debrief.action.retry': Record<string, never>;
  readonly 'debrief.action.next': Record<string, never>;
  readonly 'debrief.action.share': Record<string, never>;
  readonly 'debrief.action.board': Record<string, never>;
  /** Why NEXT is unavailable: this build ships one contract. */
  readonly 'debrief.next.none': Record<string, never>;
  /** §11.6's code, copied. Not a URL until the share-URL generator lands (M6). */
  readonly 'debrief.share.copied': Record<string, never>;
  readonly 'debrief.share.failed': Record<string, never>;
  readonly 'debrief.share.hint': Record<string, never>;
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
