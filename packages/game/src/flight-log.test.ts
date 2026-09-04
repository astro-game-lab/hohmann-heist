/**
 * The flight log (FR-604, #146).
 *
 * Two properties carry most of the weight here, and neither is about a particular
 * number:
 *
 * - **Completeness.** FR-604 names five categories, and the log must contain all of
 *   them. The tests assert against the finders' own output rather than against a
 *   transcribed list, so a log that silently dropped a category would fail even if
 *   nobody remembered to update a fixture.
 * - **Determinism.** The same timeline gives the same array, every time, including the
 *   ordering of entries that share an epoch. That is §11.4, and it is why the tie-break
 *   is asserted directly rather than inferred from a snapshot.
 *
 * The messages are asserted as **keys and parameters**, never as English — the same
 * split `messages.ts` exists to enforce.
 */
import { MU_EARTH, R_EARTH_EQ, elementsFromState, epoch } from '@hh/astro';
import { metres } from '@hh/math';
import { findApsisCrossings, findRevolutions } from '@hh/propagation';
import { describe, expect, it } from 'vitest';

import { evaluateAltitudeFloor } from './constraints/index.js';
import { buildFlightLog, type FlightLogEntry } from './flight-log.js';
import {
  REACH_ORBIT_TOLERANCE,
  evaluateProximity,
  evaluateReachOrbit,
  targetArc,
} from './objectives/index.js';
import {
  HORIZON,
  LEO_RADIUS_M,
  START,
  circular,
  definitely,
  messageOf,
  planOf,
  timelineFor,
} from './test-support.js';

const kindsOf = (entries: readonly FlightLogEntry[]): readonly string[] =>
  entries.map((entry) => entry.kind);

/** A target 400 km above the ship's orbit, trailing slightly — `c03-cold-open`'s shape. */
const TARGET = circular(LEO_RADIUS_M + 400_000, 0.9006, 1.1, 0.24);

const proximityFor = (timeline: ReturnType<typeof timelineFor>) =>
  evaluateProximity(
    timeline,
    targetArc(TARGET, START, HORIZON, MU_EARTH),
    'intercept',
    {},
    { maxRangeM: metres(1000), maxRelativeSpeedMps: null },
  );

