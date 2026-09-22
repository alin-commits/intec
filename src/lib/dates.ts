const TIME_ZONE = "Europe/Madrid";

const zonedPartsFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const dateKeyFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

/** Minutes Madrid is ahead of UTC at the given instant (60 in winter, 120 in summer). */
function madridOffsetMinutes(utcMs: number): number {
  const parts = Object.fromEntries(zonedPartsFormatter.formatToParts(new Date(utcMs)).map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return Math.round((asUtc - utcMs) / 60000);
}

/** ISO instant of 00:00 Madrid time on the given calendar day (month is 0-based, overflow allowed). */
export function madridMidnightIso(year: number, monthIndex: number, day: number): string {
  const guess = Date.UTC(year, monthIndex, day);
  let instant = guess - madridOffsetMinutes(guess) * 60000;
  // Re-check once in case the guess and the real instant sit on different sides of a DST change.
  instant = guess - madridOffsetMinutes(instant) * 60000;
  return new Date(instant).toISOString();
}

/** YYYY-MM-DD of an ISO timestamp (or a plain YYYY-MM-DD date) as seen in Madrid. */
export function dateKeyInMadrid(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return dateKeyFormatter.format(new Date(value));
}

/** YYYY-MM of an ISO timestamp (or a plain date) as seen in Madrid. */
export function monthKeyInMadrid(value: string): string {
  return dateKeyInMadrid(value).slice(0, 7);
}

/** Today's date in Madrid as YYYY-MM-DD (for date inputs and defaults). */
export function todayKey(): string {
  return dateKeyFormatter.format(new Date());
}

/** Whether a timestamp or date falls between two inclusive YYYY-MM-DD filter bounds (either may be empty). */
export function inDateKeyRange(value: string, from: string, to: string): boolean {
  const key = dateKeyInMadrid(value);
  return (!from || key >= from) && (!to || key <= to);
}

export function monthKey(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    timeZone: "Europe/Madrid",
  }).format(date);
}

export function monthRange(value: string): { start: string; end: string; previousStart: string } {
  const [year, month] = value.split("-").map(Number);
  return {
    start: madridMidnightIso(year, month - 1, 1),
    end: madridMidnightIso(year, month, 1),
    previousStart: madridMidnightIso(year, month - 2, 1),
  };
}

export function monthLabel(value: string): string {
  const [year, month] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("es-ES", {
    month: "long",
    year: "numeric",
    timeZone: "Europe/Madrid",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}

export function daysInMonth(value: string): number {
  const [year, month] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function dayNumber(value: string): number {
  return Number(new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    timeZone: "Europe/Madrid",
  }).format(new Date(value)));
}

export type MonthWeekBucket = {
  key: string;
  label: string;
  start: string;
  end: string;
};

/**
 * Splits a month into week buckets that never cross the month boundary:
 * the leading fragment before the first Monday always joins the first full
 * week, and a trailing fragment after the last full Sunday only becomes its
 * own bucket when it has 5+ days — otherwise it's folded into the previous
 * week. This mirrors the manual "semanas" grouping used in the legacy Excel.
 */
export function monthWeekBuckets(value: string): MonthWeekBucket[] {
  const [year, month] = value.split("-").map(Number);
  const totalDays = daysInMonth(value);
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const isoWeekday = firstWeekday === 0 ? 7 : firstWeekday;
  const firstMonday = isoWeekday === 1 ? 1 : 1 + (8 - isoWeekday);

  const ranges: { startDay: number; endDay: number }[] = [
    { startDay: 1, endDay: Math.min(firstMonday + 6, totalDays) },
  ];

  let cursor = firstMonday + 7;
  while (cursor + 6 <= totalDays) {
    ranges.push({ startDay: cursor, endDay: cursor + 6 });
    cursor += 7;
  }

  const trailing = totalDays - cursor + 1;
  if (trailing >= 5) {
    ranges.push({ startDay: cursor, endDay: totalDays });
  } else if (trailing > 0) {
    ranges[ranges.length - 1].endDay = totalDays;
  }

  return ranges.map(({ startDay, endDay }) => ({
    key: `${value}-W${String(startDay).padStart(2, "0")}`,
    label: startDay === endDay ? `${startDay}` : `${startDay}–${endDay}`,
    start: madridMidnightIso(year, month - 1, startDay),
    end: madridMidnightIso(year, month - 1, endDay + 1),
  }));
}

export function yearOfMonth(value: string): number {
  return Number(value.split("-")[0]);
}

export function previousMonthKey(value: string): string {
  const [year, month] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function previousYearMonthKey(value: string): string {
  const [year, month] = value.split("-").map(Number);
  return `${year - 1}-${String(month).padStart(2, "0")}`;
}

export function monthShortLabel(value: string): string {
  const [year, month] = value.split("-").map(Number);
  const raw = new Intl.DateTimeFormat("es-ES", { month: "short", timeZone: "Europe/Madrid" }).format(new Date(Date.UTC(year, month - 1, 1)));
  const clean = raw.replace(".", "");
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

/** Monday (ISO week start) of the week containing the given YYYY-MM-DD date, as YYYY-MM-DD. */
export function isoWeekStart(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  const day = date.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  date.setUTCDate(date.getUTCDate() - diff);
  return date.toISOString().slice(0, 10);
}

export function yearRange(year: number): { start: string; end: string } {
  return {
    start: madridMidnightIso(year, 0, 1),
    end: madridMidnightIso(year + 1, 0, 1),
  };
}

/** Adds (or subtracts) whole days to a YYYY-MM-DD date. */
export function shiftDateKey(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * The window of the same length right before an inclusive [from, to] date range,
 * or null when the range is open-ended (nothing sensible to compare against).
 */
export function previousDateRange(from: string, to: string): { from: string; to: string } | null {
  if (!from || !to || from > to) return null;
  const lengthDays = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
  const previousTo = shiftDateKey(from, -1);
  return { from: shiftDateKey(previousTo, -(lengthDays - 1)), to: previousTo };
}
