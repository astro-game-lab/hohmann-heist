/**
 * The message catalogue — #88, FR-910, NFR-028.
 *
 * ## Where the coverage guarantee actually lives
 *
 * `Messages` is a mapped type over every key `@hh/game` declares plus every key this
 * package declares, so **a missing message does not compile and neither does a spare
 * one**. That is stronger than any test, and it is why the cases below spend their
 * effort elsewhere: on the sample table, which forces someone adding a key to say what
 * its parameters look like, and on the behaviours a type cannot state — that no message
 * resolves to nothing, and that formatting follows the locale rather than English.
 *
 * The one rot the compiler cannot see is a key nobody uses. That needs a source scan,
 * which needs a filesystem, so it lives in `tools/guardrails/catalogue.test.ts`.
 */
import { gameMessage } from '@hh/game';
import { describe, expect, it } from 'vitest';

import { en } from './en.js';
import { MissingMessageKeyError, createCatalogue, missingKeyFallback } from './resolve.js';
import type { AllMessageParams } from './types.js';

/**
 * One plausible set of parameters per key.
 *
 * Typed as `AllMessageParams`, so the compiler requires an entry for every key and
 * refuses one for a key that does not exist. Adding a message means adding a row here,
 * which is the point: a message nobody could produce a parameter set for is a message
 * whose parameters are wrong.
 */
