import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildRepIdentities,
  computeSalesModel,
  filterRows,
  makeRepOf,
  noFilters,
  periodOf,
  previousYearMonth,
  repPairsFor,
  seriesFor,
  targetsFor,
  targetToDate,
  type Rep,
  type SalesTarget,
  type SummaryRow,
} from "../src/lib/sales-model.ts";

const reps: Rep[] = [
  { company_code: 1, code: 5, name: "SERGIO ALMODOVAR", is_person: true },
  { company_code: 2, code: 9, name: "Sergio Almodóvar Alcaraz", is_person: true },
  { company_code: 1, code: 7, name: "Ana Ruiz", is_person: true },
];
const identities = buildRepIdentities(reps);
const repOf = makeRepOf(reps, identities);

const row = (month: string, company: number, series: string, rep: number | null, net: number, cost = net * 0.7): SummaryRow => ({
  month, company_code: company, series, rep_code: rep, documents: 1, net_amount: net, cost_amount: cost, net_without_cost: 0,
});

test("periodOf: el año entero, un mes pasado y el mes en curso", () => {
  const today = new Date(2026, 8, 29);
  assert.deepEqual(periodOf(2025, null, today), { from: "2025-01-01", to: "2025-12-31", partial: false, previousFrom: "2024-01-01", previousTo: "2024-12-31" });
  assert.deepEqual(periodOf(2026, "2026-08", today), { from: "2026-08-01", to: "2026-08-31", partial: false, previousFrom: "2025-08-01", previousTo: "2025-08-31" });
  // El mes en curso acaba hoy y se compara con los mismos días del año anterior.
  assert.deepEqual(periodOf(2026, "2026-09", today), { from: "2026-09-01", to: "2026-09-29", partial: true, previousFrom: "2025-09-01", previousTo: "2025-09-29" });
  assert.equal(periodOf(2026, null, today).to, "2026-09-29");
  // Un 29 de febrero se recorta al 28 del año anterior.
  assert.equal(periodOf(2028, "2028-02", new Date(2028, 1, 29)).previousTo, "2027-02-28");
});

test("previousYearMonth", () => {
  assert.equal(previousYearMonth("2026-08"), "2025-08");
  assert.equal(previousYearMonth(null), null);
});

test("repPairsFor junta las fichas de la misma persona en varias sociedades", () => {
  const key = repOf(1, 5).key;
  assert.equal(repOf(2, 9).key, key);
  assert.deepEqual(repPairsFor(key, reps, identities, [1, 2])?.sort(), ["1:5", "2:9"]);
  assert.deepEqual(repPairsFor("sin", reps, identities, [1, 2]), ["1:sin", "2:sin"]);
  assert.deepEqual(repPairsFor("1-99", reps, identities, [1]), ["1:99"]);
  assert.equal(repPairsFor(null, reps, identities, [1]), null);
});

test("seriesFor devuelve las series de un canal", () => {
  assert.deepEqual(seriesFor("Tienda", ["TK", "CRE", "B2C"]), ["TK"]);
  assert.equal(seriesFor(null, ["TK"]), null);
});

test("filterRows aplica todos los filtros menos los que se saltan", () => {
  const rows = [row("2026-08", 1, "TK", 5, 100), row("2026-09", 1, "CRE", 7, 200), row("2026-08", 2, "TK", 9, 50)];
  const filters = { ...noFilters, month: "2026-08", channel: "Tienda" };
  assert.equal(filterRows(rows, filters, repOf).length, 2);
  assert.equal(filterRows(rows, filters, repOf, ["month"]).length, 2);
  assert.equal(filterRows(rows, filters, repOf, ["channel"]).length, 2);
  assert.equal(filterRows(rows, { ...filters, company: 1 }, repOf).length, 1);
  assert.equal(filterRows(rows, { ...noFilters, repKey: repOf(1, 5).key }, repOf).length, 2);
});

test("computeSalesModel: el mes filtra los totales pero no el gráfico ni se filtra a sí mismo", () => {
  const rows = [
    row("2026-07", 1, "TK", 5, 1000),
    row("2026-08", 1, "TK", 5, 300),
    row("2026-08", 1, "CRE", 7, 700),
  ];
  const previousRows = [row("2025-08", 1, "TK", 5, 500)];
  const model = computeSalesModel({
    rows, previousRows, filters: { ...noFilters, month: "2026-08" }, shownYear: 2026, companies: [{ code: 1, name: "Intec", is_active: true }],
    repOf, comparisonIsPartial: true, today: new Date(2026, 8, 29),
  });
  assert.equal(model.current.net, 1000);
  assert.equal(model.previous.net, 500);
  // El gráfico enseña todos los meses para poder pulsar otro.
  assert.equal(model.monthly.months.length, 9);
  assert.equal(model.monthly.months[6].bucket.net, 1000);
  assert.equal(model.monthly.months[7].bucket.net, 1000);
  // El ranking de canales no se filtra por canal, pero sí por mes.
  assert.equal(model.byChannel.buckets.get("Tienda")?.net, 300);
  assert.equal(model.byChannel.buckets.get("Crédito")?.net, 700);
  // El margen, con el coste al 70 %.
  assert.equal(Math.round(model.currentMargin?.percent ?? 0), 30);
});

test("targetsFor y targetToDate: el mes en curso cuenta en proporción a los días", () => {
  const targets: SalesTarget[] = [
    { id: "a", year: 2026, month: 8, company_code: null, rep_key: null, amount: 1000 },
    { id: "b", year: 2026, month: 9, company_code: null, rep_key: null, amount: 3000 },
    { id: "c", year: 2026, month: 9, company_code: 1, rep_key: null, amount: 999 },
  ];
  const months = targetsFor(targets, 2026, null, null);
  assert.equal(months[7], 1000);
  assert.equal(months[8], 3000);
  assert.equal(months[0], null);
  const today = new Date(2026, 8, 15);
  const soFar = targetToDate(months, 2026, today);
  assert.deepEqual(soFar?.months, ["2026-08", "2026-09"]);
  assert.equal(soFar?.target, 1000 + 3000 * (15 / 30));
  assert.deepEqual(targetToDate(months, 2026, today, 7)?.months, ["2026-08"]);
  assert.equal(targetToDate(months, 2026, today, 0), null);
  assert.equal(targetsFor(targets, 2026, 1, null)[8], 999);
});
