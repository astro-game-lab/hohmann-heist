/**
 * §8.3.4's region ② — the timeline. #128, FR-403, §6.5.
 *
 * The primary time control, and the one region that is present in both layouts and never
 * behind a tab (§8.3.4, #123). It shows the whole mission window: node markers, the scrub
 * head, the deadline wall, constraint bands, and the objective-met tick.
 *
 * ## Scrubbing cannot mutate the plan, and the proof is upstream
 *
 * #128's second criterion calls this *"the invariant that keeps prediction honest"* and
 * asks for a test. The test is in `machine.test.ts`, not here, and that is deliberate:
 * `scrubTo` returns a model whose `plan` is the same object it was handed, so the
 * invariant is a property of the transition rather than of this component's event
 * handlers. What this file contributes is that it has **no other way to change the
 * plan** — `onScrub` is the only callback it is given, and the plan arrives as read-only
 * data it renders positions from.
 *
 * ## A range input rather than a div with pointer handlers
 *
 * The scrub head is `<input type="range">`. That is not a shortcut around the drag
 * gesture; it is what makes #128's fifth criterion — *"keyboard operable with a documented
 * step size"* — true without writing a key handler at all. Arrow keys, Home and End,
 * page keys and touch all come from the platform and behave the way the player's own
 * assistive technology expects, which is a stronger guarantee than a bespoke widget that
 * happens to handle `ArrowLeft`.
 *
 * The step is `SCRUB_STEP_SECONDS`, stated in the hint the input is described by, so the
 * "documented" half of that criterion is documented *to the player* rather than only in
 * this docstring.
 *
 * ## Everything else is positioned, not interactive
 *
 * Markers, bands, the deadline wall and the objective tick are absolutely positioned by
 * percentage of the mission window. They are `aria-hidden` where a sibling already says
 * the same thing in text, and labelled where they do not — a constraint band is the only
 * statement that a violation spans *that* interval, so it keeps its label (§6.5: a player
 * never discovers a constraint by failing it).
 */
import { metAt, type Epoch } from '@hh/astro';
import type { ConstraintViolation, LegalityReason } from '@hh/game';
import type { Plan } from '@hh/sim';
import type { Catalogue } from '@hh/ui';
import type { JSX } from 'preact';

/**
 * §8.5.3's `[` and `]` move the scrub head by a minute; this is the timeline's own step.
 *
 * A minute over a 14 h window is a little under a fifth of a percent, which is fine for
 * an arrow key and far too coarse for finding an encounter — that is what `Shift` (×0.1)
 * is for in §8.5.3's table, and the range input applies it through the same `step`.
 */
export const SCRUB_STEP_SECONDS = 60;

/** Where a constraint band came from, so its label can name the constraint. */
const BAND_KIND_ORDER = ['dv_budget', 'deadline', 'altitude_floor'] as const;

export interface TimelineStripProps {
  readonly t: Catalogue['resolve'];
  readonly plan: Plan;
  readonly startEpoch: Epoch;
  readonly horizon: Epoch;
  /** MET of the contract's deadline — the wall. Past it a plan is `L3`. */
  readonly deadlineSeconds: number;
  readonly scrubEpoch: Epoch;
  /** Every reason's intervals, shaded during planning (§6.5). */
  readonly reasons: readonly LegalityReason[];
  /** Where the objective was first satisfied, or `null`. */
  readonly objectiveMetEpoch: Epoch | null;
  readonly selectedNodeIndex: number | null;
  readonly onScrub: (epoch: Epoch) => void;
  readonly onSelectNode: (index: number) => void;
}

/** Position as a percentage of the mission window. Clamped: a band may start before it. */
const positionPercent = (metSeconds: number, windowSeconds: number): number =>
  windowSeconds <= 0 ? 0 : Math.max(0, Math.min(100, (metSeconds / windowSeconds) * 100));

