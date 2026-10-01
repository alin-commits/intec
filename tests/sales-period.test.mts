import { test } from "node:test";
import assert from "node:assert/strict";
import {
  against,
  periodFromParams,
  periodToParams,
  rangeLabel,
  resolvePeriod,
  sameDays,
  shortRange,
  type CompareChoice,
  type PeriodChoice,
} from "../src/lib/sales-period.ts";

const today = new Date(2026, 8, 30);
const dataFrom = "2022-08-01";
const resolve = (choice: PeriodChoice, compare: CompareChoice = { kind: "year" }, month: string | null = null, when = today, floor = dataFrom) =>
  resolvePeriod({ choice, compare, month, today: when, dataFrom: floor });

test("el año en curso acaba hoy y se compara con el mismo tramo del anterior", () => {
  const period = resolve({ kind: "year", year: 2026 });
  assert.deepEqual(period.base, { from: "2026-01-01", to: "2026-09-30" });
  assert.deepEqual(period.compare, { from: "2025-01-01", to: "2025-09-30" });
  assert.equal(period.partial, true);
  assert.equal(period.months.length, 9);
  assert.equal(period.monthOffset, -12);
  assert.equal(period.versus, "el mismo tramo de 2025");
  assert.equal(against(period.versus ?? ""), "frente al mismo tramo de 2025");
  assert.equal(period.shortLabel, "ene–sep 2026");
  assert.equal(period.year, 2026);
});

test("un año cerrado se compara con el anterior entero", () => {
  const period = resolve({ kind: "year", year: 2025 });
  assert.deepEqual(period.compare, { from: "2024-01-01", to: "2024-12-31" });
  assert.equal(period.versus, "2024");
  assert.equal(period.shortLabel, "2025");
  assert.equal(period.partial, false);
});

test("no se compara contra lo que hay antes del primer dato, pero mes a mes sí", () => {
  const first = resolve({ kind: "year", year: 2022 });
  assert.deepEqual(first.base, { from: "2022-08-01", to: "2022-12-31" }, "2022 empieza con el primer dato");
  assert.equal(first.baseCompare, null);
  assert.equal(first.compare, null);
  assert.equal(first.compareNote, "no hay datos antes del 1 ago 2022");

  const second = resolve({ kind: "year", year: 2023 });
  assert.equal(second.compare, null, "2023 entero contra agosto-diciembre de 2022 daría un +140 % falso");
  assert.deepEqual(second.baseCompare, { from: "2022-01-01", to: "2022-12-31" }, "se carga para comparar mes a mes");
  const september = resolve({ kind: "year", year: 2023 }, { kind: "year" }, "2023-09");
  assert.deepEqual(september.compare, { from: "2022-09-01", to: "2022-09-30" });
  assert.equal(september.versus, "septiembre de 2022");
  assert.equal(september.label, "septiembre");
});

test("por fecha de factura no hay nada antes del 16 de octubre de 2025", () => {
  const period = resolve({ kind: "year", year: 2026 }, { kind: "year" }, null, today, "2025-10-16");
  assert.equal(period.compare, null);
  assert.equal(period.compareNote, "no hay datos antes del 16 oct 2025");
});

test("todos los años y los últimos 12 meses", () => {
  const all = resolve({ kind: "all" });
  assert.deepEqual(all.base, { from: "2022-08-01", to: "2026-09-30" });
  assert.equal(all.months.length, 50);
  assert.equal(all.multiYear, true);
  assert.equal(all.compare, null);
  assert.equal(all.compareNote, null, "todos los años no piden comparación");
  assert.equal(all.label, "todos los años");
  assert.equal(all.year, null);
  assert.equal(resolve({ kind: "all" }, { kind: "year" }, "2024-05").label, "mayo de 2024");

  const last = resolve({ kind: "last12" });
  assert.deepEqual(last.base, { from: "2025-10-01", to: "2026-09-30" });
  assert.deepEqual(last.compare, { from: "2024-10-01", to: "2025-09-30" });
  assert.equal(last.shortLabel, "oct 25–sep 26");
});

