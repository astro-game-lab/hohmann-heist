/**
 * The flight log — FR-604, #146, §8.3.8.
 *
 * > *The flight log MUST record every burn, apsis, revolution, constraint entry/exit,
 * > and the closest approach, with epochs.*
 *
 * One function, one array, built **once from the solved timeline** before playback
 * starts. Everything interesting about this module follows from that sentence.
 *
 * ## Why it is not built by watching the playback
 *
 * The obvious implementation samples the trajectory as the run plays and appends an
 * entry whenever something looks like it happened. It is wrong in three ways at once,
 * and #146's second criterion rules it out explicitly — *"events come from the event
 * finders over the solved timeline, not from sampling playback"*.
 *
 * **It would depend on the frame rate.** A sampled apsis is found only if a frame
 * lands near it, so a log built on a busy machine would differ from one built on an
 * idle machine, for the same plan. That is a determinism failure (§11.4) reached
 * without any randomness at all.
 *
 * **It would depend on the speed.** At 100 000× a frame advances 1 600 seconds of
 * mission time, which is a third of a LEO revolution: a sampled log would miss almost
 * everything. #146's last criterion — *"complete and identical whether the run was
 * watched or skipped to the end"* — cannot hold for a log that is a function of how
 * the player watched.
 *
 * **It would be a second implementation of the event finders**, and a worse one. #60's
 * apsis search is closed-form and cannot miss a crossing; a sampler can, and would
 * disagree with the markers the renderer draws from the same finder.
 *
 * So the log is a pure function of `(timeline, contract)` and nothing else. Playback
 * consumes it by advancing a cursor through epochs it did not choose — see
 * `@hh/ui`'s `execution/playback.ts` — which is what makes skipping and watching
 * produce the same array by construction rather than by agreement.
 *
 * ## Every entry is a key, never a sentence
 *
 * FR-910, and this package's standing rule: a {@link FlightLogEntry} carries a
 * {@link GameMessage} — a catalogue key and its parameters — and `@hh/ui` turns that
 * into text. An apsis altitude goes out as metres; whether a locale writes "274.2 km"
 * or "274,2 km" is not decided here.
 *
 * ## Ordering is total, and that matters more than it looks
 *
 * Entries are sorted by epoch, and ties are broken by a fixed **kind rank** rather
 * than by whatever order the finders happened to run in. Ties are not hypothetical:
 * a burn placed on an apsis by DEP-07's snap puts a burn and an apsis at the same
 * epoch to the tick, and `c03-cold-open`'s reference solution does exactly that.
 *
 * Without a stated tiebreak the two would order by array-concatenation accident,
 * which is a source of variation §11.4 forbids — "no iteration over unordered
 * containers where order affects the result". With one, the log is byte-identical
 * across runs, engines and machines. `Array.prototype.sort` has been required to be
 * stable since ES2019, so equal-rank entries additionally keep their finder's order,
 * which is itself epoch-ordered.
 *
 * ## What "constraint entry and exit" means here
 *
 * The constraint evaluators already return **intervals** (FR-107), and each interval
 * becomes two entries: one where the condition began to hold and one where it stopped.
 * A clipped bound is not an entry — `clippedStart` means the search began inside the
 * violation rather than that the spacecraft crossed into it there, and reporting a
 * crossing that did not happen would be worse than reporting nothing. The interval is
 * still visible: its other end is reported, and the log records the entry that exists.
 *
 * Note which constraints can appear at all. A *committed* plan has passed §6.4, so it
 * has no `L1`, `L2` or `L3` violation — the budget, the floor and the deadline all
 * block commit. Those entries are therefore reachable only from a timeline that was
 * never committed, which is exactly the case a planner-side preview of the log would
 * want, and the reason this takes the evaluations rather than assuming they are clean.
 */
import type { Epoch } from '@hh/astro';
import { R_EARTH_EQ, metAt } from '@hh/astro';
import { V } from '@hh/math';
import type { Timeline } from '@hh/sim';
import { findApsisCrossings, findRevolutions } from '@hh/propagation';

import type { ConstraintEvaluation, ConstraintViolation } from './constraints/index.js';
import type { GameMessage } from './messages.js';
import { gameMessage } from './messages.js';
import type { ObjectiveEvaluation } from './objectives/index.js';

/**
 * What kind of thing happened.
 *
 * A named union rather than a free string, so the UI can style, filter and rank
 * entries without parsing a message key — and so that adding a kind is a compile
 * error everywhere that switches over one.
 */
