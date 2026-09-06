/**
 * How each constraint is drawn — FR-409, FR-107, §6.5, §6.6, §8.6 (#129).
 *
 * > *Constraints are evaluated during planning, drawn on the timeline as shaded bands, and
 * > shown on the orbit view where they are geometric. **A player never discovers a
 * > constraint by failing it.*** — §6.5
 *
 * `TimelineStrip` drew bands for intervals the current plan was *already violating*, which
 * is the second half of that sentence and not the first. A player still found the altitude
 * floor by dragging into it.
 *
 * ## Two kinds of band, and the difference is the whole issue
 *
 * A **violation** band is where this plan is illegal. A **preview** band is where a burn
 * *would* be illegal — it exists whether or not the player has gone there, and it is what
 * §6.5's last sentence asks for.
 *
 * The deadline is the clearest case. Its wall has always been drawn as a line, but the
 * region beyond it — every epoch at which a burn would be `L3` — was not shaded at all
 * until a plan actually crossed it. So the player learned where the deadline bit by biting
 * it. That region is exactly computable from the contract, needs no plan, and is now a
 * band.
 *
 * ## Where the intervals come from, and why it is no longer the reason list
 *
 * `TimelineStrip` used to take `LegalityReason[]` and flatten `reason.intervals`. That
 * ties what is *drawn* to what is *blocking*: a constraint that produces no reason — the
 * burn-count cap is soft and produces none by design — could never be banded, and one
 * whose reason is a warning would come and go with `commitAllowed`.
 *
 * It now takes `LegalityConstraints`, the four evaluations themselves. Every evaluation
 * carries its own `violations` intervals whether or not a reason was raised, which is the
 * same data one layer earlier and with the coupling removed.
 *
 * They are recomputed on every drag frame, and that is free rather than fast:
 * `evaluateLegality` already ran them for the commit bar and the HUD, and this reads the
 * result. NFR-011 is unaffected because nothing here evaluates anything — see `evaluate.ts`
 * on why the drag path skips the objective and keeps the constraints.
 */
import { metAt, type Epoch } from '@hh/astro';
import type { ConstraintKind, LegalityConstraints } from '@hh/game';

/**
 * How a constraint appears on the orbit view.
 *
 * `none` is a real answer and carries its reason, which is #129's first criterion: *"every
 * constraint kind has a declared orbit representation (including 'none, because it has no
 * geometry'), stated in one table in code so a new kind cannot silently have neither."*
 */
export type OrbitRepresentation =
  /** A shell drawn at the limiting radius, solid when the trajectory intersects it. */
  | 'hazard-shell'
  /** Nothing, because the constraint is not about where the ship is. */
  | 'none';

export interface ConstraintRepresentation {
  /** Every kind gets timeline bands; what differs is whether a preview exists. */
  readonly preview: 'region' | 'violations-only';
  readonly orbit: OrbitRepresentation;
  /** Why there is no orbit representation. Non-null exactly when `orbit` is `none`. */
  readonly orbitReason: string | null;
}

/**
 * §6.5's constraints and how each one is shown. **The one place this is stated.**
 *
 * A `Record` over `ConstraintKind` rather than an array, so a constraint added to that
 * union is a compile error here rather than a kind that quietly has no representation. The
 * §6.5 constraints M6 brings — blackout, eclipse, approach-speed cap, no-fly shell — each
 * add a row here when their evaluator lands; #129 declares the mapping, not the evaluators.
 */
