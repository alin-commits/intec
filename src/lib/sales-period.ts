// El periodo que mira el panel de Ventas y con qué se compara. Sin imports,
// para que los tests de node lo carguen tal cual.

/** Lo que se elige en «Periodo». */
export type PeriodChoice =
  | { kind: "year"; year: number }
  | { kind: "all" }
  | { kind: "last12" }
  | { kind: "range"; from: string; to: string };

/** Lo que se elige en «Comparar con». */
export type CompareChoice =
  | { kind: "year" }
  | { kind: "previous" }
  | { kind: "range"; from: string; to: string }
  | { kind: "none" };

export type DateRange = { from: string; to: string };

export type SalesPeriod = {
  /** Lo que se mira, con el mes elegido ya aplicado. Nunca pasa de hoy. */
  from: string;
  to: string;
  /** Si acaba hoy: los últimos días todavía se mueven. */
  partial: boolean;
  /** Con qué se compara lo que se mira; null si no se compara o no hay datos para hacerlo. */
  compare: DateRange | null;
  /** El periodo entero, sin el mes elegido: los gráficos lo pintan todo para poder pulsar otro mes. */
  base: DateRange;
  /** Si el periodo entero acaba hoy: su último mes va por la mitad. */
  basePartial: boolean;
  /** Lo que se carga para comparar el periodo entero, mes a mes. */
  baseCompare: DateRange | null;
  /** Los meses del periodo entero ("2026-08"). */
  months: string[];
  /** Cuántos meses hay que mover un mes para dar con su pareja en la comparación. */
  monthOffset: number | null;
  compareKind: CompareChoice["kind"];
  /** El año, si se mira un año natural: los objetivos solo tienen sentido así. */
  year: number | null;
  /** Si los meses son de más de un año: entonces las etiquetas llevan el año. */
  multiYear: boolean;
  /** Cómo se llama lo que se mira ("2026", "todos los años", "agosto de 2026"...). */
  label: string;
  /** Cómo se llama el periodo entero, sin el mes elegido. */
  baseLabel: string;
  /** Lo mismo en corto, para columnas y leyendas ("ene–sep 2026"). */
  shortLabel: string;
  /** Tras "frente a": "2025", "el mismo tramo de 2025", "marzo–junio de 2024"... */
  versus: string | null;
  /** La comparación en corto, para columnas y leyendas. */
  compareShort: string | null;
  /** La del periodo entero, para las columnas de mes a mes. */
  baseCompareShort: string | null;
  /** Por qué no se compara, cuando se pidió comparar y no se puede. */
  compareNote: string | null;
};

const pad = (value: number) => String(value).padStart(2, "0");
const DAY_MS = 86_400_000;
export const monthShortNames = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const monthLong = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export const dateKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const parts = (key: string) => key.split("-").map(Number);
const toUtc = (key: string) => {
  const [year, month, day] = parts(key);
  return Date.UTC(year, month - 1, day);
};
const fromUtc = (ms: number) => {
  const date = new Date(ms);
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
};

