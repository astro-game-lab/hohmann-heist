import { describe, expect, it } from 'vitest';

import type { FrameSample } from './metrics.js';
import { DROPPED_FRAME_MS, FRAME_BUDGET_MS, createFrameRecorder } from './metrics.js';

const sample = (overrides: Partial<FrameSample> = {}): FrameSample => ({
  sim: 0,
  geometry: 0,
  draw: 0,
  total: 0,
  interval: undefined,
  ...overrides,
});

describe('createFrameRecorder', () => {
  it('rejects a capacity that is not a positive integer', () => {
    expect(() => createFrameRecorder(0)).toThrow(RangeError);
    expect(() => createFrameRecorder(-1)).toThrow(RangeError);
    expect(() => createFrameRecorder(2.5)).toThrow(RangeError);
  });

  it('reports zeroed statistics before anything is recorded', () => {
    const stats = createFrameRecorder().stats();
    expect(stats.total.samples).toBe(0);
    expect(stats.total.median).toBe(0);
    expect(stats.droppedFrames).toBe(0);
    expect(stats.droppedFraction).toBe(0);
  });
});

describe('percentiles', () => {
  it('reports a duration some frame actually took, not an interpolated one', () => {
    const recorder = createFrameRecorder();
    // 1..100 ms. An interpolated p95 of this set is 95.05; nearest-rank is 95, which is
    // a frame that happened. For a tail statistic that distinction is the whole point.
    for (let i = 1; i <= 100; i++) recorder.record(sample({ total: i }));

    const { total } = recorder.stats();
    expect(total.median).toBe(50);
    expect(total.p95).toBe(95);
    expect(total.worst).toBe(100);
    expect(total.samples).toBe(100);
  });

  it('summarises each quantity independently', () => {
    const recorder = createFrameRecorder();
    recorder.record(sample({ sim: 1, geometry: 2, draw: 3, total: 6 }));
    recorder.record(sample({ sim: 5, geometry: 4, draw: 3, total: 12 }));

    const stats = recorder.stats();
    expect(stats.sim.worst).toBe(5);
    expect(stats.geometry.worst).toBe(4);
    expect(stats.draw.worst).toBe(3);
    expect(stats.total.worst).toBe(12);
  });
});

describe('the ring', () => {
  it('overwrites the oldest sample once full, so statistics describe the recent past', () => {
    const recorder = createFrameRecorder(3);
    for (const total of [100, 100, 100, 1, 2, 3]) recorder.record(sample({ total }));

    const { total } = recorder.stats();
    expect(total.samples).toBe(3);
    expect(total.worst).toBe(3);
  });

  it('reports its size and clears', () => {
    const recorder = createFrameRecorder(4);
    recorder.record(sample({ total: 1 }));
    recorder.record(sample({ total: 2 }));
    expect(recorder.size).toBe(2);

    recorder.reset();
    expect(recorder.size).toBe(0);
    expect(recorder.stats().total.samples).toBe(0);
  });

  it('keeps overwriting correctly after a reset', () => {
    const recorder = createFrameRecorder(2);
    recorder.record(sample({ total: 9 }));
    recorder.reset();
    for (const total of [1, 2, 3]) recorder.record(sample({ total }));

    const { total } = recorder.stats();
    expect(total.samples).toBe(2);
    expect(total.worst).toBe(3);
    expect(total.median).toBe(2);
  });
});

describe('dropped frames', () => {
  it('excludes the first frame, which has no previous frame to be late relative to', () => {
    const recorder = createFrameRecorder();
    recorder.record(sample({ interval: undefined }));
    recorder.record(sample({ interval: 16 }));

    const stats = recorder.stats();
    expect(stats.interval.samples).toBe(1);
    expect(stats.interval.median).toBe(16);
  });

  it('does not count vsync jitter on a locked 60 Hz display', () => {
    // A real run of this page measured intervals of 16.7-16.9 ms with no frame
    // missed. Against a flat 16.667 threshold that reads as 57% dropped, which is
    // a lie about a smooth page. This is the regression test for that.
    const recorder = createFrameRecorder();
    for (const interval of [16.7, 16.8, 16.9, 16.7, 16.8]) recorder.record(sample({ interval }));

    const stats = recorder.stats();
    expect(stats.interval.median).toBeGreaterThan(FRAME_BUDGET_MS);
    expect(stats.droppedFrames).toBe(0);
    expect(stats.droppedFraction).toBe(0);
  });

  it('counts an interval that spans two vsync periods', () => {
    const recorder = createFrameRecorder();
    recorder.record(sample({ interval: DROPPED_FRAME_MS }));
    recorder.record(sample({ interval: DROPPED_FRAME_MS + 0.1 }));
    recorder.record(sample({ interval: 33.4 }));

    const stats = recorder.stats();
    expect(stats.droppedFrames).toBe(2);
    expect(stats.droppedFraction).toBeCloseTo(2 / 3, 12);
  });

  it('is zero when every frame arrives on time', () => {
    const recorder = createFrameRecorder();
    for (let i = 0; i < 10; i++) recorder.record(sample({ interval: 16 }));
    expect(recorder.stats().droppedFrames).toBe(0);
    expect(recorder.stats().droppedFraction).toBe(0);
  });
});
