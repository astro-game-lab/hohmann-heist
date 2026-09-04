/**
 * The playback clock (FR-601, FR-602, FR-603, #144, #145).
 *
 * Three requirements are asserted here as properties rather than as examples, because
 * each of them is a statement about *every* run rather than about one:
 *
 * - **FR-602, speed does not affect the outcome.** The same events, in the same order,
 *   at 1× and at 100 000×.
 * - **#144, frame-rate independence.** The same events whether the run is stepped ten
 *   thousand times or once — including the pathological case of a single frame that
 *   spans the whole horizon.
 * - **#145 and #146, skipping equals watching.** `skipToEnd` and a watched run produce
 *   identical arrays.
 *
 * The events are plain objects at hand-chosen epochs. Building them from a real
 * trajectory would mean arranging an orbit to produce two events at the same instant,
 * which is a lot of astrodynamics to make a point about an array index — and the module
 * is generic precisely so that it need not be done.
 */
import { epoch, type Epoch } from '@hh/astro';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PLAYBACK_SPEED,
  PLAYBACK_SPEEDS,
  advance,
  createPlayback,
  elapsedSeconds,
  pause,
  progressOf,
  resume,
  setSpeed,
  skipToEnd,
  togglePause,
  type PlaybackSpeed,
  type PlaybackState,
} from './playback.js';

const START = epoch(0);
const END = epoch(10_000);

interface Marker {
  readonly epoch: Epoch;
  readonly id: string;
}

const at = (seconds: number, id: string): Marker => ({ epoch: epoch(seconds), id });

/**
 * A log with the shapes that matter: one at the very start, two sharing an instant, a
 * cluster, and one exactly at the end.
 */
const EVENTS: readonly Marker[] = [
  at(0, 'ignition'),
  at(600, 'burn-1'),
  at(600, 'periapsis'),
  at(1800, 'rev-1'),
  at(3600, 'rev-2'),
  at(3600.5, 'apoapsis'),
  at(9000, 'closest'),
  at(10_000, 'end'),
];

/** Run to completion in fixed wall-clock steps, collecting everything reported. */
const runInSteps = (
  events: readonly Marker[],
  stepSeconds: number,
  speed: PlaybackSpeed,
): { readonly ids: readonly string[]; readonly state: PlaybackState } => {
  let state = setSpeed(createPlayback({ startEpoch: START, endEpoch: END }), speed);
  const ids: string[] = [];
  // A generous cap: reaching it is a hang, and failing on it names the bug rather than
  // letting the suite time out.
  for (let i = 0; i < 1_000_000; i++) {
    const step = advance(state, events, stepSeconds);
    state = step.state;
    ids.push(...step.crossed.map((event) => event.id));
    if (state.status === 'ended' && state.cursor === events.length) break;
  }
  return { ids, state };
};

describe('createPlayback', () => {
  it('starts at the beginning, playing, with nothing reported', () => {
    const state = createPlayback({ startEpoch: START, endEpoch: END });
    expect(state.epoch).toBe(START);
    expect(state.status).toBe('playing');
    expect(state.cursor).toBe(0);
    expect(state.speed).toBe(DEFAULT_PLAYBACK_SPEED);
  });

  it('can start paused, for §8.8’s reduced-motion preference', () => {
    expect(createPlayback({ startEpoch: START, endEpoch: END, paused: true }).status).toBe(
      'paused',
    );
  });

  it('refuses a run that ends before it starts', () => {
    expect(() => createPlayback({ startEpoch: END, endEpoch: START })).toThrow(RangeError);
  });

  it('accepts a run of zero length', () => {
    const state = createPlayback({ startEpoch: START, endEpoch: START });
    expect(advance(state, EVENTS, 0).state.status).toBe('ended');
  });
});