const samples: AllMessageParams = {
  'legality.l1.overBudget': { usedMps: 274.4, budgetMps: 250, excessMps: 24.4 },
  'legality.l2.belowAltitudeFloor': { floorAltitudeM: 100_000, metSeconds: 8054, intervalCount: 1 },
  'legality.l3.pastDeadline': { metSeconds: 50_000, deadlineSeconds: 43_200, overSeconds: 6800 },
  'legality.l4.escapes': { arcIndex: 2, eccentricity: 1.4, metSeconds: 1200 },
  'legality.l5.nodesTooClose': {
    firstIndex: 0,
    secondIndex: 1,
    gapSeconds: 0.5,
    minimumSeconds: 1,
  },
  'legality.l6.objectiveNotMet': {},
  'flightLog.ignition': { burnCount: 2 },
  'flightLog.burn': { index: 1, deltaVMps: 36.2, progradeMps: -36.2, metSeconds: 252 },
  'flightLog.periapsis': { altitudeM: 274_200, metSeconds: 252 },
  'flightLog.apoapsis': { altitudeM: 400_000, metSeconds: 3032 },
  'flightLog.revolution': { index: 1, periodSeconds: 5560, metSeconds: 5741 },
  'flightLog.constraintEnter': { kind: 'altitude_floor', metSeconds: 8054 },
  'flightLog.constraintExit': { kind: 'altitude_floor', metSeconds: 8120, durationSeconds: 66 },
  'flightLog.closestApproach': { rangeM: 310, relativeSpeedMps: 42.7, metSeconds: 43_792 },
  'flightLog.objectiveMet': { metSeconds: 43_792 },
  'flightLog.end': { metSeconds: 50_400 },
  'debrief.diagnosis.pastDeadline': {
    metSeconds: 12_000,
    deadlineSeconds: 10_800,
    lateSeconds: 1200,
  },
  'legality.plan.rectilinear': { nodeIndex: 0 },
  'legality.plan.nonConvergent': { nodeIndex: 3 },
  'scenario.error.malformedJson': { detail: 'Unexpected end of JSON input' },
  'scenario.error.unsupportedVersion': { version: 2, supported: 1 },
  'scenario.error.required': { path: '/', property: 'briefKey' },
  'scenario.error.unknownProperty': { path: '/ship', property: 'fuel_kg' },
  'scenario.error.type': { path: '/horizonSeconds', expected: 'number' },
  'scenario.error.range': { path: '/act', limit: 6 },
  'scenario.error.notAllowed': { path: '/objective/kind', allowed: ['intercept', 'rendezvous'] },
  'scenario.error.pattern': { path: '/id', pattern: '^[a-z0-9]+(-[a-z0-9]+)*$' },
  'scenario.error.itemCount': { path: '/coachMarks', limit: 3 },
  'scenario.error.stringLength': { path: '/par/derivation', limit: 20 },
  'scenario.error.duplicate': { path: '/assistsAllowed' },
  'scenario.error.invalidField': { path: '/par/dv_mps', keyword: 'multipleOf' },
  'scenario.error.unknownTarget': { path: '/objective/targetId', targetId: 'GHOST-1' },
  'scenario.error.duplicateTargetId': { path: '/targets/1/id', targetId: 'CTX-4' },
  'scenario.error.deadlineBeyondHorizon': { deadlineSeconds: 90_000, horizonSeconds: 50_400 },
  'scenario.error.startsBelowFloor': { startAltitudeM: 50_000, floorAltitudeM: 100_000 },
  'scenario.error.duplicateConstraint': { path: '/constraints/1', kind: 'deadline' },
  'scenario.error.toleranceTooLoose': {
    path: '/objective/maxRange_m',
    requested: 5000,
    limit: 1000,
  },
  'app.title': {},
  'app.routesLabel': {},
  'nav.board': {},
  'nav.contract': { index: 5 },
  'nav.daily': {},
  'nav.codex': {},
  'nav.settings': {},
  'screen.board.heading': {},
  'screen.contract.heading': { id: 'c03-cold-open' },
  'screen.daily.heading': {},
  'screen.dailyDate.heading': { date: '2026-09-01' },
  'screen.leaderboard.heading': { date: '2026-09-01' },
  'screen.codex.heading': { slug: 'phasing' },
  'screen.replay.heading': {},
  'screen.settings.heading': {},
  'screen.notFound.heading': {},
  'screen.notFound.body': { path: '/nope' },
  'screen.notFound.backToTitle': {},
  'screen.notBuiltYet': {},
  'brief.c03': {},
  'client.withheld': {},
  'planner.handle.prograde': {},
  'planner.handle.radial': {},
  'planner.apsis.periapsis': { altitudeMetres: 412_300 },
  'planner.apsis.apoapsis': { altitudeMetres: 35_786_000 },
  'planner.closestApproach': { separationMetres: 311.4, relativeSpeedMps: 0.02 },
  'mark.c03.departureWindow': {},
  'briefing.heading': { index: 3, title: 'Cold Open' },
  'briefing.backToBoard': {},
  'briefing.clientLabel': {},
  'briefing.feeLabel': {},
  'briefing.fee': { kilocredits: 6 },
  'briefing.objectiveLabel': {},
  'briefing.dvBudgetLabel': {},
  'briefing.deadlineLabel': {},
  'briefing.parLabel': {},
  'briefing.setupLabel': {},
  'briefing.shipLabel': {},
  'briefing.constraintsLabel': {},
  'briefing.dvBudget': { budgetMps: 300 },
  'briefing.deadline': { seconds: 10_800 },
  'briefing.par': { dvMps: 109.1177, timeSeconds: 4122.965, burns: 1 },
  'briefing.objective.reachOrbit': {
    periapsisAltitudeMetres: 400_000,
    apoapsisAltitudeMetres: 800_000,
  },
  'briefing.objective.intercept': { target: 'KESTREL-2', rangeMetres: 1000 },
  'briefing.objective.rendezvous': {
    target: 'KESTREL-2',
    rangeMetres: 100,
    relativeSpeedMps: 0.5,
  },
  'briefing.objective.softRendezvous': {
    target: 'KESTREL-2',
    rangeMetres: 100,
    relativeSpeedMps: 0.1,
  },
  'briefing.setup.circular': { altitudeMetres: 400_000 },
  'briefing.setup.circularPhased': { altitudeMetres: 800_000, trueAnomalyRad: 0.244_346_095 },
  'briefing.setup.ellipse': {
    periapsisAltitudeMetres: 400_000,
    apoapsisAltitudeMetres: 800_000,
  },
  'briefing.setup.ellipsePhased': {
    periapsisAltitudeMetres: 400_000,
    apoapsisAltitudeMetres: 800_000,
    trueAnomalyRad: 0.244_346_095,
  },
  'briefing.constraint.altitudeFloor': { floorAltitudeM: 100_000 },
  'briefing.recordNone': {},
  'briefing.record': { bestDvMps: 109.2, medal: 'gold', attempts: 7 },
  'briefing.attempts': { attempts: 7 },
  'briefing.dailyVariant': { date: '2026-09-01' },
  'briefing.leaderboardLink': {},
  'briefing.locked': { act: 2 },
  'briefing.accept': {},
  'briefing.unknownContract': { id: 'c99-nope' },
  'briefing.si.metresPerSecond': { metresPerSecond: 109.1177 },
  'briefing.si.seconds': { seconds: 10_800 },
  // §8.3.4's five regions (#123, #127–#132), §8.3.5's overlay (#137) and the camera (#103).
  'planner.region.orbitView': {},
  'planner.region.hud': {},
  'planner.hud.back': {},
  'planner.hud.contract': { index: 3, title: 'COLD OPEN' },
  'planner.hud.dvLabel': {},
  'planner.hud.dv': { usedMps: 72.4, budgetMps: 250 },
  'planner.hud.dvBar': { fraction: 0.29, usedMps: 72.4, budgetMps: 250 },
  'planner.hud.metLabel': {},
  'planner.hud.met': { metSeconds: 0 },
  'planner.hud.settings': {},
  'planner.hud.help': {},
  'planner.timeline.label': {},
  'planner.timeline.scrubAt': { metSeconds: 252 },
  'planner.timeline.stepHint': { stepSeconds: 60 },
  'planner.timeline.deadline': { metSeconds: 50_400 },
  'planner.timeline.node': { index: 1, metSeconds: 252 },
  'planner.timeline.objectiveMet': { metSeconds: 43_792 },
  'planner.timeline.band': { kind: 2, startMetSeconds: 1200, endMetSeconds: 1800 },
  'planner.plan.heading': {},
  'planner.plan.empty': {},
  'planner.plan.listLabel': { count: 2 },
  'planner.plan.nodeEpoch': { index: 1, metSeconds: 252 },
  'planner.plan.nodeLabel': { index: 1, metSeconds: 252, progradeMps: -36.2, radialMps: 0 },
  'planner.plan.prograde': { mps: -36.2 },
  'planner.plan.radial': { mps: 0 },
  'planner.plan.delete': { index: 1 },
  'planner.plan.expand': { index: 1 },
  'planner.plan.addNode': {},
  'planner.readouts.heading': {},
  'planner.readouts.apoapsisLabel': {},
  'planner.readouts.periapsisLabel': {},
  'planner.readouts.altitudeLabel': {},
  'planner.readouts.periodLabel': {},
  'planner.readouts.eccentricityLabel': {},
  'planner.readouts.apoapsis': { altitudeMetres: 400_000 },
  'planner.readouts.periapsis': { altitudeMetres: 274_200 },
  'planner.readouts.altitude': { altitudeMetres: 400_000 },
  'planner.readouts.period': { seconds: 5478 },
  'planner.readouts.eccentricity': { eccentricity: 0.0094 },
  'planner.readouts.circularNote': {},
  'planner.readouts.openNote': {},
  'planner.approach.heading': {},
  'planner.approach.rangeLabel': {},
  'planner.approach.relativeSpeedLabel': {},
  'planner.approach.atLabel': {},
  'planner.approach.range': { rangeMetres: 311.4 },
  'planner.approach.relativeSpeed': { mps: 0.02 },
  'planner.approach.at': { metSeconds: 43_792 },
  'planner.approach.met': { maxRangeMetres: 1000 },
  'planner.approach.notMet': { maxRangeMetres: 1000 },
  'planner.approach.none': {},
  'planner.assists.heading': {},
  'planner.assists.snapToApsis': {},
  'planner.assists.snapToApsisHint': { windowSeconds: 30 },
  'planner.tab.plan': { count: 2 },
  'planner.tab.readouts': {},
  'planner.tab.assists': {},
  'planner.tabsLabel': {},
  'planner.editor.heading': { index: 1 },
  'planner.editor.close': {},
  'planner.editor.epochLabel': {},
  'planner.editor.hours': {},
  'planner.editor.minutes': {},
  'planner.editor.seconds': {},
  'planner.editor.milliseconds': {},
  'planner.editor.epochSlider': {},
  'planner.editor.snapLabel': {},
  'planner.editor.snapPeriapsis': {},
  'planner.editor.snapApoapsis': {},
  'planner.editor.snapFree': {},
  'planner.editor.deltaVLabel': {},
  'planner.editor.prograde': {},
  'planner.editor.radial': {},
  'planner.editor.normal': {},
  'planner.editor.normalNote': {},
  'planner.editor.magnitudeLabel': {},
  'planner.editor.magnitude': { mps: 36.2 },
  'planner.editor.step': { sign: -1, axis: 0 },
  'planner.editor.stepHint': { stepMps: 1 },
  'planner.editor.resultHeading': {},
  'planner.editor.deltaAltitude': { deltaMetres: -125_800 },
  'planner.editor.deltaPeriod': { deltaSeconds: -78 },
  'planner.editor.resultOpen': {},
  'planner.editor.delete': {},
  'planner.editor.done': {},
  'planner.commit': {},
  'planner.camera.recentre': {},
  'planner.camera.zoomIn': {},
  'planner.camera.zoomOut': {},
  'planner.si.metres': { metres: 274_198.334_912_5 },
  'planner.si.metresPerSecond': { metresPerSecond: -36.200_1 },
  'planner.si.seconds': { seconds: 5478.123_456_789 },
  'save.problem.unreadable': {},
  'save.problem.futureVersion': { found: 2, supported: 1 },
  'save.problem.unknownVersion': { found: 0, supported: 1 },

  // ── Execution (§8.3.8) ─────────────────────────────────────────────────────
  'execution.region.orbitView': {},
  'execution.region.hud': {},
  'execution.speed.label': {},
  'execution.speed.option': { multiplier: 1000 },
  'execution.speed.current': { multiplier: 100_000 },
  'execution.control.pause': {},
  'execution.control.resume': {},
  'execution.control.skip': {},
  'execution.control.abort': {},
  'execution.paused.notice': {},
  'execution.progress.label': {},
  'execution.progress.at': { metSeconds: 4123, ofSeconds: 21_600 },
  'execution.burn.flash': { index: 1, deltaVMps: 109.1 },
  'execution.log.heading': {},
  'execution.log.label': { count: 12 },
  'execution.log.empty': {},
  'execution.announce.summary': { count: 7 },
  'execution.announce.label': {},

  // ── Debrief (§8.3.9) ───────────────────────────────────────────────────────
  'debrief.heading.success': { index: 3, title: 'Cold Open' },
  'debrief.heading.failure': { index: 3, title: 'Cold Open' },
  'debrief.medal': { medal: 'gold' },
  'debrief.medal.none': {},
  'debrief.table.label': {},
  'debrief.column.quantity': {},
  'debrief.column.you': {},
  'debrief.column.par': {},
  'debrief.column.best': {},
  'debrief.column.delta': {},
  'debrief.row.deltaV': {},
  'debrief.row.time': {},
  'debrief.row.burns': {},
  'debrief.value.deltaV': { mps: 109.1177 },
  'debrief.value.time': { seconds: 4122.965 },
  'debrief.value.burns': { count: 1 },
  'debrief.value.delta': { fraction: 0.006 },
  'debrief.value.absent': {},
  'debrief.closest': { achievedM: 310, neededM: 1000, metSeconds: 4123 },
  'debrief.whatHappened': {},
  'debrief.noDiagnosis': {},
  'debrief.missed': {},
  'debrief.miss.label.closest': {},
  'debrief.miss.label.needed': {},
  'debrief.miss.label.deltaV': {},
  'debrief.miss.closest': { rangeM: 12_400, metSeconds: 4123 },
  'debrief.miss.needed': { rangeM: 1000 },
  'debrief.miss.deltaV': { usedMps: 118.6, budgetMps: 300 },
  'debrief.beatPar': { byMps: 1.4 },
  'debrief.beatPar.report': {},
  'debrief.action.retry': {},
  'debrief.action.next': {},
  'debrief.action.share': {},
  'debrief.action.board': {},
  'debrief.next.none': {},
  'debrief.share.copied': {},
  'debrief.share.failed': {},
  'debrief.share.hint': {},
};

