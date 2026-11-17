/**
 * Staggered schedule template. Pure: no database, no clock.
 *
 * Days are whole days on the America/New_York calendar, so a game that opens at noon Eastern
 * keeps opening at noon Eastern across daylight saving changes. A normal window is one day,
 * the Final Four and the Championship get two.
 */

const TZ = "America/New_York";

export type ScheduledMatchup = { roundNumber: number; slot: number; opensAt: Date; closesAt: Date };

type RoundPlan = {
  /** Matchups in this round. */
  count: number;
  /** Start day for each quarter of the bracket (a single entry applies to the whole round). */
  days: number[];
  windowDays: number;
};

// Keyed by field size, listed from the first round to the championship.
const PLANS: Record<number, RoundPlan[]> = {
  64: [
    { count: 32, days: [0, 1, 2, 3], windowDays: 1 },
    { count: 16, days: [4, 4, 5, 5], windowDays: 1 },
    { count: 8, days: [6, 6, 7, 7], windowDays: 1 },
    { count: 4, days: [8, 8, 8, 8], windowDays: 1 },
    { count: 2, days: [9], windowDays: 2 },
    { count: 1, days: [12], windowDays: 2 },
  ],
  32: [
    { count: 16, days: [0, 0, 1, 1], windowDays: 1 },
    { count: 8, days: [2, 2, 3, 3], windowDays: 1 },
    { count: 4, days: [4, 4, 4, 4], windowDays: 1 },
    { count: 2, days: [5], windowDays: 2 },
    { count: 1, days: [8], windowDays: 2 },
  ],
  16: [
    { count: 8, days: [0, 0, 1, 1], windowDays: 1 },
    { count: 4, days: [2, 2, 2, 2], windowDays: 1 },
    { count: 2, days: [3], windowDays: 2 },
    { count: 1, days: [6], windowDays: 2 },
  ],
};

const wallFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

type Wall = { y: number; m: number; d: number; h: number; mi: number; s: number };

function wallClock(date: Date): Wall {
  const out: Record<string, number> = {};
  for (const p of wallFmt.formatToParts(date)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return { y: out.year, m: out.month, d: out.day, h: out.hour, mi: out.minute, s: out.second };
}

/** Eastern wall clock minus UTC, in milliseconds, at the given instant. */
function offsetMs(date: Date): number {
  const w = wallClock(date);
  const asUtc = Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** The instant whose Eastern wall clock reads the given fields. Month is 1 based; days may overflow. */
function easternToUtc(y: number, m: number, d: number, h: number, mi = 0, s = 0): Date {
  const guess = Date.UTC(y, m - 1, d, h, mi, s);
  let utc = guess - offsetMs(new Date(guess));
  // The offset at the guess can differ from the offset at the answer near a change; settle once.
  utc = guess - offsetMs(new Date(utc));
  return new Date(utc);
}

/** Same Eastern wall clock time, `days` calendar days later. */
export function addEasternDays(date: Date, days: number): Date {
  const w = wallClock(date);
  return easternToUtc(w.y, w.m, w.d + days, w.h, w.mi, w.s);
}

/** The next 12:00 America/New_York at or after `now`. */
export function nextNoonEastern(now: Date): Date {
  const w = wallClock(now);
  const today = easternToUtc(w.y, w.m, w.d, 12);
  if (today.getTime() >= now.getTime()) return today;
  return easternToUtc(w.y, w.m, w.d + 1, 12);
}

export function buildSchedule(fieldSize: number, startAt: Date): ScheduledMatchup[] {
  const plan = PLANS[fieldSize];
  if (!plan) throw new Error(`No schedule for a field of ${fieldSize}`);
  const out: ScheduledMatchup[] = [];
  plan.forEach((round, i) => {
    for (let slot = 0; slot < round.count; slot++) {
      const quarter = Math.min(3, Math.floor((slot * 4) / round.count));
      const day = round.days.length === 1 ? round.days[0] : round.days[quarter];
      const opensAt = addEasternDays(startAt, day);
      out.push({ roundNumber: i + 1, slot, opensAt, closesAt: addEasternDays(opensAt, round.windowDays) });
    }
  });
  return out;
}

/** Parses a datetime-local value ("2030-01-05T12:00") as America/New_York wall clock. Null if malformed. */
export function parseEasternInput(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!m) return null;
  return easternToUtc(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0));
}