describe('advance', () => {
  it('reports the opening entry on the first step, even a zero-length one', () => {
    const state = createPlayback({ startEpoch: START, endEpoch: END });
    expect(advance(state, EVENTS, 0).crossed.map((event) => event.id)).toEqual(['ignition']);
  });

  it('reports both events that share an instant', () => {
    // The case a "strictly later than last time" rule would silently halve. The flight
    // log puts a burn and the apsis it sits on at the same epoch deliberately.
    let state = createPlayback({ startEpoch: START, endEpoch: END, speed: 1 });
    state = advance(state, EVENTS, 0).state;
    const step = advance(state, EVENTS, 700);
    expect(step.crossed.map((event) => event.id)).toEqual(['burn-1', 'periapsis']);
  });

  it('reports nothing when nothing was passed', () => {
    let state = createPlayback({ startEpoch: START, endEpoch: END, speed: 1 });
    state = advance(state, EVENTS, 0).state;
    expect(advance(state, EVENTS, 100).crossed).toEqual([]);
  });

  it('never moves past the end', () => {
    const state = createPlayback({ startEpoch: START, endEpoch: END, speed: 1 });
    const step = advance(state, EVENTS, 1e9);
    expect(step.state.epoch).toBe(END);
    expect(step.state.status).toBe('ended');
  });

  it('does not move a paused run', () => {
    let state = createPlayback({ startEpoch: START, endEpoch: END, speed: 1 });
    state = advance(state, EVENTS, 0).state;
    state = pause(state);
    const step = advance(state, EVENTS, 5000);
    expect(step.state.epoch).toBe(START);
    expect(step.crossed).toEqual([]);
  });

  it('does not rewind on a negative delta', () => {
    // Some platforms hand back a negative frame delta across a suspend. Rewinding would
    // mean reporting events a second time.
    let state = createPlayback({ startEpoch: START, endEpoch: END, speed: 1 });
    state = advance(state, EVENTS, 700).state;
    const step = advance(state, EVENTS, -5000);
    expect(step.state.epoch).toBe(state.epoch);
    expect(step.crossed).toEqual([]);
  });
});

describe('FR-602 — speed does not affect the outcome', () => {
  it('reports the same events in the same order at every speed', () => {
    const atOne = runInSteps(EVENTS, 1 / 60, 1);
    const results = PLAYBACK_SPEEDS.map((speed) => runInSteps(EVENTS, 1 / 60, speed));

    for (const result of results) {
      expect(result.ids).toEqual(atOne.ids);
      expect(result.state.epoch).toBe(END);
      expect(result.state.cursor).toBe(EVENTS.length);
    }
  });

  it('reports every event exactly once, at every speed', () => {
    for (const speed of PLAYBACK_SPEEDS) {
      const { ids } = runInSteps(EVENTS, 1 / 60, speed);
      expect(ids).toEqual(EVENTS.map((event) => event.id));
    }
  });

  it('changes nothing but the rate when the speed is changed mid-run', () => {
    let state = createPlayback({ startEpoch: START, endEpoch: END, speed: 1 });
    state = advance(state, EVENTS, 700).state;
    const before = state;
    const after = setSpeed(state, 10_000);

    expect(after.epoch).toBe(before.epoch);
    expect(after.cursor).toBe(before.cursor);
    expect(after.status).toBe(before.status);
  });

  it('returns the same object when the speed is unchanged', () => {
    const state = createPlayback({ startEpoch: START, endEpoch: END, speed: 100 });
    expect(setSpeed(state, 100)).toBe(state);
  });
});

describe('#144 — frame-rate independence', () => {
  it('reports the same events however finely the run is stepped', () => {
    const fine = runInSteps(EVENTS, 1 / 240, 100);
    const coarse = runInSteps(EVENTS, 1 / 15, 100);
    expect(coarse.ids).toEqual(fine.ids);
  });

  it('skips and duplicates nothing across a single stalled frame', () => {
    // One 500 ms frame at 10 000× is 5 000 seconds of mission time — half the horizon,
    // spanning five events. All five, in order, once.
    let state = createPlayback({ startEpoch: START, endEpoch: END, speed: 10_000 });
    state = advance(state, EVENTS, 0).state;

    const stalled = advance(state, EVENTS, 0.5);
    expect(stalled.crossed.map((event) => event.id)).toEqual([
      'burn-1',
      'periapsis',
      'rev-1',
      'rev-2',
      'apoapsis',
    ]);

    const rest = advance(stalled.state, EVENTS, 0.5);
    expect(rest.crossed.map((event) => event.id)).toEqual(['closest', 'end']);
  });

  it('reports the whole run in one frame that spans the horizon', () => {
    const state = createPlayback({ startEpoch: START, endEpoch: END, speed: 1 });
    const step = advance(state, EVENTS, 1e9);
    expect(step.crossed.map((event) => event.id)).toEqual(EVENTS.map((event) => event.id));
  });
});

