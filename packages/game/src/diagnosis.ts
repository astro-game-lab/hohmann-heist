/**
 * Why a run missed — FR-307, §8.3.9.
 *
 * > *The failure text is generated from a small rule set over the outcome, not free-form.
 * > … Unmatched outcomes fall back to the bare numbers — **the game never speculates about
 * > why**.* — §8.3.9
 *
 * That last clause is the design. §6.11 makes the debrief where learning is consolidated,
 * and a confident wrong explanation there is worse than none: it teaches something false
 * at exactly the moment the player is most willing to believe it. So every rule below
 * fires only on evidence it can point at, the set is ordered so that two rules can never
 * both speak, and anything unmatched returns `null` — which the debrief renders as the
 * closest approach, what was needed, and nothing else.
 *
 * ## Which of §8.3.9's seven can fire
 *
 * §8.3.9 lists seven candidate rules, and three of them cannot occur on a run that reached
 * execution at all. *Ran out of budget*, *hit the floor* and *violated a constraint* are
 * `L1`, `L2` and the constraint checks — all of which **block commit** (§6.4). A committed
 * plan has none of them, so implementing them would be three branches no test could reach
 * except by constructing an outcome the game cannot produce.
 *
 * The four that remain:
 *
 * | Rule | Fires when | Evidence |
 * | --- | --- | --- |
 * | Missed the deadline | The objective was met after the deadline | `metSeconds` against `deadlineSeconds` |
 * | Too fast | Range was inside tolerance, speed was not | The achieved encounter against its tolerance |
 * | Arrived early or late | The miss is mostly **along-track** | `missRtn.y` dominating |
 * | Over- or under-shot | The miss is mostly **radial** | `missRtn.x` dominating |
 * | Wrong orbit | A `reach_orbit` element is outside tolerance | The element comparisons |
 *
 * ## Along-track versus radial is not a tie-break, it is the diagnosis
 *
 * A scalar range says how badly an encounter missed and cannot say how. The same 12 km can
 * be a ship on exactly the right trajectory arriving ninety seconds late, or a ship at
 * exactly the right moment twelve kilometres too high. Those want opposite advice, and
 * telling a player to adjust their timing when their altitude was wrong is the kind of
 * confident wrong explanation this module exists to avoid.
 *
 * So the miss is decomposed in the ship's RTN frame (`proximity.ts`), and the rule reads
 * which component dominates. **Neither dominating is a real outcome**, not a gap: a miss
 * at forty-five degrees is genuinely both, and the honest answer is to say nothing and let
 * the numbers speak. {@link DOMINANCE_RATIO} is where that line sits and why.
 */
import type { GameMessage } from './messages.js';
import { gameMessage } from './messages.js';
import type { ObjectiveEvaluation } from './objectives/index.js';
import { isProximityEvaluation } from './objectives/index.js';
import type { OutcomeFailure } from './outcome.js';

/**
 * How much one axis must exceed the other before the miss is called by its name.
 *
 * Two, so a miss is "along-track" only when the along-track component is at least twice
 * the radial one — about 27° of the 90° available. Between the two cones the miss is
 * genuinely diagonal and no rule fires.
 *
 * Chosen rather than measured, and stated as such: there is no experiment that yields
 * this number, only a judgement about when an explanation stops being true enough to be
 * useful. It is deliberately generous — the failure worth avoiding is confidently naming
 * the wrong axis, not staying quiet on a miss that was both.
 */
export const DOMINANCE_RATIO = 2;

/** The Codex entry a rule points at (§8.3.9: "one sentence and one Codex link"). */
export type CodexSlug =
  | 'departure-timing'
  | 'phasing-orbits'
  | 'burns-and-apsides'
  | 'the-hohmann-transfer'
  | 'rendezvous-versus-intercept';

export interface Diagnosis {
  readonly message: GameMessage;
  /**
   * Where to read more. The UI resolves this to a route; this module does not know what a
   * URL is. An entry that does not exist yet resolves to the Codex index (#161).
   */
  readonly codex: CodexSlug;
}

/** What the rules are allowed to look at. */
export interface DiagnosisFacts {
  readonly failure: OutcomeFailure | null;
  readonly objective: ObjectiveEvaluation | null;
  readonly metSeconds: number | null;
  readonly deadlineSeconds: number;
}

