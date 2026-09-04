/**
 * English messages.
 *
 * The reference locale, and for now the only one. Every entry is a function of its
 * parameters and the locale's formatters — see `types.ts` for why a function rather
 * than a template string, and why that is what makes the second locale possible.
 *
 * Two habits worth keeping when adding to this file:
 *
 * - **Never call `toFixed`, `String(n)`, or `Intl` directly.** Use `fmt`. It carries the
 *   locale, and a number formatted without it is a number formatted for en-US.
 * - **Never build a sentence from a fragment parameter.** Parameters are values. If a
 *   message needs a variant, branch on the value inside the function; that is what
 *   makes the branch translatable along with the sentence.
 */
import type { MessageFormatters, Messages } from './types.js';

/**
 * Shared renderings, so that "412.3" is rounded the same way wherever it appears.
 *
 * These are not messages and are not exported: a message is a whole sentence, and these
 * are the pieces of *number formatting* several sentences happen to share. Sharing the
 * rounding is the point — a briefing that said "400 km" in one row and "400.0 km" in the
 * next would read as two different numbers.
 */
const kilometres = (metres: number, fmt: MessageFormatters): string => {
  // Rounded to a tenth of a kilometre *first*, and the decimal dropped only if the
  // **rounded** value is whole. Testing `metres % 1000` instead would be a rule about
  // float exactness rather than about the number a player reads: a 400 km circular orbit
  // round-tripped through the semi-latus rectum comes back as 399 999.999 999 999 94 m,
  // which is 400 km to anyone looking and not a multiple of 1 000 to a computer.
  const value = Math.round(metres / 100) / 10;
  return fmt.decimal(value, Number.isInteger(value) ? 0 : 1);
};

/**
 * A tolerance, which is a statement about precision rather than about a place.
 *
 * So it keeps its decimal where {@link kilometres} drops one — "within 1.0 km" says the
 * limit is known to a hundred metres, where "within 1 km" reads as a round number
 * somebody chose. Metres below a kilometre: a 100 m docking box (DEP-03) is not "0.1 km".
 */
const range = (metres: number, fmt: MessageFormatters): string =>
  metres < 1000 ? `${fmt.integer(metres)} m` : `${fmt.decimal(metres / 1000, 1)} km`;

/** §8.3.3's `h:mm`. Whole minutes: a deadline is not a stopwatch. */
const hoursAndMinutes = (seconds: number, fmt: MessageFormatters): string => {
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  return (
    `${fmt.integer(hours)} h ` +
    `${fmt.number(totalMinutes % 60, { minimumIntegerDigits: 2, useGrouping: false })} m`
  );
};

/** Radians in, degrees out — the conversion happens at this boundary and nowhere else. */
const degrees = (radians: number, fmt: MessageFormatters): string => {
  const value = (radians * 180) / Math.PI;
  return `${value >= 0 ? '+' : ''}${fmt.decimal(value, 1)}°`;
};