describe('#145 — skipping to the end equals watching it through', () => {
  it('produces the same events in the same order', () => {
    const watched = runInSteps(EVENTS, 1 / 60, 1);

    const skipped = skipToEnd(createPlayback({ startEpoch: START, endEpoch: END }), EVENTS);
    expect(skipped.crossed.map((event) => event.id)).toEqual(watched.ids);
  });

  it('leaves the run in the same state either way', () => {
    const watched = runInSteps(EVENTS, 1 / 60, 1);
    const skipped = skipToEnd(createPlayback({ startEpoch: START, endEpoch: END }), EVENTS);

    expect(skipped.state.epoch).toBe(watched.state.epoch);
    expect(skipped.state.cursor).toBe(watched.state.cursor);
    expect(skipped.state.status).toBe(watched.state.status);
  });

  it('completes a run that was partly watched, without repeating what was seen', () => {
    let state = createPlayback({ startEpoch: START, endEpoch: END, speed: 1 });
    const seen = advance(state, EVENTS, 700);
    state = seen.state;

    const rest = skipToEnd(state, EVENTS);
    const all = [...seen.crossed, ...rest.crossed].map((event) => event.id);
    expect(all).toEqual(EVENTS.map((event) => event.id));
  });

  it('skips from a paused run', () => {
    const state = pause(createPlayback({ startEpoch: START, endEpoch: END }));
    const step = skipToEnd(state, EVENTS);
    expect(step.state.status).toBe('ended');
    expect(step.crossed).toHaveLength(EVENTS.length);
  });
});

describe('FR-603 — pause', () => {
  it('toggles', () => {
    const state = createPlayback({ startEpoch: START, endEpoch: END });
    const paused = togglePause(state);
    expect(paused.status).toBe('paused');
    expect(togglePause(paused).status).toBe('playing');
  });

  it('does nothing to a run that has ended', () => {
    const ended = skipToEnd(createPlayback({ startEpoch: START, endEpoch: END }), EVENTS).state;
    expect(togglePause(ended)).toBe(ended);
    expect(pause(ended)).toBe(ended);
    expect(resume(ended)).toBe(ended);
  });

  it('is idempotent in both directions', () => {
    const state = createPlayback({ startEpoch: START, endEpoch: END });
    expect(resume(state)).toBe(state);
    const paused = pause(state);
    expect(pause(paused)).toBe(paused);
  });

  it('resumes from exactly where it stopped', () => {
    let state = createPlayback({ startEpoch: START, endEpoch: END, speed: 1 });
    state = advance(state, EVENTS, 700).state;
    const held = pause(state);
    const resumed = advance(resume(held), EVENTS, 0);
    expect(resumed.state.epoch).toBe(state.epoch);
  });
});

describe('readouts', () => {
  it('reports progress from 0 to 1', () => {
    const state = createPlayback({ startEpoch: START, endEpoch: END, speed: 1 });
    expect(progressOf(state)).toBe(0);
    expect(progressOf(advance(state, EVENTS, 5000).state)).toBeCloseTo(0.5, 12);
    expect(progressOf(skipToEnd(state, EVENTS).state)).toBe(1);
  });

  it('reports a full run of zero length as complete rather than as NaN', () => {
    expect(progressOf(createPlayback({ startEpoch: START, endEpoch: START }))).toBe(1);
  });

  it('reports mission elapsed time at the head', () => {
    const state = createPlayback({ startEpoch: epoch(1_000_000), endEpoch: epoch(1_010_000) });
    expect(elapsedSeconds(state)).toBe(0);
    expect(elapsedSeconds(advance(setSpeed(state, 1), EVENTS, 250).state)).toBe(250);
  });
});