/**
 * Diagnose a run, or return `null`.
 *
 * Ordered, and the order is the priority: the first rule whose evidence is present wins,
 * and the rest are not consulted. That is what makes "exactly one rule fires or none" a
 * property of the function rather than of the facts it happens to be given.
 *
 * Deadline goes first because it is the only rule that can be true *of a successful
 * encounter* — a perfect intercept twenty minutes late is not a miss, it is a lateness,
 * and saying "you arrived late" about the meeting rather than the deadline would be
 * answering the wrong question.
 */
export const diagnose = (facts: DiagnosisFacts): Diagnosis | null => {
  const { failure, objective, metSeconds, deadlineSeconds } = facts;

  // ── Missed the deadline ────────────────────────────────────────────────────
  if (failure === 'pastDeadline' && metSeconds !== null) {
    return {
      message: gameMessage('debrief.diagnosis.pastDeadline', {
        metSeconds,
        deadlineSeconds,
        lateSeconds: metSeconds - deadlineSeconds,
      }),
      codex: 'departure-timing',
    };
  }

  if (objective === null) return null;

  // ── Wrong orbit ────────────────────────────────────────────────────────────
  if (objective.kind === 'reach_orbit' && !objective.met) {
    // The element that missed by the largest multiple of its own tolerance — "most
    // wrong" across quantities in different units, which a raw difference cannot rank.
    const worst = objective.comparisons
      .filter((comparison) => comparison.compared && !comparison.within)
      .reduce<{ element: string; difference: number; tolerance: number } | null>(
        (best, comparison) => {
          if (!comparison.compared) return best;
          const ratio = Math.abs(comparison.difference) / comparison.tolerance;
          const bestRatio = best === null ? -Infinity : Math.abs(best.difference) / best.tolerance;
          return ratio > bestRatio
            ? {
                element: comparison.element,
                difference: comparison.difference,
                tolerance: comparison.tolerance,
              }
            : best;
        },
        null,
      );

    if (worst === null) return null;
    return {
      message: gameMessage('debrief.diagnosis.wrongOrbit', {
        element: worst.element,
        difference: worst.difference,
        tolerance: worst.tolerance,
      }),
      codex: 'burns-and-apsides',
    };
  }

  if (!isProximityEvaluation(objective) || objective.met) return null;

  const { achieved, tolerance } = objective;

  // ── Too fast ───────────────────────────────────────────────────────────────
  //
  // Range was good enough and speed was not. Checked before the geometric rules because
  // it is a *different failure*: the ship got there, and the encounter was still not a
  // rendezvous. Explaining that as a miss of position would be plainly wrong.
  if (
    tolerance.maxRelativeSpeedMps !== null &&
    achieved.rangeM <= tolerance.maxRangeM &&
    achieved.relativeSpeedMps > tolerance.maxRelativeSpeedMps
  ) {
    return {
      message: gameMessage('debrief.diagnosis.tooFast', {
        relativeSpeedMps: achieved.relativeSpeedMps,
        maxRelativeSpeedMps: tolerance.maxRelativeSpeedMps,
        rangeM: achieved.rangeM,
      }),
      codex: 'rendezvous-versus-intercept',
    };
  }

  // ── Where the miss points ──────────────────────────────────────────────────
  const alongTrack = achieved.missRtn.y;
  const radial = achieved.missRtn.x;
  const along = Math.abs(alongTrack);
  const out = Math.abs(radial);

  // A miss of nothing has no direction. `proximity.ts` reports a zero vector when the
  // encounter could not be decomposed, and a rule reading a direction off it would be
  // inventing one.
  if (along === 0 && out === 0) return null;

  if (along > out * DOMINANCE_RATIO) {
    // The target is ahead of the ship (+T̂), so the ship is behind it — it arrived late.
    // Behind (−T̂) means the ship got there first.
    return {
      message:
        alongTrack > 0
          ? gameMessage('debrief.diagnosis.arrivedLate', {
              alongTrackM: along,
              rangeM: achieved.rangeM,
            })
          : gameMessage('debrief.diagnosis.arrivedEarly', {
              alongTrackM: along,
              rangeM: achieved.rangeM,
            }),
      codex: 'departure-timing',
    };
  }

  if (out > along * DOMINANCE_RATIO) {
    // The target is above the ship (+R̂), so the ship is below it — it undershot.
    return {
      message:
        radial > 0
          ? gameMessage('debrief.diagnosis.undershot', { radialM: out, rangeM: achieved.rangeM })
          : gameMessage('debrief.diagnosis.overshot', { radialM: out, rangeM: achieved.rangeM }),
      codex: 'the-hohmann-transfer',
    };
  }

  // Genuinely diagonal. §8.3.9's fallback, and not a gap in the rules.
  return null;
};
