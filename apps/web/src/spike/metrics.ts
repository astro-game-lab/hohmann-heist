/**
 * Frame-timing statistics for the spike.
 *
 * ## Why a ring buffer and percentiles rather than a running mean
 *
 * A mean frame time of 8 ms is compatible with holding 60 fps and with missing one
 * frame in twenty by a mile, and those are opposite answers to R1. What a player feels
 * is the tail, so the tail is what is recorded: the median says what the frame usually
 * costs, p95 and the worst say whether anything is being dropped.
 *
 * The buffer is fixed-size and overwrites, so a long session costs no memory and the
 * statistics describe the recent past rather than an average dragged down by the first
 * second after load — which, in a browser, is JIT warm-up and is not what the budget
 * is about.
 *
 * ## Why the inter-frame interval is recorded separately from the work
 *
 * The rAF callback can take 2 ms and still be running at 30 fps, if something else on
 * the main thread — style, layout, paint, compositing, another tab's timer — owns the
 * rest. Callback duration is what this code controls; the interval is what the player
 * actually gets. Reporting only the first would let the spike pass while the page
 * stutters, which is precisely the failure R1 describes. So both are kept, and the
 * write-up quotes both.
 */

/** One frame's measurements, in milliseconds. */
export interface FrameSample {
  /** Re-evaluating the plan through `withPlan`. Zero on a frame that changed nothing. */
  readonly sim: number;
  /** Cache lookup, projection, and building the scene's primitives. */
  readonly geometry: number;
  /** The `draw` call into the renderer: everything Canvas 2-D is asked to do. */
  readonly draw: number;
  /** The whole rAF callback, geometry and draw included. */
  readonly total: number;
  /** Time since the previous frame's callback started. `undefined` on the first frame. */
  readonly interval: number | undefined;
}

/** Summary of one measured quantity. All in milliseconds. */
export interface Statistic {
  readonly median: number;
  readonly p95: number;
  readonly worst: number;
  readonly samples: number;
}

export interface FrameStats {
  readonly sim: Statistic;
  readonly geometry: Statistic;
  readonly draw: Statistic;
  readonly total: Statistic;
  readonly interval: Statistic;
  /** Frames whose interval missed a vsync — see `DROPPED_FRAME_MS`. The 60 fps question. */
  readonly droppedFrames: number;
  /** `droppedFrames` as a fraction of intervals measured. Zero when none were. */
  readonly droppedFraction: number;
}

export interface FrameRecorder {
  record(sample: FrameSample): void;
  stats(): FrameStats;
  reset(): void;
  readonly size: number;
}

/** NFR-011: one 60 Hz frame. The hard limit on the work done inside a frame. */
export const FRAME_BUDGET_MS = 1000 / 60;

/**
 * How late an interval must be to count as a dropped frame.
 *
 * **Not `FRAME_BUDGET_MS`.** A display running a locked 60 Hz delivers intervals that
 * measure 16.7–16.9 ms, because the nominal 16.667 ms is not representable in the
 * timer's resolution and vsync itself jitters. Counting `interval > 16.667` therefore
 * reports most of a *perfectly smooth* run as dropped — measured here at 57% before
 * this constant existed, which is a bug in the metric and not a finding about the page.
 *
 * A frame is dropped when it misses a vsync, which means its interval spans two
 * periods. Half a period of slack separates "jittered" from "missed" unambiguously,
 * because there is nothing legitimate between 1.0 and 2.0 periods.
 */
export const DROPPED_FRAME_MS = (1000 / 60) * 1.5;

/** How many frames the ring holds. Ten seconds at 60 fps. */
export const DEFAULT_CAPACITY = 600;

const EMPTY: Statistic = Object.freeze({ median: 0, p95: 0, worst: 0, samples: 0 });

/**
 * Nearest-rank percentile on an ascending array.
 *
 * Nearest-rank rather than interpolated because these are timings, and an interpolated
 * p95 reports a duration that no frame took. For a tail statistic the honest answer is
 * a frame that actually happened.
 */
const percentile = (ascending: readonly number[], fraction: number): number => {
  if (ascending.length === 0) return 0;
  const rank = Math.ceil(fraction * ascending.length);
  const index = Math.min(ascending.length - 1, Math.max(0, rank - 1));
  return ascending[index] ?? 0;
};

const summarise = (values: readonly number[]): Statistic => {
  if (values.length === 0) return EMPTY;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    median: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    worst: sorted[sorted.length - 1] ?? 0,
    samples: sorted.length,
  };
};

/**
 * A fixed-capacity recorder of frame samples.
 *
 * @throws RangeError when the capacity is not a positive integer.
 */
export const createFrameRecorder = (
  capacity: number = DEFAULT_CAPACITY,
  droppedMs: number = DROPPED_FRAME_MS,
): FrameRecorder => {
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new RangeError(`capacity must be a positive integer, got ${String(capacity)}`);
  }

  const ring: FrameSample[] = [];
  let next = 0;

  return {
    get size(): number {
      return ring.length;
    },

    record(sample: FrameSample): void {
      if (ring.length < capacity) {
        ring.push(sample);
      } else {
        ring[next] = sample;
      }
      next = (next + 1) % capacity;
    },

    reset(): void {
      ring.length = 0;
      next = 0;
    },

    stats(): FrameStats {
      // Intervals are filtered rather than defaulted: the first frame has no previous
      // frame, and recording a zero there would drag the median down by exactly one
      // frame's worth of lie.
      const intervals = ring.map((s) => s.interval).filter((v): v is number => v !== undefined);
      const dropped = intervals.filter((v) => v > droppedMs).length;

      return {
        sim: summarise(ring.map((s) => s.sim)),
        geometry: summarise(ring.map((s) => s.geometry)),
        draw: summarise(ring.map((s) => s.draw)),
        total: summarise(ring.map((s) => s.total)),
        interval: summarise(intervals),
        droppedFrames: dropped,
        droppedFraction: intervals.length === 0 ? 0 : dropped / intervals.length,
      };
    },
  };
};