export type FlightLogKind =
  | 'ignition'
  | 'burn'
  | 'periapsis'
  | 'apoapsis'
  | 'revolution'
  | 'constraintEnter'
  | 'constraintExit'
  | 'closestApproach'
  | 'objectiveMet'
  | 'end';

/**
 * Tie-break order for entries sharing an epoch. Lower comes first.
 *
 * Chosen to read as a narrative rather than alphabetically: the run starts, the burn
 * fires, the geometry it put the spacecraft at follows, and the consequences come
 * last. A burn snapped to periapsis reads "burn 1 / periapsis", which is the order the
 * player caused them in.
 */
const KIND_RANK: Readonly<Record<FlightLogKind, number>> = Object.freeze({
  ignition: 0,
  burn: 1,
  periapsis: 2,
  apoapsis: 2,
  revolution: 3,
  constraintEnter: 4,
  constraintExit: 5,
  closestApproach: 6,
  objectiveMet: 7,
  end: 8,
});

/** One line of the log. */
export interface FlightLogEntry {
  /** When it happened. Absolute, so nothing has to remember which epoch it is relative to. */
  readonly epoch: Epoch;
  /** Mission elapsed seconds, which is what the feed displays (§8.3.8). */
  readonly metSeconds: number;
  readonly kind: FlightLogKind;
  /** A catalogue key and its parameters. Never a sentence (FR-910). */
  readonly message: GameMessage;
}

/** What the log is built from, beyond the timeline itself. */
export interface FlightLogInput {
  /** The objective evaluation, or `null` when the scenario's objective was not judged. */
  readonly objective?: ObjectiveEvaluation | null;
  /**
   * The constraint evaluations whose intervals become entry/exit pairs.
   *
   * A list rather than the named triple `LegalityConstraints` holds, because §6.5's
   * other five constraints arrive with the contracts that need them and each one is
   * just another source of intervals.
   */
  readonly constraints?: readonly ConstraintEvaluation[];
  /**
   * The radius apsis altitudes are measured above, in metres. Defaults to Earth's.
   *
   * A parameter for the same reason `evaluateAltitudeFloor` takes one: the log sits
   * above whatever body the scenario names, and §8.3.8's feed reads `periapsis
   * 274.2 km`, which is an altitude and not a radius. Converting here rather than in
   * the catalogue keeps Earth out of the message layer — `readouts.ts` makes the same
   * argument, and a catalogue that knew a planet's radius would be wrong for the first
   * contract that is not in Earth orbit.
   */
  readonly referenceRadiusM?: number;
}

/** Sort key: epoch first, then the stated rank. See the docstring on why there is one. */
const inOrder = (a: FlightLogEntry, b: FlightLogEntry): number =>
  a.epoch - b.epoch || KIND_RANK[a.kind] - KIND_RANK[b.kind];

/** Entries for one violating interval. A clipped bound is not a crossing — see the docstring. */
const forInterval = (timeline: Timeline, interval: ConstraintViolation): FlightLogEntry[] => {
  const entries: FlightLogEntry[] = [];
  if (!interval.clippedStart) {
    entries.push({
      epoch: interval.start,
      metSeconds: metAt(timeline.startEpoch, interval.start),
      kind: 'constraintEnter',
      message: gameMessage('flightLog.constraintEnter', {
        kind: interval.kind,
        metSeconds: metAt(timeline.startEpoch, interval.start),
      }),
    });
  }
  if (!interval.clippedEnd) {
    entries.push({
      epoch: interval.end,
      metSeconds: metAt(timeline.startEpoch, interval.end),
      kind: 'constraintExit',
      message: gameMessage('flightLog.constraintExit', {
        kind: interval.kind,
        metSeconds: metAt(timeline.startEpoch, interval.end),
        durationSeconds: interval.end - interval.start,
      }),
    });
  }
  return entries;
};

/**
 * Build the flight log for a solved timeline.
 *
 * Deterministic and pure: no clock, no randomness, no ambient state (§11.4). Called
 * once at commit, and the array it returns is what execution plays through and what
 * the debrief quotes.
 *
 * The searches run **per arc**, over each arc's own half-open span, and are
 * concatenated. That is `@hh/propagation`'s stated composition rule — abutting arcs
 * report each event exactly once, with no duplicate at a node's epoch and no
 * floating-point de-duplication needed here.
 */
