/**
 * El cuadrante de horarios, resuelto.
 *
 * No se guarda lo que hace cada persona cada día: eso serían 27 personas por 20
 * días y nadie lo mantendría. Se guarda el turno habitual de cada una y, encima,
 * solo lo que se sale de él. Este archivo es el que junta las dos cosas y dice
 * qué pone en cada celda del cuadrante.
 *
 * El orden en que mandan las cosas, de más fuerte a más débil:
 *
 *   1. El festivo, que es de toda la casa y no lo discute nadie.
 *   2. La excepción de esa persona ese día (vacaciones, baja, permiso, una
 *      tarde libre o un horario distinto).
 *   3. Su turno habitual.
 *   4. Y si no hay turno habitual para ese día, no trabaja.
 */

export type Slot = { start: string; end: string };
export type DayShift = { morning: Slot | null; afternoon: Slot | null };

export type ExceptionKind = "vacaciones" | "baja" | "permiso" | "no_justificada" | "tarde_libre" | "horario" | "no_trabaja";

export type ShiftTemplate = { memberId: string; weekday: number; shift: DayShift };
export type ScheduleException = { memberId: string; day: string; kind: ExceptionKind; shift?: DayShift; note?: string | null };
export type Holiday = { day: string; name: string };

/** Lo que acaba pintado en una celda. */
export type DayCell =
  | { kind: "festivo"; label: string }
  | { kind: "ausencia"; label: string; note?: string | null }
  | { kind: "libre" }
  | { kind: "trabaja"; shift: DayShift; tardeLibre: boolean; note?: string | null };

const AUSENCIAS: Record<string, string> = { vacaciones: "VACACIONES", baja: "BAJA", permiso: "PERMISO", no_justificada: "SIN JUSTIFICAR" };

