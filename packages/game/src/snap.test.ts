import { MU_EARTH, epoch } from '@hh/astro';
import { createArc, findApsisCrossings } from '@hh/propagation';
import { EMPTY_PLAN } from '@hh/sim';
import { describe, expect, it } from 'vitest';

import { SNAP_WINDOW_SECONDS, snapToApsis, snapToApsisOnArc } from './snap.js';
import { HORIZON, START, circular, elliptical, planOf, timelineFor } from './test-support.js';

/** A 400 × 800 km ellipse: two clearly separated apsides, well above the suppression floor. */
const ELLIPSE = elliptical(6_778_137, 7_178_137);
const ellipseArc = createArc({
  startEpoch: START,
  endEpoch: HORIZON,
  state: ELLIPSE,
  mu: MU_EARTH,
});

/**
 * The apsis crossings this arc actually has, so the tests aim at real epochs.
 *
 * The fixture starts at true anomaly 0, which *is* periapsis, so crossing 0 sits exactly
 * on the start epoch. Every test below wants an epoch it can approach from either side,
 * so they use the first crossing clear of the horizon's start.
 */
const crossings = findApsisCrossings(ellipseArc, START, HORIZON);
const firstCrossing = crossings.find((crossing) => crossing.epoch > SNAP_WINDOW_SECONDS);
if (firstCrossing === undefined) throw new Error('fixture has no interior apsis crossings');

describe('DEP-07’s window', () => {
  it('is the 30 s §8.3.5 and #133 both quote', () => {
    // The assist tray's hint renders this same constant, so the sentence a player reads
    // and the rule the code applies cannot drift apart.
    expect(SNAP_WINDOW_SECONDS).toBe(30);
  });
});

describe('snapping to an apsis (#133, §8.5.2)', () => {
  it('moves an epoch just inside the window onto the apsis', () => {
    const near = (firstCrossing.epoch - 12) as ReturnType<typeof epoch>;
    const result = snapToApsisOnArc(ellipseArc, near);
    expect(result.kind).toBe(firstCrossing.kind);
    expect(result.epoch).toBe(firstCrossing.epoch);
    expect(result.movedSeconds).toBeCloseTo(12, 6);
  });

  it('leaves an epoch just outside the window alone, exactly', () => {
    const far = (firstCrossing.epoch - (SNAP_WINDOW_SECONDS + 1)) as ReturnType<typeof epoch>;
    const result = snapToApsisOnArc(ellipseArc, far);
    expect(result.kind).toBeNull();
    // `toBe`, not `toBeCloseTo`: an unsnapped epoch is the caller's own value returned
    // unchanged, not one that survived a round trip through the finder.
    expect(result.epoch).toBe(far);
    expect(result.movedSeconds).toBe(0);
  });

  it('takes the nearer of two apsides in the window', () => {
    // Ask from a point between two crossings with the window widened to include both,
    // and check the nearer one wins rather than the earlier one.
    const second = crossings.find((crossing) => crossing.epoch > firstCrossing.epoch);
    if (second === undefined) throw new Error('fixture needs two interior crossings');
    const justAfterFirst = (firstCrossing.epoch + 1) as ReturnType<typeof epoch>;
    expect(snapToApsisOnArc(ellipseArc, justAfterFirst, 1e9).epoch).toBe(firstCrossing.epoch);

    const justBeforeSecond = (second.epoch - 1) as ReturnType<typeof epoch>;
    expect(snapToApsisOnArc(ellipseArc, justBeforeSecond, 1e9).epoch).toBe(second.epoch);
  });

  it('reports which apsis it caught, so the caller can say what happened', () => {
    const result = snapToApsisOnArc(ellipseArc, firstCrossing.epoch);
    expect(['periapsis', 'apoapsis']).toContain(result.kind);
    expect(result.movedSeconds).toBe(0);
  });
});

describe('a round orbit has no apsis to prefer', () => {
  it('leaves the epoch alone rather than snapping to an arbitrary one', () => {
    // `APSIS_ECCENTRICITY_FLOOR` makes the finder return nothing below e = 1e-3, and
    // that is the right answer here: there is no apsis on a circle, and moving the burn
    // to whichever one the element set happens to carry would be motion with no meaning.
    const circularArc = createArc({
      startEpoch: START,
      endEpoch: HORIZON,
      state: circular(6_778_137),
      mu: MU_EARTH,
    });
    const at = epoch(1200);
    const result = snapToApsisOnArc(circularArc, at);
    expect(result.kind).toBeNull();
    expect(result.epoch).toBe(at);
  });
});

describe('the assist toggle (#133)', () => {
  const timeline = timelineFor(EMPTY_PLAN, { initialState: ELLIPSE });

  it('uses the raw epoch when the assist is off, without searching', () => {
    const at = (firstCrossing.epoch - 3) as ReturnType<typeof epoch>;
    const off = snapToApsis(timeline, at, false);
    expect(off.kind).toBeNull();
    expect(off.epoch).toBe(at);
  });

  it('snaps when it is on', () => {
    const at = (firstCrossing.epoch - 3) as ReturnType<typeof epoch>;
    const on = snapToApsis(timeline, at, true);
    expect(on.epoch).toBe(firstCrossing.epoch);
    expect(on.kind).not.toBeNull();
  });

  it('picks the arc that owns the epoch, so the post-burn conic is what is searched', () => {
    // A burn changes the orbit, so the apsides after it are not where the pre-burn ones
    // were. Snapping against arc 0 for an epoch on arc 1 would put the node somewhere the
    // player can see is not an apsis, which is the failure this asks about.
    const twoArc = timelineFor(planOf([600, 40]), { initialState: ELLIPSE });
    expect(twoArc.arcs.length).toBe(2);

    const secondArc = twoArc.arcs[1];
    if (secondArc === undefined) throw new Error('expected a second arc');
    const after = findApsisCrossings(secondArc, epoch(700), HORIZON)[0];
    if (after === undefined) throw new Error('expected an apsis on the post-burn arc');

    const asked = (after.epoch - 4) as ReturnType<typeof epoch>;
    expect(snapToApsis(twoArc, asked, true).epoch).toBe(after.epoch);
  });
});

describe('determinism (§11.4)', () => {
  it('gives the same answer for the same inputs', () => {
    const at = (firstCrossing.epoch - 7) as ReturnType<typeof epoch>;
    const a = snapToApsisOnArc(ellipseArc, at);
    const b = snapToApsisOnArc(ellipseArc, at);
    expect(a).toEqual(b);
  });

  it('does not quantise — FR-105 does that once, at node construction', () => {
    // The claim is that this module applies no rounding of its own, and the way to state
    // it is that the snapped epoch is the finder's crossing *exactly*. Asserting instead
    // that the value is not a multiple of 1/1024 s would be asserting a coincidence: it
    // happens to be true for most crossings and is false for any that lands on a tick.
    const at = (firstCrossing.epoch - 5) as ReturnType<typeof epoch>;
    expect(snapToApsisOnArc(ellipseArc, at).epoch).toBe(firstCrossing.epoch);
  });
});
