/**
 * The run's state — §8.3.8, #144, #145, #146.
 *
 * `@hh/ui`'s `playback.ts` decides *what a step does*; this decides *when a step
 * happens* and what the screen shows afterwards. The split is the same one
 * `planner/store.ts` makes against `machine.ts`, and for the same reason: the rules run
 * under Node in tests, and only the thing that needs a browser needs a browser.
 *
 * ## The playback state lives in a ref, not in `useState`
 *
 * A run advances on every animation frame, and every frame both *reads* the current
 * state and *writes* the next one. Holding that in `useState` alone means the loop reads
 * a value captured when the effect was installed, which is one frame stale by
 * definition — the classic stale-closure bug, and here it would mean events reported
 * twice or not at all.
 *
 * So {@link playbackRef} is authoritative and the rendered copy follows it. Every
 * mutation goes through one funnel, which is what keeps the two from diverging: there is
 * no path that updates one and not the other.
 *
 * ## The log is revealed, never rebuilt
 *
 * `entries` arrives complete, built once by `@hh/game`'s `buildFlightLog` from the
 * solved timeline. This module only moves a cursor through it. That is why skipping to
 * the end and watching produce the same feed (#146's last criterion) — not because two
 * paths were made to agree, but because there is one array and one cursor.
 *
 * ## The clock is the animation frame's, and it is the only one
 *
 * `requestAnimationFrame` supplies a timestamp; the difference between frames is handed
 * to `advance`. Nothing else here reads a clock, and `advance` cannot — it is in the
 * DOM-free package. So the run's *content* is a function of elapsed wall time and
 * nothing else, and a test can drive the same sequence with plain numbers.
 */
import type { Epoch } from '@hh/astro';
import type { FlightLogEntry } from '@hh/game';
import type { PlaybackSpeed, PlaybackState } from '@hh/ui';
import {
  advance,
  announcementsFor,
  createPlayback,
  setSpeed as setPlaybackSpeed,
  skipToEnd as skipPlayback,
  togglePause as togglePlayback,
  type Announcement,
} from '@hh/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';

/** How long a burn's Δv stays flashed on the HUD, in milliseconds (§8.3.8). */
export const BURN_FLASH_MS = 1200;

/** What the screen renders. */
export interface ExecutionState {
  readonly playback: PlaybackState;
  /** The log so far, in order. Grows; never rewritten. */
  readonly revealed: readonly FlightLogEntry[];
  /**
   * What the live region should say — the announcement strategy's output for the most
   * recent step, or `null` when it had nothing to say (#146, §8.8).
   */
  readonly announcements: readonly Announcement<FlightLogEntry>[];
  /**
   * The burn whose Δv is flashed on the HUD, or `null`.
   *
   * §8.3.8: *"burn events flash the relevant Δv on the HUD with a short cue"*. Cleared
   * on a **wall-clock** timer rather than after so many seconds of mission time, because
   * it is a thing a person has to see: at 100 000× a cue measured in mission time would
   * last a hundred-thousandth of its intended duration.
   */
  readonly burnFlash: FlightLogEntry | null;
}

export interface ExecutionActions {
  /** `Space` — §8.3.8, §8.5.3. */
  readonly togglePause: () => void;
  /** `S` — FR-603's *"prominent, not hidden"*. */
  readonly skipToEnd: () => void;
  /** `1`–`5` — DEP-05. Cannot change the outcome (FR-602). */
  readonly setSpeed: (speed: PlaybackSpeed) => void;
}

export interface ExecutionSeed {
  readonly startEpoch: Epoch;
  readonly endEpoch: Epoch;
  readonly speed?: PlaybackSpeed;
  /**
   * Skip the whole run on arrival — §8.8's reduced-motion rule.
   *
   * > *`prefers-reduced-motion` respected: … playback defaults to skip-to-end.*
   *
   * The debrief is reached immediately with the complete log, which is the same
   * destination a watched run arrives at (#145). Not a shortened animation: no
   * animation.
   */
  readonly skipImmediately?: boolean;
}