/** Lunes = 1 … domingo = 7, que es como se numeran los turnos habituales. */
export function weekdayOf(day: string): number {
  const d = new Date(`${day}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

/** El lunes de la semana a la que pertenece ese día. */
export function weekStartOf(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (weekdayOf(day) - 1));
  return d.toISOString().slice(0, 10);
}

/** Los días de lunes a viernes de esa semana. */
export function weekDays(weekStart: string, howMany = 5): string[] {
  const days: string[] = [];
  for (let i = 0; i < howMany; i++) {
    const d = new Date(`${weekStart}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

export function resolveDay(input: {
  day: string;
  template: DayShift | null;
  exception: ScheduleException | null;
  holiday: Holiday | null;
}): DayCell {
  if (input.holiday) return { kind: "festivo", label: input.holiday.name || "FESTIVO" };

  const ex = input.exception;
  if (ex) {
    const ausencia = AUSENCIAS[ex.kind];
    if (ausencia) return { kind: "ausencia", label: ausencia, note: ex.note ?? null };
    if (ex.kind === "no_trabaja") return { kind: "libre" };
    if (ex.kind === "tarde_libre") {
      // La tarde libre es media jornada: se queda la mañana, la del día o la de
      // siempre, y la tarde desaparece.
      const morning = ex.shift?.morning ?? input.template?.morning ?? null;
      if (!morning) return { kind: "libre" };
      return { kind: "trabaja", shift: { morning, afternoon: null }, tardeLibre: true, note: ex.note ?? null };
    }
    if (ex.kind === "horario" && ex.shift && (ex.shift.morning || ex.shift.afternoon)) {
      return { kind: "trabaja", shift: ex.shift, tardeLibre: false, note: ex.note ?? null };
    }
  }

  if (!input.template || (!input.template.morning && !input.template.afternoon)) return { kind: "libre" };
  return { kind: "trabaja", shift: input.template, tardeLibre: false, note: null };
}

const minutes = (value: string): number => {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + (m || 0);
};

/** Las horas que suma una celda. Un turno que cruza la medianoche no existe aquí. */
export function cellHours(cell: DayCell): number {
  if (cell.kind !== "trabaja") return 0;
  const tramo = (slot: Slot | null) => (slot ? Math.max(0, minutes(slot.end) - minutes(slot.start)) : 0);
  return (tramo(cell.shift.morning) + tramo(cell.shift.afternoon)) / 60;
}

/**
 * Las horas que una persona deja de hacer ese día respecto a su turno de
 * siempre. Es lo que el cuadrante de papel no dice y hace falta para cuadrar a
 * fin de mes: no es lo mismo faltar un día entero que irse dos horas antes.
 *
 * Un festivo no cuenta: ese día no trabaja nadie y no hay nada que recuperar.
 */
export function missingHours(cell: DayCell, template: DayShift | null): number {
  if (cell.kind === "festivo" || !template) return 0;
  const previstas = cellHours({ kind: "trabaja", shift: template, tardeLibre: false });
  const hechas = cellHours(cell);
  return Math.max(0, Math.round((previstas - hechas) * 100) / 100);
}

export type MemberRow = { memberId: string; cells: Record<string, DayCell>; hours: number; tardeLibreDay: string | null };

/**
 * El cuadrante de una semana entera. Las excepciones y los festivos se pasan ya
 * leídos de la base; aquí no se consulta nada.
 */
export function buildWeek(input: {
  days: string[];
  memberIds: string[];
  templates: ShiftTemplate[];
  exceptions: ScheduleException[];
  holidays: Holiday[];
}): MemberRow[] {
  const plantilla = new Map(input.templates.map((t) => [`${t.memberId}|${t.weekday}`, t.shift]));
  const excepciones = new Map(input.exceptions.map((e) => [`${e.memberId}|${e.day}`, e]));
  const festivos = new Map(input.holidays.map((h) => [h.day, h]));

  return input.memberIds.map((memberId) => {
    const cells: Record<string, DayCell> = {};
    let hours = 0;
    let tardeLibreDay: string | null = null;
    for (const day of input.days) {
      const cell = resolveDay({
        day,
        template: plantilla.get(`${memberId}|${weekdayOf(day)}`) ?? null,
        exception: excepciones.get(`${memberId}|${day}`) ?? null,
        holiday: festivos.get(day) ?? null,
      });
      cells[day] = cell;
      hours += cellHours(cell);
      if (cell.kind === "trabaja" && cell.tardeLibre) tardeLibreDay = day;
    }
    return { memberId, cells, hours, tardeLibreDay };
  });
}

/** Los días laborables (lunes a viernes) de un mes, en orden. */
export function monthWeekdays(monthKey: string): string[] {
  const [year, month] = monthKey.split("-").map(Number);
  const dias: string[] = [];
  const cursor = new Date(Date.UTC(year, month - 1, 1));
  while (cursor.getUTCMonth() === month - 1) {
    const d = cursor.getUTCDay();
    if (d >= 1 && d <= 5) dias.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dias;
}

/** El número de semana del año, como lo numera el cuadrante de papel. */
export function weekNumber(day: string): number {
  const d = new Date(`${day}T00:00:00Z`);
  const jueves = new Date(d);
  jueves.setUTCDate(d.getUTCDate() + (4 - weekdayOf(day)));
  const primero = new Date(Date.UTC(jueves.getUTCFullYear(), 0, 1));
  return Math.ceil(((jueves.getTime() - primero.getTime()) / 86400000 + 1) / 7);
}

/** La inicial del día que va bajo el número en la cabecera: L, M, X, J, V. */
export const weekdayInitial = (day: string): string => ["L", "M", "X", "J", "V", "S", "D"][weekdayOf(day) - 1];

const DIAS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
export const weekdayName = (day: string): string => DIAS[weekdayOf(day) - 1];

/** "8:00" a secas queda feo en el papel; se pinta como en el cuadrante de siempre. */
export const formatSlot = (slot: Slot): string => `${slot.start.slice(0, 5)} - ${slot.end.slice(0, 5)}`;

export function cellLines(cell: DayCell): string[] {
  if (cell.kind === "festivo") return ["FESTIVO"];
  if (cell.kind === "ausencia") return [cell.label];
  if (cell.kind === "libre") return [];
  return [cell.shift.morning ? formatSlot(cell.shift.morning) : "", cell.shift.afternoon ? formatSlot(cell.shift.afternoon) : ""].filter(Boolean);
}