describe('buildFlightLog', () => {
  describe('completeness (FR-604)', () => {
    it('opens with ignition and closes at the horizon', () => {
      const entries = buildFlightLog(timelineFor(planOf()));
      expect(entries[0]?.kind).toBe('ignition');
      expect(entries[0]?.metSeconds).toBe(0);
      expect(entries[entries.length - 1]?.kind).toBe('end');
      expect(entries[entries.length - 1]?.epoch).toBe(HORIZON);
    });

    it('records every burn, once, in plan order', () => {
      const entries = buildFlightLog(timelineFor(planOf([600, 40], [4000, -20])));
      const burns = entries.filter((entry) => entry.kind === 'burn');

      expect(burns).toHaveLength(2);
      expect(burns.map((burn) => messageOf(burn.message, 'flightLog.burn').params.index)).toEqual([
        1, 2,
      ]);
      // The signed along-track component, which is the fact a magnitude alone loses.
      expect(messageOf(burns[1]?.message, 'flightLog.burn').params.progradeMps).toBeCloseTo(-20, 6);
    });

    it('records every apsis the finder reports, and no others', () => {
      // An eccentric transfer, so there are apsides to find at all: the parking orbit is
      // circular and #60 correctly reports nothing there.
      const timeline = timelineFor(planOf([600, 120]));
      const entries = buildFlightLog(timeline);

      const fromFinder = timeline.arcs.flatMap((arc) =>
        findApsisCrossings(arc, arc.startEpoch, arc.endEpoch).map((event) => event.epoch),
      );
      const fromLog = entries
        .filter((entry) => entry.kind === 'periapsis' || entry.kind === 'apoapsis')
        .map((entry) => entry.epoch);

      expect(fromFinder.length).toBeGreaterThan(0);
      expect(fromLog).toEqual([...fromFinder].sort((a, b) => a - b));
    });

    it('records every revolution, numbered across the whole mission', () => {
      const timeline = timelineFor(planOf([600, 40]));
      const entries = buildFlightLog(timeline);

      const expected = timeline.arcs.reduce(
        (count, arc) => count + findRevolutions(arc, arc.startEpoch, arc.endEpoch).length,
        0,
      );
      const revolutions = entries.filter((entry) => entry.kind === 'revolution');

      expect(revolutions).toHaveLength(expected);
      expect(expected).toBeGreaterThan(1);
      // Numbering continues across the burn rather than restarting at the node.
      expect(
        revolutions.map((entry) => messageOf(entry.message, 'flightLog.revolution').params.index),
      ).toEqual(revolutions.map((_entry, i) => i + 1));
    });

    it('records the closest approach when there is a target', () => {
      const timeline = timelineFor(planOf([600, 40]));
      const objective = proximityFor(timeline);
      const entries = buildFlightLog(timeline, { objective });

      const closest = entries.find((entry) => entry.kind === 'closestApproach');
      expect(closest?.epoch).toBe(objective.achieved.epoch);
      expect(messageOf(closest?.message, 'flightLog.closestApproach').params.rangeM).toBe(
        objective.achieved.rangeM,
      );
    });

    it('records a constraint entry and exit as a pair', () => {
      // A large retrograde burn drops periapsis through the floor and back out again.
      const timeline = timelineFor(planOf([600, -180]));
      const floor = evaluateAltitudeFloor(timeline);
      const entries = buildFlightLog(timeline, { constraints: [floor] });

      expect(floor.violations.length).toBeGreaterThan(0);
      const enters = entries.filter((entry) => entry.kind === 'constraintEnter');
      const exits = entries.filter((entry) => entry.kind === 'constraintExit');
      expect(enters.length + exits.length).toBeGreaterThan(0);
      for (const entry of enters) {
        expect(messageOf(entry.message, 'flightLog.constraintEnter').params.kind).toBe(
          'altitude_floor',
        );
      }
      for (const entry of exits) {
        expect(messageOf(entry.message, 'flightLog.constraintExit').params.kind).toBe(
          'altitude_floor',
        );
      }
    });

    it('reports no constraint entries when nothing was violated', () => {
      const timeline = timelineFor(planOf([600, 40]));
      const entries = buildFlightLog(timeline, { constraints: [evaluateAltitudeFloor(timeline)] });
      expect(kindsOf(entries)).not.toContain('constraintEnter');
      expect(kindsOf(entries)).not.toContain('constraintExit');
    });

    it('does not report a clipped bound as a crossing', () => {
      // A ship that starts below the floor is already in violation at the search's
      // start: `clippedStart` is set, and nothing crossed into anything there.
      const timeline = timelineFor(planOf(), {
        initialState: circular(R_EARTH_EQ + 50_000, 0.5),
      });
      const floor = evaluateAltitudeFloor(timeline);
      const entries = buildFlightLog(timeline, { constraints: [floor] });

      expect(floor.violations[0]?.clippedStart).toBe(true);
      expect(kindsOf(entries)).not.toContain('constraintEnter');
    });
  });

  describe('ordering is total and stated', () => {
    it('is sorted by epoch', () => {
      const entries = buildFlightLog(timelineFor(planOf([600, 120], [4000, -60])));
      for (let i = 1; i < entries.length; i++) {
        expect(entries[i]?.epoch).toBeGreaterThanOrEqual(entries[i - 1]?.epoch ?? Number.NaN);
      }
    });

    it('applies the kind rank to entries at exactly the same epoch', () => {
      // An exact tie rather than a hoped-for near-coincidence. A burn at T+0 shares the
      // start epoch with ignition **to the bit**, because both are the timeline's own
      // `startEpoch` rather than two values that happen to be close — which is what
      // makes this an assertion about the tie-break instead of about float luck.
      const entries = buildFlightLog(timelineFor(planOf([0, 40])));
      const together = entries.filter((entry) => entry.epoch === START);
      const kinds = together.map((entry) => entry.kind);

      expect(kinds).toEqual(['ignition', 'burn']);
    });

    it('reports the same entries in the same order under any input ordering', () => {
      // The constraint evaluations are handed in as a list, and a log whose order
      // depended on that list's order would be a §11.4 violation reachable by a caller
      // reshuffling an array — which is exactly the "unordered container" case.
      const timeline = timelineFor(planOf([600, -180]));
      const floor = evaluateAltitudeFloor(timeline);
      const objective = proximityFor(timeline);

      expect(buildFlightLog(timeline, { objective, constraints: [floor] })).toEqual(
        buildFlightLog(timeline, { constraints: [floor], objective }),
      );
    });

    it('produces an identical array on every call — §11.4', () => {
      const timeline = timelineFor(planOf([600, 120], [4000, -60]));
      const objective = proximityFor(timeline);
      const input = { objective, constraints: [evaluateAltitudeFloor(timeline)] };

      expect(buildFlightLog(timeline, input)).toEqual(buildFlightLog(timeline, input));
    });
  });

  describe('the objective', () => {
    it('does not repeat the encounter as a separate objectiveMet line', () => {
      // For a proximity objective the epoch it was met at is a closest-approach epoch,
      // and two lines saying the same thing at the same second is noise.
      const timeline = timelineFor(planOf([600, 40]));
      const objective = proximityFor(timeline);
      const entries = buildFlightLog(timeline, { objective });

      if (objective.met && objective.atEpoch === objective.achieved.epoch) {
        expect(kindsOf(entries)).not.toContain('objectiveMet');
      }
    });

    it('records the moment a reach_orbit objective was met', () => {
      // The other branch: a contract with no encounter to report, where the epoch the
      // objective was satisfied at is the only thing to say about it.
      const timeline = timelineFor(planOf([600, 40]));
      const goal = elementsFromState(
        definitely(timeline.arcs[1]).state.position,
        definitely(timeline.arcs[1]).state.velocity,
        MU_EARTH,
      );
      const objective = evaluateReachOrbit(timeline, goal, REACH_ORBIT_TOLERANCE);
      const entries = buildFlightLog(timeline, { objective });

      expect(objective.met).toBe(true);
      expect(kindsOf(entries)).toContain('objectiveMet');
      // And no encounter line, because a `reach_orbit` contract has no target.
      expect(kindsOf(entries)).not.toContain('closestApproach');
    });

    it('records an encounter and the objective separately when they are not the same instant', () => {
      // A proximity objective met at an epoch other than the overall closest approach —
      // the run got inside tolerance on an earlier pass and closer on a later one.
      const timeline = timelineFor(planOf([600, 40]));
      const objective = proximityFor(timeline);
      const elsewhere = {
        ...objective,
        met: true,
        atEpoch: epoch(objective.achieved.epoch - 900),
      };
      const entries = buildFlightLog(timeline, { objective: elsewhere });

      expect(kindsOf(entries)).toContain('closestApproach');
      expect(kindsOf(entries)).toContain('objectiveMet');
    });

    it('omits the encounter entirely when no objective was judged', () => {
      const entries = buildFlightLog(timelineFor(planOf([600, 40])), { objective: null });
      expect(kindsOf(entries)).not.toContain('closestApproach');
      expect(kindsOf(entries)).not.toContain('objectiveMet');
    });
  });

  describe('altitudes, not radii', () => {
    it('measures apsis entries above the reference radius', () => {
      const timeline = timelineFor(planOf([600, 120]));
      const entries = buildFlightLog(timeline, { referenceRadiusM: R_EARTH_EQ });
      const apsis = entries.find(
        (entry) => entry.kind === 'periapsis' || entry.kind === 'apoapsis',
      );

      // A LEO apsis altitude is hundreds of kilometres, not thousands: a radius leaking
      // through would be ~6.8e6 rather than ~4e5.
      const altitude =
        apsis?.kind === 'apoapsis'
          ? messageOf(apsis.message, 'flightLog.apoapsis').params.altitudeM
          : messageOf(apsis?.message, 'flightLog.periapsis').params.altitudeM;
      expect(altitude).toBeGreaterThan(0);
      expect(altitude).toBeLessThan(2_000_000);
    });

    it('takes the reference radius from the caller', () => {
      const timeline = timelineFor(planOf([600, 120]));
      const zeroed = buildFlightLog(timeline, { referenceRadiusM: 0 });
      const apsis = zeroed.find((entry) => entry.kind === 'periapsis' || entry.kind === 'apoapsis');
      // With no reference radius the "altitude" is the radius itself.
      const radius =
        apsis?.kind === 'apoapsis'
          ? messageOf(apsis.message, 'flightLog.apoapsis').params.altitudeM
          : messageOf(apsis?.message, 'flightLog.periapsis').params.altitudeM;
      expect(radius).toBeGreaterThan(R_EARTH_EQ);
    });
  });

  describe('the empty plan', () => {
    it('still produces a complete log', () => {
      const entries = buildFlightLog(timelineFor(planOf()));
      expect(kindsOf(entries)).toContain('ignition');
      expect(kindsOf(entries)).toContain('revolution');
      expect(kindsOf(entries)).toContain('end');
      expect(kindsOf(entries)).not.toContain('burn');
      expect(messageOf(entries[0]?.message, 'flightLog.ignition').params.burnCount).toBe(0);
    });
  });

  describe('epochs', () => {
    it('reports mission elapsed time consistent with the absolute epoch', () => {
      // A start epoch far from zero, so a MET computed as an absolute epoch by mistake
      // would be out by a million seconds rather than by a rounding.
      const timeline = timelineFor(planOf(), {
        startEpoch: epoch(1_000_000),
        horizon: epoch(1_000_000 + 6 * 3600),
      });
      for (const entry of buildFlightLog(timeline)) {
        expect(entry.metSeconds).toBeCloseTo(entry.epoch - timeline.startEpoch, 9);
      }
    });
  });
});
