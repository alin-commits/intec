import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bucketDiscount,
  buildRepIdentities,
  computeSalesModel,
  discountPercent,
  emptyBucket,
  filterRows,
  mergeBucket,
  sumRows,
  makeRepOf,
  noFilters,
  pairOf,
  repPairsFor,
  seriesFor,
  targetsFor,
  targetToDate,
  yearlyView,
  type PeriodView,
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

/** El año 2026 hasta septiembre, contra el mismo tramo de 2025. */
const months2026 = ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
const yearView: PeriodView = { months: months2026, monthOffset: -12, comparable: true, versus: "el mismo tramo de 2025", basePartial: true, multiYear: false };
const companies = [{ code: 1, name: "Intec", is_active: true }];

test("pairOf: la pareja de un mes en la comparación", () => {
  assert.equal(pairOf("2026-08", -12), "2025-08");
  assert.equal(pairOf("2026-02", -4), "2025-10");
  assert.equal(pairOf("2026-08", null), null);
  assert.equal(pairOf(null, -12), null);
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
  const model = computeSalesModel({ rows, previousRows, filters: { ...noFilters, month: "2026-08" }, period: yearView, companies, repOf });
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

/** Una fila con bruto: `discount` es lo rebajado sobre tarifa, y la mitad de eso va en las líneas. */
const discounted = (month: string, rep: number | null, net: number, discount: number): SummaryRow => {
  const gross = net / (1 - discount);
  return { ...row(month, 1, "CRE", rep, net), gross_amount: gross, gross_net: net, line_discount_amount: (gross - net) / 2, commission_amount: 0 };
};

test("el descuento se mide solo con las filas que traen bruto", () => {
  // 800 € con bruto (1.000 € de tarifa, un 20 % de rebaja) y 500 € cargados antes de leer el bruto.
  const bucket = sumRows([discounted("2026-08", 5, 800, 0.2), row("2026-08", 1, "CRE", 5, 500)]);
  assert.equal(bucket.net, 1300);
  const discount = bucketDiscount(bucket);
  assert.equal(Math.round(discount?.percent ?? 0), 20, "no un 35 %, que saldría restando los 1.300 € al bruto");
  assert.equal(Math.round(discount?.linePercent ?? 0), 10);
  assert.equal(bucketDiscount(sumRows([row("2026-08", 1, "CRE", 5, 500)])), null, "sin bruto no hay descuento, no un 0 %");
  assert.equal(discountPercent(0, 0), null);
  assert.equal(Math.round(discountPercent(1250, 1000) ?? 0), 20);
  // Solo abonos: el bruto es negativo y no se puede hablar de descuento.
  assert.equal(bucketDiscount(sumRows([discounted("2026-08", 5, -100, 0.2)])), null);
  const total = mergeBucket(emptyBucket(), bucket);
  assert.deepEqual(total, bucket, "sumar un grupo a uno vacío lo deja igual, con el bruto incluido");
});

test("el panel señala al comercial que más rebaja y la subida del descuento", () => {
  const rows = [
    discounted("2026-08", 5, 10000, 0.3),
    discounted("2026-08", 7, 30000, 0.15),
  ];
  const previousRows = [discounted("2025-08", 5, 10000, 0.15), discounted("2025-08", 7, 30000, 0.15)];
  const model = computeSalesModel({ rows, previousRows, filters: noFilters, period: yearView, companies, repOf });
  assert.equal(Math.round(model.previousDiscount?.percent ?? 0), 15);
  assert.ok((model.currentDiscount?.percent ?? 0) > 17);
  assert.equal(model.hasCommissions, false, "sin comisiones en Sage no se enseña la columna");
  const texts = model.findings.map((finding) => finding.text);
  assert.ok(texts.some((text) => text.startsWith("Sergio Almodóvar Alcaraz rebaja un 30,0 %")), texts.join(" | "));
  assert.ok(texts.some((text) => text.startsWith("El descuento medio sube")), texts.join(" | "));
  assert.ok(texts.some((text) => text.includes("del mismo tramo de 2025")), texts.join(" | "));
  assert.equal(texts.some((text) => text.startsWith("Ana Ruiz rebaja")), false, "Ana está en la media");
});

test("comparar con otras fechas: cada mes con su pareja y qué explica la diferencia", () => {
  // Marzo-junio de 2026 contra noviembre de 2025-febrero de 2026 (el periodo anterior).
  const period: PeriodView = {
    months: ["2026-03", "2026-04", "2026-05", "2026-06"], monthOffset: -4, comparable: true,
    versus: "noviembre de 2025–febrero de 2026", basePartial: false, multiYear: false,
  };
  const rows = [row("2026-03", 1, "TK", 5, 1000), row("2026-04", 1, "CRE", 7, 3000), row("2026-06", 1, "CRE", 7, 500)];
  const previousRows = [row("2025-11", 1, "TK", 5, 2000), row("2025-12", 1, "CRE", 7, 1000)];
  const model = computeSalesModel({ rows, previousRows, filters: noFilters, period, companies, repOf });
  assert.equal(model.previous.net, 3000);
  assert.deepEqual(model.monthly.months.map((month) => month.pair), ["2025-11", "2025-12", "2026-01", "2026-02"]);
  assert.equal(model.monthly.months[0].beforeNet, 2000);
  assert.equal(model.monthly.currentMonth, null, "un periodo cerrado no tiene mes en curso");
  // Sergio baja 1.000 y Ana sube 2.500: la lista va de lo que más sube a lo que más baja.
  assert.deepEqual(model.differences?.rep.map((item) => [item.label, item.change]), [["Ana Ruiz", 2500], ["Sergio Almodóvar Alcaraz", -1000]]);
  assert.deepEqual(model.differences?.channel.map((item) => item.key), ["Crédito", "Tienda"]);
  // Con un mes elegido se compara con su pareja.
  const april = computeSalesModel({ rows, previousRows, filters: { ...noFilters, month: "2026-04" }, period, companies, repOf });
  assert.equal(april.current.net, 3000);
  assert.equal(april.previous.net, 1000);
});

test("sin una comparación válida no hay flechas, pero mes a mes sí se compara", () => {
  const period: PeriodView = { ...yearView, comparable: false, versus: null };
  const rows = [row("2026-08", 1, "TK", 5, 1000)];
  const previousRows = [row("2025-08", 1, "TK", 5, 500)];
  const model = computeSalesModel({ rows, previousRows, filters: noFilters, period, companies, repOf });
  assert.equal(model.previous.net, 0);
  assert.equal(model.differences, null);
  assert.equal(model.monthly.months[7].beforeNet, 500);
});

test("año contra año: la variación solo cuenta los meses cerrados que tienen los dos años", () => {
  const months = ["2025-11", "2025-12", "2026-01", "2026-02", "2026-03"];
  const rows = [row("2025-11", 1, "TK", 5, 100), row("2025-12", 1, "TK", 5, 200), row("2026-01", 1, "TK", 5, 300), row("2026-03", 1, "TK", 5, 50)];
  const view = yearlyView({ rows, filters: noFilters, repOf, months, basePartial: true });
  assert.deepEqual(view.years, [2025, 2026]);
  assert.equal(view.points[0].y2026, 300);
  assert.equal(view.points[0].y2025, null, "enero de 2025 no está en el periodo: la línea se corta, no cae a cero");
  assert.equal(view.points[10].y2025, 100);
  assert.equal(view.table[0].change, null, "2025 no tiene nada antes con lo que compararse");
  assert.equal(view.table[1].bucket.net, 350);
  assert.equal(view.table[1].change, null, "2026 no tiene ningún mes en común con 2025");
  assert.equal(view.table[1].complete, false);
  assert.equal(view.series[1].color, "#4f46e5", "el año más reciente va en el color fuerte");

  const twoYears = ["2024-01", "2024-02", "2025-01", "2025-02", "2025-03"];
  const history = [row("2024-01", 1, "TK", 5, 100), row("2024-02", 1, "TK", 5, 100), row("2025-01", 1, "TK", 5, 150), row("2025-02", 1, "TK", 5, 150), row("2025-03", 1, "TK", 5, 999)];
  const compared = yearlyView({ rows: history, filters: noFilters, repOf, months: twoYears, basePartial: true });
  assert.equal(compared.table[1].change, 50, "enero y febrero contra enero y febrero; marzo va por la mitad");
  assert.equal(compared.table[1].span, "ene–feb");
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
