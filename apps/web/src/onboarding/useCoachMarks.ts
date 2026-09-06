/**
 * Which coach mark is showing, and what dismissing one means — FR-902, §6.6 (#159).
 *
 * The scenario says *which* marks a contract has, `@hh/ui`'s table says where each points
 * and when it fires, and this decides which of them is on screen right now. Splitting it
 * that way is what keeps the framework free of per-contract code: nothing here knows a
 * contract exists.
 *
 * ## One at a time, in declaration order
 *
 * A contract may declare three. Showing three at once would be a screen with three
 * competing hints on it, which is the failure mode §8.6 is avoiding by making marks
 * non-modal in the first place — six affordances shouting is worse than one modal. So the
 * first eligible mark shows, the next appears when it is dismissed, and the scenario's
 * order is the order.
 *
 * ## The two dismissals are different things, and only one is permanent
 *
 * *Got it* hides the mark for this attempt: component state, gone on reload, which is the
 * right lifetime for "yes, I read it". *Don't show this again* writes the mark's key to
 * `flags.coachMarksSeen` and it never returns on any device that reads that save — FR-902's
 * *"permanently dismissible"*.
 *
 * The third off switch is neither of those: it is the `coach_marks` assist, which turns
 * every mark off at once and is the same flag as §8.3.12's setting. It arrives here as
 * `enabled` and short-circuits everything below.
 */
import { latch, markByKey, type MarkFacts, type MarkSpec, type MarkTrigger } from '@hh/ui';
import { useEffect, useState } from 'preact/hooks';

export interface CoachMarkOptions {
  /** The scenario's `coachMarks`: catalogue keys, in the order the contract wants them. */
  readonly declared: readonly string[];
  /** The `coach_marks` assist. False suppresses every mark — §6.6, §8.3.12. */
  readonly enabled: boolean;
  readonly facts: MarkFacts;
  /** `flags.coachMarksSeen` from the save. */
  readonly seen: readonly string[];
  /** Write a key to `flags.coachMarksSeen`. Called once, on permanent dismissal. */
  readonly onSeen: (key: string) => void;
}

export interface CoachMarkController {
  /** The mark to draw, or `null`. */
  readonly mark: MarkSpec | null;
  /** *Got it* — this attempt only. */
  readonly dismiss: () => void;
  /** *Don't show this again* — writes the save. */
  readonly dismissPermanently: () => void;
}

export const useCoachMarks = ({
  declared,
  enabled,
  facts,
  seen,
  onSeen,
}: CoachMarkOptions): CoachMarkController => {
  const [fired, setFired] = useState<ReadonlySet<MarkTrigger>>(() => new Set<MarkTrigger>());
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(() => new Set<string>());

  // Latched rather than recomputed, so a mark does not blink out when the player deletes
  // the node that summoned it — `triggers.ts` says why at length. `latch` returns the same
  // set when nothing fired, and `setState` with an unchanged value is a no-op, so this
  // does not re-render on every scrub despite running on every one.
  //
  // The dependency list is the four facts rather than the object holding them: the caller
  // builds that object inline each render, and depending on its identity would run the
  // effect every frame.
  const { nodeCount, committable, nodeSelected, objectiveMet } = facts;
  useEffect(() => {
    setFired((current) => latch(current, { nodeCount, committable, nodeSelected, objectiveMet }));
  }, [nodeCount, committable, nodeSelected, objectiveMet]);

  const mark = enabled
    ? (declared
        .map((key) => markByKey(key))
        .find(
          (spec): spec is MarkSpec =>
            spec !== undefined &&
            fired.has(spec.trigger) &&
            !dismissed.has(spec.key) &&
            !seen.includes(spec.key),
        ) ?? null)
    : null;

  const hideForNow = (): void => {
    if (mark === null) return;
    setDismissed((current) => new Set([...current, mark.key]));
  };

  return {
    mark,
    dismiss: hideForNow,
    dismissPermanently: () => {
      if (mark === null) return;
      // Both, and in this order. The save write is asynchronous as far as this component
      // is concerned — it goes up to `app.tsx` and comes back down as a new `seen` — and
      // without the local hide the mark would still be on screen for that round trip.
      onSeen(mark.key);
      hideForNow();
    },
  };
};
