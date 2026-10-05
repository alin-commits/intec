import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildWeek,
  cellHours,
  cellLines,
  resolveDay,
  weekDays,
  weekStartOf,
  weekdayName,
  weekdayOf,
  type DayShift,
} from "../src/lib/horarios/model.ts";

const normal: DayShift = { morning: { start: "08:00", end: "13:30" }, afternoon: { start: "15:30", end: "18:00" } };
const soloManana: DayShift = { morning: { start: "08:00", end: "14:00" }, afternoon: null };

test("la semana empieza en lunes, venga de donde venga el día", () => {
  // Del 5 al 11 de octubre de 2026: el 5 es lunes.
  assert.equal(weekStartOf("2026-10-05"), "2026-10-05");
  assert.equal(weekStartOf("2026-10-09"), "2026-10-05");
  assert.equal(weekStartOf("2026-10-11"), "2026-10-05");
  assert.equal(weekStartOf("2026-10-12"), "2026-10-12");
  assert.deepEqual(weekDays("2026-10-05"), ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09"]);
  assert.equal(weekdayOf("2026-10-05"), 1);
  assert.equal(weekdayOf("2026-10-11"), 7);
  assert.equal(weekdayName("2026-10-09"), "viernes");
});

test("sin nada que lo cambie, manda el turno habitual", () => {
  const cell = resolveDay({ day: "2026-10-06", template: normal, exception: null, holiday: null });
  assert.deepEqual(cell, { kind: "trabaja", shift: normal, tardeLibre: false, note: null });
  assert.deepEqual(cellLines(cell), ["08:00 - 13:30", "15:30 - 18:00"]);
  assert.equal(cellHours(cell), 8);
});

test("el festivo manda sobre todo, incluso sobre las vacaciones", () => {
  const cell = resolveDay({
    day: "2026-10-09",
    template: normal,
    exception: { memberId: "m", day: "2026-10-09", kind: "vacaciones" },
    holiday: { day: "2026-10-09", name: "FESTIVO" },
  });
  assert.deepEqual(cell, { kind: "festivo", label: "FESTIVO" });
  assert.equal(cellHours(cell), 0, "un festivo no suma horas aunque tocara trabajar");
});

test("las ausencias tapan el turno y no suman horas", () => {
  for (const [kind, label] of [["vacaciones", "VACACIONES"], ["baja", "BAJA"], ["permiso", "PERMISO"]] as const) {
    const cell = resolveDay({ day: "2026-10-06", template: normal, exception: { memberId: "m", day: "2026-10-06", kind }, holiday: null });
    assert.deepEqual(cellLines(cell), [label]);
    assert.equal(cellHours(cell), 0);
  }
});

test("la tarde libre deja la mañana y se lleva la tarde", () => {
  const cell = resolveDay({ day: "2026-10-09", template: normal, exception: { memberId: "m", day: "2026-10-09", kind: "tarde_libre" }, holiday: null });
  assert.equal(cell.kind, "trabaja");
  assert.deepEqual(cellLines(cell), ["08:00 - 13:30"]);
  assert.equal(cellHours(cell), 5.5);
  if (cell.kind === "trabaja") assert.equal(cell.tardeLibre, true);
});

test("una tarde libre con horas propias usa esas, no las de siempre", () => {
  const cell = resolveDay({
    day: "2026-10-09",
    template: normal,
    exception: { memberId: "m", day: "2026-10-09", kind: "tarde_libre", shift: { morning: { start: "08:00", end: "14:00" }, afternoon: null } },
    holiday: null,
  });
  assert.deepEqual(cellLines(cell), ["08:00 - 14:00"]);
  assert.equal(cellHours(cell), 6);
});

test("un horario distinto para un día suelto sustituye al habitual", () => {
  const cell = resolveDay({
    day: "2026-10-07",
    template: normal,
    exception: { memberId: "m", day: "2026-10-07", kind: "horario", shift: { morning: { start: "07:00", end: "13:30" }, afternoon: { start: "15:30", end: "17:00" } } },
    holiday: null,
  });
  assert.deepEqual(cellLines(cell), ["07:00 - 13:30", "15:30 - 17:00"]);
  assert.equal(cellHours(cell), 8);
});

test("sin turno habitual ese día, no trabaja", () => {
  assert.deepEqual(resolveDay({ day: "2026-10-06", template: null, exception: null, holiday: null }), { kind: "libre" });
  assert.deepEqual(cellLines({ kind: "libre" }), []);
});

test("la semana entera: horas, festivo y en qué día cae la tarde libre", () => {
  const dias = weekDays("2026-10-05");
  const filas = buildWeek({
    days: dias,
    memberIds: ["ana", "luis"],
    templates: [
      ...[1, 2, 3, 4, 5].map((weekday) => ({ memberId: "ana", weekday, shift: normal })),
      ...[1, 2, 3, 4, 5].map((weekday) => ({ memberId: "luis", weekday, shift: soloManana })),
    ],
    exceptions: [
      { memberId: "ana", day: "2026-10-07", kind: "tarde_libre" as const },
      { memberId: "luis", day: "2026-10-06", kind: "baja" as const },
    ],
    holidays: [{ day: "2026-10-09", name: "FESTIVO" }],
  });

  const ana = filas[0];
  assert.equal(ana.tardeLibreDay, "2026-10-07");
  assert.equal(weekdayName(ana.tardeLibreDay!), "miércoles");
  // Tres días de 8 h, uno de 5,5 (tarde libre) y el viernes festivo.
  assert.equal(ana.hours, 8 * 3 + 5.5);
  assert.deepEqual(cellLines(ana.cells["2026-10-09"]), ["FESTIVO"]);

  const luis = filas[1];
  assert.equal(luis.tardeLibreDay, null);
  // Cuatro días de 6 h menos el martes de baja, y el viernes festivo: 3 × 6.
  assert.equal(luis.hours, 18);
  assert.deepEqual(cellLines(luis.cells["2026-10-06"]), ["BAJA"]);
});

test("una semana sin nadie ni nada no revienta", () => {
  assert.deepEqual(buildWeek({ days: weekDays("2026-10-05"), memberIds: [], templates: [], exceptions: [], holidays: [] }), []);
});

test("los días laborables de un mes y sus semanas", async () => {
  const { monthWeekdays, weekNumber, weekdayInitial } = await import("../src/lib/horarios/model.ts");
  const dias = monthWeekdays("2026-10");
  assert.equal(dias.length, 22, "octubre de 2026 tiene 22 días laborables");
  assert.equal(dias[0], "2026-10-01", "empieza el jueves 1");
  assert.equal(dias[dias.length - 1], "2026-10-30");
  assert.ok(!dias.includes("2026-10-03"), "el sábado 3 no está");
  assert.ok(!dias.includes("2026-10-04"), "el domingo 4 tampoco");
  assert.equal(weekdayInitial("2026-10-01"), "J");
  assert.equal(weekdayInitial("2026-10-05"), "L");
  assert.equal(weekdayInitial("2026-10-07"), "X");
  // La semana del 5 al 9 de octubre es la 41, como en el cuadrante de papel.
  assert.equal(weekNumber("2026-10-05"), 41);
  assert.equal(weekNumber("2026-10-09"), 41);
  assert.equal(weekNumber("2026-10-12"), 42);
});