const catalogue = createCatalogue();

describe('coverage', () => {
  it('answers every key it declares, and nothing resolves to nothing', () => {
    expect(catalogue.keys.length).toBeGreaterThan(40);
    for (const key of catalogue.keys) {
      const text = catalogue.resolveDynamic(key, samples[key]);
      expect(text.trim(), key).not.toBe('');
    }
  });

  it('has a sample for exactly the keys it answers', () => {
    expect(Object.keys(samples).sort()).toStrictEqual([...catalogue.keys]);
  });

  it('lists its keys in a stable order', () => {
    expect([...catalogue.keys]).toStrictEqual([...catalogue.keys].sort());
    expect(createCatalogue().keys).toStrictEqual(catalogue.keys);
  });
});

describe('resolving what the rules emit', () => {
  it('takes a GameMessage straight from an evaluator', () => {
    const message = gameMessage('legality.l1.overBudget', {
      usedMps: 274,
      budgetMps: 250,
      excessMps: 24,
    });
    expect(catalogue.resolveMessage(message)).toBe('Over budget by 24.0 m/s');
  });

  // §6.4's own example of the message, which is the point of the exercise: the rule
  // produced a number and the catalogue produced the sentence.
  it('renders §6.4’s L2 message with the epoch', () => {
    const message = gameMessage('legality.l2.belowAltitudeFloor', {
      floorAltitudeM: 100_000,
      metSeconds: 2 * 3600 + 14 * 60,
      intervalCount: 1,
    });
    expect(catalogue.resolveMessage(message)).toBe(
      'Trajectory intersects the atmosphere at T+02:14:00',
    );
  });

  it('branches on a value rather than concatenating a variant', () => {
    const once = catalogue.resolve('legality.l2.belowAltitudeFloor', {
      floorAltitudeM: 100_000,
      metSeconds: 100,
      intervalCount: 1,
    });
    const thrice = catalogue.resolve('legality.l2.belowAltitudeFloor', {
      floorAltitudeM: 100_000,
      metSeconds: 100,
      intervalCount: 3,
    });
    expect(once).not.toBe(thrice);
    expect(thrice).toContain('3 times');
  });

  it('can be pulled off the catalogue and used on its own', () => {
    const t = catalogue.resolve;
    expect(t('app.title', {})).toBe('Hohmann Heist');
  });
});

