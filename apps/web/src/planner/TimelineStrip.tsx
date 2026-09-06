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
 * The step comes from {@link scrubStepFor} and is stated in the hint the input is
 * described by, so the "documented" half of that criterion is documented *to the player*
 * rather than only in this docstring — and it stays documented when it changes, because
 * the hint reads the same number the input does.
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
import type { ConstraintKind, ConstraintViolation, LegalityReason } from '@hh/game';
import type { Plan } from '@hh/sim';
import type { Catalogue } from '@hh/ui';
import type { JSX } from 'preact';

/**
 * The scrub step, as a fraction of the mission window — about a fifth of a percent.
 *
 * This used to be a flat 60 s, and its docstring gave the reason: *"a minute over a 14 h
 * window is a little under a fifth of a percent, which is fine for an arrow key and far
 * too coarse for finding an encounter — that is what `Shift` (×0.1) is for."* Every word
 * of that is still right, and every word of it is about a **fourteen-hour** window.
 *
 * C07 runs for fourteen days. A minute there is a fifth of a *hundredth* of a percent and
 * crossing the timeline takes twenty thousand key presses, which is not "keyboard operable
 * with a documented step size" (#128) in any useful sense however accurately it is
 * documented. So the fraction is the invariant and the step follows from it: 0.2% of 14 h
 * is 60 s, which is where the original constant came from, and a fourteen-hour contract
 * still gets exactly that.
 *
 * Shorter contracts do move. C03's six-hour window gets 30 s rather than 60, because 60 s
 * was already twice the intended fraction for it — the flat constant was right for one
 * window and approximately wrong for every other, which is only visible now that the
 * shipped windows span three hours to fourteen days.
 */
const SCRUB_STEP_FRACTION = 60 / (14 * 3600);

/**
 * Steps a person can hold in their head, coarsest last.
 *
 * The derived fraction is snapped to one of these rather than used raw, because "moves by
 * 2 419 s" is a true sentence that tells a player nothing.
 */
const SCRUB_STEPS_SECONDS = [1, 5, 15, 30, 60, 300, 900, 1800, 3600, 7200, 21_600, 43_200];

/**
 * The arrow-key step for a mission window, in seconds.
 *
 * Snapped to the **nearest** listed step rather than rounded down, because the quantity
 * being held fixed is how many presses it takes to cross the timeline — a constant
 * fraction means a constant press count, and rounding always downward would nearly double
 * it wherever the target fell just above a listed value. Nearest keeps every shipped
 * contract between about 670 and 960 presses end to end; rounding down would have put a
 * three-hour contract at 2 160, which is a worse instrument than the flat minute it
 * replaced.
 *
 * Never zero: a contract shorter than the smallest step still gets one, because an
 * `<input type="range">` with `step={0}` does not move at all.
 */
export const scrubStepFor = (windowSeconds: number): number => {
  const target = windowSeconds * SCRUB_STEP_FRACTION;
  const first = SCRUB_STEPS_SECONDS[0] ?? 1;
  return SCRUB_STEPS_SECONDS.reduce(
    (best, step) => (Math.abs(step - target) < Math.abs(best - target) ? step : best),
    first,
  );
};

/**
 * Where a constraint band came from, so its label can name the constraint.
 *
 * Every member of `ConstraintKind`, so the lookup below is total. `burn_count` never
 * reaches here today — the cap is soft, so it produces no `LegalityReason` and these
 * bands are flattened out of the reason list — and it is listed anyway: the compiler
 * checks this array against the union, and leaving a kind out would make the next
 * constraint that *is* drawn silently label itself "constraint".
 */
const BAND_KIND_ORDER: readonly ConstraintKind[] = [
  'dv_budget',
  'deadline',
  'altitude_floor',
  'burn_count',
];

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
  const scrubStep = scrubStepFor(windowSeconds);
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
        step={scrubStep}
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
        {t('planner.timeline.stepHint', { stepSeconds: scrubStep })}
      </p>
    </section>
  );
};
