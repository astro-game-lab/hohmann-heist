/**
 * Execution — §8.3.8, #144, #145, #146, #147.
 *
 * > *Same orbit view, different chrome. The plan panel becomes an event feed.*
 *
 * Composition, and the keyboard. The run's state is `store.ts`'s, the clock's rules are
 * `@hh/ui`'s, the log is `@hh/game`'s and the camera is `camera.ts`'s; this decides what
 * is on screen and which key does what.
 *
 * ## What this screen cannot do, and why that is structural
 *
 * §8.3.8: *"pausing does not allow editing — that would break the 'prediction is truth'
 * promise. It offers Abort instead."*
 *
 * There is no edit control here to disable, no `PlanEdit` imported, and no plan in this
 * component's state — the committed plan lives on the timeline it produced, which is
 * read-only. So the promise is kept by there being nothing that could break it, and the
 * paused state says so in a sentence rather than leaving the absence to be inferred.
 *
 * ## The outcome was decided before the first frame
 *
 * FR-601. The `Outcome` this screen hands to the debrief is computed by whoever
 * committed the plan, arrives as a prop, and is passed through untouched. Nothing here
 * evaluates anything, which is why watching the run, skipping it, or aborting and
 * committing the identical plan again all produce the same numbers — and why changing
 * speed cannot (FR-602).
 *
 * ## Reduced motion skips rather than slows
 *
 * §8.8's Motion row: *"playback defaults to skip-to-end"*. Not a shorter animation — no
 * animation. The debrief is reached immediately with the complete flight log, which is
 * the same destination and the same log a watched run arrives at (#145, #146).
 */
import type { Epoch } from '@hh/astro';
import type { FlightLogEntry, LoadedScenario, Outcome } from '@hh/game';
import type { Timeline } from '@hh/sim';
import type { Catalogue, PlaybackSpeed } from '@hh/ui';
import { PLAYBACK_SPEEDS, elapsedSeconds, progressOf } from '@hh/ui';
import type { JSX } from 'preact';
import { useEffect } from 'preact/hooks';

import { useReducedMotion } from '../motion.js';
import { ExecutionView } from './ExecutionView.js';
import { FlightLog } from './FlightLog.js';
import { useExecution } from './store.js';

export interface ExecutionScreenProps {
  readonly t: Catalogue['resolve'];
  readonly resolveDynamic: Catalogue['resolveDynamic'];
  readonly scenario: LoadedScenario;
  /** The committed timeline. Played back, never rebuilt (FR-601). */
  readonly timeline: Timeline;
  /** The complete log, built once at commit from the solved timeline (#146). */
  readonly entries: readonly FlightLogEntry[];
  /** The result, decided at commit. Passed through to the debrief untouched. */
  readonly outcome: Outcome;
  /** FR-603: back to the planner, with the plan intact. */
  readonly onAbort: () => void;
  /** The run reached the horizon. */
  readonly onFinish: () => void;
}