test("el periodo anterior cuenta meses si se miran meses enteros, y días si no", () => {
  const quarter = resolve({ kind: "range", from: "2026-03-01", to: "2026-06-30" }, { kind: "previous" });
  assert.deepEqual(quarter.compare, { from: "2025-11-01", to: "2026-02-28" });
  assert.equal(quarter.monthOffset, -4);
  assert.equal(quarter.label, "marzo–junio de 2026");
  assert.equal(quarter.versus, "noviembre de 2025–febrero de 2026");

  const days = resolve({ kind: "range", from: "2026-03-20", to: "2026-03-10" }, { kind: "previous" });
  assert.deepEqual(days.base, { from: "2026-03-10", to: "2026-03-20" }, "las fechas al revés se ordenan");
  assert.deepEqual(days.compare, { from: "2026-02-27", to: "2026-03-09" });
  assert.equal(days.label, "10 mar–20 mar de 2026");
});

test("otras fechas: el mes elegido se compara con el que le toca en el otro periodo", () => {
  const choice: PeriodChoice = { kind: "range", from: "2026-01-01", to: "2026-06-30" };
  const compare: CompareChoice = { kind: "range", from: "2024-01-01", to: "2024-06-30" };
  const period = resolve(choice, compare);
  assert.equal(period.monthOffset, -24);
  assert.equal(period.compareShort, "ene–jun 2024");
  const march = resolve(choice, compare, "2026-03");
  assert.deepEqual(march.compare, { from: "2024-03-01", to: "2024-03-31" });
  // Un mes sin pareja en el otro periodo no se compara con cualquier cosa.
  const short = resolve(choice, { kind: "range", from: "2024-01-01", to: "2024-02-29" }, "2026-05");
  assert.equal(short.compare, null);
  assert.equal(short.compareNote, "ese mes no tiene pareja en el periodo con el que se compara");
});

test("el mes en curso se compara con los mismos días; el 29 de febrero cae en el 28", () => {
  const period = resolve({ kind: "year", year: 2026 }, { kind: "year" }, "2026-09", new Date(2026, 8, 15));
  assert.deepEqual(period.compare, { from: "2025-09-01", to: "2025-09-15" });
  assert.equal(sameDays(period), true);
  const leap = resolve({ kind: "year", year: 2028 }, { kind: "year" }, "2028-02", new Date(2028, 1, 29));
  assert.equal(leap.compare?.to, "2027-02-28");
});

test("sin comparar", () => {
  const period = resolve({ kind: "year", year: 2025 }, { kind: "none" });
  assert.equal(period.compare, null);
  assert.equal(period.baseCompare, null);
  assert.equal(period.monthOffset, null);
  assert.equal(period.compareNote, null);
});

test("los nombres de los tramos", () => {
  assert.equal(rangeLabel("2025-01-01", "2025-12-31"), "2025");
  assert.equal(rangeLabel("2025-08-01", "2025-08-31"), "agosto de 2025");
  assert.equal(rangeLabel("2024-03-05", "2025-06-15"), "5 mar 2024–15 jun 2025");
  assert.equal(shortRange("2025-08-01", "2025-08-31"), "ago 2025");
  assert.equal(shortRange("2025-08-03", "2025-08-20"), "3 ago–20 ago 2025");
});

test("el periodo va y vuelve de la dirección de la página", () => {
  const cases: [PeriodChoice, CompareChoice][] = [
    [{ kind: "year", year: 2024 }, { kind: "year" }],
    [{ kind: "all" }, { kind: "none" }],
    [{ kind: "last12" }, { kind: "previous" }],
    [{ kind: "range", from: "2026-03-01", to: "2026-06-30" }, { kind: "range", from: "2025-03-01", to: "2025-06-30" }],
  ];
  for (const [choice, compare] of cases) {
    const params = new URLSearchParams();
    periodToParams(params, choice, compare, 2026);
    assert.deepEqual(periodFromParams(params), { choice, compare });
  }
  const current = new URLSearchParams();
  periodToParams(current, { kind: "year", year: 2026 }, { kind: "year" }, 2026);
  assert.equal(current.toString(), "", "lo de siempre no ensucia la dirección");
  assert.equal(periodFromParams(new URLSearchParams("d=2026-02-30~2026-03-01")).choice, null, "una fecha que no existe no vale");
});