describe('a missing key', () => {
  // Only reachable for a key that came from data — a scenario's briefKey or a coach
  // mark (D14). Every statically-known key is checked by the compiler.
  it('throws under the development policy, naming the key', () => {
    const dev = createCatalogue({ onMissingKey: 'throw' });
    expect(() => dev.resolveDynamic('brief.c05')).toThrow(MissingMessageKeyError);
    expect(() => dev.resolveDynamic('brief.c05')).toThrow(/brief\.c05/);
  });

  it('renders a visible marker under the production policy, never a blank', () => {
    const prod = createCatalogue({ onMissingKey: 'fallback' });
    const rendered = prod.resolveDynamic('brief.c05');
    expect(rendered).toBe(missingKeyFallback('brief.c05'));
    expect(rendered.trim()).not.toBe('');
    expect(rendered).toContain('brief.c05');
  });

  it('is stable across calls, so it does not flicker between renders', () => {
    const prod = createCatalogue({ onMissingKey: 'fallback' });
    expect(prod.resolveDynamic('brief.c05')).toBe(prod.resolveDynamic('brief.c05'));
  });

  it('throws by default, because the safe default is the loud one', () => {
    expect(() => createCatalogue().resolveDynamic('nope.at.all')).toThrow(MissingMessageKeyError);
  });

  it('reports which keys it has', () => {
    expect(catalogue.has('app.title')).toBe(true);
    expect(catalogue.has('brief.c05')).toBe(false);
  });

  it('resolves a key that is present, when handed dynamically', () => {
    expect(catalogue.resolveDynamic('app.title')).toBe('Hohmann Heist');
  });
});