export const CONSTRAINT_REPRESENTATION: Readonly<Record<ConstraintKind, ConstraintRepresentation>> =
  Object.freeze({
    /**
     * DEP-08's 100 km shell, already drawn by #107 and already turning solid on intersection.
     * That is the altitude floor's geometric representation and it is complete.
     *
     * `violations-only` on the timeline, and the distinction is worth being exact about: the
     * intervals *are* the preview. `evaluateAltitudeFloor` reports where the **current**
     * trajectory falls below the floor, which is a statement about where the ship is going
     * rather than about where it has been — so the band appears while a node is being dragged
     * towards trouble, before the drag is released and before the plan is illegal. There is
     * no separate region to shade, because "where a burn would be illegal" is not a property
     * of the epoch for this constraint; it depends on the whole trajectory.
     */
    altitude_floor: { preview: 'violations-only', orbit: 'hazard-shell', orbitReason: null },

    /**
     * The one true region preview: every epoch after the deadline is one at which a burn is
     * `L3`, computable from the contract alone. Shaded from the wall to the horizon.
     */
    deadline: {
      preview: 'region',
      orbit: 'none',
      orbitReason: 'A deadline is a time, not a place — nothing in the orbit view is later.',
    },

    /**
     * Cumulative over the whole plan, so it has no interval a player can avoid by burning
     * somewhere else. The HUD's Δv bar is where this constraint is legible, and it is
     * continuous rather than banded.
     */
    dv_budget: {
      preview: 'violations-only',
      orbit: 'none',
      orbitReason: 'A budget is spent over the whole plan, not at a place on the orbit.',
    },

    /**
     * Soft: it never blocks a commit (§6.5, #92) and forfeits Gold through §6.7's
     * `burns ≤ par_burns` rule instead. It has no geometry and no interval — a cap is a
     * count — so this row exists to say so rather than to draw anything.
     */
    burn_count: {
      preview: 'violations-only',
      orbit: 'none',
      orbitReason: 'A cap is a count of burns, with no position and no interval.',
    },
  });

/** One shaded interval on the timeline, and what it means. */
export interface Band {
  readonly kind: ConstraintKind;
  /** MET seconds, so the strip positions it without another conversion. */
  readonly startMet: number;
  readonly endMet: number;
  /**
   * `violated` — this plan breaks the rule here. `preview` — a burn here would.
   *
   * §8.6 makes the difference visible rather than only structural: a preview band is
   * shaded and a violated one is solid, *"no modal, no sound"*.
   */
  readonly state: 'preview' | 'violated';
}

export interface BandsInput {
  readonly constraints: LegalityConstraints;
  readonly startEpoch: Epoch;
  readonly horizon: Epoch;
  /** MET of the deadline, for the region preview. */
  readonly deadlineSeconds: number;
  /**
   * §6.6's `constraints` assist. With it off, preview regions are not drawn.
   *
   * **Violations are still drawn.** #129 asks for the assist to turn "preview" off, and a
   * violation is not a preview — it is a report of something that has already happened.
   * Hiding it would leave the commit bar saying a plan is illegal with nothing on the
   * timeline saying where, which is a worse game and is not what disabling an assist that
   * shows you things *early* should buy. Turning it off earns *Blind* precisely because it
   * removes the warning, not the verdict.
   */
  readonly previewEnabled: boolean;
}

/**
 * Every band the timeline should draw, in a stable order.
 *
 * Ordered by kind and then by start epoch rather than by whatever order the evaluations
 * happen to produce, so the DOM does not reshuffle between frames of a drag — which
 * matters for a screen reader reading the list and for Preact's keyed reconciliation.
 */
export const bandsFor = (input: BandsInput): readonly Band[] => {
  const { constraints, startEpoch, horizon, deadlineSeconds, previewEnabled } = input;
  const bands: Band[] = [];

  // Named individually rather than by iterating the object, so that a constraint added to
  // `LegalityConstraints` is a compile error here as well as in the table above — an
  // `Object.values` loop would silently include a new one with no representation declared.
  const evaluations = [
    constraints.budget,
    constraints.deadline,
    constraints.altitudeFloor,
    constraints.burnCount,
  ];

  for (const evaluation of evaluations) {
    for (const violation of evaluation.violations) {
      bands.push({
        kind: violation.kind,
        startMet: metAt(startEpoch, violation.start),
        endMet: metAt(startEpoch, violation.end),
        state: 'violated',
      });
    }
  }

  // The deadline's region, which is the half §6.5 was missing. Only when the assist is on:
  // this is the archetypal "shows you where you must not go before you go there".
  if (previewEnabled && CONSTRAINT_REPRESENTATION.deadline.preview === 'region') {
    const horizonMet = metAt(startEpoch, horizon);
    // Nothing to shade for a contract whose deadline is its horizon, which is the common
    // shape: there is no reachable epoch beyond the wall to warn about.
    if (deadlineSeconds < horizonMet) {
      bands.push({
        kind: 'deadline',
        startMet: deadlineSeconds,
        endMet: horizonMet,
        state: 'preview',
      });
    }
  }

  return bands.sort((a, b) =>
    a.kind === b.kind ? a.startMet - b.startMet : a.kind.localeCompare(b.kind),
  );
};
