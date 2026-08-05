export function monthKey(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    timeZone: "Europe/Madrid",
  }).format(date);
}

export function monthRange(value: string): { start: string; end: string; previousStart: string } {
  const [year, month] = value.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  const previousStart = new Date(Date.UTC(year, month - 2, 1));
  return { start: start.toISOString(), end: end.toISOString(), previousStart: previousStart.toISOString() };
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
    start: new Date(Date.UTC(year, month - 1, startDay)).toISOString(),
    end: new Date(Date.UTC(year, month - 1, endDay + 1)).toISOString(),
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

export function yearRange(year: number): { start: string; end: string } {
  return {
    start: new Date(Date.UTC(year, 0, 1)).toISOString(),
    end: new Date(Date.UTC(year + 1, 0, 1)).toISOString(),
  };
}