describe('formatting follows the locale, not English', () => {
  it('uses the locale’s decimal separator', () => {
    const de = createCatalogue({ locale: 'de-DE' });
    const message = gameMessage('legality.l1.overBudget', {
      usedMps: 274.4,
      budgetMps: 250,
      excessMps: 24.4,
    });
    expect(de.resolveMessage(message)).toContain('24,4');
    expect(catalogue.resolveMessage(message)).toContain('24.4');
  });

  it('uses the locale’s plural categories rather than a two-way English rule', () => {
    // Polish has four; English has two. The formatter reports the category, so a
    // translated message can branch on it correctly.
    const pl = createCatalogue({ locale: 'pl-PL' });
    expect(pl.formatters.plural(1)).toBe('one');
    expect(pl.formatters.plural(3)).toBe('few');
    expect(pl.formatters.plural(5)).toBe('many');
    expect(catalogue.formatters.plural(3)).toBe('other');
  });

  it('joins lists the way the locale joins them', () => {
    expect(catalogue.formatters.list(['a', 'b', 'c'], 'disjunction')).toBe('a, b, or c');
    const de = createCatalogue({ locale: 'de-DE' });
    expect(de.formatters.list(['a', 'b'], 'conjunction')).toBe('a und b');
  });

  it('formats a unit rather than appending one', () => {
    // The abbreviation and its position are both locale-dependent, so appending "m/s"
    // in the message would decide both for every language at once. §8.3.3's SI tooltip is
    // where the game does this most literally: the quantity, unrounded, with its unit.
    expect(catalogue.resolve('briefing.si.metresPerSecond', { metresPerSecond: 3074.66 })).toBe(
      '3074.66 m/s',
    );
  });

  it('formats mission elapsed time through @hh/astro', () => {
    expect(catalogue.formatters.met(43_784)).toBe('T+12:09:44');
  });
});

describe('a caller can supply its own messages', () => {
  it('takes a replacement set, which is what a second locale will be', () => {
    const shouty = createCatalogue({ messages: { ...en, 'app.title': () => 'HOHMANN HEIST' } });
    expect(shouty.resolve('app.title', {})).toBe('HOHMANN HEIST');
    // And everything else still resolves.
    for (const key of shouty.keys) {
      expect(shouty.resolveDynamic(key, samples[key]).trim()).not.toBe('');
    }
  });
});