export const en: Messages = {
  // ── Legality (§6.4) ────────────────────────────────────────────────────────
  'legality.l1.overBudget': ({ excessMps }, fmt) =>
    `Over budget by ${fmt.decimal(excessMps, 1)} m/s`,
  'legality.l2.belowAltitudeFloor': ({ floorAltitudeM, metSeconds, intervalCount }, fmt) =>
    intervalCount > 1
      ? `Trajectory drops below ${fmt.integer(floorAltitudeM / 1000)} km ` +
        `${fmt.integer(intervalCount)} times, first at ${fmt.met(metSeconds)}`
      : `Trajectory intersects the atmosphere at ${fmt.met(metSeconds)}`,
  'legality.l3.pastDeadline': ({ overSeconds }, fmt) =>
    `Last burn is ${fmt.integer(Math.ceil(overSeconds / 60))} min after the deadline`,
  'legality.l4.escapes': () => 'Trajectory escapes Earth',
  'legality.l5.nodesTooClose': ({ minimumSeconds }, fmt) =>
    `Merge these burns — they are less than ${fmt.integer(minimumSeconds)} s apart`,
  'legality.l6.objectiveNotMet': () => 'This plan does not meet the objective',
  'legality.plan.rectilinear': ({ nodeIndex }, fmt) =>
    `Burn ${fmt.integer(nodeIndex + 1)} cancels the orbit entirely — there is no trajectory after it`,
  'legality.plan.nonConvergent': ({ nodeIndex }, fmt) =>
    `The trajectory after burn ${fmt.integer(nodeIndex + 1)} could not be computed`,

  // ── Scenario loading (FR-202) ──────────────────────────────────────────────
  'scenario.error.malformedJson': ({ detail }) => `This scenario is not valid JSON: ${detail}`,
  'scenario.error.unsupportedVersion': ({ version, supported }, fmt) =>
    `This scenario is version ${fmt.integer(version)}; this build reads version ${fmt.integer(supported)}`,
  'scenario.error.required': ({ path, property }) => `${path} is missing "${property}"`,
  'scenario.error.unknownProperty': ({ path, property }) =>
    `${path} has an unrecognised field "${property}" — check the spelling`,
  'scenario.error.type': ({ path, expected }) => `${path} must be a ${expected}`,
  'scenario.error.range': ({ path, limit }, fmt) =>
    `${path} is outside its range (${fmt.number(limit)})`,
  'scenario.error.stringLength': ({ path, limit }, fmt) =>
    `${path} must be ${fmt.integer(limit)} characters or ${limit === 1 ? 'more' : 'longer'}`,
  'scenario.error.itemCount': ({ path, limit }, fmt) => {
    const entries = fmt.plural(limit) === 'one' ? 'entry' : 'entries';
    return `${path} must have ${fmt.integer(limit)} ${entries}`;
  },
  'scenario.error.duplicate': ({ path }) => `${path} contains a duplicate`,
  'scenario.error.pattern': ({ path, pattern }) =>
    `${path} does not match the required form (${pattern})`,
  'scenario.error.notAllowed': ({ path, allowed }, fmt) =>
    allowed.length === 0
      ? `${path} is not one of the recognised values`
      : `${path} must be ${fmt.list(allowed, 'disjunction')}`,
  'scenario.error.invalidField': ({ path, keyword }) => `${path} is not valid (${keyword})`,
  'scenario.error.unknownTarget': ({ targetId }) =>
    `The objective names a target "${targetId}" that this scenario does not define`,
  'scenario.error.duplicateTargetId': ({ targetId }) => `Two targets share the id "${targetId}"`,
  'scenario.error.deadlineBeyondHorizon': ({ deadlineSeconds, horizonSeconds }, fmt) =>
    `The deadline (${fmt.met(deadlineSeconds)}) is past the planning horizon (${fmt.met(horizonSeconds)})`,
  'scenario.error.startsBelowFloor': ({ startAltitudeM, floorAltitudeM }, fmt) =>
    `The ship starts at ${fmt.decimal(startAltitudeM / 1000, 1)} km, below the ` +
    `${fmt.integer(floorAltitudeM / 1000)} km floor`,
  'scenario.error.duplicateConstraint': ({ kind }) => `This scenario has two "${kind}" constraints`,
  'scenario.error.toleranceTooLoose': ({ path, requested, limit }, fmt) =>
    `${path} asks for ${fmt.number(requested)}, which is looser than the ${fmt.number(limit)} ` +
    'the departures table promises the player',

  // ── Contract briefs and coach marks (§8.3.3) ───────────────────────────────
  //
  // 30–60 words, second person, terse. The hint is flavour rather than instruction —
  // "Wait for it" is a mood, not a step — because a brief that tells the player what to
  // do has answered the puzzle for them. Asserted, not merely intended: the content
  // suite counts the words of every brief it can resolve.
  // ── The orbit scene (§9.3, D8) ─────────────────────────────────────────────
  //
  // DEP-10 lives in this line and nowhere else: the axis the renderer draws is the
  // transverse basis vector T̂, and "prograde" is the word players know for it.
  'planner.handle.prograde': () => 'prograde',
  'planner.handle.radial': () => 'radial',
  // Altitudes arrive in metres, as everything below the UI does, and are shown in
  // kilometres because that is the unit a player reads an orbit in. One decimal: a LEO
  // altitude moves by tens of metres under a small burn, and a whole-kilometre readout
  // would sit still while the player dragged.
  'planner.apsis.periapsis': ({ altitudeMetres }, fmt) =>
    `periapsis ${fmt.decimal(altitudeMetres / 1000, 1)} km`,
  'planner.apsis.apoapsis': ({ altitudeMetres }, fmt) =>
    `apoapsis ${fmt.decimal(altitudeMetres / 1000, 1)} km`,
  // Metres below a kilometre, kilometres above it: a rendezvous ends at 100 m (DEP-03),
  // and "0.1 km" is a worse reading of that than "100 m".
  'planner.closestApproach': ({ separationMetres, relativeSpeedMps }, fmt) =>
    separationMetres < 1000
      ? `${fmt.integer(Math.round(separationMetres))} m · ${fmt.decimal(relativeSpeedMps, 2)} m/s`
      : `${fmt.decimal(separationMetres / 1000, 2)} km · ${fmt.decimal(relativeSpeedMps, 2)} m/s`,

  'client.withheld': () => 'withheld',

  'brief.c03': () =>
    'KESTREL-2 runs a courier loop four hundred kilometres above you, and its cargo does ' +
    'not stay aboard long. Getting up there is the cheap part — a single push will do it. ' +
    'Arriving while the thing is still there is not. Wait for it.',
  'mark.c03.departureWindow': () =>
    'The target keeps moving while you climb. When you leave decides where it will be ' +
    'when you get there.',

  // ── The briefing (§8.3.3) ──────────────────────────────────────────────────
  //
  // SI in, display units out. Every number below arrives in metres, seconds or radians
  // and leaves in the unit §8.3.3 asks for — and through `fmt`, never `toFixed`, because
  // the separator and the grouping belong to the locale rather than to the screen.
  'briefing.heading': ({ index, title }, fmt) =>
    `Contract ${fmt.number(index, { minimumIntegerDigits: 2, useGrouping: false })} — “${title}”`,
  'briefing.backToBoard': () => '◂ Board',
  'briefing.clientLabel': () => 'client:',
  'briefing.feeLabel': () => 'fee:',
  'briefing.fee': ({ kilocredits }, fmt) => `${fmt.number(kilocredits)} kcr`,

  'briefing.objectiveLabel': () => 'Objective',
  'briefing.dvBudgetLabel': () => 'Δv budget',
  'briefing.deadlineLabel': () => 'Deadline',
  'briefing.parLabel': () => 'Par',
  'briefing.setupLabel': () => 'Setup',
  'briefing.shipLabel': () => 'You',
  'briefing.constraintsLabel': () => 'Constraints',

  'briefing.dvBudget': ({ budgetMps }, fmt) => `${fmt.integer(budgetMps)} m/s`,
  'briefing.deadline': ({ seconds }, fmt) => hoursAndMinutes(seconds, fmt),
  // Burns pluralise, and the count is small enough that "1 burns" would be the first
  // thing anyone noticed. `fmt.plural` rather than an `=== 1` test, because English's
  // two categories are not every language's.
  'briefing.par': ({ dvMps, timeSeconds, burns }, fmt) =>
    `${fmt.decimal(dvMps, 1)} m/s · ${hoursAndMinutes(timeSeconds, fmt)} · ` +
    `${fmt.integer(burns)} ${fmt.plural(burns) === 'one' ? 'burn' : 'burns'}`,

  'briefing.objective.reachOrbit': ({ periapsisAltitudeMetres, apoapsisAltitudeMetres }, fmt) =>
    `Reach a ${kilometres(periapsisAltitudeMetres, fmt)} × ${kilometres(apoapsisAltitudeMetres, fmt)} km orbit`,
  'briefing.objective.intercept': ({ target, rangeMetres }, fmt) =>
    `Intercept ${target} within ${range(rangeMetres, fmt)}`,
  'briefing.objective.rendezvous': ({ target, rangeMetres, relativeSpeedMps }, fmt) =>
    `Rendezvous with ${target} within ${range(rangeMetres, fmt)} at ` +
    `${fmt.decimal(relativeSpeedMps, 2)} m/s or less`,
  'briefing.objective.softRendezvous': ({ target, rangeMetres, relativeSpeedMps }, fmt) =>
    `Dock with ${target} within ${range(rangeMetres, fmt)} at ` +
    `${fmt.decimal(relativeSpeedMps, 2)} m/s or less`,

  'briefing.setup.circular': ({ altitudeMetres }, fmt) =>
    `${kilometres(altitudeMetres, fmt)} km circular`,
  'briefing.setup.circularPhased': ({ altitudeMetres, trueAnomalyRad }, fmt) =>
    `${kilometres(altitudeMetres, fmt)} km circular, ${degrees(trueAnomalyRad, fmt)} true anomaly`,
  'briefing.setup.ellipse': ({ periapsisAltitudeMetres, apoapsisAltitudeMetres }, fmt) =>
    `${kilometres(periapsisAltitudeMetres, fmt)} × ${kilometres(apoapsisAltitudeMetres, fmt)} km`,
  'briefing.setup.ellipsePhased': (
    { periapsisAltitudeMetres, apoapsisAltitudeMetres, trueAnomalyRad },
    fmt,
  ) =>
    `${kilometres(periapsisAltitudeMetres, fmt)} × ${kilometres(apoapsisAltitudeMetres, fmt)} km, ` +
    `${degrees(trueAnomalyRad, fmt)} true anomaly`,

  'briefing.constraint.altitudeFloor': ({ floorAltitudeM }, fmt) =>
    `Never below ${kilometres(floorAltitudeM, fmt)} km`,

  'briefing.recordNone': () => 'best: —',
  'briefing.record': ({ bestDvMps, medal }, fmt) =>
    `best: ${fmt.decimal(bestDvMps, 1)} m/s (${medal})`,
  'briefing.attempts': ({ attempts }, fmt) => `attempts: ${fmt.integer(attempts)}`,
  'briefing.dailyVariant': ({ date }) => `Daily challenge for ${date}`,
  'briefing.leaderboardLink': () => 'Leaderboard',
  // States §6.8's rule; it does not evaluate it. Progression is #82, in M3.
  'briefing.locked': ({ act }, fmt) =>
    `Locked. Act ${fmt.integer(act)} opens once you have Bronze on two thirds of the act ` +
    `before it.`,
  'briefing.accept': () => 'Accept',
  'briefing.unknownContract': ({ id }) => `There is no contract with the id “${id}”.`,

  'briefing.si.metresPerSecond': ({ metresPerSecond }, fmt) =>
    fmt.number(metresPerSecond, {
      style: 'unit',
      unit: 'meter-per-second',
      maximumFractionDigits: 4,
      useGrouping: false,
    }),
  'briefing.si.seconds': ({ seconds }, fmt) => `${fmt.number(seconds)} s`,

  // ── Save problems (§11.7) ──────────────────────────────────────────────────
  //
  // Each ends the same way, because that is the fact the player needs: nothing has been
  // written over, and what was there is still there.
  'save.problem.unreadable': () =>
    'Your saved progress could not be read. Nothing has been overwritten — the file is ' +
    'still on this device, and you can carry on playing.',
  'save.problem.futureVersion': ({ found, supported }, fmt) =>
    `Your saved progress was written by a newer version of the game (save format ` +
    `${fmt.integer(found)}; this build reads ${fmt.integer(supported)}). It has been left ` +
    'untouched. Update the game to read it.',
  'save.problem.unknownVersion': ({ found, supported }, fmt) =>
    `Your saved progress is in a format this build cannot upgrade (save format ` +
    `${fmt.integer(found)}; this build reads ${fmt.integer(supported)}). It has been left ` +
    'untouched.',

  // ── The application shell ──────────────────────────────────────────────────
  'app.title': () => 'Hohmann Heist',
  'app.routesLabel': () => 'Routes',

  'nav.board': () => 'Contract board',
  'nav.contract': ({ index }, fmt) =>
    `Contract ${fmt.number(index, { minimumIntegerDigits: 2, useGrouping: false })}`,
  'nav.daily': () => 'Daily',
  'nav.codex': () => 'Codex',
  'nav.settings': () => 'Settings',
  'nav.spike': () => 'M1 spike',

  // ── Screen headings and the not-found state (§8.2, §8.7) ───────────────────
  //
  // A heading names the screen, not the game: "Contract board", not "Hohmann Heist —
  // Contract board". The document title carries the game's name once, in `index.html`.
  'screen.board.heading': () => 'Contract board',
  'screen.contract.heading': ({ id }) => `Contract ${id}`,
  'screen.daily.heading': () => "Today's daily",
  'screen.dailyDate.heading': ({ date }) => `Daily challenge — ${date}`,
  'screen.leaderboard.heading': ({ date }) => `Leaderboard — ${date}`,
  'screen.codex.heading': ({ slug }) => `Codex — ${slug}`,
  'screen.replay.heading': () => 'Replay',
  'screen.settings.heading': () => 'Settings',

  // Not an error, and phrased so it does not read like one: a hash the router cannot
  // match is usually an old shared link rather than anything the player did wrong.
  'screen.notFound.heading': () => 'No such screen',
  'screen.notFound.body': ({ path }) =>
    `Nothing in this game answers to “${path}”. The link may be from an older build.`,
  'screen.notFound.backToTitle': () => 'Back to the start',
  'screen.notBuiltYet': () =>
    'This screen is not built yet. The vertical slice runs as far as a contract briefing.',
};
