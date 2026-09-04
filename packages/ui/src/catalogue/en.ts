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
import type { Messages } from './types.js';

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
  'brief.c03': () =>
    'KESTREL-2 runs a courier loop four hundred kilometres above you, and its cargo does ' +
    'not stay aboard long. Getting up there is the cheap part — a single push will do it. ' +
    'Arriving while the thing is still there is not. Wait for it.',
  'mark.c03.departureWindow': () =>
    'The target keeps moving while you climb. When you leave decides where it will be ' +
    'when you get there.',

  // ── The application shell ──────────────────────────────────────────────────
  'app.title': () => 'Hohmann Heist',
  'app.skeletonNotice': () =>
    'Skeleton build. Routing and the simulation packages are wired; the screens are not built yet.',
  'app.routesLabel': () => 'Routes',
  'app.currentRouteHeading': () => 'Current route',
  'app.routeName': () => 'name',
  'app.routePath': () => 'path',
  'app.routeParams': () => 'params',
  'app.simulationHeading': () => 'Simulation packages',
  'app.geoSpeedLabel': () => 'Circular speed at geostationary radius:',
  // `Intl`'s unit style rather than a concatenated "m/s": the unit's position and its
  // abbreviation are both locale-dependent, and appending one here would decide both.
  // Grouping is off so the rendered value stays machine-readable in a test.
  'app.geoSpeedValue': ({ speedMps }, fmt) =>
    fmt.number(speedMps, {
      style: 'unit',
      unit: 'meter-per-second',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
      useGrouping: false,
    }),
  'app.missionClockLabel': () => 'Mission clock formatting:',
  'nav.title': () => 'Title',
  'nav.board': () => 'Contract board',
  'nav.contract': ({ index }, fmt) =>
    `Contract ${fmt.number(index, { minimumIntegerDigits: 2, useGrouping: false })}`,
  'nav.daily': () => 'Daily',
  'nav.codex': () => 'Codex',
  'nav.settings': () => 'Settings',
  'nav.spike': () => 'M1 spike',
};