export const ExecutionScreen = ({
  t,
  resolveDynamic,
  scenario,
  timeline,
  entries,
  outcome,
  onAbort,
  onFinish,
}: ExecutionScreenProps): JSX.Element => {
  const reducedMotion = useReducedMotion();

  const [state, actions] = useExecution(entries, {
    startEpoch: timeline.startEpoch,
    endEpoch: timeline.horizon,
    skipImmediately: reducedMotion,
  });

  const { playback } = state;
  const ended = playback.status === 'ended';

  /**
   * §8.3.8's burn cue, as the HUD's own wording.
   *
   * The flight log already has a phrase for a burn and it is the wrong one here: the log
   * is read at leisure and quotes the Δv to DEP-09's quantum, while the cue is glanced at
   * for a second and wants one decimal. So the HUD resolves its own key, and the burn's
   * numbers come off the entry's parameters — narrowed by the literal key, which is
   * exactly what `GameMessage`'s distributed union is for.
   */
  const burnFlash = state.burnFlash;
  const flash =
    burnFlash !== null && burnFlash.message.key === 'flightLog.burn'
      ? { index: burnFlash.message.params.index, deltaVMps: burnFlash.message.params.deltaVMps }
      : null;

  // The encounter the camera closes in on (#147). Read from the outcome rather than
  // searched for here: it is the same epoch the debrief quotes, so the view tightens on
  // exactly the moment the result is about.
  const encounterEpoch: Epoch | null =
    outcome.objective !== null && outcome.objective.kind !== 'reach_orbit'
      ? outcome.objective.achieved.epoch
      : null;

  // Leaving for the debrief is an effect rather than something the frame loop does, so
  // it happens once after the render that finished the run — not from inside a callback
  // that is also updating state.
  useEffect(() => {
    if (ended) onFinish();
  }, [ended, onFinish]);

  /**
   * §8.5.3's execution map: `Space`, `1`–`5`, `S`, `Esc`.
   *
   * On the document rather than on a region, for NFR-016's reason: *"fully operable
   * without a pointer"* has to hold wherever focus happens to be, and a binding that
   * only worked while focus was on the canvas would fail exactly when a keyboard user
   * needed it. The flight log is focusable and scrolls with the arrow keys, which are
   * deliberately unbound here.
   */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      if (event.key === ' ' || event.key === 'Spacebar') {
        actions.togglePause();
      } else if (event.key === 's' || event.key === 'S') {
        actions.skipToEnd();
      } else if (event.key === 'Escape') {
        // §8.5.3's "Back / close overlay". There is no overlay here, so it is Abort —
        // and abort is the only way out that keeps the plan (FR-603).
        onAbort();
      } else {
        // `1`–`5` index `PLAYBACK_SPEEDS` directly, so the key map and the button row
        // read from one list and cannot disagree about which digit is which rate.
        const index = Number.parseInt(event.key, 10) - 1;
        const speed = Number.isNaN(index) ? undefined : PLAYBACK_SPEEDS[index];
        if (speed === undefined) return;
        actions.setSpeed(speed);
      }
      event.preventDefault();
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [actions, onAbort]);

  return (
    <div class="hh-execution" data-testid="execution">
      <header class="hh-hud" aria-label={t('execution.region.hud', {})}>
        <span class="hh-hud__contract">
          {t('planner.hud.contract', {
            index: scenario.document.index,
            title: scenario.document.title,
          })}
        </span>

        <span class="hh-hud__group">
          <span class="hh-hud__label">{t('planner.hud.dvLabel', {})}</span>
          <span data-testid="execution-dv">
            {t('planner.hud.dv', {
              usedMps: outcome.dvUsedMps,
              budgetMps: outcome.dvBudgetMps,
            })}
          </span>
        </span>

        <span class="hh-hud__group">
          <span class="hh-hud__label">{t('planner.hud.metLabel', {})}</span>
          <span data-testid="execution-met">
            {t('planner.hud.met', { metSeconds: elapsedSeconds(playback) })}
          </span>
        </span>

        {/* DEP-05's *"the current rate is visible in the HUD"*. */}
        <span class="hh-hud__group" data-testid="execution-speed-current">
          {t('execution.speed.current', { multiplier: playback.speed })}
        </span>

        {/*
          §8.3.8's burn cue. `role="status"` so it is announced as well as seen — §8.8's
          rule that nothing is conveyed by one channel alone — and rendered only while a
          burn is flashed, so the region is empty the rest of the time.
        */}
        {flash === null ? null : (
          <span class="hh-hud__flash" role="status" data-testid="execution-burn-flash">
            {t('execution.burn.flash', flash)}
          </span>
        )}

        <span class="hh-hud__controls">
          <button
            type="button"
            data-testid="execution-pause"
            disabled={ended}
            onClick={actions.togglePause}
          >
            {playback.status === 'paused'
              ? t('execution.control.resume', {})
              : t('execution.control.pause', {})}
          </button>
          {/*
            Skip is a peer of pause rather than tucked away, which is FR-603's
            *"prominent, not hidden"* made literal: §8.3.8's reasoning is that a player on
            their twelfth attempt should not rewatch twelve hours of coasting.
          */}
          <button
            type="button"
            data-testid="execution-skip"
            disabled={ended}
            onClick={actions.skipToEnd}
          >
            {t('execution.control.skip', {})}
          </button>
          <button type="button" data-testid="execution-abort" onClick={onAbort}>
            {t('execution.control.abort', {})}
          </button>
        </span>
      </header>

      <div class="hh-execution__stage">
        <ExecutionView
          t={t}
          resolveDynamic={resolveDynamic}
          scenario={scenario}
          timeline={timeline}
          epoch={playback.epoch}
          encounterEpoch={encounterEpoch}
        />
        <FlightLog
          t={t}
          resolveDynamic={resolveDynamic}
          entries={state.revealed}
          announcements={state.announcements}
          autoScroll={!reducedMotion}
        />
      </div>

      {playback.status === 'paused' ? (
        <p class="hh-execution__paused" role="status" data-testid="execution-paused-notice">
          {t('execution.paused.notice', {})}
        </p>
      ) : null}

      <footer class="hh-execution__transport">
        {/*
          A progress bar, not a scrubber. Scrubbing is FR-403's planner operation over a
          *prediction*; a run is a thing that is happening, and dragging it backwards
          would mean re-reporting events the cursor has already passed.
        */}
        <div
          class="hh-execution__progress"
          role="progressbar"
          aria-label={t('execution.progress.label', {})}
          aria-valuemin={0}
          aria-valuemax={1}
          aria-valuenow={progressOf(playback)}
          aria-valuetext={t('execution.progress.at', {
            metSeconds: elapsedSeconds(playback),
            ofSeconds: timeline.horizon - timeline.startEpoch,
          })}
          data-testid="execution-progress"
        >
          <div
            class="hh-execution__progress-fill"
            style={{ inlineSize: `${String(progressOf(playback) * 100)}%` }}
          />
        </div>

        <div class="hh-execution__speeds" role="group" aria-label={t('execution.speed.label', {})}>
          {PLAYBACK_SPEEDS.map((speed: PlaybackSpeed) => (
            <button
              key={speed}
              type="button"
              data-testid={`execution-speed-${String(speed)}`}
              aria-pressed={playback.speed === speed}
              disabled={ended}
              onClick={() => {
                actions.setSpeed(speed);
              }}
            >
              {t('execution.speed.option', { multiplier: speed })}
            </button>
          ))}
        </div>
      </footer>
    </div>
  );
};
