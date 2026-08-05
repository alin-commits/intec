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
