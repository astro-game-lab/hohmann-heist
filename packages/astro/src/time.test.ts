import { describe, expect, it } from 'vitest';

import { seconds } from '@hh/math';

import {
  addSeconds,
  differenceSeconds,
  epoch,
  epochAtMet,
  formatMet,
  fromCalendarTAI,
  fromJulianDateTT,
  J2000,
  J2000_JD_TT,
  met,
  metAt,
  SECONDS_PER_DAY,
  toCalendarTAI,
  toJulianDateTAI,
  toJulianDateTT,
  TT_MINUS_TAI,
} from './time.js';

describe('epoch arithmetic', () => {
  it('advances and differences', () => {
    const t = addSeconds(J2000, seconds(3600));
    expect(t).toBe(3600);
    expect(differenceSeconds(J2000, t)).toBe(3600);
    expect(differenceSeconds(t, J2000)).toBe(-3600);
  });

  it('keeps mission elapsed time separate from the absolute epoch', () => {
    const start = epoch(1e6);
    const now = addSeconds(start, seconds(90));
    expect(metAt(start, now)).toBe(90);
    expect(epochAtMet(start, met(90))).toBe(now);
  });
});

describe('julian date', () => {
  it('places J2000 at its defining Julian Date in TT', () => {
    expect(toJulianDateTT(J2000)).toBe(J2000_JD_TT);
  });

  // Recovering the offset by subtracting two Julian Dates is a badly conditioned
  // way to ask the question: both are near 2451545, and the difference is 4e-9 of
  // their magnitude, so almost every significant digit cancels. The residual error
  // below is one float64 ULP of a JD in this era, about 47 microseconds -- a
  // property of the representation, not of the conversion. Epoch arithmetic does
  // not suffer from it, which is why the simulation never goes through a JD.
  it('offsets TAI from TT by 32.184 s, to the precision a Julian Date can carry', () => {
    const gap = (toJulianDateTT(J2000) - toJulianDateTAI(J2000)) * SECONDS_PER_DAY;
    expect(gap).toBeCloseTo(TT_MINUS_TAI, 4);
    expect(Math.abs(gap - TT_MINUS_TAI)).toBeLessThan(1e-4);
  });

  it('round-trips', () => {
    for (const s of [0, 1, -1, 86400, 1e9, -1e9]) {
      const t = epoch(s);
      expect(fromJulianDateTT(toJulianDateTT(t))).toBeCloseTo(t, 3);
    }
  });

  it('advances one day per 86400 seconds', () => {
    expect(toJulianDateTT(epoch(SECONDS_PER_DAY)) - toJulianDateTT(J2000)).toBe(1);
  });
});

describe('calendar', () => {
  // J2000 is 2000-01-01 12:00:00 TT by definition. In TAI that instant is 32.184 s
  // earlier, so the TAI calendar reading is 11:59:27.816.
  it('renders the J2000 epoch as its TAI calendar instant', () => {
    const c = toCalendarTAI(J2000);
    expect(c.scale).toBe('TAI');
    expect([c.year, c.month, c.day]).toEqual([2000, 1, 1]);
    expect(c.hour).toBe(11);
    expect(c.minute).toBe(59);
    // Tolerance is the Julian Date precision limit documented on toJulianDateTT,
    // not a number chosen to make this pass.
    expect(c.second).toBeCloseTo(60 - TT_MINUS_TAI, 4);
  });

  it('round-trips across a range of dates, including leap years', () => {
    const cases = [
      { year: 1999, month: 12, day: 31, hour: 23, minute: 59, second: 59 },
      { year: 2000, month: 2, day: 29, hour: 0, minute: 0, second: 0 },
      { year: 2024, month: 6, day: 15, hour: 13, minute: 45, second: 30.5 },
      { year: 2100, month: 3, day: 1, hour: 0, minute: 0, second: 0 },
      { year: 1970, month: 1, day: 1, hour: 0, minute: 0, second: 0 },
    ];
    for (const c of cases) {
      const back = toCalendarTAI(fromCalendarTAI(c));
      expect([back.year, back.month, back.day], JSON.stringify(c)).toEqual([
        c.year,
        c.month,
        c.day,
      ]);
      expect(back.hour).toBe(c.hour);
      expect(back.minute).toBe(c.minute);
      expect(back.second).toBeCloseTo(c.second, 4);
    }
  });

  it('handles the 2100 non-leap-year correctly', () => {
    // 2100 is divisible by 4 but not 400, so it is not a leap year.
    const feb28 = fromCalendarTAI({ year: 2100, month: 2, day: 28, hour: 0, minute: 0, second: 0 });
    const next = toCalendarTAI(addSeconds(feb28, seconds(SECONDS_PER_DAY)));
    expect([next.year, next.month, next.day]).toEqual([2100, 3, 1]);
  });
});

describe('formatMet', () => {
  it('formats under a day', () => {
    expect(formatMet(met(0))).toBe('T+00:00:00');
    expect(formatMet(met(3661))).toBe('T+01:01:01');
    expect(formatMet(met(43784))).toBe('T+12:09:44');
  });

  it('formats over a day', () => {
    expect(formatMet(met(SECONDS_PER_DAY + 3661))).toBe('T+1d 01:01:01');
    expect(formatMet(met(17 * SECONDS_PER_DAY))).toBe('T+17d 00:00:00');
  });

  it('formats negative time, for a countdown', () => {
    expect(formatMet(met(-90))).toBe('T-00:01:30');
  });
});
