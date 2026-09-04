/**
 * The announcement strategy (#146, §8.8).
 *
 * The requirement is a bound — *"announcements do not flood assistive technology at
 * 10 000×"* — so the tests are about the bound, and they assert it at the speeds where
 * it actually binds rather than only at 1×, which is where a naïve implementation looks
 * fine.
 *
 * `maxIndividual` is read from the exported policy rather than hard-coded, so tuning it
 * changes the tests' expectations with it; the *shape* of the guarantee — at most
 * `maxIndividual + 1` announcements per step, notable entries first, in log order — is
 * what is fixed here.
 */
import { epoch } from '@hh/astro';
import type { FlightLogKind } from '@hh/game';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_ANNOUNCEMENT_POLICY,
  NOTABLE_KINDS,
  announcementsFor,
  isNotable,
  type AnnounceableEvent,
  type Announcement,
} from './announce.js';

const { maxIndividual } = DEFAULT_ANNOUNCEMENT_POLICY;

interface Entry extends AnnounceableEvent {
  readonly id: string;
}

const entry = (seconds: number, kind: FlightLogKind, id: string = kind): Entry => ({
  epoch: epoch(seconds),
  kind,
  id,
});

/** A step's worth of crossings at high speed: one burn among a lot of context. */
const busyStep = (routineCount: number): readonly Entry[] => [
  entry(600, 'burn', 'burn-1'),
  ...Array.from({ length: routineCount }, (_v, i) =>
    entry(700 + i, i % 2 === 0 ? 'revolution' : 'apoapsis', `routine-${String(i)}`),
  ),
];

const idsOf = (announcements: readonly Announcement<Entry>[]): readonly string[] =>
  announcements.flatMap((announcement) =>
    announcement.kind === 'entry' ? [announcement.entry.id] : [],
  );

describe('which kinds are notable', () => {
  it('speaks the milestones §8.8 names', () => {
    for (const kind of ['burn', 'closestApproach', 'objectiveMet', 'end'] as const) {
      expect(isNotable(entry(0, kind))).toBe(true);
    }
  });

  it('leaves routine geometry to the log', () => {
    // Real, worth recording, and not worth interrupting someone to say.
    for (const kind of ['periapsis', 'apoapsis', 'revolution'] as const) {
      expect(isNotable(entry(0, kind))).toBe(false);
    }
  });

  it('speaks the end of the run, which is the cue that the debrief has arrived', () => {
    expect(NOTABLE_KINDS.has('end')).toBe(true);
  });

  it('speaks a constraint being entered and left', () => {
    expect(NOTABLE_KINDS.has('constraintEnter')).toBe(true);
    expect(NOTABLE_KINDS.has('constraintExit')).toBe(true);
  });
});

describe('announcementsFor', () => {
  it('says nothing when nothing was crossed', () => {
    expect(announcementsFor([])).toEqual([]);
  });

  it('announces a lone milestone individually', () => {
    const announcements = announcementsFor([entry(600, 'burn', 'burn-1')]);
    expect(announcements).toHaveLength(1);
    expect(idsOf(announcements)).toEqual(['burn-1']);
  });

  it('summarises a lone routine event rather than speaking it', () => {
    // At 1× a revolution completing is not silence — it is "1 event" — so the listener
    // knows something happened and can go and read the log.
    const announcements = announcementsFor([entry(1800, 'revolution')]);
    expect(announcements).toEqual([{ kind: 'summary', count: 1 }]);
  });

  it('keeps notable entries in log order', () => {
    const announcements = announcementsFor([
      entry(600, 'burn', 'burn-1'),
      entry(9000, 'closestApproach', 'closest'),
    ]);
    expect(idsOf(announcements)).toEqual(['burn-1', 'closest']);
  });
});

describe('the bound (#146)', () => {
  it('never exceeds maxIndividual + 1 announcements, however many were crossed', () => {
    // 1×, 1 000× and 100 000× differ only in how many events arrive at once, which is
    // exactly the variable the bound absorbs. Forty is more than a whole revolution's
    // worth of context at 10 000×.
    for (const count of [0, 1, 5, 40, 400]) {
      const announcements = announcementsFor(busyStep(count));
      expect(announcements.length).toBeLessThanOrEqual(maxIndividual + 1);
    }
  });

  it('still speaks the burn among forty routine events', () => {
    // The failure this rules out: a bound implemented by truncating the crossed array
    // would drop the one thing that mattered and read out forty apsides.
    const announcements = announcementsFor(busyStep(40));
    expect(idsOf(announcements)).toContain('burn-1');
  });

  it('accounts for everything it did not speak', () => {
    const crossed = busyStep(40);
    const announcements = announcementsFor(crossed);
    const spoken = idsOf(announcements).length;
    const summary = announcements.find((announcement) => announcement.kind === 'summary');

    expect(summary?.kind === 'summary' ? summary.count : null).toBe(crossed.length - spoken);
  });

  it('adds no summary when everything was spoken', () => {
    const announcements = announcementsFor([
      entry(600, 'burn', 'burn-1'),
      entry(9000, 'closestApproach', 'closest'),
    ]);
    expect(announcements.every((announcement) => announcement.kind === 'entry')).toBe(true);
  });

  it('puts the summary last', () => {
    const announcements = announcementsFor(busyStep(40));
    expect(announcements[announcements.length - 1]?.kind).toBe('summary');
  });

  it('caps the individual announcements even when every crossing is notable', () => {
    const allNotable = Array.from({ length: 10 }, (_v, i) =>
      entry(600 + i, 'burn', `burn-${String(i)}`),
    );
    const announcements = announcementsFor(allNotable);
    expect(idsOf(announcements)).toHaveLength(maxIndividual);
    expect(announcements).toHaveLength(maxIndividual + 1);
  });
});

describe('the policy is a parameter', () => {
  it('honours a caller that wants everything spoken', () => {
    const crossed = busyStep(2);
    const announcements = announcementsFor(crossed, { maxIndividual: 100 });
    // Still only the notable ones — the cap is not what filters routine events out.
    expect(idsOf(announcements)).toEqual(['burn-1']);
  });

  it('honours a caller that wants nothing spoken individually', () => {
    const crossed = busyStep(2);
    expect(announcementsFor(crossed, { maxIndividual: 0 })).toEqual([
      { kind: 'summary', count: crossed.length },
    ]);
  });
});