/**
 * Drive a run.
 *
 * Returns the state to render and the three controls §8.3.8 offers. Abort is **not**
 * here: it leaves this screen entirely, so it belongs to whatever owns the phase.
 */
export const useExecution = (
  entries: readonly FlightLogEntry[],
  seed: ExecutionSeed,
): readonly [ExecutionState, ExecutionActions] => {
  const [state, setState] = useState<ExecutionState>(() => ({
    playback: createPlayback({
      startEpoch: seed.startEpoch,
      endEpoch: seed.endEpoch,
      ...(seed.speed === undefined ? {} : { speed: seed.speed }),
    }),
    revealed: [],
    announcements: [],
    burnFlash: null,
  }));

  // Seeded from the first render's state and written by every transition after it. The
  // initial value is only read on the first render, so the two can never start apart.
  const playbackRef = useRef<PlaybackState>(state.playback);

  /**
   * The single funnel. Every transition — a frame, a pause, a skip — comes through here,
   * so the ref and the rendered copy cannot disagree and the reveal rule is written once.
   */
  const apply = useCallback((next: PlaybackState, crossed: readonly FlightLogEntry[]): void => {
    playbackRef.current = next;
    setState((current) => {
      if (crossed.length === 0) {
        // Nothing happened: keep the announcements from the previous step rather than
        // clearing them, so a live region does not lose a message a listener is still
        // hearing. The `playback` object still changes, because the epoch moved.
        return { ...current, playback: next };
      }
      const burn = crossed.filter((entry) => entry.kind === 'burn').at(-1) ?? null;
      return {
        playback: next,
        revealed: [...current.revealed, ...crossed],
        announcements: announcementsFor(crossed),
        burnFlash: burn ?? current.burnFlash,
      };
    });
  }, []);

  const step = useCallback(
    (wallDeltaSeconds: number): void => {
      const { state: next, crossed } = advance(playbackRef.current, entries, wallDeltaSeconds);
      apply(next, crossed);
    },
    [apply, entries],
  );

  const actions = useMemo<ExecutionActions>(
    () => ({
      togglePause: () => {
        apply(togglePlayback(playbackRef.current), []);
      },
      skipToEnd: () => {
        const { state: next, crossed } = skipPlayback(playbackRef.current, entries);
        apply(next, crossed);
      },
      setSpeed: (speed) => {
        apply(setPlaybackSpeed(playbackRef.current, speed), []);
      },
    }),
    [apply, entries],
  );

  // The opening entry, and §8.8's reduced-motion skip. A zero-length step is what
  // reports ignition — see `createPlayback`'s docstring on why the cursor starts before
  // it rather than past it.
  const skipImmediately = seed.skipImmediately ?? false;
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    if (skipImmediately) actions.skipToEnd();
    else step(0);
  }, [actions, skipImmediately, step]);

  // The frame loop. Installed only while the run is playing, so a paused or finished run
  // schedules no frames at all — the same arrangement the planner's ease uses.
  const status = state.playback.status;
  useEffect(() => {
    if (status !== 'playing') return;

    let raf = 0;
    let last: number | null = null;
    const tick = (timestamp: number): void => {
      // The first frame after a resume has no previous timestamp, and treating the gap
      // since the *pause* as elapsed time would jump the run forward by however long the
      // player was thinking.
      const deltaSeconds = last === null ? 0 : (timestamp - last) / 1000;
      last = timestamp;
      step(deltaSeconds);
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(raf);
    };
  }, [status, step]);

  // The burn cue's timer. Keyed on the flashed entry's epoch, so a second burn restarts
  // the cue rather than inheriting the first one's remaining time.
  const flashEpoch = state.burnFlash?.epoch ?? null;
  useEffect(() => {
    if (flashEpoch === null) return;
    const timer = window.setTimeout(() => {
      setState((current) =>
        current.burnFlash?.epoch === flashEpoch ? { ...current, burnFlash: null } : current,
      );
    }, BURN_FLASH_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [flashEpoch]);

  return [state, actions] as const;
};
