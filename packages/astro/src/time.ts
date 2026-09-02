/**
 * Time.
 *
 * Simulation time is a scalar offset from a defined epoch in a stated scale, never
 * a wall-clock reading and never UTC. UTC is not uniform — leap seconds make it
 * wrong for propagation — so everything here is **TAI**.
 *
 * TAI and TT tick at the same rate and differ only by a constant offset, so a
 * *duration* in seconds is the same number in either scale. The scale matters only
 * when converting to an absolute reading: a Julian Date, or a calendar date.
 *
 * **Leap seconds are deliberately not implemented.** Converting to UTC needs a
 * leap-second table, which is data with a source, an expiry, and an attribution
 * row. Nothing in v1.0 needs it: mission elapsed time is what the UI shows, and the
 * daily-challenge key is a UTC calendar *date* used as a seed, never converted from
 * an epoch. So the calendar output here is labelled TAI, because a formatter that
 * says "UTC" while doing TAI arithmetic is precisely the kind of quiet lie
 * `docs/PHYSICS.md` exists to prevent.
 */
import type { Brand, Seconds } from '@hh/math';
import { seconds } from '@hh/math';

/**
 * An instant, as TAI seconds from the J2000 epoch.
 *
 * Branded separately from `Seconds` so that an instant and a duration cannot be
 * mixed up, and separately from `Met` so that a mission clock cannot be passed
 * where an absolute epoch belongs.
 */
export type Epoch = Brand<number, 'tai-s-past-j2000'>;

/** Mission elapsed time: seconds since the start of a contract. What the UI shows. */
export type Met = Brand<number, 'met-s'>;

/** Tag a number of TAI seconds past J2000 as an epoch. */
export const epoch = (taiSecondsPastJ2000: number): Epoch => taiSecondsPastJ2000 as Epoch;

/** Tag a number of seconds as mission elapsed time. */
export const met = (secondsSinceStart: number): Met => secondsSinceStart as Met;

/** The J2000 epoch itself. */
export const J2000: Epoch = epoch(0);

/** Julian Date of the J2000 epoch instant, in TT. Definitional. */
export const J2000_JD_TT = 2451545.0;

/** TT − TAI, in seconds. Exact by definition of TT. */
export const TT_MINUS_TAI = 32.184;

/** Seconds in a day. Exact, because TAI days are exactly 86400 SI seconds. */
export const SECONDS_PER_DAY = 86400;

/** Advance an epoch by a duration. */
export const addSeconds = (t: Epoch, dt: Seconds): Epoch => epoch(t + dt);

/** Duration from `a` to `b`. Positive when `b` is later. */
export const differenceSeconds = (a: Epoch, b: Epoch): Seconds => seconds(b - a);

/** Mission elapsed time at `now`, for a contract that began at `start`. */
export const metAt = (start: Epoch, now: Epoch): Met => met(now - start);

/** The epoch at a given mission elapsed time. */
export const epochAtMet = (start: Epoch, elapsed: Met): Epoch => epoch(start + elapsed);

/**
 * Julian Date in the TT scale.
 *
 * **Precision limit.** A Julian Date near 2 451 545 has a float64 ULP of about
 * 5 × 10⁻¹⁰ days, or ~47 microseconds. Anything derived from a JD — including the
 * calendar conversions below — inherits that resolution, and differencing two
 * nearby Julian Dates loses it entirely to cancellation.
 *
 * The `Epoch` scalar itself does not have this problem: seconds past J2000 stay
 * near 10⁹ at most, so its resolution is ~2 × 10⁻⁷ s. **Do arithmetic on epochs,
 * and convert to a Julian Date only at the point of display.** Nothing in the
 * simulation path goes through this function.
 */
export const toJulianDateTT = (t: Epoch): number => J2000_JD_TT + t / SECONDS_PER_DAY;

/** Julian Date in the TAI scale. */
export const toJulianDateTAI = (t: Epoch): number =>
  toJulianDateTT(t) - TT_MINUS_TAI / SECONDS_PER_DAY;

/** Epoch from a Julian Date in the TT scale. */
export const fromJulianDateTT = (jd: number): Epoch => epoch((jd - J2000_JD_TT) * SECONDS_PER_DAY);

/** A calendar instant. The scale is part of the value, never assumed. */
export interface CalendarDate {
  readonly scale: 'TAI';
  readonly year: number;
  /** 1–12. */
  readonly month: number;
  /** 1–31. */
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  /** May be fractional. */
  readonly second: number;
}

/**
 * Convert an epoch to a TAI calendar date.
 *
 * Uses the Fliegel–Van Flandern algorithm for the Julian Day Number, which is exact
 * for the proleptic Gregorian calendar over any range this game can reach.
 *
 * The *date* part is exact. The *time of day* inherits the Julian Date precision
 * limit described on `toJulianDateTT` — roughly 50 microseconds. That is ample for
 * display, which is the only thing this is for, and no simulation result depends
 * on it.
 */
export const toCalendarTAI = (t: Epoch): CalendarDate => {
  const jd = toJulianDateTAI(t);
  // Shift so the day boundary falls at midnight rather than noon.
  const z = Math.floor(jd + 0.5);
  const dayFraction = jd + 0.5 - z;

  const alpha = Math.floor((z - 1867216.25) / 36524.25);
  const a = z + 1 + alpha - Math.floor(alpha / 4);
  const b = a + 1524;
  const c = Math.floor((b - 122.1) / 365.25);
  const d = Math.floor(365.25 * c);
  const e = Math.floor((b - d) / 30.6001);

  const day = b - d - Math.floor(30.6001 * e);
  const month = e < 14 ? e - 1 : e - 13;
  const year = month > 2 ? c - 4716 : c - 4715;

  const secondOfDay = dayFraction * SECONDS_PER_DAY;
  const hour = Math.floor(secondOfDay / 3600);
  const minute = Math.floor((secondOfDay - hour * 3600) / 60);
  const second = secondOfDay - hour * 3600 - minute * 60;

  return { scale: 'TAI', year, month, day, hour, minute, second };
};

/** Epoch from a TAI calendar date. */
export const fromCalendarTAI = (
  date: Omit<CalendarDate, 'scale'> & { readonly scale?: 'TAI' },
): Epoch => {
  const { year, month, day, hour, minute, second } = date;
  const y = month <= 2 ? year - 1 : year;
  const m = month <= 2 ? month + 12 : month;
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  const jdMidnight =
    Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + b - 1524.5;
  const jdTAI = jdMidnight + (hour * 3600 + minute * 60 + second) / SECONDS_PER_DAY;
  return fromJulianDateTT(jdTAI + TT_MINUS_TAI / SECONDS_PER_DAY);
};

/**
 * Format mission elapsed time for display, as `T+HH:MM:SS` or `T+Dd HH:MM:SS`.
 *
 * Display formatting is boundary work, which is why it converts out of SI here and
 * nowhere else.
 */
export const formatMet = (elapsed: Met): string => {
  const sign = elapsed < 0 ? '-' : '+';
  const total = Math.abs(elapsed);
  const days = Math.floor(total / SECONDS_PER_DAY);
  const rem = total - days * SECONDS_PER_DAY;
  const h = Math.floor(rem / 3600);
  const mm = Math.floor((rem - h * 3600) / 60);
  const ss = Math.floor(rem - h * 3600 - mm * 60);
  const pad = (n: number): string => n.toString().padStart(2, '0');
  const clock = `${pad(h)}:${pad(mm)}:${pad(ss)}`;
  return days > 0 ? `T${sign}${String(days)}d ${clock}` : `T${sign}${clock}`;
};