export const buildFlightLog = (
  timeline: Timeline,
  input: FlightLogInput = {},
): readonly FlightLogEntry[] => {
  const { startEpoch, horizon } = timeline;
  const met = (at: Epoch): number => metAt(startEpoch, at);
  const referenceRadiusM = input.referenceRadiusM ?? R_EARTH_EQ;

  const entries: FlightLogEntry[] = [
    {
      epoch: startEpoch,
      metSeconds: 0,
      kind: 'ignition',
      message: gameMessage('flightLog.ignition', {
        burnCount: timeline.plan.nodes.length,
      }),
    },
  ];

  // ── Burns ───────────────────────────────────────────────────────────────────
  //
  // From the timeline's impulses rather than the plan's nodes: the plan holds the burn
  // in RTN, and the magnitude a player reads is the same either way, but the impulse is
  // where the states either side of it live and it is the record the renderer already
  // draws from. One source, one answer.
  for (const impulse of timeline.impulses) {
    entries.push({
      epoch: impulse.epoch,
      metSeconds: met(impulse.epoch),
      kind: 'burn',
      message: gameMessage('flightLog.burn', {
        index: impulse.nodeIndex + 1,
        deltaVMps: V.norm(impulse.deltaVEci),
        // Signed along-track component, which is what §8.3.8's feed shows as `-36.2 m/s`.
        // Taken from the plan's RTN transverse count rather than re-derived from the
        // inertial vector: DEP-10 calls that component "prograde" and `componentsOf`
        // already owns the convention.
        progradeMps: timeline.plan.nodes[impulse.nodeIndex]?.deltaVRtn.y ?? 0,
        metSeconds: met(impulse.epoch),
      }),
    });
  }

  // ── Apsides and revolutions, per arc ────────────────────────────────────────
  //
  // Revolutions are numbered across the whole timeline rather than per arc: an arc
  // counts from its own start (a burn changes what one revolution is), but the player
  // reads a single mission-long sequence.
  let revolution = 0;
  for (const arc of timeline.arcs) {
    for (const apsis of findApsisCrossings(arc, arc.startEpoch, arc.endEpoch)) {
      entries.push({
        epoch: apsis.epoch,
        metSeconds: met(apsis.epoch),
        kind: apsis.kind,
        message: gameMessage(
          apsis.kind === 'periapsis' ? 'flightLog.periapsis' : 'flightLog.apoapsis',
          { altitudeM: apsis.radius - referenceRadiusM, metSeconds: met(apsis.epoch) },
        ),
      });
    }

    for (const completed of findRevolutions(arc, arc.startEpoch, arc.endEpoch)) {
      revolution += 1;
      entries.push({
        epoch: completed.epoch,
        metSeconds: met(completed.epoch),
        kind: 'revolution',
        message: gameMessage('flightLog.revolution', {
          index: revolution,
          periodSeconds: completed.periodSeconds,
          metSeconds: met(completed.epoch),
        }),
      });
    }
  }

  // ── Constraint entries and exits ────────────────────────────────────────────
  for (const constraint of input.constraints ?? []) {
    for (const interval of constraint.violations) {
      entries.push(...forInterval(timeline, interval));
    }
  }

  // ── The encounter ───────────────────────────────────────────────────────────
  const objective = input.objective ?? null;
  if (objective !== null && objective.kind !== 'reach_orbit') {
    const { achieved } = objective;
    entries.push({
      epoch: achieved.epoch,
      metSeconds: met(achieved.epoch),
      kind: 'closestApproach',
      message: gameMessage('flightLog.closestApproach', {
        rangeM: achieved.rangeM,
        relativeSpeedMps: achieved.relativeSpeedMps,
        metSeconds: met(achieved.epoch),
      }),
    });
  }

  // The moment the objective was satisfied, when there is one and it is not the same
  // instant as the closest approach — for a proximity objective it usually is, and two
  // lines saying the same thing is noise rather than information.
  if (objective !== null && objective.met && objective.atEpoch !== null) {
    const already =
      objective.kind !== 'reach_orbit' && objective.atEpoch === objective.achieved.epoch;
    if (!already) {
      entries.push({
        epoch: objective.atEpoch,
        metSeconds: met(objective.atEpoch),
        kind: 'objectiveMet',
        message: gameMessage('flightLog.objectiveMet', {
          metSeconds: met(objective.atEpoch),
        }),
      });
    }
  }

  entries.push({
    epoch: horizon,
    metSeconds: met(horizon),
    kind: 'end',
    message: gameMessage('flightLog.end', { metSeconds: met(horizon) }),
  });

  return Object.freeze(entries.sort(inOrder));
};