/** Una fecha "AAAA-MM-DD" que existe (no un 31 de junio). */
export const isDateKey = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && fromUtc(toUtc(value)) === value;
export const addDays = (key: string, count: number) => fromUtc(toUtc(key) + count * DAY_MS);
/** Los días de `from` a `to`, los dos incluidos. */
export const dayCount = (from: string, to: string) => Math.round((toUtc(to) - toUtc(from)) / DAY_MS) + 1;
const lastDayOfMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
export const monthEnd = (month: string) => {
  const [year, number] = parts(month);
  return `${month}-${pad(lastDayOfMonth(year, number))}`;
};
/** "2024-03" + n meses. */
export function shiftMonth(month: string, count: number): string {
  const [year, number] = parts(month);
  const index = year * 12 + (number - 1) + count;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}`;
}
const monthIndex = (key: string) => {
  const [year, number] = parts(key);
  return year * 12 + number - 1;
};
/** El mismo día de hace un año; un 29 de febrero cae en el 28. */
export function sameDayYearBefore(key: string): string {
  const [year, month, day] = parts(key);
  return `${year - 1}-${pad(month)}-${pad(Math.min(day, lastDayOfMonth(year - 1, month)))}`;
}
export function monthsBetween(from: string, to: string): string[] {
  const months: string[] = [];
  for (let month = from.slice(0, 7); month <= to.slice(0, 7); month = shiftMonth(month, 1)) months.push(month);
  return months;
}
const maxKey = (a: string, b: string) => (a > b ? a : b);
const minKey = (a: string, b: string) => (a < b ? a : b);
const isMonthStart = (key: string) => key.endsWith("-01");
const isMonthEnd = (key: string) => monthEnd(key.slice(0, 7)) === key;

/**
 * Un tramo de fechas dicho como lo diría una persona: "2025", "agosto de
 * 2025", "marzo–junio de 2025" o "3 mar–15 jun de 2025".
 */
export function rangeLabel(from: string, to: string): string {
  const [fromYear, fromMonth, fromDay] = parts(from);
  const [toYear, toMonth, toDay] = parts(to);
  const wholeMonths = isMonthStart(from) && isMonthEnd(to);
  if (wholeMonths && fromYear === toYear) {
    if (fromMonth === 1 && toMonth === 12) return String(fromYear);
    if (fromMonth === toMonth) return `${monthLong[fromMonth - 1]} de ${fromYear}`;
    return `${monthLong[fromMonth - 1]}–${monthLong[toMonth - 1]} de ${fromYear}`;
  }
  if (wholeMonths) return `${monthLong[fromMonth - 1]} de ${fromYear}–${monthLong[toMonth - 1]} de ${toYear}`;
  const day = (value: number, month: number) => `${value} ${monthShortNames[month - 1]}`;
  if (fromYear === toYear) return `${day(fromDay, fromMonth)}–${day(toDay, toMonth)} de ${fromYear}`;
  return `${day(fromDay, fromMonth)} ${fromYear}–${day(toDay, toMonth)} ${toYear}`;
}

/** Lo mismo en corto, para una columna o una leyenda: "2025", "ago 2025", "oct 25–sep 26". */
export function shortRange(from: string, to: string): string {
  const [fromYear, fromMonth, fromDay] = parts(from);
  const [toYear, toMonth, toDay] = parts(to);
  const start = isMonthStart(from) ? monthShortNames[fromMonth - 1] : `${fromDay} ${monthShortNames[fromMonth - 1]}`;
  const end = isMonthEnd(to) ? monthShortNames[toMonth - 1] : `${toDay} ${monthShortNames[toMonth - 1]}`;
  if (fromYear === toYear) {
    if (isMonthStart(from) && isMonthEnd(to) && fromMonth === 1 && toMonth === 12) return String(fromYear);
    if (fromMonth === toMonth && isMonthStart(from) && isMonthEnd(to)) return `${start} ${fromYear}`;
    return `${start}–${end} ${fromYear}`;
  }
  return `${start} ${String(fromYear).slice(2)}–${end} ${String(toYear).slice(2)}`;
}

/** "frente a 2025", pero "frente al mismo tramo de 2025". */
export const against = (versus: string) => (versus.startsWith("el ") ? `frente al ${versus.slice(3)}` : `frente a ${versus}`);

/** El nombre de un mes en una frase: "agosto", o "agosto de 2025" si el periodo abarca varios años. */
export const monthPhrase = (month: string, withYear: boolean) => {
  const name = monthLong[Number(month.slice(5, 7)) - 1] ?? month;
  return withYear ? `${name} de ${month.slice(0, 4)}` : name;
};

/**
 * El periodo que se mira y con qué se compara.
 *
 * - Un año en curso acaba hoy y se compara con el mismo tramo del anterior: si
 *   no, en septiembre siempre parecería que se ha vendido un 30 % menos.
 * - «El periodo anterior» es el de la misma duración justo antes. Si se miran
 *   meses enteros se cuentan meses (un trimestre contra el anterior); si no,
 *   días.
 * - Nada empieza antes de `dataFrom`, el primer día con datos. Una comparación
 *   que empezaría antes no se hace: saldría contra casi nada, con un +400 %
 *   que no significa nada. Mes a mes sí se compara lo que haya.
 * - Con un mes elegido, se compara con su pareja: el mismo mes del año anterior
 *   o el mes que le toca en el otro periodo, con los mismos días.
 */
export function resolvePeriod(input: {
  choice: PeriodChoice;
  compare: CompareChoice;
  month: string | null;
  today: Date;
  dataFrom: string | null;
}): SalesPeriod {
  const { choice, month, today } = input;
  const todayKey = dateKey(today);
  const floor = input.dataFrom ?? "2000-01-01";

  // ---- El periodo entero ----
  let from: string;
  let to: string;
  if (choice.kind === "year") {
    from = `${choice.year}-01-01`;
    to = `${choice.year}-12-31`;
  } else if (choice.kind === "all") {
    from = floor;
    to = todayKey;
  } else if (choice.kind === "last12") {
    to = todayKey;
    from = addDays(sameDayYearBefore(todayKey), 1);
  } else {
    from = minKey(choice.from, choice.to);
    to = maxKey(choice.from, choice.to);
  }
  from = maxKey(from, floor);
  to = minKey(to, todayKey);
  if (from > to) from = to;
  const base = { from, to };

  // ---- Con qué se compara el periodo entero ----
  // Todos los años no tienen nada antes con lo que compararse.
  const compare: CompareChoice = choice.kind === "all" ? { kind: "none" } : input.compare;
  let baseCompare: DateRange | null = null;
  if (compare.kind === "year") {
    baseCompare = { from: sameDayYearBefore(base.from), to: sameDayYearBefore(base.to) };
  } else if (compare.kind === "previous") {
    if (isMonthStart(base.from) && isMonthEnd(base.to)) {
      const count = monthIndex(base.to) - monthIndex(base.from) + 1;
      baseCompare = { from: `${shiftMonth(base.from.slice(0, 7), -count)}-01`, to: addDays(base.from, -1) };
    } else {
      const length = dayCount(base.from, base.to);
      baseCompare = { from: addDays(base.from, -length), to: addDays(base.from, -1) };
    }
  } else if (compare.kind === "range") {
    baseCompare = { from: minKey(compare.from, compare.to), to: minKey(maxKey(compare.from, compare.to), todayKey) };
  }
  // Entero antes del primer dato (o todavía por llegar) no hay nada que cargar.
  if (baseCompare && (baseCompare.to < floor || baseCompare.from > baseCompare.to)) baseCompare = null;
  const monthOffset = baseCompare
    ? (compare.kind === "year" ? -12 : monthIndex(baseCompare.from) - monthIndex(base.from))
    : null;

  // ---- El mes elegido ----
  const months = monthsBetween(base.from, base.to);
  const chosen = month && months.includes(month) ? month : null;
  let effective: DateRange = base;
  let effectiveCompare: DateRange | null = baseCompare;
  if (chosen) {
    effective = { from: maxKey(`${chosen}-01`, base.from), to: minKey(monthEnd(chosen), base.to) };
    if (baseCompare && compare.kind === "year") {
      effectiveCompare = { from: sameDayYearBefore(effective.from), to: sameDayYearBefore(effective.to) };
    } else if (baseCompare && monthOffset !== null) {
      const pair = shiftMonth(chosen, monthOffset);
      const pairFrom = maxKey(`${pair}-01`, baseCompare.from);
      const pairTo = minKey(minKey(addDays(pairFrom, dayCount(effective.from, effective.to) - 1), monthEnd(pair)), baseCompare.to);
      effectiveCompare = pairFrom <= pairTo ? { from: pairFrom, to: pairTo } : null;
    }
  }
  // Una comparación que empieza antes del primer dato saldría contra casi nada.
  let compareNote: string | null = null;
  if (compare.kind !== "none") {
    const [floorYear, floorMonth, floorDay] = parts(floor);
    const beforeData = `no hay datos antes del ${floorDay} ${monthShortNames[floorMonth - 1]} ${floorYear}`;
    if (!baseCompare) compareNote = beforeData;
    else if (!effectiveCompare) compareNote = "ese mes no tiene pareja en el periodo con el que se compara";
    else if (effectiveCompare.from < floor) compareNote = beforeData;
    if (compareNote) effectiveCompare = null;
  }

  // ---- Los nombres ----
  const partial = effective.to === todayKey;
  const multiYear = months.length > 0 && months[0].slice(0, 4) !== months[months.length - 1].slice(0, 4);
  const baseLabel = choice.kind === "year"
    ? String(choice.year)
    : choice.kind === "all" ? "todos los años"
      : choice.kind === "last12" ? "los últimos 12 meses"
        : rangeLabel(base.from, base.to);
  const label = chosen ? monthPhrase(chosen, multiYear || choice.kind !== "year") : baseLabel;
  let versus: string | null = null;
  if (effectiveCompare) {
    if (compare.kind === "year" && choice.kind === "year" && !chosen) {
      versus = partial ? `el mismo tramo de ${choice.year - 1}` : String(choice.year - 1);
    } else if (compare.kind === "year" && chosen) {
      versus = monthPhrase(shiftMonth(chosen, -12), true);
    } else {
      versus = rangeLabel(effectiveCompare.from, effectiveCompare.to);
    }
  }
  return {
    from: effective.from,
    to: effective.to,
    partial,
    compare: effectiveCompare,
    base,
    basePartial: base.to === todayKey,
    baseCompare,
    months,
    monthOffset,
    compareKind: compare.kind,
    year: choice.kind === "year" ? choice.year : null,
    multiYear,
    label,
    baseLabel,
    shortLabel: choice.kind === "year" && !chosen && !partial ? String(choice.year) : shortRange(effective.from, effective.to),
    versus,
    compareShort: effectiveCompare ? shortRange(effectiveCompare.from, effectiveCompare.to) : null,
    baseCompareShort: baseCompare ? shortRange(baseCompare.from, baseCompare.to) : null,
    compareNote,
  };
}

/** Si en la comparación se habla de los mismos días (un mes a medias contra el mismo tramo). */
export const sameDays = (period: SalesPeriod) => period.partial && period.compare !== null && period.from.slice(0, 7) === period.to.slice(0, 7);

// ---- La dirección de la página (?y=2025&vs=anterior...) ----

const RANGE = /^(\d{4}-\d{2}-\d{2})~(\d{4}-\d{2}-\d{2})$/;
const parseRange = (value: string | null): DateRange | null => {
  const match = value ? RANGE.exec(value) : null;
  if (!match || !isDateKey(match[1]) || !isDateKey(match[2])) return null;
  return { from: match[1], to: match[2] };
};

export function periodFromParams(params: URLSearchParams): { choice: PeriodChoice | null; compare: CompareChoice } {
  const range = parseRange(params.get("d"));
  const year = params.get("y");
  let choice: PeriodChoice | null = null;
  if (range) choice = { kind: "range", ...range };
  else if (year === "todos") choice = { kind: "all" };
  else if (year === "12m") choice = { kind: "last12" };
  else if (year && /^\d{4}$/.test(year)) choice = { kind: "year", year: Number(year) };
  const versus = params.get("vs");
  const versusRange = parseRange(versus);
  const compare: CompareChoice = versusRange
    ? { kind: "range", ...versusRange }
    : versus === "anterior" ? { kind: "previous" } : versus === "no" ? { kind: "none" } : { kind: "year" };
  return { choice, compare };
}

export function periodToParams(params: URLSearchParams, choice: PeriodChoice, compare: CompareChoice, currentYear: number): void {
  if (choice.kind === "range") params.set("d", `${choice.from}~${choice.to}`);
  else if (choice.kind === "all") params.set("y", "todos");
  else if (choice.kind === "last12") params.set("y", "12m");
  else if (choice.year !== currentYear) params.set("y", String(choice.year));
  if (compare.kind === "previous") params.set("vs", "anterior");
  else if (compare.kind === "none") params.set("vs", "no");
  else if (compare.kind === "range") params.set("vs", `${compare.from}~${compare.to}`);
}