export const TimelineStrip = ({
  t,
  plan,
  startEpoch,
  horizon,
  deadlineSeconds,
  scrubEpoch,
  reasons,
  objectiveMetEpoch,
  selectedNodeIndex,
  onScrub,
  onSelectNode,
}: TimelineStripProps): JSX.Element => {
  const windowSeconds = metAt(startEpoch, horizon);
  const scrubMet = metAt(startEpoch, scrubEpoch);
  const at = (metSeconds: number): number => positionPercent(metSeconds, windowSeconds);

  // Every interval from every reason, flattened. A reason can carry several — three dips
  // below the floor is three bands — and §6.5 asks for all of them, not the first.
  const bands: readonly ConstraintViolation[] = reasons.flatMap((reason) => reason.intervals);

  return (
    <section class="hh-timeline" aria-label={t('planner.timeline.label', {})}>
      <div class="hh-timeline__track" data-testid="timeline-track">
        {bands.map((band) => {
          const startMet = metAt(startEpoch, band.start);
          const endMet = metAt(startEpoch, band.end);
          const kind = BAND_KIND_ORDER.indexOf(band.kind);
          return (
            <div
              key={`${band.kind}:${String(band.start)}:${String(band.end)}`}
              class="hh-timeline__band"
              data-kind={band.kind}
              data-testid="timeline-band"
              style={{
                left: `${String(at(startMet))}%`,
                width: `${String(Math.max(0.4, at(endMet) - at(startMet)))}%`,
              }}
              title={t('planner.timeline.band', {
                kind,
                startMetSeconds: startMet,
                endMetSeconds: endMet,
              })}
            >
              <span class="hh-sr-only">
                {t('planner.timeline.band', {
                  kind,
                  startMetSeconds: startMet,
                  endMetSeconds: endMet,
                })}
              </span>
            </div>
          );
        })}

        <div
          class="hh-timeline__deadline"
          data-testid="timeline-deadline"
          style={{ left: `${String(at(deadlineSeconds))}%` }}
        >
          <span class="hh-sr-only">
            {t('planner.timeline.deadline', { metSeconds: deadlineSeconds })}
          </span>
        </div>

        {objectiveMetEpoch === null ? null : (
          <div
            class="hh-timeline__objective"
            data-testid="timeline-objective"
            style={{ left: `${String(at(metAt(startEpoch, objectiveMetEpoch)))}%` }}
          >
            <span class="hh-sr-only">
              {t('planner.timeline.objectiveMet', {
                metSeconds: metAt(startEpoch, objectiveMetEpoch),
              })}
            </span>
          </div>
        )}

        {/*
          Node markers are buttons, so the timeline is a second route to selection for a
          keyboard user and the plan panel is not the only one. They are ordered by epoch
          because `Plan` is (FR-101) — #128's "markers reorder automatically by epoch" is
          a property the plan already guarantees, so there is no sort here to disagree
          with it.
        */}
        {plan.nodes.map((node, index) => (
          <button
            key={node.epochTicks}
            type="button"
            class="hh-timeline__node"
            aria-pressed={selectedNodeIndex === index}
            data-testid={`timeline-node-${String(index)}`}
            style={{ left: `${String(at(metAt(startEpoch, node.epoch)))}%` }}
            onClick={() => {
              onSelectNode(index);
            }}
          >
            <span class="hh-sr-only">
              {t('planner.timeline.node', {
                index: index + 1,
                metSeconds: metAt(startEpoch, node.epoch),
              })}
            </span>
          </button>
        ))}
      </div>

      <input
        type="range"
        class="hh-timeline__scrub"
        min={0}
        max={windowSeconds}
        step={SCRUB_STEP_SECONDS}
        value={scrubMet}
        aria-label={t('planner.timeline.scrubAt', { metSeconds: scrubMet })}
        aria-describedby="hh-timeline-step-hint"
        data-testid="timeline-scrub"
        onInput={(event) => {
          const seconds = Number((event.target as HTMLInputElement).value);
          // Back to an absolute epoch here rather than storing a MET: the plan's epochs
          // are absolute (FR-101) and a second time origin in the app would be a second
          // thing to get wrong.
          onScrub((startEpoch + seconds) as Epoch);
        }}
      />
      <p class="hh-sr-only" id="hh-timeline-step-hint">
        {t('planner.timeline.stepHint', { stepSeconds: SCRUB_STEP_SECONDS })}
      </p>
    </section>
  );
};
